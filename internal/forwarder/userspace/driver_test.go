package userspace

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	masque "github.com/quic-go/masque-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/stretchr/testify/require"
	"github.com/wmnsk/go-pfcp/ie"

	"github.com/acore2026/go-upf/internal/gtpv1"
	"github.com/acore2026/go-upf/internal/report"
	"github.com/acore2026/go-upf/pkg/factory"
)

type testReportHandler struct {
	mu      sync.Mutex
	reports []report.SessReport
}

type testMasqueProxy struct{}

func (h *testReportHandler) NotifySessReport(sr report.SessReport) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.reports = append(h.reports, sr)
}

func (h *testReportHandler) PopBufPkt(uint64, uint16) ([]byte, bool) {
	return nil, false
}

func (p *testMasqueProxy) ProxyConnectedSocket(w http.ResponseWriter, _ *masque.Request, conn *net.UDPConn) error {
	defer conn.Close()
	w.WriteHeader(http.StatusOK)
	return nil
}

func (p *testMasqueProxy) Close() error { return nil }

func TestNewStartsConfiguredWorkers(t *testing.T) {
	var wg sync.WaitGroup
	driver, err := New(&wg, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   3,
				QueueSize: 8,
			},
		},
	})
	require.NoError(t, err)
	require.Len(t, driver.workers, 3)

	driver.Close()
	wg.Wait()
}

func TestNewStartsAdaptiveQoSControllerWhenEnabled(t *testing.T) {
	certFile, keyFile, certPool := writeAdaptiveQoSTestCerts(t)
	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
				GNBControl: &factory.AdaptiveQoSGNBControl{
					Addr: "127.0.0.2",
					Port: 2152,
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	require.NotNil(t, driver.adaptiveQoS)
	require.True(t, driver.adaptiveQoS.Running())
	require.NotNil(t, driver.adaptiveQoS.Template())
	require.Equal(t, certFile, driver.adaptiveQoS.certFile)
	require.Equal(t, keyFile, driver.adaptiveQoS.keyFile)
	require.NotNil(t, certPool)
}

func TestNewWithoutAdaptiveQoSLeavesControllerDisabled(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.Nil(t, driver.adaptiveQoS)
}

func TestRuleLifecycle(t *testing.T) {
	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	err = driver.CreateFAR(1, ie.NewCreateFAR(
		ie.NewFARID(9),
		ie.NewApplyAction(0x2),
	))
	require.NoError(t, err)

	err = driver.CreatePDR(1, ie.NewCreatePDR(
		ie.NewPDRID(7),
		ie.NewPrecedence(255),
		ie.NewPDI(ie.NewSourceInterface(ie.SrcInterfaceAccess)),
		ie.NewOuterHeaderRemoval(0, 0),
		ie.NewFARID(9),
	))
	require.NoError(t, err)

	driver.mu.RLock()
	require.Contains(t, driver.sessions, uint64(1))
	require.Contains(t, driver.sessions[1].PDRs, uint16(7))
	require.Contains(t, driver.sessions[1].FARs, uint32(9))
	driver.mu.RUnlock()

	err = driver.RemovePDR(1, ie.NewRemovePDR(ie.NewPDRID(7)))
	require.NoError(t, err)
	err = driver.RemoveFAR(1, ie.NewRemoveFAR(ie.NewFARID(9)))
	require.NoError(t, err)

	driver.mu.RLock()
	require.NotContains(t, driver.sessions, uint64(1))
	driver.mu.RUnlock()
}

func TestSessionStateInitializesAdaptiveMaps(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	err = driver.CreateFAR(1, ie.NewCreateFAR(
		ie.NewFARID(9),
		ie.NewApplyAction(0x2),
	))
	require.NoError(t, err)
	err = driver.CreatePDR(1, ie.NewCreatePDR(
		ie.NewPDRID(7),
		ie.NewPrecedence(255),
		ie.NewPDI(ie.NewSourceInterface(ie.SrcInterfaceAccess)),
		ie.NewOuterHeaderRemoval(0, 0),
		ie.NewFARID(9),
	))
	require.NoError(t, err)

	driver.mu.RLock()
	sess := driver.sessions[1]
	driver.mu.RUnlock()
	require.NotNil(t, sess)
	require.NotNil(t, sess.AdaptiveFlows)
	require.NotNil(t, sess.AdaptiveQER)
}

func TestQERStoresPFCPFieldsConsistently(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateQER(77, ie.NewCreateQER(
		ie.NewQERID(5),
		ie.NewQERCorrelationID(9),
		ie.NewGateStatus(ie.GateStatusClosed, ie.GateStatusOpen),
		ie.NewMBR(200000, 100000),
		ie.NewGBR(300000, 150000),
		ie.NewQFI(10),
		ie.NewRQI(1),
		ie.NewPagingPolicyIndicator(7),
	)))

	driver.mu.RLock()
	qer := driver.sessions[77].QERs[5]
	driver.mu.RUnlock()
	require.NotNil(t, qer)
	require.NotNil(t, qer.CorrelationID)
	require.EqualValues(t, 9, *qer.CorrelationID)
	require.NotNil(t, qer.GateStatus)
	require.EqualValues(t, ie.GateStatusClosed<<2|ie.GateStatusOpen, *qer.GateStatus)
	require.NotNil(t, qer.MBRUL)
	require.NotNil(t, qer.MBRDL)
	require.EqualValues(t, 200000, *qer.MBRUL)
	require.EqualValues(t, 100000, *qer.MBRDL)
	require.NotNil(t, qer.GBRUL)
	require.NotNil(t, qer.GBRDL)
	require.EqualValues(t, 300000, *qer.GBRUL)
	require.EqualValues(t, 150000, *qer.GBRDL)
	require.NotNil(t, qer.QFI)
	require.EqualValues(t, 10, *qer.QFI)
	require.NotNil(t, qer.RQI)
	require.EqualValues(t, 1, *qer.RQI)
	require.NotNil(t, qer.PPI)
	require.EqualValues(t, 7, *qer.PPI)
}

