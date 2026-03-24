package client

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	masque "github.com/quic-go/masque-go"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/yosida95/uritemplate/v3"
)

const (
	AdaptiveReportTypeIntent = "intent"
	AdaptiveReportTypeEnd    = "end"
)

type AdaptiveReport struct {
	UEAddress              string           `json:"ueAddress,omitempty"`
	FlowID                 string           `json:"flowId,omitempty"`
	ReportType             string           `json:"reportType,omitempty"`
	Timestamp              time.Time        `json:"timestamp,omitempty"`
	Scenario               string           `json:"scenario,omitempty"`
	TrafficPattern         string           `json:"trafficPattern,omitempty"`
	LatencySensitivity     string           `json:"latencySensitivity,omitempty"`
	PacketLossTolerance    string           `json:"packetLossTolerance,omitempty"`
	Priority               string           `json:"priority,omitempty"`
	ExpectedArrivalTime    time.Time        `json:"expectedArrivalTime,omitempty"`
	ExpectedArrivalDelayMs  uint64           `json:"expectedArrivalDelayMs,omitempty"`
	Packet                 *PacketFiveTuple `json:"packet,omitempty"`
	BurstSize              uint64           `json:"burstSize,omitempty"`
	BurstDuration          time.Duration    `json:"burstDuration,omitempty"`
	BurstDurationMs        uint64           `json:"burstDurationMs,omitempty"`
	Deadline               time.Duration    `json:"deadline,omitempty"`
	DeadlineMs             uint64           `json:"deadlineMs,omitempty"`
	SEIDHint               uint64           `json:"seidHint,omitempty"`
	FlowDescription        string           `json:"flowDescription,omitempty"`
}

type PacketFiveTuple struct {
	SrcIP    string `json:"srcIp,omitempty"`
	DstIP    string `json:"dstIp,omitempty"`
	SrcPort  uint16 `json:"srcPort,omitempty"`
	DstPort  uint16 `json:"dstPort,omitempty"`
	Protocol string `json:"protocol,omitempty"`
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
	PacketCount         uint64  `json:"packetCount,omitempty"`
}

type Client struct {
	ProxyTemplate string
	UpfAddr       string
	TargetHost    string
	TargetPort    int
	TLSConf       *tls.Config
}

func (c *Client) Report(ctx context.Context, report AdaptiveReport) (*AdaptiveFeedback, error) {
	report.normalize()

	dialCtx := context.Background()
	cancel := func() {}
	if ctx != nil {
		if deadline, ok := ctx.Deadline(); ok {
			dialCtx, cancel = context.WithDeadline(context.Background(), deadline)
		} else {
			dialCtx, cancel = context.WithTimeout(context.Background(), 15*time.Second)
		}
	} else {
		dialCtx, cancel = context.WithTimeout(context.Background(), 15*time.Second)
	}
	defer cancel()

	proxyTemplate, err := normalizeProxyTemplate(c.ProxyTemplate)
	if err != nil || proxyTemplate == nil {
		proxyTemplate, err = normalizeProxyTemplate(c.UpfAddr)
	}
	if err != nil {
		return nil, err
	}

	targetHost := strings.TrimSpace(c.TargetHost)
	if targetHost == "" {
		targetHost = "127.0.0.1"
	}
	targetPort := c.TargetPort
	if targetPort <= 0 {
		targetPort = 7777
	}
	target := net.JoinHostPort(targetHost, strconv.Itoa(targetPort))
	mc := masque.Client{
		TLSClientConfig: c.tlsConfig(),
		QUICConfig: &quic.Config{
			EnableDatagrams:   true,
			InitialPacketSize: 1350,
		},
	}
	defer mc.Close()

	pconn, rsp, err := mc.Dial(dialCtx, proxyTemplate, mustUDPAddr(target))
	if err != nil {
		return nil, fmt.Errorf("open masque tunnel: %w", err)
	}
	defer pconn.Close()
	if rsp == nil || rsp.StatusCode < 200 || rsp.StatusCode > 299 {
		code := 0
		if rsp != nil {
			code = rsp.StatusCode
		}
		return nil, fmt.Errorf("open masque tunnel: proxy returned %d", code)
	}

	payload, err := json.Marshal(report)
	if err != nil {
		return nil, err
	}
	if deadline := deadlineFromContext(dialCtx); !deadline.IsZero() {
		_ = pconn.SetDeadline(deadline)
	}
	if _, err := pconn.WriteTo(payload, nil); err != nil {
		return nil, fmt.Errorf("write report: %w", err)
	}

	respBuf := make([]byte, 64*1024)
	n, _, err := pconn.ReadFrom(respBuf)
	if err != nil {
		return nil, fmt.Errorf("read feedback: %w", err)
	}

	var feedback AdaptiveFeedback
	if err := json.Unmarshal(respBuf[:n], &feedback); err != nil {
		return nil, fmt.Errorf("unmarshal feedback: %w", err)
	}

	return &feedback, nil
}

