package userspace

import (
	"encoding/binary"
	"errors"
	"net"
	"time"

	"github.com/wmnsk/go-pfcp/ie"

	"github.com/free5gc/go-upf/internal/gtpv1"
	"github.com/free5gc/go-upf/internal/report"
	"github.com/free5gc/go-upf/pkg/factory"
)

const (
	qerULGateClosed = 0x04
	qerDLGateClosed = 0x01
)

var errUnsupportedDownlinkPayload = errors.New("userspace: unsupported non-IPv4 downlink payload")

type PayloadFormat uint8

const (
	PayloadFormatUnknown PayloadFormat = iota
	PayloadFormatRawIP
	PayloadFormatGTPU
)

type PacketOutcome struct {
	SEID    uint64
	PDRID   uint16
	Action  PacketAction
	Format  PayloadFormat
	Payload []byte
	Peer    *net.UDPAddr
}

func (d *Driver) processUplink(packet Packet, result PacketResult) PacketResult {
	d.stats.uplinkPackets.Add(1)
	decoded, err := decodeGTPU(packet.Payload)
	if err != nil {
		result.Err = err
		d.stats.uplinkPacketErrors.Add(1)
		d.stats.droppedPackets.Add(1)
		return result
	}
	meta, err := parseIPv4PacketMeta(decoded.InnerPayload)
	if err != nil {
		result.Err = err
		d.stats.uplinkPacketErrors.Add(1)
		d.stats.droppedPackets.Add(1)
		return result
	}
	ueIP := packet.UEIP
	if len(ueIP) == 0 {
		ueIP = meta.SrcIP
	}

	result.Binding = d.matchUplink(decoded.TEID, ueIP, meta)
	if result.Binding == nil {
		result.Err = errors.New("userspace: packet did not match any uplink PDR")
		d.stats.uplinkPdrMisses.Add(1)
		d.stats.uplinkPacketErrors.Add(1)
		d.stats.droppedPackets.Add(1)
		return result
	}
	result.Action = resolveAction(result.Binding)
	if gateClosed(result.Binding, PacketDirectionUplink) {
		result.Action = PacketActionDrop
	}
	if result.Action == PacketActionForward && !d.mbrAllows(result.Binding, len(decoded.InnerPayload), PacketDirectionUplink) {
		result.Action = PacketActionDrop
	}

	switch result.Action {
	case PacketActionForward:
		outcome, err := d.forwardUplink(result.Binding, decoded.InnerPayload)
		if err != nil {
			result.Err = err
			d.stats.uplinkPacketErrors.Add(1)
			d.stats.droppedPackets.Add(1)
			return result
		}
		result.Outcome = outcome
		d.stats.forwardedPackets.Add(1)
		d.publishOutcome(outcome)
	case PacketActionBuffer:
		outcome := d.bufferPacket(result.Binding, decoded.InnerPayload)
		result.Outcome = outcome
		d.stats.bufferedPackets.Add(1)
	default:
		result.Outcome = &PacketOutcome{
			SEID:   result.Binding.SEID,
			PDRID:  result.Binding.PDR.ID,
			Action: result.Action,
			Format: PayloadFormatRawIP,
		}
		d.stats.droppedPackets.Add(1)
	}

	d.updateUsage(result.Binding, len(decoded.InnerPayload), true)
	return result
}