func TestAdaptiveQEROverrideClosesGate(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateQER(77, ie.NewCreateQER(
		ie.NewQERID(5),
		ie.NewGateStatus(ie.GateStatusOpen, ie.GateStatusOpen),
	)))

	driver.mu.Lock()
	driver.sessions[77].AdaptiveQER[adaptiveQERKey(5)] = &AdaptiveQEROverride{
		FlowID:         "flow-1",
		ApplyToQERID:   5,
		OverrideGateUL: boolPtr(false),
		ExpiresAt:      time.Now().UTC().Add(time.Minute),
	}
	binding := &PDRBinding{
		SEID: 77,
		QERs: []*QERRule{driver.sessions[77].QERs[5]},
	}
	driver.mu.Unlock()

	require.True(t, driver.gateClosed(binding, PacketDirectionUplink))
	require.False(t, driver.gateClosed(binding, PacketDirectionDownlink))
}

func TestAdaptiveQEROverrideMBRTakesPrecedence(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateQER(88, ie.NewCreateQER(
		ie.NewQERID(6),
		ie.NewMBR(500000, 400000),
	)))

	driver.mu.Lock()
	driver.sessions[88].AdaptiveQER[adaptiveQERKey(6)] = &AdaptiveQEROverride{
		FlowID:        "flow-2",
		ApplyToQERID:  6,
		OverrideMBRUL: 123000,
		OverrideMBRDL: 456000,
		ExpiresAt:     time.Now().UTC().Add(time.Minute),
	}
	binding := &PDRBinding{
		SEID: 88,
		QERs: []*QERRule{driver.sessions[88].QERs[6]},
	}
	driver.mu.Unlock()

	require.EqualValues(t, 123000, driver.effectiveQERMBR(binding, binding.QERs[0], PacketDirectionUplink))
	require.EqualValues(t, 456000, driver.effectiveQERMBR(binding, binding.QERs[0], PacketDirectionDownlink))
}

