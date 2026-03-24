package userspace

import (
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/pkg/errors"
	"github.com/wmnsk/go-pfcp/ie"

	"github.com/acore2026/go-upf/internal/logger"
	"github.com/acore2026/go-upf/internal/report"
	"github.com/acore2026/go-upf/pkg/factory"
)

type Driver struct {
	mu            sync.RWMutex
	sessions      map[uint64]*SessionState
	handler       report.Handler
	snapshot      snapshotHolder
	stats         *statsTracker
	pendingDDN    map[ddnKey]*pendingDDNNotification
	adaptiveQoS   *adaptiveQoSController
	adaptiveTrace *adaptiveTraceBuffer

	workers  []*worker
	egressCh chan PacketOutcome
	outputCh chan PacketOutcome
	stopCh   chan struct{}
	wg       *sync.WaitGroup
	workerWg sync.WaitGroup
	ioWg     sync.WaitGroup
	io       *runtimeIO
	once     sync.Once
}

func New(wg *sync.WaitGroup, cfg *factory.Config) (*Driver, error) {
	if cfg == nil || cfg.Gtpu == nil {
		return nil, errors.New("no Gtpu config")
	}

	opts := optionsFromConfig(cfg)
	d := &Driver{
		sessions:      make(map[uint64]*SessionState),
		snapshot:      newSnapshotHolder(),
		stats:         newStatsTracker(),
		pendingDDN:    make(map[ddnKey]*pendingDDNNotification),
		adaptiveTrace: newAdaptiveTraceBuffer(adaptiveDefaultTraceLimit),
		egressCh:      make(chan PacketOutcome, max(1, opts.queueSize*opts.workers)),
		outputCh:      make(chan PacketOutcome, max(1, opts.queueSize*opts.workers)),
		stopCh:        make(chan struct{}),
		wg:            wg,
	}
	d.adaptiveQoS = newAdaptiveQoSController(d, cfg)
	d.startWorkers(opts)
	d.startPeriodicURRLoop()
	if err := d.startRuntime(opts); err != nil {
		d.Close()
		return nil, errors.Wrap(err, "start runtime")
	}
	if d.adaptiveQoS != nil {
		if err := d.adaptiveQoS.start(); err != nil {
			d.Close()
			return nil, errors.Wrap(err, "start adaptive qos")
		}
	}
	return d, nil
}

func (d *Driver) Close() {
	d.once.Do(func() {
		close(d.stopCh)
		if d.io != nil {
			d.io.close()
		}
		if d.adaptiveQoS != nil {
			d.adaptiveQoS.close()
		}
		d.stopPendingDDN()
		d.ioWg.Wait()
		d.workerWg.Wait()
		close(d.egressCh)
		close(d.outputCh)
	})
}

