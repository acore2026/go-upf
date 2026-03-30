package userspace

import "time"

type adaptiveStoryView struct {
	Scenario            string           `json:"scenario,omitempty"`
	FlowID              string           `json:"flowId,omitempty"`
	Phase               string           `json:"phase,omitempty"`
	Packet              *PacketFiveTuple `json:"packet,omitempty"`
	ProfileID           string           `json:"profileId,omitempty"`
	DefaultProfileID    string           `json:"defaultProfileId,omitempty"`
	PreviousProfileID   string           `json:"previousProfileId,omitempty"`
	DecisionReason      string           `json:"decisionReason,omitempty"`
	GNBDecision         string           `json:"gnbDecision,omitempty"`
	PredictedAirDelayMs uint64           `json:"predictedAirDelayMs,omitempty"`
	BlockSuccessRatio   float64          `json:"blockSuccessRatio,omitempty"`
	BurstSize           uint64           `json:"burstSize,omitempty"`
	BurstDurationMs     uint64           `json:"burstDurationMs,omitempty"`
	DeadlineMs          uint64           `json:"deadlineMs,omitempty"`
	ExpectedArrivalTime time.Time        `json:"expectedArrivalTime,omitempty"`
	FlowDescription     string           `json:"flowDescription,omitempty"`
	PacketCount         uint64           `json:"packetCount,omitempty"`
}

func (d *Driver) currentStoryView() *adaptiveStoryView {
	if d == nil {
		return nil
	}
	snapshot := d.Snapshot()
	var latest *AdaptiveFlowState
	for _, sess := range snapshot.Sessions {
		for _, flow := range sess.AdaptiveFlows {
			if flow == nil || flow.LatestReport.Scenario == "" {
				continue
			}
			if latest == nil || flow.UpdatedAt.After(latest.UpdatedAt) {
				latest = flow
			}
		}
	}
	if latest == nil {
		return nil
	}
	return &adaptiveStoryView{
		Scenario:            latest.LatestReport.Scenario,
		FlowID:              latest.FlowID,
		Phase:               latest.StoryPhase,
		Packet:              clonePacketFiveTuple(latest.Packet),
		ProfileID:           storyProfileID(latest),
		DefaultProfileID:    defaultAdaptiveProfileID(),
		PreviousProfileID:   latest.PreviousProfileID,
		DecisionReason:      latest.DecisionReason,
		GNBDecision:         latest.GNBDecision,
		PredictedAirDelayMs: latest.PredictedAirDelayMs,
		BlockSuccessRatio:   latest.BlockSuccessRatio,
		BurstSize:           latest.LatestReport.BurstSize,
		BurstDurationMs:     storyDurationMs(latest.LatestReport.BurstDuration, latest.LatestReport.BurstDurationMs),
		DeadlineMs:          storyDurationMs(latest.LatestReport.Deadline, latest.LatestReport.DeadlineMs),
		ExpectedArrivalTime: latest.LatestReport.expectedArrivalTime(),
		FlowDescription:     latest.FlowDescription,
		PacketCount:         latest.PacketCount.Load(),
	}
}

func storyProfileID(flow *AdaptiveFlowState) string {
	if flow == nil || flow.SelectedProfile == nil {
		return ""
	}
	return flow.SelectedProfile.ProfileID
}

func storyDurationMs(duration time.Duration, raw uint64) uint64 {
	if raw > 0 {
		return raw
	}
	if duration <= 0 {
		return 0
	}
	return uint64(duration / time.Millisecond)
}

func defaultAdaptiveProfileID() string {
	return "adaptive-default"
}