func TestAdaptiveQoSMASQUETunnelCarriesReportAndFeedback(t *testing.T) {
	certFile, keyFile, certPool := writeAdaptiveQoSTestCerts(t)

	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()
	seedAdaptiveSession(t, driver, 42, "60.60.0.42", 9)

	template := driver.adaptiveQoS.Template()
	require.NotNil(t, template)
	targetAddr := driver.adaptiveQoS.ReportTargetAddr()
	require.NotNil(t, targetAddr)

	client := masque.Client{
		TLSClientConfig: &tls.Config{
			RootCAs:            certPool,
			ServerName:         "localhost",
			NextProtos:         []string{http3.NextProtoH3},
			InsecureSkipVerify: true,
		},
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, rsp, err := client.Dial(ctx, template, targetAddr)
	require.NoError(t, err)
	require.Equal(t, 200, rsp.StatusCode)
	defer conn.Close()

	reqPayload, err := json.Marshal(AdaptiveReport{
		UEAddress:           "60.60.0.42",
		FlowID:              "flow-123",
		ReportType:          AdaptiveReportTypeIntent,
		Timestamp:           time.Now().UTC(),
		LatencySensitivity:  "high",
		TrafficPattern:      "periodic",
		PacketLossTolerance: "low",
	})
	require.NoError(t, err)
	_, err = conn.WriteTo(reqPayload, nil)
	require.NoError(t, err)

	buf := make([]byte, 1024)
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
	n, _, err := conn.ReadFrom(buf)
	require.NoError(t, err)
	var feedback AdaptiveFeedback
	require.NoError(t, json.Unmarshal(buf[:n], &feedback))
	require.Equal(t, "flow-123", feedback.FlowID)
	require.Equal(t, AdaptiveFeedbackStatusStarted, feedback.Status)
	require.Equal(t, "ACCEPTED", feedback.ReasonCode)
}

func TestApplyAdaptiveReportBindsByUEAddressAndOverridesQER(t *testing.T) {
	certFile, keyFile, _ := writeAdaptiveQoSTestCerts(t)

	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
				Authorization: &factory.AdaptiveQoSAuthorization{
					DefaultProfileDuration: time.Minute,
					MaxBitrateUL:           200000,
					MaxBitrateDL:           300000,
				},
				Rules: []factory.AdaptiveQoSRule{
					{
						Name:               "low-latency",
						TrafficPattern:     "periodic",
						LatencySensitivity: "high",
						OverrideGateUL:     boolPtr(true),
						OverrideGateDL:     boolPtr(true),
						OverrideMBRUL:      150000,
						OverrideMBRDL:      250000,
						Duration:           45 * time.Second,
					},
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	seedAdaptiveSession(t, driver, 101, "60.60.0.101", 7)

	now := time.Now().UTC()
	feedback := driver.applyAdaptiveReport(AdaptiveReport{
		UEAddress:           "60.60.0.101",
		FlowID:              "flow-a",
		ReportType:          AdaptiveReportTypeIntent,
		Timestamp:           now,
		TrafficPattern:      "periodic",
		LatencySensitivity:  "high",
		PacketLossTolerance: "low",
	}, now)

	require.Equal(t, AdaptiveFeedbackStatusStarted, feedback.Status)
	require.Equal(t, "ACCEPTED", feedback.ReasonCode)

	driver.mu.RLock()
	defer driver.mu.RUnlock()
	sess := driver.sessions[101]
	require.NotNil(t, sess)
	flow := sess.AdaptiveFlows["flow-a"]
	require.NotNil(t, flow)
	require.Equal(t, "60.60.0.101", flow.UEAddress)
	require.Equal(t, []uint32{7}, flow.AppliedQERIDs)
	require.NotNil(t, flow.SelectedProfile)
	require.Equal(t, "low-latency", flow.SelectedProfile.ProfileID)
	override := sess.AdaptiveQER[adaptiveQERKey(7)]
	require.NotNil(t, override)
	require.NotNil(t, override.OverrideGateUL)
	require.True(t, *override.OverrideGateUL)
	require.NotNil(t, override.OverrideGateDL)
	require.True(t, *override.OverrideGateDL)
	require.EqualValues(t, 150000, override.OverrideMBRUL)
	require.EqualValues(t, 250000, override.OverrideMBRDL)
}

func TestApplyAdaptiveReportPredictiveBurstReturnsStoryFeedback(t *testing.T) {
	certFile, keyFile, _ := writeAdaptiveQoSTestCerts(t)

	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	seedAdaptiveSession(t, driver, 103, "60.60.0.103", 9)

	now := time.Now().UTC()
	feedback := driver.applyAdaptiveReport(AdaptiveReport{
		UEAddress:       "60.60.0.103",
		FlowID:          "story1-flow",
		ReportType:      AdaptiveReportTypeIntent,
		Timestamp:       now,
		Scenario:        "predictive-burst",
		TrafficPattern:  "burst",
		BurstSize:       6 << 20,
		BurstDurationMs: 120,
		DeadlineMs:      150,
	}, now)

	require.Equal(t, AdaptiveFeedbackStatusStarted, feedback.Status)
	require.Equal(t, "burst-protect", feedback.ProfileID)
	require.Equal(t, "predictive-burst", feedback.Scenario)
	require.Equal(t, "prepared", feedback.StoryPhase)
	require.Equal(t, "ACCEPTED", feedback.GNBDecision)
	require.EqualValues(t, 8, feedback.PredictedAirDelayMs)
	require.InDelta(t, 0.99, feedback.BlockSuccessRatio, 0.001)

	story := driver.currentStoryView()
	require.NotNil(t, story)
	require.Equal(t, "predictive-burst", story.Scenario)
	require.Equal(t, "story1-flow", story.FlowID)
	require.Equal(t, "burst-protect", story.ProfileID)
	require.Contains(t, story.DecisionReason, "burst=6291456B")
	require.Contains(t, story.DecisionReason, "deadline=150ms")

	driver.mu.RLock()
	flow := driver.sessions[103].AdaptiveFlows["story1-flow"]
	driver.mu.RUnlock()
	require.NotNil(t, flow)
	qos := flowQoSDecision(flow)
	require.NotNil(t, qos)
	require.Equal(t, uint64(6<<20), qos.RequestedBurstSize)
	require.Equal(t, uint64(150), qos.RequestedDeadlineMs)
	require.Equal(t, "burst", qos.RequestedTrafficPattern)
	require.Equal(t, uint64(335544320), qos.RequestedBitrateDL)
	require.Equal(t, uint64(41943040), qos.RequestedBitrateUL)
	require.Equal(t, uint64(1000000), qos.DefaultGFBRDL)
	require.Equal(t, uint64(1000000), qos.DefaultGFBRUL)
	require.Equal(t, uint64(335544320), qos.OverrideMBRDL)
	require.Equal(t, uint64(41943040), qos.OverrideMBRUL)
	require.Equal(t, "high", qos.RequestedPriority)
	require.True(t, strings.Contains(qos.DecisionReason, "requestedDL=335544320"))
}

func TestAdaptiveQoSStatusExposesCurrentAndDefaultProfiles(t *testing.T) {
	certFile, keyFile, _ := writeAdaptiveQoSTestCerts(t)

	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()
	seedAdaptiveSession(t, driver, 104, "60.60.0.104", 10)

	now := time.Now().UTC()
	feedback := driver.applyAdaptiveReport(AdaptiveReport{
		UEAddress:      "60.60.0.104",
		FlowID:         "story1-flow-status",
		ReportType:     AdaptiveReportTypeIntent,
		Timestamp:      now,
		Scenario:       "predictive-burst",
		TrafficPattern: "burst",
		BurstSize:      6 << 20,
		DeadlineMs:     150,
	}, now)
	require.Equal(t, AdaptiveFeedbackStatusStarted, feedback.Status)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/debug/adaptive-qos/status", nil)
	driver.adaptiveQoS.handleDebugStatus(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var status adaptiveDebugStatus
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &status))
	require.NotNil(t, status.Story)
	require.NotNil(t, status.QoSDecision)
	require.NotNil(t, status.CurrentQoSProfile)
	require.NotNil(t, status.DefaultQoSProfile)
	require.Equal(t, status.QoSDecision.SelectedProfileID, status.CurrentQoSProfile.SelectedProfileID)
	require.Equal(t, "adaptive-default", status.DefaultQoSProfile.SelectedProfileID)
	require.Equal(t, uint64(1000000), status.DefaultQoSProfile.OverrideGFBRDL)
	require.Equal(t, uint64(1000000), status.DefaultQoSProfile.OverrideGFBRUL)
}

func TestAdaptiveQoSAutoEndsFlowAfterExpectedArrival(t *testing.T) {
	certFile, keyFile, _ := writeAdaptiveQoSTestCerts(t)

	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()
	seedAdaptiveSession(t, driver, 105, "60.60.0.105", 11)

	startedAt := time.Now().UTC()
	feedback := driver.applyAdaptiveReport(AdaptiveReport{
		UEAddress:           "60.60.0.105",
		FlowID:              "flow-auto-end",
		ReportType:          AdaptiveReportTypeIntent,
		Timestamp:           startedAt,
		Scenario:            "predictive-burst",
		TrafficPattern:      "burst",
		BurstSize:           6 << 20,
		DeadlineMs:          150,
		ExpectedArrivalTime: startedAt.Add(25 * time.Millisecond),
	}, startedAt)
	require.Equal(t, AdaptiveFeedbackStatusStarted, feedback.Status)

	require.Eventually(t, func() bool {
		snapshot := driver.Snapshot()
		for _, sess := range snapshot.Sessions {
			if sess == nil {
				continue
			}
			if _, ok := sess.AdaptiveFlows["flow-auto-end"]; ok {
				return false
			}
		}
		return true
	}, 12*time.Second, 100*time.Millisecond)

	snapshot := driver.Snapshot()
	foundCleared := false
	for _, event := range snapshot.AdaptiveTrace {
		if event.FlowID == "flow-auto-end" && event.Stage == "upf-profile-cleared" {
			foundCleared = true
			break
		}
	}
	require.True(t, foundCleared, "expected auto-end trace event")
}

func TestAdaptiveQoSMASQUEConnectAndDisconnectTrace(t *testing.T) {
	certFile, keyFile, _ := writeAdaptiveQoSTestCerts(t)

	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()
	require.NotNil(t, driver.adaptiveQoS)
	driver.adaptiveQoS.proxy = &testMasqueProxy{}

	templateHost := driver.adaptiveQoS.template.Raw()
	u, err := url.Parse(templateHost)
	require.NoError(t, err)

	req := &http.Request{
		Method:     http.MethodConnect,
		Host:       u.Host,
		Proto:      "connect-udp",
		ProtoMajor: 3,
		ProtoMinor: 0,
		URL: &url.URL{
			Scheme:   "https",
			Host:     u.Host,
			Path:     "/masque",
			RawQuery: "h=198.51.100.10&p=443",
		},
		Header: make(http.Header),
	}

	rec := httptest.NewRecorder()
	driver.adaptiveQoS.handleMASQUE(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	snapshot := driver.Snapshot()
	var sawConnect, sawDisconnect bool
	for _, event := range snapshot.AdaptiveTrace {
		if event.Stage == "masque-connect" && event.Status == "connected" {
			sawConnect = true
		}
		if event.Stage == "masque-disconnect" && event.Status == "disconnected" {
			sawDisconnect = true
		}
	}
	require.True(t, sawConnect, "expected masque connect trace")
	require.True(t, sawDisconnect, "expected masque disconnect trace")
}

func TestApplyAdaptiveReportEndClearsOverrides(t *testing.T) {
	certFile, keyFile, _ := writeAdaptiveQoSTestCerts(t)

	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	seedAdaptiveSession(t, driver, 102, "60.60.0.102", 8)
	now := time.Now().UTC()

	started := driver.applyAdaptiveReport(AdaptiveReport{
		UEAddress:          "60.60.0.102",
		FlowID:             "flow-b",
		ReportType:         AdaptiveReportTypeIntent,
		Timestamp:          now,
		LatencySensitivity: "high",
	}, now)
	require.Equal(t, AdaptiveFeedbackStatusStarted, started.Status)

	ended := driver.applyAdaptiveReport(AdaptiveReport{
		FlowID:     "flow-b",
		ReportType: AdaptiveReportTypeEnd,
		Timestamp:  now.Add(time.Second),
	}, now.Add(time.Second))
	require.Equal(t, AdaptiveFeedbackStatusEnded, ended.Status)
	require.Equal(t, "ENDED", ended.ReasonCode)

	driver.mu.RLock()
	defer driver.mu.RUnlock()
	sess := driver.sessions[102]
	require.NotNil(t, sess)
	require.Nil(t, sess.AdaptiveFlows["flow-b"])
	require.Nil(t, sess.AdaptiveQER[adaptiveQERKey(8)])
}

func TestApplyAdaptiveReportRejectsAmbiguousSessionWithoutHint(t *testing.T) {
	certFile, keyFile, _ := writeAdaptiveQoSTestCerts(t)

	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
			AdaptiveQoS: &factory.AdaptiveQoS{
				Enable:            true,
				MASQUEBindAddress: "127.0.0.1",
				MASQUEPort:        0,
				TLS: &factory.Tls{
					Pem: certFile,
					Key: keyFile,
				},
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	seedAdaptiveSession(t, driver, 201, "60.60.0.201", 11)
	seedAdaptiveSession(t, driver, 202, "60.60.0.202", 12)

	feedback := driver.applyAdaptiveReport(AdaptiveReport{
		FlowID:     "flow-c",
		ReportType: AdaptiveReportTypeIntent,
		Timestamp:  time.Now().UTC(),
	}, time.Now().UTC())
	require.Equal(t, AdaptiveFeedbackStatusRejected, feedback.Status)
	require.Equal(t, "SESSION_HINT_REQUIRED", feedback.ReasonCode)
}

func TestSnapshotIndexesAndClassification(t *testing.T) {
	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   2,
				QueueSize: 4,
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	err = driver.CreateFAR(10, ie.NewCreateFAR(
		ie.NewFARID(5),
		ie.NewApplyAction(0x2),
	))
	require.NoError(t, err)

	err = driver.CreatePDR(10, ie.NewCreatePDR(
		ie.NewPDRID(3),
		ie.NewPrecedence(200),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x1234, net.ParseIP("172.16.0.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.9", "", 0, 0),
		),
		ie.NewOuterHeaderRemoval(0, 0),
		ie.NewFARID(5),
	))
	require.NoError(t, err)
	err = driver.CreatePDR(10, ie.NewCreatePDR(
		ie.NewPDRID(4),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.9", "", 0, 0),
		),
		ie.NewFARID(5),
	))
	require.NoError(t, err)

	snapshot := driver.Snapshot()
	require.Contains(t, snapshot.Uplink, uint32(0x1234))
	require.Contains(t, snapshot.Downlink, "60.60.0.9")
	require.Len(t, snapshot.Uplink[0x1234], 1)
	require.Len(t, snapshot.Downlink["60.60.0.9"], 1)

	uplink := driver.MatchUplink(0x1234, net.ParseIP("60.60.0.9"))
	require.NotNil(t, uplink)
	require.EqualValues(t, 10, uplink.SEID)
	require.NotNil(t, uplink.FAR)
	require.EqualValues(t, 5, uplink.FAR.ID)
	require.EqualValues(t, 3, uplink.PDR.ID)

	downlink := driver.MatchDownlink(net.ParseIP("60.60.0.9"))
	require.NotNil(t, downlink)
	require.EqualValues(t, 4, downlink.PDR.ID)
}

func TestReportUsageStoresQueryableReports(t *testing.T) {
	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 4,
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	err = driver.CreateURR(99, ie.NewCreateURR(ie.NewURRID(7)))
	require.NoError(t, err)

	reportSet := []report.USAReport{{URRID: 7}}
	err = driver.ReportUsage(99, 7, reportSet)
	require.NoError(t, err)

	reports, err := driver.QueryURR(99, 7)
	require.NoError(t, err)
	require.Len(t, reports, 1)
	require.EqualValues(t, 7, reports[0].URRID)
}

func TestDispatchPacketUsesWorkerAndResolvesAction(t *testing.T) {
	driver, err := New(nil, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   4,
				QueueSize: 8,
			},
		},
	})
	require.NoError(t, err)
	defer driver.Close()

	err = driver.CreateFAR(55, ie.NewCreateFAR(
		ie.NewFARID(11),
		ie.NewApplyAction(0x2),
	))
	require.NoError(t, err)
	err = driver.CreatePDR(55, ie.NewCreatePDR(
		ie.NewPDRID(9),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x2001, net.ParseIP("172.16.0.2"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.10", "", 0, 0),
		),
		ie.NewOuterHeaderRemoval(0, 0),
		ie.NewFARID(11),
	))
	require.NoError(t, err)

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		SEIDHint:  55,
		TEID:      0x2001,
		UEIP:      net.ParseIP("60.60.0.10"),
		Payload:   encodeTestGTP(t, 0x2001, makeIPv4Packet("60.60.0.10", "8.8.8.8"), 0),
	})
	require.NoError(t, result.Err)
	require.Equal(t, PacketActionForward, result.Action)
	require.Equal(t, shardForSEID(55, len(driver.workers)), result.WorkerID)
	require.NotNil(t, result.Binding)
	require.EqualValues(t, 9, result.Binding.PDR.ID)
}