func (d *Driver) processDownlink(packet Packet, result PacketResult) PacketResult {
	d.stats.downlinkPackets.Add(1)
	meta, err := parseIPv4PacketMeta(packet.Payload)
	if err != nil {
		result.Action = PacketActionDrop
		result.Err = errUnsupportedDownlinkPayload
		d.stats.unsupportedDownlinkL3.Add(1)
		d.stats.downlinkPacketErrors.Add(1)
		d.stats.droppedPackets.Add(1)
		return result
	}
	ueIP := packet.UEIP
	if len(ueIP) == 0 {
		ueIP = meta.DstIP
	}

	result.Binding = d.matchDownlink(ueIP, meta)
	if result.Binding == nil {
		result.Err = errors.New("userspace: packet did not match any downlink PDR")
		d.stats.downlinkPdrMisses.Add(1)
		d.stats.downlinkPacketErrors.Add(1)
		d.stats.droppedPackets.Add(1)
		return result
	}
	result.Action = resolveAction(result.Binding)
	if gateClosed(result.Binding, PacketDirectionDownlink) {
		result.Action = PacketActionDrop
	}
	if result.Action == PacketActionForward && !d.mbrAllows(result.Binding, len(packet.Payload), PacketDirectionDownlink) {
		result.Action = PacketActionDrop
	}

	switch result.Action {
	case PacketActionForward:
		outcome, err := d.forwardDownlink(result.Binding, packet.Payload)
		if err != nil {
			result.Err = err
			d.stats.downlinkPacketErrors.Add(1)
			d.stats.droppedPackets.Add(1)
			return result
		}
		result.Outcome = outcome
		d.stats.forwardedPackets.Add(1)
		d.publishOutcome(outcome)
	case PacketActionBuffer:
		outcome := d.bufferPacket(result.Binding, packet.Payload)
		result.Outcome = outcome
		d.stats.bufferedPackets.Add(1)
	default:
		result.Outcome = &PacketOutcome{
			SEID:   result.Binding.SEID,
			PDRID:  result.Binding.PDR.ID,
			Action: result.Action,
			Format: PayloadFormatRawIP,
		}
		d.stats.droppedPackets.Add(1)
	}

	d.updateUsage(result.Binding, len(packet.Payload), false)
	return result
}

func (d *Driver) forwardUplink(binding *PDRBinding, payload []byte) (*PacketOutcome, error) {
	outcome := &PacketOutcome{
		SEID:    binding.SEID,
		PDRID:   binding.PDR.ID,
		Action:  PacketActionForward,
		Format:  PayloadFormatRawIP,
		Payload: append([]byte(nil), payload...),
	}
	if binding.FAR == nil || binding.FAR.Forwarding == nil || binding.FAR.Forwarding.OuterHeaderCreation == nil {
		return outcome, nil
	}

	encoded, peer, err := encodeGTPU(binding, payload, true)
	if err != nil {
		return nil, err
	}
	outcome.Format = PayloadFormatGTPU
	outcome.Payload = encoded
	outcome.Peer = peer
	return outcome, nil
}

func (d *Driver) forwardDownlink(binding *PDRBinding, payload []byte) (*PacketOutcome, error) {
	if binding.FAR == nil || binding.FAR.Forwarding == nil || binding.FAR.Forwarding.OuterHeaderCreation == nil {
		return &PacketOutcome{
			SEID:    binding.SEID,
			PDRID:   binding.PDR.ID,
			Action:  PacketActionForward,
			Format:  PayloadFormatRawIP,
			Payload: append([]byte(nil), payload...),
		}, nil
	}
	encoded, peer, err := encodeGTPU(binding, payload, false)
	if err != nil {
		return nil, err
	}
	return &PacketOutcome{
		SEID:    binding.SEID,
		PDRID:   binding.PDR.ID,
		Action:  PacketActionForward,
		Format:  PayloadFormatGTPU,
		Payload: encoded,
		Peer:    peer,
	}, nil
}

func (d *Driver) bufferPacket(binding *PDRBinding, payload []byte) *PacketOutcome {
	limit := bufferedPacketLimit(binding)

	d.mu.Lock()
	sess := d.sessions[binding.SEID]
	if sess != nil {
		queue := append(sess.Buffers[binding.PDR.ID], append([]byte(nil), payload...))
		if limit > 0 && len(queue) > limit {
			queue = queue[len(queue)-limit:]
		}
		sess.Buffers[binding.PDR.ID] = queue
		sess.touch()
	}
	d.mu.Unlock()

	d.scheduleBufferedNotification(binding, payload)

	return &PacketOutcome{
		SEID:   binding.SEID,
		PDRID:  binding.PDR.ID,
		Action: PacketActionBuffer,
		Format: PayloadFormatRawIP,
	}
}

func bufferedPacketLimit(binding *PDRBinding) int {
	if binding == nil || binding.BAR == nil || binding.BAR.SuggestedBufferingPacketsCount == nil {
		return 0
	}
	return int(*binding.BAR.SuggestedBufferingPacketsCount)
}

