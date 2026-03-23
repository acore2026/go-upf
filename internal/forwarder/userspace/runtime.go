package userspace

import (
	"encoding/binary"
	"errors"
	"net"
	"sort"
	"sync/atomic"
	"time"

	"github.com/wmnsk/go-pfcp/ie"

	"github.com/acore2026/go-upf/internal/report"
)

type RuntimeSnapshot struct {
	GeneratedAt   time.Time
	Sessions      map[uint64]*SessionState
	Uplink        map[uint32][]*PDRBinding
	Downlink      map[string][]*PDRBinding
	AdaptiveTrace []AdaptiveTraceEvent
}

type PDRBinding struct {
	SEID uint64
	PDR  *PDRRule
	FAR  *FARRule
	QERs []*QERRule
	URRs []*URRRule
	BAR  *BARRule
}

func newRuntimeSnapshot() *RuntimeSnapshot {
	return &RuntimeSnapshot{
		GeneratedAt: time.Now().UTC(),
		Sessions:    make(map[uint64]*SessionState),
		Uplink:      make(map[uint32][]*PDRBinding),
		Downlink:    make(map[string][]*PDRBinding),
	}
}

func cloneSessionState(sess *SessionState) *SessionState {
	cp := NewSessionState(sess.SEID)
	cp.UpdatedAt = sess.UpdatedAt
	for id, rule := range sess.PDRs {
		cp.PDRs[id] = rule
	}
	for id, rule := range sess.FARs {
		cp.FARs[id] = rule
	}
	for id, rule := range sess.QERs {
		cp.QERs[id] = rule
	}
	for key, rule := range sess.AdaptiveQER {
		cp.AdaptiveQER[key] = rule
	}
	for id, rule := range sess.URRs {
		cp.URRs[id] = rule
	}
	for id, ts := range sess.URRPeriodAt {
		cp.URRPeriodAt[id] = ts
	}
	for id, rule := range sess.BARs {
		cp.BARs[id] = rule
	}
	for id, reports := range sess.URRReports {
		cp.URRReports[id] = append([]report.USAReport(nil), reports...)
	}
	for key, flow := range sess.AdaptiveFlows {
		cp.AdaptiveFlows[key] = flow
	}
	return cp
}

func buildRuntimeSnapshot(sessions map[uint64]*SessionState, trace []AdaptiveTraceEvent) *RuntimeSnapshot {
	snapshot := newRuntimeSnapshot()
	snapshot.AdaptiveTrace = append(snapshot.AdaptiveTrace, trace...)

	for seid, sess := range sessions {
		snapshot.Sessions[seid] = cloneSessionState(sess)

		for _, pdr := range sess.PDRs {
			binding := &PDRBinding{
				SEID: seid,
				PDR:  pdr,
			}
			if pdr.FARID != nil {
				binding.FAR = sess.FARs[*pdr.FARID]
				if binding.FAR != nil && binding.FAR.BARID != nil {
					binding.BAR = sess.BARs[*binding.FAR.BARID]
				}
			}
			for _, qerID := range pdr.QERIDs {
				if qer := sess.QERs[qerID]; qer != nil {
					binding.QERs = append(binding.QERs, qer)
				}
			}
			for _, urrID := range pdr.URRIDs {
				if urr := sess.URRs[urrID]; urr != nil {
					binding.URRs = append(binding.URRs, urr)
				}
			}
			if pdr.PDI == nil {
				continue
			}
			if pdr.PDI.FTEID != nil && isAccessPDR(pdr) {
				snapshot.Uplink[pdr.PDI.FTEID.TEID] = append(snapshot.Uplink[pdr.PDI.FTEID.TEID], binding)
			}
			if len(pdr.PDI.UEIPv4) > 0 && isCorePDR(pdr) {
				key := pdr.PDI.UEIPv4.String()
				snapshot.Downlink[key] = append(snapshot.Downlink[key], binding)
			}
		}
	}

	for key := range snapshot.Uplink {
		sortBindings(snapshot.Uplink[key])
	}
	for key := range snapshot.Downlink {
		sortBindings(snapshot.Downlink[key])
	}

	return snapshot
}

