package userspace

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	masque "github.com/quic-go/masque-go"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/yosida95/uritemplate/v3"

	"github.com/acore2026/go-upf/internal/logger"
	"github.com/acore2026/go-upf/pkg/factory"
)

const (
	adaptiveDefaultMASQUEBind = "127.0.0.1"
	adaptiveDefaultReportBind = "127.0.0.1"
	adaptiveDefaultTraceLimit = 256
	adaptiveAutoEndGrace      = 750 * time.Millisecond
)

const (
	AdaptiveReportTypeIntent = "intent"
	AdaptiveReportTypeEnd    = "end"
)

const (
	AdaptiveFeedbackStatusStarted  = "started"
	AdaptiveFeedbackStatusEnded    = "ended"
	AdaptiveFeedbackStatusRejected = "rejected"
)

type AdaptiveReport struct {
	UEAddress           string        `json:"ueAddress,omitempty"`
	FlowID              string        `json:"flowId,omitempty"`
	ReportType          string        `json:"reportType,omitempty"`
	Timestamp           time.Time     `json:"timestamp,omitempty"`
	Scenario            string        `json:"scenario,omitempty"`
	TrafficPattern      string        `json:"trafficPattern,omitempty"`
	LatencySensitivity  string        `json:"latencySensitivity,omitempty"`
	PacketLossTolerance string        `json:"packetLossTolerance,omitempty"`
	Priority            string        `json:"priority,omitempty"`
	ExpectedArrivalTime time.Time     `json:"expectedArrivalTime,omitempty"`
	BurstSize           uint64        `json:"burstSize,omitempty"`
	BurstDuration       time.Duration `json:"burstDuration,omitempty"`
	BurstDurationMs     uint64        `json:"burstDurationMs,omitempty"`
	Deadline            time.Duration `json:"deadline,omitempty"`
	DeadlineMs          uint64        `json:"deadlineMs,omitempty"`
	SEIDHint            uint64        `json:"seidHint,omitempty"`
}

type AdaptiveFeedback struct {
	FlowID              string  `json:"flowId,omitempty"`
	Status              string  `json:"status,omitempty"`
	ReasonCode          string  `json:"reasonCode,omitempty"`
	ProfileID           string  `json:"profileId,omitempty"`
	Scenario            string  `json:"scenario,omitempty"`
	StoryPhase          string  `json:"storyPhase,omitempty"`
	GNBDecision         string  `json:"gnbDecision,omitempty"`
	PredictedAirDelayMs uint64  `json:"predictedAirDelayMs,omitempty"`
	BlockSuccessRatio   float64 `json:"blockSuccessRatio,omitempty"`
}

type AdaptiveProfile struct {
	ProfileID      string
	OverrideGateUL *bool
	OverrideGateDL *bool
	OverrideGFBRUL uint64
	OverrideGFBRDL uint64
	OverrideMBRUL  uint64
	OverrideMBRDL  uint64
	Duration       time.Duration
}

type AdaptiveQEROverride struct {
	FlowID         string
	ApplyToQERID   uint32
	OverrideGateUL *bool
	OverrideGateDL *bool
	OverrideGFBRUL uint64
	OverrideGFBRDL uint64
	OverrideMBRUL  uint64
	OverrideMBRDL  uint64
	ExpiresAt      time.Time
}

type AdaptiveFlowState struct {
	FlowID              string
	UEAddress           string
	AppliedQERIDs       []uint32
	SelectedProfile     *AdaptiveProfile
	PreviousProfileID   string
	DecisionReason      string
	CPProvisionedRange  *adaptiveCPProvisionedRange
	LatestReport        AdaptiveReport
	StoryPhase          string
	Scenario            string
	GNBDecision         string
	PredictedAirDelayMs uint64
	BlockSuccessRatio   float64
	UpdatedAt           time.Time
}

type AdaptiveTraceEvent struct {
	Timestamp           time.Time                   `json:"timestamp"`
	FlowID              string                      `json:"flowId,omitempty"`
	UEAddress           string                      `json:"ueAddress,omitempty"`
	SEID                uint64                      `json:"seid,omitempty"`
	Stage               string                      `json:"stage,omitempty"`
	Status              string                      `json:"status,omitempty"`
	ReasonCode          string                      `json:"reasonCode,omitempty"`
	ProfileID           string                      `json:"profileId,omitempty"`
	Scenario            string                      `json:"scenario,omitempty"`
	GNBDecision         string                      `json:"gnbDecision,omitempty"`
	PredictedAirDelayMs uint64                      `json:"predictedAirDelayMs,omitempty"`
	BlockSuccessRatio   float64                     `json:"blockSuccessRatio,omitempty"`
	PreviousProfileID   string                      `json:"previousProfileId,omitempty"`
	DefaultProfileID    string                      `json:"defaultProfileId,omitempty"`
	DecisionReason      string                      `json:"decisionReason,omitempty"`
	CPProvisionedRange  *adaptiveCPProvisionedRange `json:"cpProvisionedRange,omitempty"`
	QoSDecision         *adaptiveQoSDecisionView    `json:"qosDecision,omitempty"`
	RequestMessage      *AdaptiveReport             `json:"requestMessage,omitempty"`
	ResponseMessage     *AdaptiveFeedback           `json:"responseMessage,omitempty"`
}

type adaptiveTraceBuffer struct {
	mu     sync.RWMutex
	limit  int
	events []AdaptiveTraceEvent
}

func newAdaptiveTraceBuffer(limit int) *adaptiveTraceBuffer {
	if limit <= 0 {
		limit = adaptiveDefaultTraceLimit
	}
	return &adaptiveTraceBuffer{
		limit:  limit,
		events: make([]AdaptiveTraceEvent, 0, limit),
	}
}

func (b *adaptiveTraceBuffer) add(event AdaptiveTraceEvent) {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	b.events = append(b.events, event)
	if len(b.events) > b.limit {
		b.events = append([]AdaptiveTraceEvent(nil), b.events[len(b.events)-b.limit:]...)
	}
}