func (d *Driver) handleFARTransitionLocked(seid uint64, sess *SessionState, prev *FARRule, next *FARRule) {
	if prev == nil || next == nil || !prev.ApplyAction.BUFF() {
		return
	}

	for _, pdr := range sess.PDRs {
		if pdr.FARID == nil || *pdr.FARID != next.ID {
			continue
		}
		buffered := sess.Buffers[pdr.ID]
		if len(buffered) == 0 {
			continue
		}
		d.cancelPendingDDNLocked(ddnKey{SEID: seid, PDRID: pdr.ID})
		delete(sess.Buffers, pdr.ID)

		binding := d.Snapshot().Sessions[seid]
		var matched *PDRBinding
		if binding != nil {
			for _, candidate := range d.Snapshot().Downlink[pdr.PDI.UEIPv4.String()] {
				if candidate.SEID == seid && candidate.PDR.ID == pdr.ID {
					matched = candidate
					break
				}
			}
		}
		if matched == nil {
			matched = buildRuntimeSnapshot(d.sessions).Downlink[pdr.PDI.UEIPv4.String()][0]
		}

		switch {
		case next.ApplyAction.FORW():
			for _, payload := range buffered {
				outcome, err := d.forwardBufferedPayload(matched, payload)
				if err == nil {
					d.publishOutcome(outcome)
				}
			}
		case next.ApplyAction.DROP():
		}
	}
}

func (d *Driver) forwardBufferedPayload(binding *PDRBinding, payload []byte) (*PacketOutcome, error) {
	if binding == nil {
		return nil, errors.New("userspace: missing binding for buffered payload")
	}
	if binding.PDR.PDI != nil && binding.PDR.PDI.SourceInterface != nil && *binding.PDR.PDI.SourceInterface == ie.SrcInterfaceCore {
		return d.forwardDownlink(binding, payload)
	}
	return d.forwardUplink(binding, payload)
}

func (d *Driver) publishOutcome(outcome *PacketOutcome) {
	select {
	case d.egressCh <- *outcome:
	default:
	}
	select {
	case d.outputCh <- *outcome:
	default:
	}
}

func (d *Driver) emitReport(sessReport report.SessReport) {
	d.mu.RLock()
	handler := d.handler
	d.mu.RUnlock()
	if handler != nil {
		handler.NotifySessReport(sessReport)
	}
}

func (d *Driver) updateUsage(binding *PDRBinding, bytes int, uplink bool) {
	if binding == nil || len(binding.URRs) == 0 {
		return
	}
	now := time.Now().UTC()
	var reports []report.Report

	d.mu.Lock()
	sess := d.sessions[binding.SEID]
	if sess == nil {
		d.mu.Unlock()
		return
	}
	for _, urr := range binding.URRs {
		current := sess.URRReports[urr.ID]
		usage := report.USAReport{
			URRID:     urr.ID,
			StartTime: now,
			EndTime:   now,
		}
		if len(current) > 0 {
			usage = current[len(current)-1]
			usage.EndTime = now
		}
		usage.VolumMeasure.TotalVolume += uint64(bytes)
		usage.VolumMeasure.TotalPktNum++
		if uplink {
			usage.VolumMeasure.UplinkVolume += uint64(bytes)
			usage.VolumMeasure.UplinkPktNum++
		} else {
			usage.VolumMeasure.DownlinkVolume += uint64(bytes)
			usage.VolumMeasure.DownlinkPktNum++
		}

		triggered := false
		if urr.VolumeThreshold != nil && urr.VolumeThreshold.TotalVolume > 0 && usage.VolumMeasure.TotalVolume >= urr.VolumeThreshold.TotalVolume {
			usage.USARTrigger.SetReportingTrigger(report.RPT_TRIG_VOLTH)
			triggered = true
		}
		if urr.VolumeQuota != nil && urr.VolumeQuota.TotalVolume > 0 && usage.VolumMeasure.TotalVolume >= urr.VolumeQuota.TotalVolume {
			usage.USARTrigger.SetReportingTrigger(report.RPT_TRIG_VOLQU)
			triggered = true
		}
		sess.URRReports[urr.ID] = []report.USAReport{usage}
		if triggered {
			reports = append(reports, usage)
		}
	}
	sess.touch()
	d.publishSnapshotLocked()
	d.mu.Unlock()
	if len(reports) > 0 {
		d.emitReport(report.SessReport{SEID: binding.SEID, Reports: reports})
	}
}

