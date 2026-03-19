package userspace

import (
	"time"

	"github.com/acore2026/go-upf/internal/report"
)

type ddnKey struct {
	SEID  uint64
	PDRID uint16
}

type pendingDDNNotification struct {
	timer   *time.Timer
	payload []byte
	action  uint16
}

func (d *Driver) stopPendingDDN() {
	d.mu.Lock()
	defer d.mu.Unlock()

	for key := range d.pendingDDN {
		d.cancelPendingDDNLocked(key)
	}
}

func (d *Driver) scheduleBufferedNotification(binding *PDRBinding, payload []byte) {
	if binding == nil || binding.PDR == nil || binding.FAR == nil || !binding.FAR.ApplyAction.NOCP() {
		return
	}

	delay := ddnDelay(binding)
	if delay <= 0 {
		d.emitReport(report.SessReport{
			SEID: binding.SEID,
			Reports: []report.Report{report.DLDReport{
				PDRID:  binding.PDR.ID,
				Action: binding.FAR.ApplyAction.Flags,
				BufPkt: append([]byte(nil), payload...),
			}},
		})
		return
	}

	key := ddnKey{SEID: binding.SEID, PDRID: binding.PDR.ID}
	bufPkt := append([]byte(nil), payload...)
	action := binding.FAR.ApplyAction.Flags

	d.mu.Lock()
	if pending := d.pendingDDN[key]; pending != nil {
		pending.payload = bufPkt
		pending.action = action
		d.mu.Unlock()
		return
	}
	timer := time.AfterFunc(delay, func() {
		d.fireBufferedNotification(key)
	})
	d.pendingDDN[key] = &pendingDDNNotification{
		timer:   timer,
		payload: bufPkt,
		action:  action,
	}
	d.mu.Unlock()
}

func (d *Driver) fireBufferedNotification(key ddnKey) {
	var dlReport *report.DLDReport

	d.mu.Lock()
	pending := d.pendingDDN[key]
	if pending != nil {
		delete(d.pendingDDN, key)
	}
	sess := d.sessions[key.SEID]
	if pending != nil && sess != nil && len(sess.Buffers[key.PDRID]) > 0 {
		dlReport = &report.DLDReport{
			PDRID:  key.PDRID,
			Action: pending.action,
			BufPkt: append([]byte(nil), pending.payload...),
		}
	}
	d.mu.Unlock()

	if dlReport != nil {
		d.emitReport(report.SessReport{
			SEID:    key.SEID,
			Reports: []report.Report{*dlReport},
		})
	}
}

func (d *Driver) cancelPendingDDNLocked(key ddnKey) {
	if pending := d.pendingDDN[key]; pending != nil {
		if pending.timer != nil {
			pending.timer.Stop()
		}
		delete(d.pendingDDN, key)
	}
}

func ddnDelay(binding *PDRBinding) time.Duration {
	if binding == nil || binding.BAR == nil || binding.BAR.DownlinkDataNotificationDelay == nil {
		return 0
	}
	return *binding.BAR.DownlinkDataNotificationDelay
}
