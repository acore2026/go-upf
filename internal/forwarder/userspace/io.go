package userspace

import (
	"errors"
	"io"
	"net"

	"github.com/acore2026/go-upf/internal/logger"
)

const maxPacketSize = 64 * 1024

type ioBackend interface {
	start(*Driver)
	write(PacketOutcome) error
	close()
}

type runtimeIO struct {
	backend ioBackend
}

func (d *Driver) startRuntime(opts options) error {
	rio, err := openRuntimeIO(opts)
	if err != nil {
		return err
	}
	d.io = rio
	if rio == nil {
		return nil
	}

	rio.start(d)
	egressLoops := max(1, len(d.workers))
	for i := 0; i < egressLoops; i++ {
		d.startLoop(d.egressLoop)
	}
	return nil
}

func openRuntimeIO(opts options) (*runtimeIO, error) {
	backend, err := newUDPTUNBackend(opts)
	if err != nil {
		return nil, err
	}
	if backend == nil {
		return nil, nil
	}
	return &runtimeIO{backend: backend}, nil
}

func (d *Driver) startLoop(fn func()) {
	d.ioWg.Add(1)
	if d.wg != nil {
		d.wg.Add(1)
	}
	go func() {
		defer d.ioWg.Done()
		if d.wg != nil {
			defer d.wg.Done()
		}
		fn()
	}()
}

func (d *Driver) egressLoop() {
	for {
		select {
		case <-d.stopCh:
			return
		case outcome := <-d.egressCh:
			if err := d.writeOutcome(outcome); err != nil && !d.isRuntimeClosed(err) {
				logger.FwderLog.Debugf("userspace egress write error: format=%d pdr=%d seid=%d err=%v", outcome.Format, outcome.PDRID, outcome.SEID, err)
				d.stats.egressErrors.Add(1)
			}
		}
	}
}

func (d *Driver) writeOutcome(outcome PacketOutcome) error {
	if d.io == nil || d.io.backend == nil {
		return nil
	}
	return d.io.backend.write(outcome)
}

func (d *Driver) isRuntimeClosed(err error) bool {
	if err == nil {
		return false
	}
	select {
	case <-d.stopCh:
		return true
	default:
	}
	return errors.Is(err, net.ErrClosed) || errors.Is(err, io.EOF)
}

func (r *runtimeIO) start(d *Driver) {
	if r != nil && r.backend != nil {
		r.backend.start(d)
	}
}

func (r *runtimeIO) close() {
	if r != nil && r.backend != nil {
		r.backend.close()
	}
}
