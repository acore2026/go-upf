package userspace

import (
	"time"

	"github.com/acore2026/go-upf/internal/report"
)

func (d *Driver) startPeriodicURRLoop() {
	d.ioWg.Add(1)
	if d.wg != nil {
		d.wg.Add(1)
	}
	go func() {
		defer d.ioWg.Done()
		if d.wg != nil {
			defer d.wg.Done()
		}
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-d.stopCh:
				return
			case now := <-ticker.C:
				d.emitPeriodicURRReports(now.UTC())
			}
		}
	}()
}

func (d *Driver) emitPeriodicURRReports(now time.Time) {
	sessionReports := make(map[uint64][]report.Report)

	d.mu.Lock()
	for seid, sess := range d.sessions {
		for urrid, urr := range sess.URRs {
			if urr == nil || urr.MeasurementPeriod <= 0 || !urr.ReportingTrigger.PERIO() {
				continue
			}
			last := sess.URRPeriodAt[urrid]
			if last.IsZero() {
				sess.URRPeriodAt[urrid] = now
				continue
			}
			if now.Sub(last) < urr.MeasurementPeriod {
				continue
			}
			current := sess.URRReports[urrid]
			if len(current) == 0 {
				sess.URRPeriodAt[urrid] = now
				continue
			}

			usage := current[len(current)-1]
			usage.EndTime = now
			usage.USARTrigger = report.UsageReportTrigger{}
			usage.USARTrigger.SetReportingTrigger(report.RPT_TRIG_PERIO)
			sessionReports[seid] = append(sessionReports[seid], usage)

			sess.URRReports[urrid] = []report.USAReport{{
				URRID:     urrid,
				StartTime: now,
				EndTime:   now,
			}}
			sess.URRPeriodAt[urrid] = now
		}
	}
	if len(sessionReports) > 0 {
		d.publishSnapshotLocked()
	}
	d.mu.Unlock()

	for seid, reports := range sessionReports {
		d.emitReport(report.SessReport{
			SEID:    seid,
			Reports: reports,
		})
	}
}