func sortBindings(bindings []*PDRBinding) {
	sort.SliceStable(bindings, func(i, j int) bool {
		left := precedenceOf(bindings[i].PDR)
		right := precedenceOf(bindings[j].PDR)
		if left == right {
			return bindings[i].PDR.ID < bindings[j].PDR.ID
		}
		return left > right
	})
}

func precedenceOf(rule *PDRRule) uint32 {
	if rule == nil || rule.Precedence == nil {
		return 0
	}
	return *rule.Precedence
}

func isAccessPDR(rule *PDRRule) bool {
	if rule == nil || rule.PDI == nil || rule.PDI.SourceInterface == nil {
		return false
	}
	return *rule.PDI.SourceInterface == ie.SrcInterfaceAccess
}

func isCorePDR(rule *PDRRule) bool {
	if rule == nil || rule.PDI == nil || rule.PDI.SourceInterface == nil {
		return false
	}
	return *rule.PDI.SourceInterface == ie.SrcInterfaceCore
}

func shardForSEID(seid uint64, workerCount int) int {
	if workerCount <= 1 {
		return 0
	}
	return int(seid % uint64(workerCount))
}

func shardForTEID(teid uint32, workerCount int) int {
	if workerCount <= 1 {
		return 0
	}
	return int(teid % uint32(workerCount))
}

func shardForIPv4(ip net.IP, workerCount int) int {
	if workerCount <= 1 || len(ip) == 0 {
		return 0
	}
	v4 := ip.To4()
	if v4 == nil {
		return 0
	}
	return int(binary.BigEndian.Uint32(v4) % uint32(workerCount))
}

func (d *Driver) publishSnapshotLocked() {
	var trace []AdaptiveTraceEvent
	if d.adaptiveTrace != nil {
		trace = d.adaptiveTrace.snapshot(0)
	}
	d.snapshot.Store(buildRuntimeSnapshot(d.sessions, trace))
}

func (d *Driver) Snapshot() *RuntimeSnapshot {
	value := d.snapshot.Load()
	if value == nil {
		return newRuntimeSnapshot()
	}
	return value.(*RuntimeSnapshot)
}

func (d *Driver) MatchUplink(teid uint32, ueIP net.IP) *PDRBinding {
	return d.matchUplink(teid, ueIP, nil)
}

func (d *Driver) matchUplink(teid uint32, ueIP net.IP, meta *packetMeta) *PDRBinding {
	snapshot := d.Snapshot()
	bindings := snapshot.Uplink[teid]
	if binding := selectUplinkBinding(bindings, ueIP, meta); binding != nil {
		return binding
	}

	// Some live free5GC/UERANSIM flows can shift the AN TEID without the
	// userspace runtime seeing the updated uplink PDR TEID. Fall back to a
	// global uplink scan and let precedence/SDF/UE-IP narrow the match.
	var fallbackBindings []*PDRBinding
	for key, candidates := range snapshot.Uplink {
		if key == teid {
			continue
		}
		fallbackBindings = append(fallbackBindings, candidates...)
	}
	return selectUplinkBinding(fallbackBindings, ueIP, meta)
}

func selectUplinkBinding(bindings []*PDRBinding, ueIP net.IP, meta *packetMeta) *PDRBinding {
	var fallback *PDRBinding
	for _, binding := range bindings {
		if binding.PDR == nil || binding.PDR.PDI == nil {
			continue
		}
		if !matchSDF(binding, meta, PacketDirectionUplink) {
			continue
		}
		if len(ueIP) > 0 && len(binding.PDR.PDI.UEIPv4) > 0 {
			if binding.PDR.PDI.UEIPv4.Equal(ueIP) {
				return binding
			}
			if fallback == nil {
				fallback = binding
			}
			continue
		}
		return binding
	}
	return fallback
}