func (d *Driver) CreatePDR(seid uint64, req *ie.IE) error {
	rule, err := parsePDR(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess := d.ensureSessionLocked(seid)
	sess.PDRs[rule.ID] = rule
	logPDRRule("create", seid, rule)
	sess.touch()
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) UpdatePDR(seid uint64, req *ie.IE) error {
	rule, err := parseUpdatePDR(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.PDRs[rule.ID]; !ok {
		return ErrPDRNotFound
	}
	merged := mergePDRRule(sess.PDRs[rule.ID], rule)
	sess.PDRs[rule.ID] = merged
	logPDRRule("update", seid, merged)
	sess.touch()
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) RemovePDR(seid uint64, req *ie.IE) error {
	id, err := req.PDRID()
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.PDRs[id]; !ok {
		return ErrPDRNotFound
	}
	d.cancelPendingDDNLocked(ddnKey{SEID: seid, PDRID: id})
	delete(sess.PDRs, id)
	sess.touch()
	d.deleteSessionIfEmptyLocked(seid, sess)
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) CreateFAR(seid uint64, req *ie.IE) error {
	rule, err := parseFAR(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess := d.ensureSessionLocked(seid)
	sess.FARs[rule.ID] = rule
	sess.touch()
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) UpdateFAR(seid uint64, req *ie.IE) error {
	rule, err := parseUpdateFAR(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.FARs[rule.ID]; !ok {
		return ErrFARNotFound
	}
	prev := sess.FARs[rule.ID]
	merged := mergeFARRule(prev, rule)
	sess.FARs[rule.ID] = merged
	sess.touch()
	d.publishSnapshotLocked()
	d.handleFARTransitionLocked(seid, sess, prev, merged)
	return nil
}

func (d *Driver) RemoveFAR(seid uint64, req *ie.IE) error {
	id, err := req.FARID()
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.FARs[id]; !ok {
		return ErrFARNotFound
	}
	for _, pdr := range sess.PDRs {
		if pdr.FARID != nil && *pdr.FARID == id {
			d.cancelPendingDDNLocked(ddnKey{SEID: seid, PDRID: pdr.ID})
		}
	}
	delete(sess.FARs, id)
	sess.touch()
	d.deleteSessionIfEmptyLocked(seid, sess)
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) CreateQER(seid uint64, req *ie.IE) error {
	rule, err := parseQER(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess := d.ensureSessionLocked(seid)
	sess.QERs[rule.ID] = rule
	sess.touch()
	d.emitCPProvisionedTraceLocked(sess)
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) UpdateQER(seid uint64, req *ie.IE) error {
	rule, err := parseUpdateQER(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.QERs[rule.ID]; !ok {
		return ErrQERNotFound
	}
	sess.QERs[rule.ID] = rule
	sess.touch()
	d.emitCPProvisionedTraceLocked(sess)
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) RemoveQER(seid uint64, req *ie.IE) error {
	id, err := req.QERID()
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.QERs[id]; !ok {
		return ErrQERNotFound
	}
	delete(sess.QERs, id)
	sess.touch()
	d.deleteSessionIfEmptyLocked(seid, sess)
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) CreateURR(seid uint64, req *ie.IE) error {
	rule, err := parseURR(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess := d.ensureSessionLocked(seid)
	sess.URRs[rule.ID] = rule
	if _, ok := sess.URRPeriodAt[rule.ID]; !ok {
		sess.URRPeriodAt[rule.ID] = time.Now().UTC()
	}
	sess.touch()
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) UpdateURR(seid uint64, req *ie.IE) ([]report.USAReport, error) {
	rule, err := parseUpdateURR(req)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return nil, ErrSessionNotFound
	}
	if _, ok := sess.URRs[rule.ID]; !ok {
		return nil, ErrURRNotFound
	}
	sess.URRs[rule.ID] = rule
	if _, ok := sess.URRPeriodAt[rule.ID]; !ok {
		sess.URRPeriodAt[rule.ID] = time.Now().UTC()
	}
	sess.touch()
	d.publishSnapshotLocked()
	return nil, nil
}

func (d *Driver) RemoveURR(seid uint64, req *ie.IE) ([]report.USAReport, error) {
	id, err := req.URRID()
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return nil, ErrSessionNotFound
	}
	if _, ok := sess.URRs[id]; !ok {
		return nil, ErrURRNotFound
	}
	finalReports := append([]report.USAReport(nil), sess.URRReports[id]...)
	delete(sess.URRs, id)
	delete(sess.URRPeriodAt, id)
	delete(sess.URRReports, id)
	sess.touch()
	d.deleteSessionIfEmptyLocked(seid, sess)
	d.publishSnapshotLocked()
	return finalReports, nil
}

func (d *Driver) QueryURR(seid uint64, urrid uint32) ([]report.USAReport, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return nil, ErrSessionNotFound
	}
	if _, ok := sess.URRs[urrid]; !ok {
		return nil, ErrURRNotFound
	}
	return append([]report.USAReport(nil), sess.URRReports[urrid]...), nil
}

func (d *Driver) CreateBAR(seid uint64, req *ie.IE) error {
	rule, err := parseBAR(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess := d.ensureSessionLocked(seid)
	sess.BARs[rule.ID] = rule
	sess.touch()
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) UpdateBAR(seid uint64, req *ie.IE) error {
	rule, err := parseUpdateBAR(req)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.BARs[rule.ID]; !ok {
		return ErrBARNotFound
	}
	sess.BARs[rule.ID] = rule
	sess.touch()
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) RemoveBAR(seid uint64, req *ie.IE) error {
	id, err := req.BARID()
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	sess, ok := d.sessions[seid]
	if !ok {
		return ErrSessionNotFound
	}
	if _, ok := sess.BARs[id]; !ok {
		return ErrBARNotFound
	}
	delete(sess.BARs, id)
	sess.touch()
	d.deleteSessionIfEmptyLocked(seid, sess)
	d.publishSnapshotLocked()
	return nil
}

func (d *Driver) HandleReport(handler report.Handler) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.handler = handler
}

func mergePDRRule(prev *PDRRule, next *PDRRule) *PDRRule {
	if prev == nil {
		return next
	}
	if next == nil {
		return prev
	}

	merged := *prev
	merged.ID = next.ID
	if next.Precedence != nil {
		merged.Precedence = next.Precedence
	}
	if next.PDI != nil {
		merged.PDI = mergePDI(prev.PDI, next.PDI)
	}
	if next.OuterHeaderRemoval != nil {
		merged.OuterHeaderRemoval = next.OuterHeaderRemoval
	}
	if next.FARID != nil {
		merged.FARID = next.FARID
	}
	if len(next.QERIDs) > 0 {
		merged.QERIDs = append([]uint32(nil), next.QERIDs...)
	}
	if len(next.URRIDs) > 0 {
		merged.URRIDs = append([]uint32(nil), next.URRIDs...)
	}
	if len(next.Raw) > 0 {
		merged.Raw = append([]byte(nil), next.Raw...)
	}
	return &merged
}

func mergePDI(prev *PDI, next *PDI) *PDI {
	if prev == nil {
		return next
	}
	if next == nil {
		return prev
	}

	merged := *prev
	if next.SourceInterface != nil {
		merged.SourceInterface = next.SourceInterface
	}
	if next.FTEID != nil {
		merged.FTEID = next.FTEID
	}
	if next.NetworkInstance != "" {
		merged.NetworkInstance = next.NetworkInstance
	}
	if len(next.UEIPv4) > 0 {
		merged.UEIPv4 = append(net.IP(nil), next.UEIPv4...)
	}
	if len(next.SDFFilters) > 0 {
		merged.SDFFilters = append([]string(nil), next.SDFFilters...)
	}
	if len(next.SDFRules) > 0 {
		merged.SDFRules = append([]*SDFFilterRule(nil), next.SDFRules...)
	}
	if next.ApplicationID != "" {
		merged.ApplicationID = next.ApplicationID
	}
	return &merged
}

func mergeFARRule(prev *FARRule, next *FARRule) *FARRule {
	if prev == nil {
		return next
	}
	if next == nil {
		return prev
	}

	merged := *prev
	merged.ID = next.ID
	if next.ApplyAction.Flags != 0 {
		merged.ApplyAction = next.ApplyAction
	}
	if next.Forwarding != nil {
		merged.Forwarding = mergeForwardingParameters(prev.Forwarding, next.Forwarding)
	}
	if next.BARID != nil {
		merged.BARID = next.BARID
	}
	if len(next.Raw) > 0 {
		merged.Raw = append([]byte(nil), next.Raw...)
	}
	return &merged
}

func mergeForwardingParameters(prev *ForwardingParameters, next *ForwardingParameters) *ForwardingParameters {
	if prev == nil {
		return next
	}
	if next == nil {
		return prev
	}

	merged := *prev
	if next.DestinationInterface != nil {
		merged.DestinationInterface = next.DestinationInterface
	}
	if next.NetworkInstance != "" {
		merged.NetworkInstance = next.NetworkInstance
	}
	if next.OuterHeaderCreation != nil {
		merged.OuterHeaderCreation = next.OuterHeaderCreation
	}
	if next.ForwardingPolicy != "" {
		merged.ForwardingPolicy = next.ForwardingPolicy
	}
	if next.PFCPSMReqFlags != nil {
		merged.PFCPSMReqFlags = next.PFCPSMReqFlags
	}
	return &merged
}

func logPDRRule(op string, seid uint64, rule *PDRRule) {
	if rule == nil {
		return
	}
	var teid uint32
	var ueIP net.IP
	var srcIf any
	var sdf []string
	if rule.PDI != nil {
		if rule.PDI.SourceInterface != nil {
			srcIf = *rule.PDI.SourceInterface
		}
		if rule.PDI.FTEID != nil {
			teid = rule.PDI.FTEID.TEID
		}
		if len(rule.PDI.UEIPv4) > 0 {
			ueIP = rule.PDI.UEIPv4
		}
		if len(rule.PDI.SDFFilters) > 0 {
			sdf = append([]string(nil), rule.PDI.SDFFilters...)
		}
	}
	logger.FwderLog.Debugf("userspace pdr %s: seid=%d pdr=%d srcIf=%v teid=%d ue=%s far=%v sdf=%v", op, seid, rule.ID, srcIf, teid, ueIP, rule.FARID, sdf)
}

func (d *Driver) Output() <-chan PacketOutcome {
	return d.outputCh
}

func (d *Driver) ensureSessionLocked(seid uint64) *SessionState {
	sess, ok := d.sessions[seid]
	if !ok {
		sess = NewSessionState(seid)
		d.sessions[seid] = sess
		d.addAdaptiveTraceLocked(AdaptiveTraceEvent{
			Timestamp:      time.Now().UTC(),
			SEID:           seid,
			Stage:          "pdu-session-established",
			Status:         "active",
			DecisionReason: fmt.Sprintf("new session seid=%d", seid),
		})
	}
	return sess
}

func (d *Driver) deleteSessionIfEmptyLocked(seid uint64, sess *SessionState) {
	if len(sess.PDRs) != 0 || len(sess.FARs) != 0 || len(sess.QERs) != 0 || len(sess.URRs) != 0 || len(sess.BARs) != 0 || len(sess.URRReports) != 0 || len(sess.Buffers) != 0 {
		return
	}
	for key := range d.pendingDDN {
		if key.SEID == seid {
			d.cancelPendingDDNLocked(key)
		}
	}
	delete(d.sessions, seid)
}
