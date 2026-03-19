package userspace

import (
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wmnsk/go-pfcp/ie"

	"github.com/free5gc/go-upf/internal/gtpv1"
	"github.com/free5gc/go-upf/internal/report"
	"github.com/free5gc/go-upf/pkg/factory"
)

type testReportHandler struct {
	mu      sync.Mutex
	reports []report.SessReport
}

func (h *testReportHandler) NotifySessReport(sr report.SessReport) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.reports = append(h.reports, sr)
}

func (h *testReportHandler) PopBufPkt(uint64, uint16) ([]byte, bool) {
	return nil, false
}

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