func TestProcessUplinkDecapsulates(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(1, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreatePDR(1, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x1111, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.1", "", 0, 0),
		),
		ie.NewOuterHeaderRemoval(0, 0),
		ie.NewFARID(1),
	)))

	inner := makeIPv4Packet("60.60.0.1", "8.8.8.8")
	gtp := encodeTestGTP(t, 0x1111, inner, 0)
	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		TEID:      0x1111,
		Payload:   gtp,
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Outcome)
	require.Equal(t, PacketActionForward, result.Action)
	require.Equal(t, PayloadFormatRawIP, result.Outcome.Format)
	require.Equal(t, inner, result.Outcome.Payload)
}

func TestProcessDownlinkEncapsulates(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(9, ie.NewCreateFAR(
		ie.NewFARID(3),
		ie.NewApplyAction(0x2),
		ie.NewForwardingParameters(
			ie.NewOuterHeaderCreation(256, 0x2222, "172.16.1.10", "", 2152, 0, 0),
		),
	)))
	require.NoError(t, driver.CreateQER(9, ie.NewCreateQER(
		ie.NewQERID(7),
		ie.NewGateStatus(ie.GateStatusOpen, ie.GateStatusOpen),
		ie.NewQFI(9),
	)))
	require.NoError(t, driver.CreatePDR(9, ie.NewCreatePDR(
		ie.NewPDRID(4),
		ie.NewPrecedence(50),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.2", "", 0, 0),
		),
		ie.NewFARID(3),
		ie.NewQERID(7),
	)))

	inner := makeIPv4Packet("8.8.8.8", "60.60.0.2")
	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		Payload:   inner,
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Outcome)
	require.Equal(t, PacketActionForward, result.Action)
	require.Equal(t, PayloadFormatGTPU, result.Outcome.Format)
	require.NotNil(t, result.Outcome.Peer)
	require.Equal(t, "172.16.1.10:2152", result.Outcome.Peer.String())

	decoded, err := decodeGTPU(result.Outcome.Payload)
	require.NoError(t, err)
	require.EqualValues(t, 0x2222, decoded.TEID)
	require.Equal(t, inner, decoded.InnerPayload)
}