func (b *adaptiveTraceBuffer) snapshot(limit int) []AdaptiveTraceEvent {
	if b == nil {
		return nil
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	if len(b.events) == 0 {
		return nil
	}
	if limit <= 0 || limit >= len(b.events) {
		return append([]AdaptiveTraceEvent(nil), b.events...)
	}
	return append([]AdaptiveTraceEvent(nil), b.events[len(b.events)-limit:]...)
}

type adaptiveQoSController struct {
	driver    *Driver
	cfg       *factory.AdaptiveQoS
	certFile  string
	keyFile   string
	template  *uritemplate.Template
	reportTo  *net.UDPAddr
	masqueLn  *net.UDPConn
	reportLn  *net.UDPConn
	debugLn   net.Listener
	server    *http3.Server
	debugSrv  *http.Server
	proxy     masqueProxy
	running   bool
	closeOnce sync.Once
	debugMu   sync.RWMutex
	debugErr  string
}

type masqueProxy interface {
	ProxyConnectedSocket(http.ResponseWriter, *masque.Request, *net.UDPConn) error
	Close() error
}

type adaptiveDebugStatus struct {
	GeneratedAt        time.Time                   `json:"generatedAt"`
	ActiveSessions     int                         `json:"activeSessions"`
	ActiveFlows        int                         `json:"activeFlows"`
	TraceDepth         int                         `json:"traceDepth"`
	Story              *adaptiveStoryView          `json:"story,omitempty"`
	PreviousProfileID  string                      `json:"previousProfileId,omitempty"`
	DefaultProfileID   string                      `json:"defaultProfileId,omitempty"`
	CPProvisionedRange *adaptiveCPProvisionedRange `json:"cpProvisionedRange,omitempty"`
	QoSDecision        *adaptiveQoSDecisionView    `json:"qosDecision,omitempty"`
	CurrentQoSProfile  *adaptiveQoSDecisionView    `json:"currentQoSProfile,omitempty"`
	DefaultQoSProfile  *adaptiveQoSDecisionView    `json:"defaultQoSProfile,omitempty"`
	ServeError         string                      `json:"serveError,omitempty"`
}

type adaptiveDebugTraceEvent struct {
	Seq                 int                         `json:"seq"`
	Timestamp           time.Time                   `json:"timestamp"`
	Component           string                      `json:"component"`
	FlowID              string                      `json:"flowId,omitempty"`
	UEAddress           string                      `json:"ueAddress,omitempty"`
	SEID                uint64                      `json:"seid,omitempty"`
	Stage               string                      `json:"stage,omitempty"`
	Status              string                      `json:"status,omitempty"`
	Reason              string                      `json:"reason,omitempty"`
	ReasonCode          string                      `json:"reasonCode,omitempty"`
	ProfileID           string                      `json:"profileId,omitempty"`
	Scenario            string                      `json:"scenario,omitempty"`
	GNBDecision         string                      `json:"gnbDecision,omitempty"`
	PredictedAirDelayMs uint64                      `json:"predictedAirDelayMs,omitempty"`
	BlockSuccessRatio   float64                     `json:"blockSuccessRatio,omitempty"`
	PreviousProfileID   string                      `json:"previousProfileId,omitempty"`
	DefaultProfileID    string                      `json:"defaultProfileId,omitempty"`
	DecisionReason      string                      `json:"decisionReason,omitempty"`
	CPProvisionedRange  *adaptiveCPProvisionedRange `json:"cpProvisionedRange,omitempty"`
	QoSDecision         *adaptiveQoSDecisionView    `json:"qosDecision,omitempty"`
	RequestMessage      *AdaptiveReport             `json:"requestMessage,omitempty"`
	ResponseMessage     *AdaptiveFeedback           `json:"responseMessage,omitempty"`
	Detail              string                      `json:"detail,omitempty"`
}

type adaptiveCPProvisionedRange struct {
	QERCount                  int    `json:"qerCount"`
	AuthorizationMaxBitrateUL uint64 `json:"authorizationMaxBitrateUl,omitempty"`
	AuthorizationMaxBitrateDL uint64 `json:"authorizationMaxBitrateDl,omitempty"`
	AuthorizationMaxGFBRUL    uint64 `json:"authorizationMaxGfbrUl,omitempty"`
	AuthorizationMaxGFBRDL    uint64 `json:"authorizationMaxGfbrDl,omitempty"`
	MBRULMin                  uint64 `json:"mbrUlMin,omitempty"`
	MBRULMax                  uint64 `json:"mbrUlMax,omitempty"`
	MBRDLMin                  uint64 `json:"mbrDlMin,omitempty"`
	MBRDLMax                  uint64 `json:"mbrDlMax,omitempty"`
	GBRULMin                  uint64 `json:"gbrUlMin,omitempty"`
	GBRULMax                  uint64 `json:"gbrUlMax,omitempty"`
	GBRDLMin                  uint64 `json:"gbrDlMin,omitempty"`
	GBRDLMax                  uint64 `json:"gbrDlMax,omitempty"`
	GateClosedULCount         int    `json:"gateClosedUlCount,omitempty"`
	GateClosedDLCount         int    `json:"gateClosedDlCount,omitempty"`
}

type adaptiveQoSDecisionView struct {
	SelectedProfileID            string    `json:"selectedProfileId,omitempty"`
	PreviousProfileID            string    `json:"previousProfileId,omitempty"`
	DecisionReason               string    `json:"decisionReason,omitempty"`
	AppliedQERIDs                []uint32  `json:"appliedQerIds,omitempty"`
	OverrideGateUL               *bool     `json:"overrideGateUl,omitempty"`
	OverrideGateDL               *bool     `json:"overrideGateDl,omitempty"`
	OverrideGFBRUL               uint64    `json:"overrideGfbrUl,omitempty"`
	OverrideGFBRDL               uint64    `json:"overrideGfbrDl,omitempty"`
	DefaultGFBRUL                uint64    `json:"defaultGfbrUl,omitempty"`
	DefaultGFBRDL                uint64    `json:"defaultGfbrDl,omitempty"`
	OverrideMBRUL                uint64    `json:"overrideMbrUl,omitempty"`
	OverrideMBRDL                uint64    `json:"overrideMbrDl,omitempty"`
	DurationMs                   uint64    `json:"durationMs,omitempty"`
	RequestedTrafficPattern      string    `json:"requestedTrafficPattern,omitempty"`
	RequestedLatencySensitivity  string    `json:"requestedLatencySensitivity,omitempty"`
	RequestedPacketLossTolerance string    `json:"requestedPacketLossTolerance,omitempty"`
	RequestedBurstSize           uint64    `json:"requestedBurstSize,omitempty"`
	RequestedBurstDurationMs     uint64    `json:"requestedBurstDurationMs,omitempty"`
	RequestedDeadlineMs          uint64    `json:"requestedDeadlineMs,omitempty"`
	RequestedPriority            string    `json:"requestedPriority,omitempty"`
	RequestedBitrateDL           uint64    `json:"requestedBitrateDl,omitempty"`
	RequestedBitrateUL           uint64    `json:"requestedBitrateUl,omitempty"`
	RequestedArrivalTime         time.Time `json:"requestedArrivalTime,omitempty"`
	DefaultProfileID             string    `json:"defaultProfileId,omitempty"`
}

func newAdaptiveQoSController(d *Driver, cfg *factory.Config) *adaptiveQoSController {
	if d == nil || cfg == nil || cfg.Gtpu == nil || cfg.Gtpu.AdaptiveQoS == nil || !cfg.Gtpu.AdaptiveQoS.Enable {
		return nil
	}

	localCfg := *cfg.Gtpu.AdaptiveQoS
	if localCfg.MASQUEBindAddress == "" {
		localCfg.MASQUEBindAddress = adaptiveDefaultMASQUEBind
	}
	if localCfg.ReportBindAddress == "" {
		localCfg.ReportBindAddress = adaptiveDefaultReportBind
	}

	return &adaptiveQoSController{
		driver:   d,
		cfg:      &localCfg,
		certFile: cfg.GetAdaptiveQoSCertPemPath(),
		keyFile:  cfg.GetAdaptiveQoSCertKeyPath(),
		proxy:    &masque.Proxy{},
	}
}

func (c *adaptiveQoSController) start() error {
	if c == nil {
		return nil
	}

	tlsConf, err := makeAdaptiveTLSConfig(c.certFile, c.keyFile)
	if err != nil {
		return err
	}

	reportAddr := &net.UDPAddr{IP: net.ParseIP(c.cfg.ReportBindAddress), Port: c.cfg.ReportPort}
	reportLn, err := net.ListenUDP("udp", reportAddr)
	if err != nil {
		return fmt.Errorf("listen adaptive report udp: %w", err)
	}
	c.reportLn = reportLn
	c.reportTo = reportLn.LocalAddr().(*net.UDPAddr)

	masqueAddr := &net.UDPAddr{IP: net.ParseIP(c.cfg.MASQUEBindAddress), Port: c.cfg.MASQUEPort}
	masqueLn, err := net.ListenUDP("udp", masqueAddr)
	if err != nil {
		reportLn.Close()
		return fmt.Errorf("listen adaptive masque udp: %w", err)
	}
	c.masqueLn = masqueLn

	masqueUDPAddr := masqueLn.LocalAddr().(*net.UDPAddr)
	masquePort := masqueUDPAddr.Port
	templateHost := c.cfg.MASQUEBindAddress
	if templateHost == "" || templateHost == "0.0.0.0" || templateHost == "::" {
		if ip := masqueUDPAddr.IP; ip != nil && !ip.IsUnspecified() {
			templateHost = ip.String()
		}
	}
	if templateHost == "" || templateHost == "0.0.0.0" || templateHost == "::" {
		templateHost = "localhost"
	}
	c.template = uritemplate.MustNew(
		fmt.Sprintf("https://%s:%d/masque?h={target_host}&p={target_port}", templateHost, masquePort),
	)

	mux := http.NewServeMux()
	c.server = &http3.Server{
		TLSConfig:       tlsConf,
		QUICConfig:      &quic.Config{EnableDatagrams: true},
		EnableDatagrams: true,
		Handler:         mux,
	}
	mux.HandleFunc("/masque", c.handleMASQUE)

	go func() {
		if err := c.server.Serve(c.masqueLn); err != nil && !strings.Contains(err.Error(), "closed network connection") {
			logger.FwderLog.Warnf("adaptive qos masque server stopped: %+v", err)
		}
	}()
	go c.reportLoop()

	if err := c.startDebugServer(); err != nil {
		return fmt.Errorf("start adaptive qos debug server: %w", err)
	}

	c.running = true
	logger.FwderLog.Infof("adaptive qos controller started: masque=%s report=%s", c.masqueLn.LocalAddr(), c.reportLn.LocalAddr())
	return nil
}

func (c *adaptiveQoSController) startDebugServer() error {
	if c == nil || c.driver == nil || c.cfg == nil || c.cfg.DebugPort <= 0 {
		return nil
	}
	bindAddress := c.cfg.DebugBindAddress
	if bindAddress == "" {
		bindAddress = "0.0.0.0"
	}
	addr := net.JoinHostPort(bindAddress, strconv.Itoa(c.cfg.DebugPort))
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/adaptive-qos/status", c.handleDebugStatus)
	mux.HandleFunc("/debug/adaptive-qos/trace", c.handleDebugTrace)
	mux.HandleFunc("/debug/adaptive-qos/reset", c.handleDebugReset)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	c.debugLn = ln
	c.debugSrv = &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := c.debugSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			c.setDebugServeError(err)
			logger.FwderLog.Warnf("adaptive qos debug server stopped: %+v", err)
		}
	}()
	return nil
}