func (d *Driver) MatchDownlink(ueIP net.IP) *PDRBinding {
	return d.matchDownlink(ueIP, nil)
}

func (d *Driver) matchDownlink(ueIP net.IP, meta *packetMeta) *PDRBinding {
	if len(ueIP) == 0 {
		return nil
	}
	bindings := d.Snapshot().Downlink[ueIP.String()]
	for _, binding := range bindings {
		if matchSDF(binding, meta, PacketDirectionDownlink) {
			return binding
		}
	}
	return nil
}

func (d *Driver) ReportUsage(seid uint64, urrid uint32, reports []report.USAReport) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.URRs[urrid]; !ok {
		return ErrURRNotFound
	}

	sess.URRReports[urrid] = append([]report.USAReport(nil), reports...)
	sess.touch()
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) DispatchPacket(packet Packet) PacketResult {
	if len(d.workers) == 0 {
		return PacketResult{Err: errNoWorkers}
	}

	worker := d.workers[d.workerIndexFor(packet)]
	resp := make(chan PacketResult, 1)
	job := packetJob{
		packet: packet,
		resp:   resp,
	}
	select {
	case <-d.stopCh:
		return PacketResult{Err: errNoWorkers}
	case worker.queue <- job:
	}

	select {
	case <-d.stopCh:
		return PacketResult{Err: errNoWorkers}
	case result := <-resp:
		return result
	}
}

func (d *Driver) enqueuePacket(packet Packet) error {
	if len(d.workers) == 0 {
		return errNoWorkers
	}

	worker := d.workers[d.workerIndexFor(packet)]
	select {
	case <-d.stopCh:
		return errNoWorkers
	case worker.queue <- packetJob{packet: packet}:
		return nil
	}
}

func (d *Driver) ProcessUplinkGTP(payload []byte) PacketResult {
	return d.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		TEID:      uplinkTEID(payload),
		Payload:   payload,
	})
}

func (d *Driver) ProcessDownlinkIP(payload []byte) PacketResult {
	ueIP := downlinkUEIP(payload)
	return d.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		UEIP:      ueIP,
		Payload:   payload,
	})
}

func uplinkTEID(payload []byte) uint32 {
	if len(payload) < 8 {
		return 0
	}
	return binary.BigEndian.Uint32(payload[4:8])
}

func downlinkUEIP(payload []byte) net.IP {
	meta, err := parseIPv4PacketMeta(payload)
	if err != nil {
		return nil
	}
	return meta.DstIP
}

func (d *Driver) workerIndexFor(packet Packet) int {
	switch packet.Direction {
	case PacketDirectionUplink:
		if packet.SEIDHint != 0 {
			return shardForSEID(packet.SEIDHint, len(d.workers))
		}
		if packet.TEID != 0 {
			return shardForTEID(packet.TEID, len(d.workers))
		}
	case PacketDirectionDownlink:
		if packet.SEIDHint != 0 {
			return shardForSEID(packet.SEIDHint, len(d.workers))
		}
		return shardForIPv4(packet.UEIP, len(d.workers))
	}
	return 0
}

func resolveAction(binding *PDRBinding) PacketAction {
	if binding == nil || binding.FAR == nil {
		return PacketActionUnknown
	}
	switch {
	case binding.FAR.ApplyAction.DROP():
		return PacketActionDrop
	case binding.FAR.ApplyAction.BUFF():
		return PacketActionBuffer
	case binding.FAR.ApplyAction.FORW():
		return PacketActionForward
	default:
		return PacketActionUnknown
	}
}

type snapshotHolder struct {
	value atomic.Value
}

func newSnapshotHolder() snapshotHolder {
	var holder snapshotHolder
	holder.Store(newRuntimeSnapshot())
	return holder
}

var errNoWorkers = errors.New("userspace: no workers available")

func (s *snapshotHolder) Load() any {
	return s.value.Load()
}

func (s *snapshotHolder) Store(snapshot *RuntimeSnapshot) {
	s.value.Store(snapshot)
}