func TestSDFSelectsMatchingUplinkPDR(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(30, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreatePDR(30, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(200),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x4444, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.30", "", 0, 0),
			ie.NewSDFFilter("permit out udp from assigned 9999 to any 53", "", "", "", 0),
		),
		ie.NewFARID(1),
	)))
	require.NoError(t, driver.CreatePDR(30, ie.NewCreatePDR(
		ie.NewPDRID(2),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x4444, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.30", "", 0, 0),
			ie.NewSDFFilter("permit out udp from assigned 1234 to any 53", "", "", "", 0),
		),
		ie.NewFARID(1),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x4444, makeUDPIPv4Packet("60.60.0.30", "8.8.8.8", 1234, 53), 0),
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Binding)
	require.EqualValues(t, 2, result.Binding.PDR.ID)
}

func TestUplinkMatchFallsBackToTEIDWhenUEIPDiffers(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(33, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreatePDR(33, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x6666, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.1", "", 0, 0),
		),
		ie.NewFARID(1),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x6666, makeIPv4Packet("60.60.0.2", "8.8.8.8"), 0),
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Binding)
	require.EqualValues(t, 1, result.Binding.PDR.ID)
}

func TestUplinkMatchFallsBackAcrossTEIDs(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(34, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreatePDR(34, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x1111, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.2", "", 0, 0),
		),
		ie.NewFARID(1),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x6666, makeIPv4Packet("60.60.0.2", "8.8.8.8"), 0),
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Binding)
	require.EqualValues(t, 1, result.Binding.PDR.ID)
}

func TestUplinkMatchesDefaultAssignedRule(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(35, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreatePDR(35, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x2222, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.35", "", 0, 0),
			ie.NewSDFFilter("permit out ip from any to assigned", "", "", "", 0),
		),
		ie.NewFARID(1),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x2222, makeIPv4Packet("60.60.0.35", "8.8.8.8"), 0),
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Binding)
	require.EqualValues(t, 1, result.Binding.PDR.ID)
}