type decodedGTPU struct {
	TEID         uint32
	InnerPayload []byte
	SourceIP     net.IP
}

func decodeGTPU(payload []byte) (*decodedGTPU, error) {
	if len(payload) < 12 {
		return nil, errors.New("userspace: gtp-u payload too short")
	}
	flags := payload[0]
	headerLen := 12
	if flags&0x07 != 0 {
		for next := payload[headerLen-1]; next != 0; next = payload[headerLen-1] {
			if len(payload) < headerLen+1 {
				return nil, errors.New("userspace: truncated gtp-u extension header")
			}
			extLen := int(payload[headerLen]) * 4
			if extLen == 0 || len(payload) < headerLen+extLen {
				return nil, errors.New("userspace: invalid gtp-u extension header length")
			}
			headerLen += extLen
		}
	}
	if len(payload) < headerLen {
		return nil, errors.New("userspace: gtp-u header exceeds payload")
	}

	inner := append([]byte(nil), payload[headerLen:]...)
	return &decodedGTPU{
		TEID:         binary.BigEndian.Uint32(payload[4:8]),
		InnerPayload: inner,
		SourceIP:     parseIPv4Source(inner),
	}, nil
}

func encodeGTPU(binding *PDRBinding, payload []byte, uplink bool) ([]byte, *net.UDPAddr, error) {
	if binding == nil || binding.FAR == nil || binding.FAR.Forwarding == nil || binding.FAR.Forwarding.OuterHeaderCreation == nil {
		return nil, nil, errors.New("userspace: missing outer header creation")
	}
	header := binding.FAR.Forwarding.OuterHeaderCreation

	var exts []gtpv1.Encoder
	if qfi := firstQFI(binding.QERs); qfi != 0 {
		pduType := uint8(0)
		if uplink {
			pduType = 1
		}
		exts = append(exts, gtpv1.PDUSessionContainer{
			PDUType:   pduType,
			QoSFlowID: qfi,
		})
	}

	msg := gtpv1.Message{
		Flags:   0x30,
		Type:    gtpv1.MsgTypeTPDU,
		TEID:    header.TEID,
		Exts:    exts,
		Payload: payload,
	}
	if len(exts) > 0 {
		msg.Flags = 0x34
	}

	buf := make([]byte, msg.Len())
	if _, err := msg.Encode(buf); err != nil {
		return nil, nil, err
	}
	port := int(header.Port)
	if port == 0 {
		port = factory.UpfGtpDefaultPort
	}
	return buf, &net.UDPAddr{IP: append(net.IP(nil), header.IPv4...), Port: port}, nil
}

func firstQFI(qers []*QERRule) uint8 {
	for _, qer := range qers {
		if qer != nil && qer.QFI != nil {
			return *qer.QFI
		}
	}
	return 0
}

func gateClosed(binding *PDRBinding, direction PacketDirection) bool {
	for _, qer := range binding.QERs {
		if qer == nil || qer.GateStatus == nil {
			continue
		}
		switch direction {
		case PacketDirectionUplink:
			if *qer.GateStatus&qerULGateClosed != 0 {
				return true
			}
		case PacketDirectionDownlink:
			if *qer.GateStatus&qerDLGateClosed != 0 {
				return true
			}
		}
	}
	return false
}

func parseIPv4Source(payload []byte) net.IP {
	if len(payload) < 20 || payload[0]>>4 != 4 {
		return nil
	}
	return append(net.IP(nil), payload[12:16]...)
}

func parseIPv4Destination(payload []byte) net.IP {
	if len(payload) < 20 || payload[0]>>4 != 4 {
		return nil
	}
	return append(net.IP(nil), payload[16:20]...)
}
