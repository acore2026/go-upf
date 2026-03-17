package userspace

import (
	"errors"
	"net"
	"runtime"
	"sync"
	"time"

	"github.com/free5gc/go-upf/internal/report"
	"github.com/free5gc/go-upf/pkg/factory"
)

type options struct {
	workers   int
	queueSize int
	tunName   string
	tunMTU    uint32
	ifaces    []factory.IfInfo
	dnns      []factory.DnnList
}

func optionsFromConfig(cfg *factory.Config) options {
	opt := options{
		workers:   runtime.GOMAXPROCS(0),
		queueSize: 1024,
	}
	if cfg == nil || cfg.Gtpu == nil {
		return opt
	}
	opt.ifaces = append(opt.ifaces, cfg.Gtpu.IfList...)
	opt.dnns = append(opt.dnns, cfg.DnnList...)
	if cfg.Gtpu.Userspace != nil {
		if cfg.Gtpu.Userspace.Workers > 0 {
			opt.workers = cfg.Gtpu.Userspace.Workers
		}
		if cfg.Gtpu.Userspace.QueueSize > 0 {
			opt.queueSize = cfg.Gtpu.Userspace.QueueSize
		}
		opt.tunName = cfg.Gtpu.Userspace.TunName
		opt.tunMTU = cfg.Gtpu.Userspace.TunMTU
	}
	if opt.workers <= 0 {
		opt.workers = 1
	}
	if opt.queueSize <= 0 {
		opt.queueSize = 1024
	}
	if opt.tunName == "" {
		opt.tunName = "upfusr0"
	}
	return opt
}

type worker struct {
	id         int
	driver     *Driver
	queue      chan packetJob
	stopCh     <-chan struct{}
	wg         *sync.WaitGroup
	externalWg *sync.WaitGroup
}

type PacketDirection uint8

const (
	PacketDirectionUplink PacketDirection = iota + 1
	PacketDirectionDownlink
)

type PacketAction uint8

const (
	PacketActionUnknown PacketAction = iota
	PacketActionDrop
	PacketActionForward
	PacketActionBuffer
)

type Packet struct {
	Direction PacketDirection
	SEIDHint  uint64
	TEID      uint32
	UEIP      net.IP
	Payload   []byte
}

type PacketResult struct {
	WorkerID int
	Action   PacketAction
	Binding  *PDRBinding
	Outcome  *PacketOutcome
	Err      error
}

type packetJob struct {
	packet Packet
	resp   chan PacketResult
}

func (w *worker) run() {
	if w.wg != nil {
		defer w.wg.Done()
	}
	if w.externalWg != nil {
		defer w.externalWg.Done()
	}
	for {
		select {
		case <-w.stopCh:
			return
		case job := <-w.queue:
			job.resp <- w.process(job.packet)
		}
	}
}

func (d *Driver) startWorkers(opt options) {
	for i := 0; i < opt.workers; i++ {
		w := &worker{
			id:         i,
			driver:     d,
			queue:      make(chan packetJob, opt.queueSize),
			stopCh:     d.stopCh,
			wg:         &d.workerWg,
			externalWg: d.wg,
		}
		d.workers = append(d.workers, w)
		d.workerWg.Add(1)
		if d.wg != nil {
			d.wg.Add(1)
		}
		go w.run()
	}
}

func (w *worker) process(packet Packet) PacketResult {
	result := PacketResult{WorkerID: w.id}
	switch packet.Direction {
	case PacketDirectionUplink:
		result = w.driver.processUplink(packet, result)
	case PacketDirectionDownlink:
		result = w.driver.processDownlink(packet, result)
	default:
		result.Err = errors.New("userspace: unknown packet direction")
		return result
	}
	return result
}

type SessionState struct {
	SEID        uint64
	PDRs        map[uint16]*PDRRule
	FARs        map[uint32]*FARRule
	QERs        map[uint32]*QERRule
	QERMeters   map[uint32]*QERMeterState
	URRs        map[uint32]*URRRule
	URRPeriodAt map[uint32]time.Time
	BARs        map[uint8]*BARRule
	Buffers     map[uint16][][]byte
	URRReports  map[uint32][]report.USAReport
	UpdatedAt   time.Time
}

func NewSessionState(seid uint64) *SessionState {
	return &SessionState{
		SEID:        seid,
		PDRs:        make(map[uint16]*PDRRule),
		FARs:        make(map[uint32]*FARRule),
		QERs:        make(map[uint32]*QERRule),
		QERMeters:   make(map[uint32]*QERMeterState),
		URRs:        make(map[uint32]*URRRule),
		URRPeriodAt: make(map[uint32]time.Time),
		BARs:        make(map[uint8]*BARRule),
		Buffers:     make(map[uint16][][]byte),
		URRReports:  make(map[uint32][]report.USAReport),
		UpdatedAt:   time.Now().UTC(),
	}
}

func (s *SessionState) touch() {
	s.UpdatedAt = time.Now().UTC()
}

type PDRRule struct {
	ID                 uint16
	Precedence         *uint32
	PDI                *PDI
	OuterHeaderRemoval *uint8
	FARID              *uint32
	QERIDs             []uint32
	URRIDs             []uint32
	Raw                []byte
}

type PDI struct {
	SourceInterface *uint8
	FTEID           *FTEID
	NetworkInstance string
	UEIPv4          net.IP
	SDFFilters      []string
	SDFRules        []*SDFFilterRule
	ApplicationID   string
}

type FTEID struct {
	TEID uint32
	IPv4 net.IP
}

type FARRule struct {
	ID          uint32
	ApplyAction report.ApplyAction
	Forwarding  *ForwardingParameters
	BARID       *uint8
	Raw         []byte
}

type ForwardingParameters struct {
	DestinationInterface *uint8
	NetworkInstance      string
	OuterHeaderCreation  *OuterHeaderCreation
	ForwardingPolicy     string
	PFCPSMReqFlags       *uint8
}

type OuterHeaderCreation struct {
	Description uint16
	TEID        uint32
	IPv4        net.IP
	Port        uint16
}

type QERRule struct {
	ID            uint32
	CorrelationID *uint32
	GateStatus    *uint8
	MBRUL         *uint64
	MBRDL         *uint64
	GBRUL         *uint64
	GBRDL         *uint64
	QFI           *uint8
	RQI           *uint8
	PPI           *uint8
	Raw           []byte
}

type URRRule struct {
	ID                     uint32
	MeasurementMethod      report.MeasureMethod
	ReportingTrigger       report.ReportingTrigger
	MeasurementPeriod      time.Duration
	MeasurementInformation report.MeasureInformation
	VolumeThreshold        *VolumeLimit
	VolumeQuota            *VolumeLimit
	Raw                    []byte
}

type VolumeLimit struct {
	Flags          uint8
	TotalVolume    uint64
	UplinkVolume   uint64
	DownlinkVolume uint64
}

type QERMeterState struct {
	Uplink   tokenBucket
	Downlink tokenBucket
}

type tokenBucket struct {
	Tokens     float64
	LastRefill time.Time
}

type SDFFilterRule struct {
	Action      string
	Direction   string
	Protocol    string
	Source      *FlowEndpoint
	Destination *FlowEndpoint
}

type FlowEndpoint struct {
	Any      bool
	Assigned bool
	Network  *net.IPNet
	Ports    []PortRange
}

type PortRange struct {
	From uint16
	To   uint16
}

type BARRule struct {
	ID                             uint8
	DownlinkDataNotificationDelay  *time.Duration
	SuggestedBufferingPacketsCount *uint16
	Raw                            []byte
}