func TestDownlinkMatchesDefaultAssignedRule(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(36, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreatePDR(36, ie.NewCreatePDR(
		ie.NewPDRID(2),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.36", "", 0, 0),
			ie.NewSDFFilter("permit out ip from any to assigned", "", "", "", 0),
		),
		ie.NewFARID(1),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		Payload:   makeIPv4Packet("8.8.8.8", "60.60.0.36"),
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Binding)
	require.EqualValues(t, 2, result.Binding.PDR.ID)
}

func TestSDFSelectsMatchingDownlinkPDR(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(31, ie.NewCreateFAR(
		ie.NewFARID(3),
		ie.NewApplyAction(0x2),
		ie.NewForwardingParameters(
			ie.NewOuterHeaderCreation(256, 0x7777, "172.16.9.9", "", 2152, 0, 0),
		),
	)))
	require.NoError(t, driver.CreatePDR(31, ie.NewCreatePDR(
		ie.NewPDRID(10),
		ie.NewPrecedence(200),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.31", "", 0, 0),
			ie.NewSDFFilter("permit in udp from any 9999 to assigned 4321", "", "", "", 0),
		),
		ie.NewFARID(3),
	)))
	require.NoError(t, driver.CreatePDR(31, ie.NewCreatePDR(
		ie.NewPDRID(11),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.31", "", 0, 0),
			ie.NewSDFFilter("permit in udp from any 53 to assigned 4321", "", "", "", 0),
		),
		ie.NewFARID(3),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		Payload:   makeUDPIPv4Packet("8.8.8.8", "60.60.0.31", 53, 4321),
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Binding)
	require.EqualValues(t, 11, result.Binding.PDR.ID)
}

func TestQERMBRLimitsImmediateBurst(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(32, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreateQER(32, ie.NewCreateQER(
		ie.NewQERID(5),
		ie.NewGateStatus(ie.GateStatusOpen, ie.GateStatusOpen),
		ie.NewMBR(3, 0),
	)))
	require.NoError(t, driver.CreatePDR(32, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x5555, net.ParseIP("172.16.5.5"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.32", "", 0, 0),
		),
		ie.NewOuterHeaderRemoval(0, 0),
		ie.NewFARID(1),
		ie.NewQERID(5),
	)))

	payload := makeUDPIPv4PacketWithPayload("60.60.0.32", "8.8.8.8", 1234, 53, 256)
	first := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x5555, payload, 0),
	})
	second := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x5555, payload, 0),
	})

	require.NoError(t, first.Err)
	require.Equal(t, PacketActionForward, first.Action)
	require.NoError(t, second.Err)
	require.Equal(t, PacketActionDrop, second.Action)
}

func TestBufferAndFarTransitionDrain(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	handler := &testReportHandler{}
	driver.HandleReport(handler)

	require.NoError(t, driver.CreateFAR(20, ie.NewCreateFAR(
		ie.NewFARID(8),
		ie.NewApplyAction(0x0c),
	)))
	require.NoError(t, driver.CreatePDR(20, ie.NewCreatePDR(
		ie.NewPDRID(2),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.20", "", 0, 0),
		),
		ie.NewFARID(8),
	)))

	inner := makeIPv4Packet("1.1.1.1", "60.60.0.20")
	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		Payload:   inner,
	})
	require.NoError(t, result.Err)
	require.Equal(t, PacketActionBuffer, result.Action)

	require.Eventually(t, func() bool {
		handler.mu.Lock()
		defer handler.mu.Unlock()
		return len(handler.reports) == 1
	}, time.Second, 10*time.Millisecond)

	require.NoError(t, driver.UpdateFAR(20, ie.NewUpdateFAR(
		ie.NewFARID(8),
		ie.NewApplyAction(0x2),
		ie.NewUpdateForwardingParameters(
			ie.NewOuterHeaderCreation(256, 0x3333, "172.16.2.20", "", 2152, 0, 0),
		),
	)))

	select {
	case outcome := <-driver.Output():
		require.Equal(t, PacketActionForward, outcome.Action)
		require.Equal(t, PayloadFormatGTPU, outcome.Format)
		decoded, err := decodeGTPU(outcome.Payload)
		require.NoError(t, err)
		require.Equal(t, inner, decoded.InnerPayload)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for drained buffered packet")
	}
}

func TestUpdatePDRPreservesExistingMatchFields(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(70, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreatePDR(70, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x7001, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.70", "", 0, 0),
		),
		ie.NewOuterHeaderRemoval(0, 0),
		ie.NewFARID(1),
	)))

	require.NoError(t, driver.UpdatePDR(70, ie.NewUpdatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(50),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x7001, makeIPv4Packet("60.60.0.70", "8.8.8.8"), 0),
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Binding)
	require.EqualValues(t, 1, result.Binding.PDR.ID)
	require.EqualValues(t, 50, *result.Binding.PDR.Precedence)
	require.NotNil(t, result.Binding.PDR.PDI)
	require.NotNil(t, result.Binding.PDR.PDI.FTEID)
	require.EqualValues(t, 0x7001, result.Binding.PDR.PDI.FTEID.TEID)
	require.Equal(t, net.ParseIP("60.60.0.70").To4(), result.Binding.PDR.PDI.UEIPv4.To4())
}

func TestUpdateFARPreservesExistingOuterHeaderCreation(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(71, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
		ie.NewForwardingParameters(
			ie.NewDestinationInterface(ie.DstInterfaceAccess),
			ie.NewOuterHeaderCreation(256, 0x7101, "172.16.2.71", "", 2152, 0, 0),
		),
	)))
	require.NoError(t, driver.CreatePDR(71, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.71", "", 0, 0),
		),
		ie.NewFARID(1),
	)))

	require.NoError(t, driver.UpdateFAR(71, ie.NewUpdateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		Payload:   makeIPv4Packet("8.8.8.8", "60.60.0.71"),
	})

	require.NoError(t, result.Err)
	require.NotNil(t, result.Outcome)
	require.Equal(t, PayloadFormatGTPU, result.Outcome.Format)
	decoded, err := decodeGTPU(result.Outcome.Payload)
	require.NoError(t, err)
	require.EqualValues(t, 0x7101, decoded.TEID)
}

