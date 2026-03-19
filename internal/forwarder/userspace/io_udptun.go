package userspace

import (
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"syscall"

	"github.com/acore2026/go-upf/internal/logger"
	"github.com/acore2026/go-upf/pkg/factory"
	"github.com/khirono/go-nl"
	"github.com/khirono/go-rtnllink"
	"github.com/khirono/go-rtnlroute"
)

type udpTunBackend struct {
	mu      sync.Mutex
	udp     *net.UDPConn
	tun     tunDevice
	rt      *nl.Conn
	mux     *nl.Mux
	rtnlc   *nl.Client
	muxDone chan struct{}
}

func newUDPTUNBackend(opts options) (ioBackend, error) {
	var needTun bool
	for _, dnn := range opts.dnns {
		if dnn.Cidr != "" {
			needTun = true
			break
		}
	}

	var bindAddr string
	for _, ifInfo := range opts.ifaces {
		if strings.EqualFold(ifInfo.Type, "N3") {
			bindAddr = net.JoinHostPort(ifInfo.Addr, fmt.Sprintf("%d", factory.UpfGtpDefaultPort))
			break
		}
	}

	if bindAddr == "" && !needTun {
		return nil, nil
	}

	backend := &udpTunBackend{}
	if bindAddr != "" {
		laddr, err := net.ResolveUDPAddr("udp4", bindAddr)
		if err != nil {
			backend.close()
			return nil, err
		}
		conn, err := net.ListenUDP("udp4", laddr)
		if err != nil {
			backend.close()
			return nil, err
		}
		backend.udp = conn
		logger.FwderLog.Infof("userspace N3 UDP socket listening on %s", conn.LocalAddr())
	}

	if needTun {
		conn, err := nl.Open(syscall.NETLINK_ROUTE)
		if err != nil {
			backend.close()
			return nil, err
		}
		backend.rt = conn
		mux, err := nl.NewMux()
		if err != nil {
			backend.close()
			return nil, err
		}
		backend.mux = mux
		backend.muxDone = make(chan struct{})
		go func() {
			defer close(backend.muxDone)
			if err := backend.mux.Serve(); err != nil {
				logger.FwderLog.Warnf("userspace rtnetlink mux stopped: %+v", err)
			}
		}()
		backend.rtnlc = nl.NewClient(conn, backend.mux)

		tun, err := openTUN(opts.tunName)
		if err != nil {
			backend.close()
			return nil, err
		}
		backend.tun = tun

		if err := bringLinkUp(backend.rtnlc, tun.Name()); err != nil {
			backend.close()
			return nil, err
		}
		if opts.tunMTU != 0 {
			if err := tun.SetMTU(int(opts.tunMTU)); err != nil {
				backend.close()
				return nil, err
			}
		}
		for _, dnn := range opts.dnns {
			if dnn.Cidr == "" {
				continue
			}
			_, dst, err := net.ParseCIDR(dnn.Cidr)
			if err != nil {
				backend.close()
				return nil, err
			}
			if err := routeAdd(backend.rtnlc, tun.Name(), dst); err != nil {
				backend.close()
				return nil, err
			}
		}
		logger.FwderLog.Infof("userspace N6 TUN device %s ready", tun.Name())
	}

	return backend, nil
}

func (b *udpTunBackend) start(d *Driver) {
	if b.udp != nil {
		d.startLoop(func() { b.udpReadLoop(d) })
	}
	if b.tun != nil {
		d.startLoop(func() { b.tunReadLoop(d) })
	}
}

func (b *udpTunBackend) udpReadLoop(d *Driver) {
	buf := make([]byte, maxPacketSize)
	for {
		n, _, err := b.udp.ReadFromUDP(buf)
		if err != nil {
			if d.isRuntimeClosed(err) {
				return
			}
			d.stats.runtimeIOErrors.Add(1)
			continue
		}
		payload := append([]byte(nil), buf[:n]...)
		if err := d.enqueuePacket(Packet{
			Direction: PacketDirectionUplink,
			TEID:      uplinkTEID(payload),
			Payload:   payload,
		}); err != nil {
			d.stats.runtimeIOErrors.Add(1)
		}
	}
}

func (b *udpTunBackend) tunReadLoop(d *Driver) {
	buf := make([]byte, maxPacketSize)
	for {
		n, err := b.tun.Read(buf)
		if err != nil {
			if d.isRuntimeClosed(err) {
				return
			}
			d.stats.runtimeIOErrors.Add(1)
			continue
		}
		payload := append([]byte(nil), buf[:n]...)
		ueIP := downlinkUEIP(payload)
		if ueIP == nil {
			if !errors.Is(d.ProcessDownlinkIP(payload).Err, errUnsupportedDownlinkPayload) {
				d.stats.runtimeIOErrors.Add(1)
			}
			continue
		}
		if err := d.enqueuePacket(Packet{
			Direction: PacketDirectionDownlink,
			UEIP:      ueIP,
			Payload:   payload,
		}); err != nil {
			d.stats.runtimeIOErrors.Add(1)
		}
	}
}

func (b *udpTunBackend) write(outcome PacketOutcome) error {
	switch outcome.Format {
	case PayloadFormatGTPU:
		if b.udp == nil || outcome.Peer == nil {
			return nil
		}
		_, err := b.udp.WriteToUDP(outcome.Payload, outcome.Peer)
		return err
	case PayloadFormatRawIP:
		if b.tun == nil {
			return nil
		}
		_, err := b.tun.Write(outcome.Payload)
		return err
	default:
		return nil
	}
}

func (b *udpTunBackend) close() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.udp != nil {
		_ = b.udp.Close()
		b.udp = nil
	}
	if b.tun != nil {
		_ = b.tun.Close()
		b.tun = nil
	}
	if b.rt != nil {
		b.rt.Close()
		b.rt = nil
	}
	if b.mux != nil {
		b.mux.Close()
		b.mux = nil
	}
	if b.muxDone != nil {
		<-b.muxDone
		b.muxDone = nil
	}
	b.rtnlc = nil
}

func bringLinkUp(client *nl.Client, ifName string) error {
	return rtnllink.Up(client, ifName)
}

func routeAdd(client *nl.Client, ifName string, dst *net.IPNet) error {
	req := &rtnlroute.Request{
		Header: rtnlroute.Header{
			Table:    syscall.RT_TABLE_MAIN,
			Scope:    syscall.RT_SCOPE_UNIVERSE,
			Protocol: syscall.RTPROT_STATIC,
			Type:     syscall.RTN_UNICAST,
		},
	}
	if err := req.AddDst(dst); err != nil {
		return err
	}
	if err := req.AddIfName(ifName); err != nil {
		return err
	}
	return rtnlroute.Create(client, req)
}