func (r *AdaptiveReport) normalize() {
	if r == nil {
		return
	}
	if r.ReportType == "" {
		r.ReportType = AdaptiveReportTypeIntent
	}
	if r.Scenario == "" {
		r.Scenario = "predictive-burst"
	}
	if r.FlowID == "" {
		r.FlowID = "flow-" + time.Now().UTC().Format("150405")
	}
	now := time.Now().UTC()
	if r.Timestamp.IsZero() {
		r.Timestamp = now
	}
	if r.ExpectedArrivalTime.IsZero() && r.ExpectedArrivalDelayMs > 0 {
		r.ExpectedArrivalTime = now.Add(time.Duration(r.ExpectedArrivalDelayMs) * time.Millisecond)
	}
	if r.FlowDescription == "" {
		r.FlowDescription = buildFlowDescription(r.Packet)
	}
}

func buildFlowDescription(pkt *PacketFiveTuple) string {
	if pkt == nil {
		return ""
	}
	protocol := strings.ToLower(strings.TrimSpace(pkt.Protocol))
	if protocol == "" {
		protocol = "ip"
	}
	if strings.TrimSpace(pkt.SrcIP) == "" && strings.TrimSpace(pkt.DstIP) == "" {
		return ""
	}
	src := strings.TrimSpace(pkt.SrcIP)
	dst := strings.TrimSpace(pkt.DstIP)
	srcToken := "any"
	dstToken := "any"
	if src != "" {
		srcToken = src
	}
	if pkt.SrcPort != 0 {
		srcToken = fmt.Sprintf("%s %d", srcToken, pkt.SrcPort)
	}
	if dst != "" {
		dstToken = dst
	}
	if pkt.DstPort != 0 {
		dstToken = fmt.Sprintf("%s %d", dstToken, pkt.DstPort)
	}
	return fmt.Sprintf("permit out %s from %s to %s", protocol, srcToken, dstToken)
}

func normalizeProxyTemplate(raw string) (*uritemplate.Template, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "https://127.0.0.1:4433/masque?h={target_host}&p={target_port}"
	}
	if strings.Contains(raw, "{target_host}") && strings.Contains(raw, "{target_port}") {
		return uritemplate.New(raw)
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse proxy template: %w", err)
	}
	if u.Scheme == "" {
		u.Scheme = "https"
	}
	if u.Path == "" || u.Path == "/" {
		u.Path = "/masque"
	}
	u.RawQuery = "h={target_host}&p={target_port}"
	return uritemplate.New(u.String())
}

func mustUDPAddr(addr string) *net.UDPAddr {
	udpAddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 7777}
	}
	return udpAddr
}

func (c *Client) tlsConfig() *tls.Config {
	if c == nil || c.TLSConf == nil {
		return &tls.Config{NextProtos: []string{http3.NextProtoH3}}
	}
	conf := c.TLSConf.Clone()
	if len(conf.NextProtos) == 0 {
		conf.NextProtos = []string{http3.NextProtoH3}
	}
	return conf
}

func deadlineFromContext(ctx context.Context) time.Time {
	if ctx == nil {
		return time.Time{}
	}
	if deadline, ok := ctx.Deadline(); ok {
		return deadline
	}
	return time.Now().Add(10 * time.Second)
}
