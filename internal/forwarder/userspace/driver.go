package userspace

import (
	"sync"
	"time"

	"github.com/pkg/errors"
	"github.com/wmnsk/go-pfcp/ie"

	"github.com/free5gc/go-upf/internal/report"
	"github.com/free5gc/go-upf/pkg/factory"
)

type Driver struct {
	mu         sync.RWMutex
	sessions   map[uint64]*SessionState
	handler    report.Handler
	snapshot   snapshotHolder
	stats      *statsTracker
	pendingDDN map[ddnKey]*pendingDDNNotification

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
		sessions:   make(map[uint64]*SessionState),
		snapshot:   newSnapshotHolder(),
		stats:      newStatsTracker(),
		pendingDDN: make(map[ddnKey]*pendingDDNNotification),
		egressCh:   make(chan PacketOutcome, max(1, opts.queueSize*opts.workers)),
		outputCh:   make(chan PacketOutcome, max(1, opts.queueSize*opts.workers)),
		stopCh:     make(chan struct{}),
		wg:         wg,
	}
	d.startWorkers(opts)
	d.startPeriodicURRLoop()
	if err := d.startRuntime(opts); err != nil {
		d.Close()
		return nil, err
	}
	return d, nil
}

func (d *Driver) Close() {
	d.once.Do(func() {
		close(d.stopCh)
		d.stopPendingDDN()
		if d.io != nil {
			d.io.close()
		}
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
	sess.PDRs[rule.ID] = rule
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
	sess.FARs[rule.ID] = rule
	sess.touch()
	d.publishSnapshotLocked()
	d.handleFARTransitionLocked(seid, sess, prev, rule)
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

func (d *Driver) Output() <-chan PacketOutcome {
	return d.outputCh
}

func (d *Driver) ensureSessionLocked(seid uint64) *SessionState {
	sess, ok := d.sessions[seid]
	if !ok {
		sess = NewSessionState(seid)
		d.sessions[seid] = sess
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