func (c *adaptiveQoSController) setDebugServeError(err error) {
	if c == nil {
		return
	}
	c.debugMu.Lock()
	defer c.debugMu.Unlock()
	if err == nil {
		c.debugErr = ""
		return
	}
	c.debugErr = err.Error()
}

func (c *adaptiveQoSController) debugServeError() string {
	if c == nil {
		return ""
	}
	c.debugMu.RLock()
	defer c.debugMu.RUnlock()
	return c.debugErr
}

func (c *adaptiveQoSController) handleDebugStatus(w http.ResponseWriter, _ *http.Request) {
	if c == nil || c.driver == nil {
		http.Error(w, "adaptive qos controller unavailable", http.StatusServiceUnavailable)
		return
	}
	snapshot := c.driver.Snapshot()
	activeFlows := 0
	var latestFlow *AdaptiveFlowState
	for _, sess := range snapshot.Sessions {
		if sess == nil {
			continue
		}
		activeFlows += len(sess.AdaptiveFlows)
		for _, flow := range sess.AdaptiveFlows {
			if flow == nil {
				continue
			}
			if latestFlow == nil || flow.UpdatedAt.After(latestFlow.UpdatedAt) {
				latestFlow = flow
			}
		}
	}
	status := adaptiveDebugStatus{
		GeneratedAt:        snapshot.GeneratedAt,
		ActiveSessions:     len(snapshot.Sessions),
		ActiveFlows:        activeFlows,
		TraceDepth:         len(snapshot.AdaptiveTrace),
		Story:              c.driver.currentStoryView(),
		PreviousProfileID:  flowPreviousProfileID(latestFlow),
		DefaultProfileID:   defaultAdaptiveProfileID(),
		CPProvisionedRange: flowCPProvisionedRange(latestFlow),
		QoSDecision:        flowQoSDecision(latestFlow),
		CurrentQoSProfile:  currentQoSProfileView(latestFlow),
		DefaultQoSProfile:  defaultQoSProfileView(latestFlow),
		ServeError:         c.debugServeError(),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(status)
}

func (c *adaptiveQoSController) handleDebugTrace(w http.ResponseWriter, r *http.Request) {
	if c == nil || c.driver == nil {
		http.Error(w, "adaptive qos controller unavailable", http.StatusServiceUnavailable)
		return
	}
	limit := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	snapshot := c.driver.Snapshot()
	trace := snapshot.AdaptiveTrace
	if limit > 0 && limit < len(trace) {
		trace = trace[len(trace)-limit:]
	}
	resp := make([]adaptiveDebugTraceEvent, 0, len(trace))
	for i, event := range trace {
		resp = append(resp, adaptiveDebugTraceEvent{
			Seq:                 i + 1,
			Timestamp:           event.Timestamp,
			Component:           "upf",
			FlowID:              event.FlowID,
			UEAddress:           event.UEAddress,
			SEID:                event.SEID,
			Stage:               event.Stage,
			Status:              event.Status,
			Reason:              event.ReasonCode,
			ReasonCode:          event.ReasonCode,
			ProfileID:           event.ProfileID,
			Scenario:            event.Scenario,
			GNBDecision:         event.GNBDecision,
			PredictedAirDelayMs: event.PredictedAirDelayMs,
			BlockSuccessRatio:   event.BlockSuccessRatio,
			PreviousProfileID:   event.PreviousProfileID,
			DefaultProfileID:    event.DefaultProfileID,
			DecisionReason:      event.DecisionReason,
			CPProvisionedRange:  event.CPProvisionedRange,
			QoSDecision:         event.QoSDecision,
			RequestMessage:      event.RequestMessage,
			ResponseMessage:     event.ResponseMessage,
			Detail:              formatAdaptiveTraceDetail(event),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

type adaptiveDebugResetResponse struct {
	GeneratedAt    time.Time `json:"generatedAt"`
	ActiveSessions int       `json:"activeSessions"`
	ActiveFlows    int       `json:"activeFlows"`
	TraceDepth     int       `json:"traceDepth"`
	Status         string    `json:"status"`
}

func (c *adaptiveQoSController) handleDebugReset(w http.ResponseWriter, r *http.Request) {
	if c == nil || c.driver == nil {
		http.Error(w, "adaptive qos controller unavailable", http.StatusServiceUnavailable)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	summary := c.driver.resetAdaptiveState()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(adaptiveDebugResetResponse{
		GeneratedAt:    summary.GeneratedAt,
		ActiveSessions: summary.ActiveSessions,
		ActiveFlows:    summary.ActiveFlows,
		TraceDepth:     summary.TraceDepth,
		Status:         "reset",
	})
}

func formatAdaptiveTraceDetail(event AdaptiveTraceEvent) string {
	parts := make([]string, 0, 14)
	if event.ProfileID != "" {
		parts = append(parts, "profile="+event.ProfileID)
	}
	if event.PreviousProfileID != "" {
		parts = append(parts, "previousProfile="+event.PreviousProfileID)
	}
	if event.DefaultProfileID != "" {
		parts = append(parts, "defaultProfile="+event.DefaultProfileID)
	}
	if event.Status != "" {
		parts = append(parts, "status="+event.Status)
	}
	if event.ReasonCode != "" {
		parts = append(parts, "reason="+event.ReasonCode)
	}
	if event.DecisionReason != "" {
		parts = append(parts, "decision="+event.DecisionReason)
	}
	if event.GNBDecision != "" {
		parts = append(parts, "gnb="+event.GNBDecision)
	}
	if event.PredictedAirDelayMs > 0 {
		parts = append(parts, "airDelay="+strconv.FormatUint(event.PredictedAirDelayMs, 10)+"ms")
	}
	if event.BlockSuccessRatio > 0 {
		parts = append(parts, "blockSuccess="+strconv.FormatFloat(event.BlockSuccessRatio, 'f', 2, 64))
	}
	if event.CPProvisionedRange != nil {
		cp := event.CPProvisionedRange
		cpParts := make([]string, 0, 4)
		if cp.MBRULMax > 0 || cp.MBRDLMax > 0 {
			cpParts = append(cpParts, "mbrUL="+formatRange(cp.MBRULMin, cp.MBRULMax))
			cpParts = append(cpParts, "mbrDL="+formatRange(cp.MBRDLMin, cp.MBRDLMax))
		}
		if cp.GBRULMax > 0 || cp.GBRDLMax > 0 {
			cpParts = append(cpParts, "gbrUL="+formatRange(cp.GBRULMin, cp.GBRULMax))
			cpParts = append(cpParts, "gbrDL="+formatRange(cp.GBRDLMin, cp.GBRDLMax))
		}
		if len(cpParts) > 0 {
			parts = append(parts, "cp["+strings.Join(cpParts, ",")+"]")
		}
	}
	return strings.Join(parts, " ")
}

func flowPreviousProfileID(flow *AdaptiveFlowState) string {
	if flow == nil {
		return ""
	}
	return flow.PreviousProfileID
}

func flowCPProvisionedRange(flow *AdaptiveFlowState) *adaptiveCPProvisionedRange {
	if flow == nil {
		return nil
	}
	return flow.CPProvisionedRange
}

func flowQoSDecision(flow *AdaptiveFlowState) *adaptiveQoSDecisionView {
	if flow == nil || flow.SelectedProfile == nil {
		return nil
	}
	report := flow.LatestReport
	return &adaptiveQoSDecisionView{
		SelectedProfileID:            flow.SelectedProfile.ProfileID,
		PreviousProfileID:            flow.PreviousProfileID,
		DefaultProfileID:             defaultAdaptiveProfileID(),
		DecisionReason:               flow.DecisionReason,
		AppliedQERIDs:                append([]uint32(nil), flow.AppliedQERIDs...),
		OverrideGateUL:               flow.SelectedProfile.OverrideGateUL,
		OverrideGateDL:               flow.SelectedProfile.OverrideGateDL,
		OverrideGFBRUL:               flow.SelectedProfile.OverrideGFBRUL,
		OverrideGFBRDL:               flow.SelectedProfile.OverrideGFBRDL,
		DefaultGFBRUL:                defaultAdaptiveGFBR(),
		DefaultGFBRDL:                defaultAdaptiveGFBR(),
		OverrideMBRUL:                flow.SelectedProfile.OverrideMBRUL,
		OverrideMBRDL:                flow.SelectedProfile.OverrideMBRDL,
		DurationMs:                   storyDurationMs(flow.SelectedProfile.Duration, 0),
		RequestedTrafficPattern:      report.TrafficPattern,
		RequestedLatencySensitivity:  report.LatencySensitivity,
		RequestedPacketLossTolerance: report.PacketLossTolerance,
		RequestedBurstSize:           report.BurstSize,
		RequestedBurstDurationMs:     storyDurationMs(report.BurstDuration, report.BurstDurationMs),
		RequestedDeadlineMs:          storyDurationMs(report.Deadline, report.DeadlineMs),
		RequestedPriority:            inferBurstPriority(report),
		RequestedBitrateDL:           rateFromBurst(report.BurstSize, report.DeadlineMsOrBurstDurationMs()),
		RequestedBitrateUL:           rateFromBurst(report.BurstSize/8, report.DeadlineMsOrBurstDurationMs()),
		RequestedArrivalTime:         report.expectedArrivalTime(),
	}
}

func currentQoSProfileView(flow *AdaptiveFlowState) *adaptiveQoSDecisionView {
	return flowQoSDecision(flow)
}

func defaultQoSProfileView(flow *AdaptiveFlowState) *adaptiveQoSDecisionView {
	base := &AdaptiveProfile{
		ProfileID:      defaultAdaptiveProfileID(),
		OverrideGateUL: boolPtr(true),
		OverrideGateDL: boolPtr(true),
		OverrideGFBRUL: 100000,
		OverrideGFBRDL: 100000,
		OverrideMBRUL:  100000,
		OverrideMBRDL:  100000,
		Duration:       defaultAdaptiveDurationForFlow(flow),
	}
	return &adaptiveQoSDecisionView{
		SelectedProfileID: base.ProfileID,
		DecisionReason:    "fallback=adaptive-default",
		OverrideGateUL:    base.OverrideGateUL,
		OverrideGateDL:    base.OverrideGateDL,
		OverrideGFBRUL:    base.OverrideGFBRUL,
		OverrideGFBRDL:    base.OverrideGFBRDL,
		DefaultGFBRUL:     base.OverrideGFBRUL,
		DefaultGFBRDL:     base.OverrideGFBRDL,
		OverrideMBRUL:     base.OverrideMBRUL,
		OverrideMBRDL:     base.OverrideMBRDL,
		DurationMs:        uint64(base.Duration / time.Millisecond),
		DefaultProfileID:  base.ProfileID,
	}
}

func defaultAdaptiveDurationForFlow(flow *AdaptiveFlowState) time.Duration {
	if flow == nil || flow.SelectedProfile == nil || flow.SelectedProfile.Duration <= 0 {
		return 30 * time.Second
	}
	return flow.SelectedProfile.Duration
}

func formatRange(minV, maxV uint64) string {
	if minV == 0 && maxV == 0 {
		return "n/a"
	}
	if minV == maxV {
		return strconv.FormatUint(maxV, 10)
	}
	return strconv.FormatUint(minV, 10) + "-" + strconv.FormatUint(maxV, 10)
}

func cloneAdaptiveReport(in AdaptiveReport) *AdaptiveReport {
	out := in
	return &out
}

func cloneAdaptiveFeedback(in AdaptiveFeedback) *AdaptiveFeedback {
	out := in
	return &out
}

type adaptiveResetSummary struct {
	GeneratedAt    time.Time
	ActiveSessions int
	ActiveFlows    int
	TraceDepth     int
}

func (b *adaptiveTraceBuffer) reset() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = b.events[:0]
}

func (d *Driver) resetAdaptiveState() adaptiveResetSummary {
	d.mu.Lock()
	defer d.mu.Unlock()

	activeFlows := 0
	for _, sess := range d.sessions {
		if sess == nil {
			continue
		}
		activeFlows += len(sess.AdaptiveFlows)
		for key := range sess.AdaptiveQER {
			delete(sess.AdaptiveQER, key)
		}
		for key := range sess.AdaptiveFlows {
			delete(sess.AdaptiveFlows, key)
		}
		sess.touch()
	}
	if d.adaptiveTrace != nil {
		d.adaptiveTrace.reset()
	}
	d.publishSnapshotLocked()

	return adaptiveResetSummary{
		GeneratedAt:    time.Now().UTC(),
		ActiveSessions: len(d.sessions),
		ActiveFlows:    0,
		TraceDepth:     0,
	}
}

func makeAdaptiveTLSConfig(certFile string, keyFile string) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load adaptive qos tls cert: %w", err)
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		NextProtos:   []string{http3.NextProtoH3},
	}, nil
}

func (c *adaptiveQoSController) handleMASQUE(w http.ResponseWriter, r *http.Request) {
	if c.driver != nil {
		defer c.driver.publishSnapshotLocked()
	}
	req, err := masque.ParseRequest(r, c.template)
	if err != nil {
		if parseErr, ok := err.(*masque.RequestParseError); ok {
			c.driver.addAdaptiveTraceLocked(AdaptiveTraceEvent{
				Timestamp:  time.Now().UTC(),
				Stage:      "masque-connect-failed",
				Status:     "rejected",
				ReasonCode: fmt.Sprintf("MASQUE_PARSE_%d", parseErr.HTTPStatus),
			})
			w.WriteHeader(parseErr.HTTPStatus)
			return
		}
		c.driver.addAdaptiveTraceLocked(AdaptiveTraceEvent{
			Timestamp:  time.Now().UTC(),
			Stage:      "masque-connect-failed",
			Status:     "rejected",
			ReasonCode: "MASQUE_PARSE_ERROR",
		})
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if c.reportLn == nil {
		c.driver.addAdaptiveTraceLocked(AdaptiveTraceEvent{
			Timestamp:  time.Now().UTC(),
			Stage:      "masque-connect-failed",
			Status:     "rejected",
			ReasonCode: "MASQUE_REPORT_UNAVAILABLE",
		})
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	conn, err := net.DialUDP("udp", nil, c.reportLn.LocalAddr().(*net.UDPAddr))
	if err != nil {
		c.driver.addAdaptiveTraceLocked(AdaptiveTraceEvent{
			Timestamp:  time.Now().UTC(),
			Stage:      "masque-connect-failed",
			Status:     "rejected",
			ReasonCode: "MASQUE_DIAL_FAILED",
		})
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if req == nil {
		c.driver.addAdaptiveTraceLocked(AdaptiveTraceEvent{
			Timestamp:  time.Now().UTC(),
			Stage:      "masque-connect-failed",
			Status:     "rejected",
			ReasonCode: "MASQUE_REQUEST_MISSING",
		})
		w.WriteHeader(http.StatusBadRequest)
		_ = conn.Close()
		return
	}
	c.driver.addAdaptiveTraceLocked(AdaptiveTraceEvent{
		Timestamp:  time.Now().UTC(),
		Stage:      "masque-connect",
		Status:     "connected",
		ReasonCode: "CONNECTED",
	})
	_ = c.proxy.ProxyConnectedSocket(w, req, conn)
	c.driver.addAdaptiveTraceLocked(AdaptiveTraceEvent{
		Timestamp:  time.Now().UTC(),
		Stage:      "masque-disconnect",
		Status:     "disconnected",
		ReasonCode: "DISCONNECTED",
	})
}

func (c *adaptiveQoSController) reportLoop() {
	if c == nil || c.reportLn == nil || c.driver == nil {
		return
	}
	buf := make([]byte, 64*1024)
	for {
		n, addr, err := c.reportLn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		var report AdaptiveReport
		if err := json.Unmarshal(buf[:n], &report); err != nil {
			continue
		}
		now := time.Now().UTC()
		feedback := c.driver.applyAdaptiveReport(report, now)
		payload, err := json.Marshal(feedback)
		if err != nil {
			continue
		}
		_, _ = c.reportLn.WriteToUDP(payload, addr)
	}
}

func (c *adaptiveQoSController) Running() bool {
	return c != nil && c.running
}

func (c *adaptiveQoSController) Template() *uritemplate.Template {
	if c == nil {
		return nil
	}
	return c.template
}

func (c *adaptiveQoSController) ReportTargetAddr() *net.UDPAddr {
	if c == nil {
		return nil
	}
	return c.reportTo
}

func (c *adaptiveQoSController) InterceptUplink(payload []byte) bool {
	if c == nil {
		return false
	}
	var report AdaptiveReport
	if err := json.Unmarshal(payload, &report); err != nil {
		return false
	}
	if report.ReportType == "" {
		report.ReportType = AdaptiveReportTypeIntent
	}
	c.driver.applyAdaptiveReport(report, time.Now().UTC())
	return true
}

func (c *adaptiveQoSController) close() {
	if c == nil {
		return
	}
	c.closeOnce.Do(func() {
		c.running = false
		if c.proxy != nil {
			_ = c.proxy.Close()
		}
		if c.server != nil {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			_ = c.server.Shutdown(ctx)
			cancel()
		}
		if c.masqueLn != nil {
			_ = c.masqueLn.Close()
		}
		if c.reportLn != nil {
			_ = c.reportLn.Close()
		}
		if c.debugSrv != nil {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			_ = c.debugSrv.Shutdown(ctx)
			cancel()
		}
		if c.debugLn != nil {
			_ = c.debugLn.Close()
		}
	})
}

func (d *Driver) applyAdaptiveReport(report AdaptiveReport, now time.Time) AdaptiveFeedback {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if report.ReportType == "" {
		report.ReportType = AdaptiveReportTypeIntent
	}
	if report.Timestamp.IsZero() {
		report.Timestamp = now
	}
	if report.FlowID == "" {
		report.FlowID = "flow-" + strconv.FormatInt(now.UnixNano(), 10)
	}

	if report.ReportType == AdaptiveReportTypeEnd {
		return d.endAdaptiveFlow(report, now)
	}
	return d.startAdaptiveFlow(report, now)
}

func (d *Driver) startAdaptiveFlow(report AdaptiveReport, now time.Time) AdaptiveFeedback {
	var feedback AdaptiveFeedback
	feedback.FlowID = report.FlowID
	feedback.Status = AdaptiveFeedbackStatusRejected
	feedback.ReasonCode = "SESSION_NOT_FOUND"
	feedback.Scenario = report.Scenario

	d.mu.Lock()
	defer d.mu.Unlock()

	seid, sess, ok := d.resolveAdaptiveSessionLocked(report)
	if !ok || sess == nil {
		if len(d.sessions) > 1 && report.UEAddress == "" && report.SEIDHint == 0 {
			feedback.ReasonCode = "SESSION_HINT_REQUIRED"
		}
		d.addAdaptiveTraceLocked(AdaptiveTraceEvent{
			Timestamp:        now,
			FlowID:           report.FlowID,
			UEAddress:        report.UEAddress,
			Stage:            "session-resolve",
			Status:           feedback.Status,
			ReasonCode:       feedback.ReasonCode,
			DefaultProfileID: defaultAdaptiveProfileID(),
			RequestMessage:   cloneAdaptiveReport(report),
			ResponseMessage:  cloneAdaptiveFeedback(feedback),
		})
		d.publishSnapshotLocked()
		return feedback
	}

	appliedQERIDs := collectAdaptiveQERIDs(sess)
	previousProfileID := ""
	if existing := sess.AdaptiveFlows[report.FlowID]; existing != nil {
		previousProfileID = storyProfileID(existing)
	}
	cpProvisionedRange := d.collectCPProvisionedRange(sess)
	profile, decisionReason := d.selectAdaptiveProfile(report, cpProvisionedRange)
	if profile.Duration <= 0 {
		profile.Duration = d.defaultAdaptiveDuration()
	}
	expiresAt := now.Add(profile.Duration)

	for _, qerID := range appliedQERIDs {
		sess.AdaptiveQER[adaptiveQERKey(qerID)] = &AdaptiveQEROverride{
			FlowID:         report.FlowID,
			ApplyToQERID:   qerID,
			OverrideGateUL: profile.OverrideGateUL,
			OverrideGateDL: profile.OverrideGateDL,
			OverrideGFBRUL: profile.OverrideGFBRUL,
			OverrideGFBRDL: profile.OverrideGFBRDL,
			OverrideMBRUL:  profile.OverrideMBRUL,
			OverrideMBRDL:  profile.OverrideMBRDL,
			ExpiresAt:      expiresAt,
		}
	}

	flow := &AdaptiveFlowState{
		FlowID:             report.FlowID,
		UEAddress:          report.UEAddress,
		AppliedQERIDs:      append([]uint32(nil), appliedQERIDs...),
		SelectedProfile:    profile,
		PreviousProfileID:  previousProfileID,
		DecisionReason:     decisionReason,
		CPProvisionedRange: cpProvisionedRange,
		LatestReport:       report,
		Scenario:           report.Scenario,
		UpdatedAt:          now,
	}

	feedback = AdaptiveFeedback{
		FlowID:     report.FlowID,
		Status:     AdaptiveFeedbackStatusStarted,
		ReasonCode: "ACCEPTED",
		ProfileID:  profile.ProfileID,
		Scenario:   report.Scenario,
	}

	if report.Scenario == "predictive-burst" {
		flow.StoryPhase = "prepared"
		flow.GNBDecision = "ACCEPTED"
		flow.PredictedAirDelayMs = derivePredictedAirDelay(report)
		flow.BlockSuccessRatio = deriveBlockSuccessRatio(report)
		feedback.StoryPhase = flow.StoryPhase
		feedback.GNBDecision = flow.GNBDecision
		feedback.PredictedAirDelayMs = flow.PredictedAirDelayMs
		feedback.BlockSuccessRatio = flow.BlockSuccessRatio
	}

	sess.AdaptiveFlows[report.FlowID] = flow
	sess.touch()

	d.addAdaptiveTraceLocked(AdaptiveTraceEvent{
		Timestamp:           now,
		FlowID:              report.FlowID,
		UEAddress:           report.UEAddress,
		SEID:                seid,
		Stage:               "upf-profile-applied",
		Status:              feedback.Status,
		ReasonCode:          feedback.ReasonCode,
		ProfileID:           profile.ProfileID,
		Scenario:            report.Scenario,
		GNBDecision:         feedback.GNBDecision,
		PredictedAirDelayMs: feedback.PredictedAirDelayMs,
		BlockSuccessRatio:   feedback.BlockSuccessRatio,
		PreviousProfileID:   previousProfileID,
		DefaultProfileID:    defaultAdaptiveProfileID(),
		DecisionReason:      decisionReason,
		CPProvisionedRange:  cpProvisionedRange,
		QoSDecision:         flowQoSDecision(flow),
		RequestMessage:      cloneAdaptiveReport(report),
		ResponseMessage:     cloneAdaptiveFeedback(feedback),
	})
	d.publishSnapshotLocked()
	d.scheduleAdaptiveFlowAutoEnd(report, report.Timestamp)
	return feedback
}

func (d *Driver) scheduleAdaptiveFlowAutoEnd(report AdaptiveReport, startedAt time.Time) {
	if d == nil || report.FlowID == "" || report.ExpectedArrivalTime.IsZero() {
		return
	}
	deadline := report.ExpectedArrivalTime.Add(adaptiveAutoEndGrace)
	delay := time.Until(deadline)
	if delay < adaptiveAutoEndGrace {
		delay = adaptiveAutoEndGrace
	}
	endReport := AdaptiveReport{
		FlowID:     report.FlowID,
		UEAddress:  report.UEAddress,
		ReportType: AdaptiveReportTypeEnd,
		Timestamp:  deadline,
		Scenario:   report.Scenario,
	}
	time.AfterFunc(delay, func() {
		if !d.isFlowStillCurrent(report.FlowID, startedAt) {
			return
		}
		d.applyAdaptiveReport(endReport, time.Now().UTC())
	})
}

func (d *Driver) isFlowStillCurrent(flowID string, startedAt time.Time) bool {
	if d == nil || flowID == "" {
		return false
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	for _, sess := range d.sessions {
		if sess == nil {
			continue
		}
		flow := sess.AdaptiveFlows[flowID]
		if flow == nil {
			continue
		}
		return flow.LatestReport.Timestamp.Equal(startedAt)
	}
	return false
}

func (d *Driver) endAdaptiveFlow(report AdaptiveReport, now time.Time) AdaptiveFeedback {
	feedback := AdaptiveFeedback{
		FlowID:     report.FlowID,
		Status:     AdaptiveFeedbackStatusRejected,
		ReasonCode: "FLOW_NOT_FOUND",
		Scenario:   report.Scenario,
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	for _, sess := range d.sessions {
		flow := sess.AdaptiveFlows[report.FlowID]
		if flow == nil {
			continue
		}
		for _, qerID := range flow.AppliedQERIDs {
			delete(sess.AdaptiveQER, adaptiveQERKey(qerID))
		}
		delete(sess.AdaptiveFlows, report.FlowID)
		sess.touch()
		feedback.Status = AdaptiveFeedbackStatusEnded
		feedback.ReasonCode = "ENDED"
		feedback.ProfileID = storyProfileID(flow)
		d.addAdaptiveTraceLocked(AdaptiveTraceEvent{
			Timestamp:        now,
			FlowID:           report.FlowID,
			UEAddress:        flow.UEAddress,
			SEID:             sess.SEID,
			Stage:            "upf-profile-cleared",
			Status:           feedback.Status,
			ReasonCode:       feedback.ReasonCode,
			ProfileID:        feedback.ProfileID,
			DefaultProfileID: defaultAdaptiveProfileID(),
			RequestMessage:   cloneAdaptiveReport(report),
			ResponseMessage:  cloneAdaptiveFeedback(feedback),
		})
		d.publishSnapshotLocked()
		return feedback
	}

	d.addAdaptiveTraceLocked(AdaptiveTraceEvent{
		Timestamp:        now,
		FlowID:           report.FlowID,
		UEAddress:        report.UEAddress,
		Stage:            "upf-profile-clear-miss",
		Status:           feedback.Status,
		ReasonCode:       feedback.ReasonCode,
		DefaultProfileID: defaultAdaptiveProfileID(),
		RequestMessage:   cloneAdaptiveReport(report),
		ResponseMessage:  cloneAdaptiveFeedback(feedback),
	})
	d.publishSnapshotLocked()
	return feedback
}

func (d *Driver) resolveAdaptiveSessionLocked(report AdaptiveReport) (uint64, *SessionState, bool) {
	if report.SEIDHint != 0 {
		sess := d.sessions[report.SEIDHint]
		if sess == nil {
			return 0, nil, false
		}
		return report.SEIDHint, sess, true
	}
	if report.UEAddress != "" {
		for seid, sess := range d.sessions {
			for _, pdr := range sess.PDRs {
				if pdr == nil || pdr.PDI == nil || len(pdr.PDI.UEIPv4) == 0 {
					continue
				}
				if pdr.PDI.UEIPv4.String() == report.UEAddress {
					return seid, sess, true
				}
			}
		}
		return 0, nil, false
	}
	if len(d.sessions) == 1 {
		for seid, sess := range d.sessions {
			return seid, sess, true
		}
	}
	return 0, nil, false
}

func (d *Driver) defaultAdaptiveDuration() time.Duration {
	if d == nil || d.adaptiveQoS == nil || d.adaptiveQoS.cfg == nil || d.adaptiveQoS.cfg.Authorization == nil {
		return 30 * time.Second
	}
	duration := d.adaptiveQoS.cfg.Authorization.DefaultProfileDuration
	if duration <= 0 {
		return 30 * time.Second
	}
	return duration
}

func (d *Driver) selectAdaptiveProfile(report AdaptiveReport, cp *adaptiveCPProvisionedRange) (*AdaptiveProfile, string) {
	if report.Scenario == "predictive-burst" {
		decision := derivePredictiveBurstDecision(report, cp)
		return &AdaptiveProfile{
			ProfileID:      decision.SelectedProfileID,
			OverrideGateUL: decision.OverrideGateUL,
			OverrideGateDL: decision.OverrideGateDL,
			OverrideGFBRUL: decision.OverrideGFBRUL,
			OverrideGFBRDL: decision.OverrideGFBRDL,
			OverrideMBRUL:  decision.OverrideMBRUL,
			OverrideMBRDL:  decision.OverrideMBRDL,
			Duration:       time.Duration(decision.DurationMs) * time.Millisecond,
		}, decision.DecisionReason
	}

	if d != nil && d.adaptiveQoS != nil && d.adaptiveQoS.cfg != nil {
		for _, rule := range d.adaptiveQoS.cfg.Rules {
			if !adaptiveRuleMatches(rule, report) {
				continue
			}
			name := rule.Name
			if name == "" {
				name = "adaptive-rule"
			}
			return &AdaptiveProfile{
				ProfileID:      name,
				OverrideGateUL: rule.OverrideGateUL,
				OverrideGateDL: rule.OverrideGateDL,
				OverrideGFBRUL: rule.TargetGFBRUL,
				OverrideGFBRDL: rule.TargetGFBRDL,
				OverrideMBRUL:  rule.OverrideMBRUL,
				OverrideMBRDL:  rule.OverrideMBRDL,
				Duration:       rule.Duration,
			}, "matched-rule=" + name
		}
	}

	return &AdaptiveProfile{
		ProfileID:      "adaptive-default",
		OverrideGateUL: boolPtr(true),
		OverrideGateDL: boolPtr(true),
		OverrideGFBRUL: 100000,
		OverrideGFBRDL: 100000,
		OverrideMBRUL:  100000,
		OverrideMBRDL:  100000,
		Duration:       d.defaultAdaptiveDuration(),
	}, "fallback=adaptive-default"
}

func adaptiveRuleMatches(rule factory.AdaptiveQoSRule, report AdaptiveReport) bool {
	if rule.TrafficPattern != "" && !strings.EqualFold(rule.TrafficPattern, report.TrafficPattern) {
		return false
	}
	if rule.LatencySensitivity != "" && !strings.EqualFold(rule.LatencySensitivity, report.LatencySensitivity) {
		return false
	}
	if rule.PacketLossTolerance != "" && !strings.EqualFold(rule.PacketLossTolerance, report.PacketLossTolerance) {
		return false
	}
	return true
}

func derivePredictiveBurstDecision(report AdaptiveReport, cp *adaptiveCPProvisionedRange) *adaptiveQoSDecisionView {
	windowMs := report.DeadlineMs
	if windowMs == 0 || (report.BurstDurationMs > 0 && report.BurstDurationMs > windowMs) {
		windowMs = report.BurstDurationMs
	}
	if windowMs == 0 {
		windowMs = 150
	}
	requiredDL := rateFromBurst(report.BurstSize, windowMs)
	requiredUL := requiredDL / 8
	if requiredUL == 0 && requiredDL > 0 {
		requiredUL = requiredDL / 4
	}
	if requiredUL == 0 {
		requiredUL = 100_000
	}
	if cp != nil {
		if cp.AuthorizationMaxBitrateDL > 0 && requiredDL > cp.AuthorizationMaxBitrateDL {
			requiredDL = cp.AuthorizationMaxBitrateDL
		}
		if cp.AuthorizationMaxBitrateUL > 0 && requiredUL > cp.AuthorizationMaxBitrateUL {
			requiredUL = cp.AuthorizationMaxBitrateUL
		}
	}
	gate := true
	gfbrDL := requiredDL * 3 / 4
	gfbrUL := requiredUL * 3 / 4
	if gfbrDL == 0 && requiredDL > 0 {
		gfbrDL = requiredDL
	}
	if gfbrUL == 0 && requiredUL > 0 {
		gfbrUL = requiredUL
	}
	return &adaptiveQoSDecisionView{
		SelectedProfileID:            "burst-protect",
		DecisionReason:               buildPredictiveBurstDecisionReason(report, requiredDL, requiredUL),
		OverrideGateUL:               &gate,
		OverrideGateDL:               &gate,
		OverrideGFBRUL:               gfbrUL,
		OverrideGFBRDL:               gfbrDL,
		DefaultGFBRUL:                defaultAdaptiveGFBR(),
		DefaultGFBRDL:                defaultAdaptiveGFBR(),
		OverrideMBRUL:                requiredUL,
		OverrideMBRDL:                requiredDL,
		DurationMs:                   report.DeadlineMsOrBurstDurationMs(),
		RequestedTrafficPattern:      report.TrafficPattern,
		RequestedLatencySensitivity:  report.LatencySensitivity,
		RequestedPacketLossTolerance: report.PacketLossTolerance,
		RequestedBurstSize:           report.BurstSize,
		RequestedBurstDurationMs:     storyDurationMs(report.BurstDuration, report.BurstDurationMs),
		RequestedDeadlineMs:          storyDurationMs(report.Deadline, report.DeadlineMs),
		RequestedPriority:            inferBurstPriority(report),
		RequestedBitrateDL:           rateFromBurst(report.BurstSize, windowMs),
		RequestedBitrateUL:           rateFromBurst(report.BurstSize/8, windowMs),
		RequestedArrivalTime:         report.expectedArrivalTime(),
		DefaultProfileID:             defaultAdaptiveProfileID(),
	}
}

func defaultAdaptiveGFBR() uint64 {
	return 100000
}

func rateFromBurst(sizeBytes uint64, windowMs uint64) uint64 {
	if sizeBytes == 0 {
		return 0
	}
	if windowMs == 0 {
		windowMs = 1
	}
	bits := sizeBytes * 8
	return uint64((bits*1000 + windowMs - 1) / windowMs)
}

func buildPredictiveBurstDecisionReason(report AdaptiveReport, requiredDL, requiredUL uint64) string {
	parts := []string{"scenario=predictive-burst"}
	if report.BurstSize > 0 {
		parts = append(parts, fmt.Sprintf("burst=%dB", report.BurstSize))
	}
	if ms := storyDurationMs(report.BurstDuration, report.BurstDurationMs); ms > 0 {
		parts = append(parts, fmt.Sprintf("burstDuration=%dms", ms))
	}
	if ms := storyDurationMs(report.Deadline, report.DeadlineMs); ms > 0 {
		parts = append(parts, fmt.Sprintf("deadline=%dms", ms))
	}
	if report.Priority != "" {
		parts = append(parts, "priority="+report.Priority)
	}
	if !report.ExpectedArrivalTime.IsZero() {
		parts = append(parts, "arrival="+report.ExpectedArrivalTime.UTC().Format(time.RFC3339Nano))
	}
	parts = append(parts, fmt.Sprintf("requestedDL=%d", requiredDL))
	parts = append(parts, fmt.Sprintf("requestedUL=%d", requiredUL))
	return strings.Join(parts, " ")
}

func inferBurstPriority(report AdaptiveReport) string {
	if report.Priority != "" {
		return report.Priority
	}
	if report.DeadlineMs > 0 && report.DeadlineMs <= 150 {
		return "high"
	}
	return "normal"
}

func derivePredictedAirDelay(report AdaptiveReport) uint64 {
	if report.DeadlineMs > 0 {
		if report.DeadlineMs <= 50 {
			return 4
		}
		if report.DeadlineMs <= 150 {
			return 8
		}
		return 16
	}
	if report.BurstDurationMs > 0 {
		if report.BurstDurationMs <= 100 {
			return 8
		}
		return 16
	}
	return 8
}

func deriveBlockSuccessRatio(report AdaptiveReport) float64 {
	if report.BurstSize >= 8<<20 {
		return 0.96
	}
	if report.BurstSize >= 4<<20 {
		return 0.99
	}
	return 0.995
}

func (r AdaptiveReport) DeadlineMsOrBurstDurationMs() uint64 {
	if ms := storyDurationMs(r.Deadline, r.DeadlineMs); ms > 0 {
		return ms
	}
	return storyDurationMs(r.BurstDuration, r.BurstDurationMs)
}

func (r AdaptiveReport) expectedArrivalTime() time.Time {
	if !r.ExpectedArrivalTime.IsZero() {
		return r.ExpectedArrivalTime.UTC()
	}
	return r.Timestamp.Add(time.Duration(r.BurstDurationMs) * time.Millisecond)
}

func collectAdaptiveQERIDs(sess *SessionState) []uint32 {
	if sess == nil {
		return nil
	}
	seen := make(map[uint32]struct{})
	var out []uint32
	for _, pdr := range sess.PDRs {
		for _, qerID := range pdr.QERIDs {
			if _, ok := sess.QERs[qerID]; !ok {
				continue
			}
			if _, exists := seen[qerID]; exists {
				continue
			}
			seen[qerID] = struct{}{}
			out = append(out, qerID)
		}
	}
	if len(out) == 0 {
		for qerID := range sess.QERs {
			if _, exists := seen[qerID]; exists {
				continue
			}
			seen[qerID] = struct{}{}
			out = append(out, qerID)
		}
	}
	return out
}

func (d *Driver) collectCPProvisionedRange(sess *SessionState) *adaptiveCPProvisionedRange {
	if sess == nil {
		return nil
	}
	cp := &adaptiveCPProvisionedRange{
		QERCount: len(sess.QERs),
	}
	if d != nil && d.adaptiveQoS != nil && d.adaptiveQoS.cfg != nil && d.adaptiveQoS.cfg.Authorization != nil {
		auth := d.adaptiveQoS.cfg.Authorization
		cp.AuthorizationMaxBitrateUL = auth.MaxBitrateUL
		cp.AuthorizationMaxBitrateDL = auth.MaxBitrateDL
		cp.AuthorizationMaxGFBRUL = auth.MaxGFBRUL
		cp.AuthorizationMaxGFBRDL = auth.MaxGFBRDL
	}

	var mbrULSet, mbrDLSet, gbrULSet, gbrDLSet bool
	for _, qer := range sess.QERs {
		if qer == nil {
			continue
		}
		if qer.MBRUL != nil {
			cp.MBRULMin, cp.MBRULMax, mbrULSet = updateRange(cp.MBRULMin, cp.MBRULMax, *qer.MBRUL, mbrULSet)
		}
		if qer.MBRDL != nil {
			cp.MBRDLMin, cp.MBRDLMax, mbrDLSet = updateRange(cp.MBRDLMin, cp.MBRDLMax, *qer.MBRDL, mbrDLSet)
		}
		if qer.GBRUL != nil {
			cp.GBRULMin, cp.GBRULMax, gbrULSet = updateRange(cp.GBRULMin, cp.GBRULMax, *qer.GBRUL, gbrULSet)
		}
		if qer.GBRDL != nil {
			cp.GBRDLMin, cp.GBRDLMax, gbrDLSet = updateRange(cp.GBRDLMin, cp.GBRDLMax, *qer.GBRDL, gbrDLSet)
		}
		if qer.GateStatus != nil {
			if *qer.GateStatus&qerULGateClosed != 0 {
				cp.GateClosedULCount++
			}
			if *qer.GateStatus&qerDLGateClosed != 0 {
				cp.GateClosedDLCount++
			}
		}
	}
	return cp
}

func updateRange(minV, maxV, value uint64, alreadySet bool) (uint64, uint64, bool) {
	if !alreadySet {
		return value, value, true
	}
	if value < minV {
		minV = value
	}
	if value > maxV {
		maxV = value
	}
	return minV, maxV, true
}

func adaptiveQERKey(qerID uint32) string {
	return strconv.FormatUint(uint64(qerID), 10)
}

func boolPtr(v bool) *bool {
	return &v
}

func (d *Driver) addAdaptiveTraceLocked(event AdaptiveTraceEvent) {
	if d == nil || d.adaptiveTrace == nil {
		return
	}
	d.adaptiveTrace.add(event)
}
