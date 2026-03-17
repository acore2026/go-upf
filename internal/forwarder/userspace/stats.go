package userspace

import "sync/atomic"

type StatsSnapshot struct {
	UplinkPackets         uint64
	DownlinkPackets       uint64
	ForwardedPackets      uint64
	DroppedPackets        uint64
	BufferedPackets       uint64
	UplinkPDRMisses       uint64
	DownlinkPDRMisses     uint64
	UnsupportedDownlinkL3 uint64
	UplinkPacketErrors    uint64
	DownlinkPacketErrors  uint64
	RuntimeIOErrors       uint64
	EgressErrors          uint64
}

type statsTracker struct {
	uplinkPackets         atomic.Uint64
	downlinkPackets       atomic.Uint64
	forwardedPackets      atomic.Uint64
	droppedPackets        atomic.Uint64
	bufferedPackets       atomic.Uint64
	uplinkPdrMisses       atomic.Uint64
	downlinkPdrMisses     atomic.Uint64
	unsupportedDownlinkL3 atomic.Uint64
	uplinkPacketErrors    atomic.Uint64
	downlinkPacketErrors  atomic.Uint64
	runtimeIOErrors       atomic.Uint64
	egressErrors          atomic.Uint64
}

func newStatsTracker() *statsTracker {
	return &statsTracker{}
}

func (d *Driver) Stats() StatsSnapshot {
	if d == nil || d.stats == nil {
		return StatsSnapshot{}
	}
	return StatsSnapshot{
		UplinkPackets:         d.stats.uplinkPackets.Load(),
		DownlinkPackets:       d.stats.downlinkPackets.Load(),
		ForwardedPackets:      d.stats.forwardedPackets.Load(),
		DroppedPackets:        d.stats.droppedPackets.Load(),
		BufferedPackets:       d.stats.bufferedPackets.Load(),
		UplinkPDRMisses:       d.stats.uplinkPdrMisses.Load(),
		DownlinkPDRMisses:     d.stats.downlinkPdrMisses.Load(),
		UnsupportedDownlinkL3: d.stats.unsupportedDownlinkL3.Load(),
		UplinkPacketErrors:    d.stats.uplinkPacketErrors.Load(),
		DownlinkPacketErrors:  d.stats.downlinkPacketErrors.Load(),
		RuntimeIOErrors:       d.stats.runtimeIOErrors.Load(),
		EgressErrors:          d.stats.egressErrors.Load(),
	}
}