func TestBufferHonorsBARSuggestedPacketLimit(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateBAR(40, ie.NewCreateBAR(
		ie.NewBARID(1),
		ie.NewSuggestedBufferingPacketsCount(2),
	)))
	require.NoError(t, driver.CreateFAR(40, ie.NewCreateFAR(
		ie.NewFARID(9),
		ie.NewApplyAction(0x0c),
		ie.NewBARID(1),
	)))
	require.NoError(t, driver.CreatePDR(40, ie.NewCreatePDR(
		ie.NewPDRID(7),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.40", "", 0, 0),
		),
		ie.NewFARID(9),
	)))

	for i := 1; i <= 3; i++ {
		result := driver.DispatchPacket(Packet{
			Direction: PacketDirectionDownlink,
			Payload:   makeUDPIPv4Packet("8.8.8.8", "60.60.0.40", uint16(1000+i), 4321),
		})
		require.NoError(t, result.Err)
		require.Equal(t, PacketActionBuffer, result.Action)
	}

	driver.mu.RLock()
	queue := driver.sessions[40].Buffers[7]
	driver.mu.RUnlock()
	require.Len(t, queue, 2)

	lastMeta, err := parseIPv4PacketMeta(queue[1])
	require.NoError(t, err)
	require.EqualValues(t, 1003, lastMeta.SrcPort)
}

func TestBufferHonorsBARNotificationDelay(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	handler := &testReportHandler{}
	driver.HandleReport(handler)

	require.NoError(t, driver.CreateBAR(42, ie.NewCreateBAR(
		ie.NewBARID(1),
		ie.NewDownlinkDataNotificationDelay(150*time.Millisecond),
	)))
	require.NoError(t, driver.CreateFAR(42, ie.NewCreateFAR(
		ie.NewFARID(9),
		ie.NewApplyAction(0x0c),
		ie.NewBARID(1),
	)))
	require.NoError(t, driver.CreatePDR(42, ie.NewCreatePDR(
		ie.NewPDRID(7),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.42", "", 0, 0),
		),
		ie.NewFARID(9),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		Payload:   makeIPv4Packet("8.8.8.8", "60.60.0.42"),
	})
	require.NoError(t, result.Err)
	require.Equal(t, PacketActionBuffer, result.Action)

	time.Sleep(75 * time.Millisecond)
	handler.mu.Lock()
	reportCount := len(handler.reports)
	handler.mu.Unlock()
	require.Zero(t, reportCount)

	require.Eventually(t, func() bool {
		handler.mu.Lock()
		defer handler.mu.Unlock()
		return len(handler.reports) == 1
	}, time.Second, 10*time.Millisecond)
}

func TestFARTransitionCancelsDelayedNotification(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	handler := &testReportHandler{}
	driver.HandleReport(handler)

	require.NoError(t, driver.CreateBAR(43, ie.NewCreateBAR(
		ie.NewBARID(1),
		ie.NewDownlinkDataNotificationDelay(250*time.Millisecond),
	)))
	require.NoError(t, driver.CreateFAR(43, ie.NewCreateFAR(
		ie.NewFARID(9),
		ie.NewApplyAction(0x0c),
		ie.NewBARID(1),
	)))
	require.NoError(t, driver.CreatePDR(43, ie.NewCreatePDR(
		ie.NewPDRID(7),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceCore),
			ie.NewUEIPAddress(2, "60.60.0.43", "", 0, 0),
		),
		ie.NewFARID(9),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		Payload:   makeIPv4Packet("8.8.8.8", "60.60.0.43"),
	})
	require.NoError(t, result.Err)
	require.Equal(t, PacketActionBuffer, result.Action)

	require.NoError(t, driver.UpdateFAR(43, ie.NewUpdateFAR(
		ie.NewFARID(9),
		ie.NewApplyAction(0x2),
		ie.NewUpdateForwardingParameters(
			ie.NewOuterHeaderCreation(256, 0x4343, "172.16.2.43", "", 2152, 0, 0),
		),
	)))

	time.Sleep(350 * time.Millisecond)
	handler.mu.Lock()
	defer handler.mu.Unlock()
	require.Zero(t, len(handler.reports))
}

func TestQERMBRLimitsBurstTraffic(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(41, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreateQER(41, ie.NewCreateQER(
		ie.NewQERID(1),
		ie.NewGateStatus(ie.GateStatusOpen, ie.GateStatusOpen),
		ie.NewMBR(3, 3),
	)))
	require.NoError(t, driver.CreatePDR(41, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x5151, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.41", "", 0, 0),
		),
		ie.NewFARID(1),
		ie.NewQERID(1),
	)))

	packet := encodeTestGTP(t, 0x5151, makeUDPIPv4PacketWithPayload("60.60.0.41", "8.8.8.8", 1234, 53, 256), 0)
	first := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   packet,
	})
	second := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   packet,
	})

	require.NoError(t, first.Err)
	require.Equal(t, PacketActionForward, first.Action)
	require.NoError(t, second.Err)
	require.Equal(t, PacketActionDrop, second.Action)
}

func TestStatsTrackForwardDropAndMisses(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	require.NoError(t, driver.CreateFAR(50, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreatePDR(50, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x6060, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.50", "", 0, 0),
			ie.NewSDFFilter("permit out udp from assigned 1234 to any 53", "", "", "", 0),
		),
		ie.NewFARID(1),
	)))

	forward := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x6060, makeUDPIPv4Packet("60.60.0.50", "8.8.8.8", 1234, 53), 0),
	})
	require.NoError(t, forward.Err)
	require.Equal(t, PacketActionForward, forward.Action)

	miss := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x9999, makeIPv4Packet("60.60.0.50", "8.8.8.8"), 0),
	})
	require.Error(t, miss.Err)

	unsupported := driver.DispatchPacket(Packet{
		Direction: PacketDirectionDownlink,
		Payload:   []byte{0x60, 0, 0, 0},
	})
	require.Error(t, unsupported.Err)

	stats := driver.Stats()
	require.EqualValues(t, 2, stats.UplinkPackets)
	require.EqualValues(t, 1, stats.DownlinkPackets)
	require.EqualValues(t, 1, stats.ForwardedPackets)
	require.EqualValues(t, 2, stats.DroppedPackets)
	require.EqualValues(t, 1, stats.UplinkPDRMisses)
	require.EqualValues(t, 1, stats.UnsupportedDownlinkL3)
	require.EqualValues(t, 1, stats.UplinkPacketErrors)
	require.EqualValues(t, 1, stats.DownlinkPacketErrors)
}

func TestPeriodicURRReportingEmitsUsageReport(t *testing.T) {
	driver, err := New(nil, newUserspaceConfig(1))
	require.NoError(t, err)
	defer driver.Close()

	handler := &testReportHandler{}
	driver.HandleReport(handler)

	require.NoError(t, driver.CreateFAR(60, ie.NewCreateFAR(
		ie.NewFARID(1),
		ie.NewApplyAction(0x2),
	)))
	require.NoError(t, driver.CreateURR(60, ie.NewCreateURR(
		ie.NewURRID(1),
		ie.NewReportingTriggers(0x01, 0x00, 0x00),
		ie.NewMeasurementPeriod(time.Second),
	)))
	require.NoError(t, driver.CreatePDR(60, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(10),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, 0x7070, net.ParseIP("172.16.1.1"), nil, 0),
			ie.NewUEIPAddress(2, "60.60.0.60", "", 0, 0),
		),
		ie.NewFARID(1),
		ie.NewURRID(1),
	)))

	result := driver.DispatchPacket(Packet{
		Direction: PacketDirectionUplink,
		Payload:   encodeTestGTP(t, 0x7070, makeIPv4Packet("60.60.0.60", "8.8.8.8"), 0),
	})
	require.NoError(t, result.Err)

	require.Eventually(t, func() bool {
		handler.mu.Lock()
		defer handler.mu.Unlock()
		if len(handler.reports) == 0 {
			return false
		}
		for _, sr := range handler.reports {
			for _, rpt := range sr.Reports {
				usar, ok := rpt.(report.USAReport)
				if ok && usar.USARTrigger.PERIO() {
					return true
				}
			}
		}
		return false
	}, 2*time.Second, 50*time.Millisecond)
}

func newUserspaceConfig(workers int) *factory.Config {
	return &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   workers,
				QueueSize: 8,
			},
		},
	}
}

func seedAdaptiveSession(t *testing.T, driver *Driver, seid uint64, ueAddr string, qerID uint32) {
	t.Helper()

	require.NoError(t, driver.CreateQER(seid, ie.NewCreateQER(
		ie.NewQERID(qerID),
		ie.NewGateStatus(ie.GateStatusOpen, ie.GateStatusOpen),
		ie.NewMBR(500000, 400000),
	)))
	require.NoError(t, driver.CreatePDR(seid, ie.NewCreatePDR(
		ie.NewPDRID(1),
		ie.NewPrecedence(100),
		ie.NewPDI(
			ie.NewSourceInterface(ie.SrcInterfaceAccess),
			ie.NewFTEID(1, uint32(seid), net.ParseIP("172.16.0.1"), nil, 0),
			ie.NewUEIPAddress(2, ueAddr, "", 0, 0),
		),
		ie.NewQERID(qerID),
	)))
}

func writeAdaptiveQoSTestCerts(t *testing.T) (string, string, *x509.CertPool) {
	t.Helper()

	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(2019),
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	require.NoError(t, err)
	caCert, err := x509.ParseCertificate(caDER)
	require.NoError(t, err)

	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "localhost",
		},
		DNSNames:    []string{"localhost"},
		IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1)},
		NotBefore:   time.Now(),
		NotAfter:    time.Now().Add(24 * time.Hour),
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		KeyUsage:    x509.KeyUsageDigitalSignature,
	}
	leafKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	require.NoError(t, err)

	dir := t.TempDir()
	certFile := filepath.Join(dir, "adaptive-qos.pem")
	keyFile := filepath.Join(dir, "adaptive-qos.key")
	require.NoError(t, os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}), 0o600))
	require.NoError(t, os.WriteFile(certFile+".ca", pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), 0o600))
	keyDER := x509.MarshalPKCS1PrivateKey(leafKey)
	require.NoError(t, os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: keyDER}), 0o600))

	pool := x509.NewCertPool()
	pool.AddCert(caCert)
	return certFile, keyFile, pool
}

func makeIPv4Packet(src string, dst string) []byte {
	return makeUDPIPv4Packet(src, dst, 0, 0)
}

func makeUDPIPv4Packet(src string, dst string, srcPort uint16, dstPort uint16) []byte {
	return makeUDPIPv4PacketWithPayload(src, dst, srcPort, dstPort, 0)
}

func makeUDPIPv4PacketWithPayload(src string, dst string, srcPort uint16, dstPort uint16, payloadLen int) []byte {
	packet := make([]byte, 28+payloadLen)
	packet[0] = 0x45
	packet[2] = byte(len(packet) >> 8)
	packet[3] = byte(len(packet))
	packet[8] = 64
	packet[9] = 17
	copy(packet[12:16], net.ParseIP(src).To4())
	copy(packet[16:20], net.ParseIP(dst).To4())
	packet[20] = byte(srcPort >> 8)
	packet[21] = byte(srcPort)
	packet[22] = byte(dstPort >> 8)
	packet[23] = byte(dstPort)
	packet[24] = 0
	packet[25] = 8
	return packet
}

func encodeTestGTP(t *testing.T, teid uint32, payload []byte, qfi uint8) []byte {
	t.Helper()

	msg := gtpv1.Message{
		Flags:   0x30,
		Type:    gtpv1.MsgTypeTPDU,
		TEID:    teid,
		Payload: payload,
	}
	if qfi != 0 {
		msg.Flags = 0x34
		msg.Exts = []gtpv1.Encoder{gtpv1.PDUSessionContainer{
			PDUType:   1,
			QoSFlowID: qfi,
		}}
	}

	buf := make([]byte, msg.Len())
	_, err := msg.Encode(buf)
	require.NoError(t, err)
	return buf
}
