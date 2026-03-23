# Story 1 UI <-> Backend API

## Goal
This document defines the backend contract for the first demo-ready UI build.

Scope is limited to **Story 1: Predictive burst assistance**:
- UE app knows a downlink burst is about to arrive
- sidecar reports burst metadata to the UPF
- UPF selects a burst-protect profile
- fake gNB returns `ACCEPTED` with predicted air delay
- UI shows the preparation and the final burst outcome

This contract is intentionally simple so UI work can proceed in parallel with backend implementation.

## Components
- **UI**
  - browser page
  - no direct MASQUE or QUIC handling
- **Sidecar HTTP API**
  - UI talks to this directly for story start and local state
- **UPF Debug HTTP API**
  - UI polls this for UPF-side state and trace

## Base URLs

### Sidecar
- default example: `http://ue:18080`

### UPF debug
- default example: `http://upf:9082`

The UI should treat both as configurable.

## Story 1 UX flow
1. User opens the page.
2. UI loads current sidecar status and UPF status.
3. User clicks `Run Predictive Burst`.
4. UI calls the sidecar story-start endpoint.
5. UI starts polling sidecar and UPF state every 1 second.
6. UI renders:
   - story phase
   - burst metadata
   - selected profile
   - fake gNB decision
   - predicted air delay
   - block success ratio
   - event timeline from both traces

## Required Endpoints

### 1. Start Story 1
`POST /demo/story1/start`

This is the main UI action for the first build.

Request body:
```json
{
  "flowId": "story1-flow-1",
  "ueAddress": "10.60.0.4",
  "burstSize": 6291456,
  "burstDurationMs": 120,
  "expectedArrivalDelayMs": 500,
  "deadlineMs": 150,
  "priority": "high"
}
```

Request rules:
- `flowId` required
- all other fields optional
- if omitted, the sidecar should use simple defaults suitable for the demo

Response body:
```json
{
  "flowId": "story1-flow-1",
  "status": "GUARANTEE_STARTED",
  "reasonCode": "ACCEPTED",
  "effectiveTime": "2026-03-23T10:00:00Z",
  "profileId": "burst-protect",
  "scenario": "predictive-burst",
  "storyPhase": "prepared",
  "gnbDecision": "ACCEPTED",
  "predictedAirDelayMs": 8,
  "blockSuccessRatio": 0.99
}
```

Semantics:
- `status` is the normal UPF guarantee result
- `profileId` is the selected adaptive profile
- `storyPhase` is the UI-friendly phase name
- `gnbDecision` is the fake gNB result
- `predictedAirDelayMs` is synthetic and deterministic
- `blockSuccessRatio` may already be returned if the backend computes it immediately, or may appear later via polling

### 2. Sidecar status
`GET /status`

Used for header-level health and current flow summary.

Response body:
```json
{
  "lastReportAt": "2026-03-23T10:00:00Z",
  "lastError": "",
  "activeFlows": 1,
  "managedFlowIds": ["story1-flow-1"],
  "traceDepth": 12,
  "story": {
    "scenario": "predictive-burst",
    "flowId": "story1-flow-1",
    "phase": "prepared",
    "profileId": "burst-protect",
    "gnbDecision": "ACCEPTED",
    "predictedAirDelayMs": 8,
    "blockSuccessRatio": 0.99
  }
}
```

Notes:
- existing fields should remain
- `story` is the new summary block for the first build

### 3. Sidecar flow detail
`GET /flows/{flowId}`

Used for the main flow detail panel.

Response body:
```json
{
  "flowId": "story1-flow-1",
  "active": true,
  "createdAt": "2026-03-23T10:00:00Z",
  "updatedAt": "2026-03-23T10:00:01Z",
  "lastError": "",
  "lastReport": {
    "FlowID": "story1-flow-1",
    "ReportType": "INTENT_REPORT",
    "TrafficPattern": "burst",
    "ExpectedArrivalTime": "2026-03-23T10:00:00.500Z",
    "BurstSize": 6291456,
    "BurstDurationMs": 120,
    "DeadlineMs": 150,
    "Priority": "high",
    "Scenario": "predictive-burst"
  },
  "lastFeedback": {
    "FlowID": "story1-flow-1",
    "Status": "GUARANTEE_STARTED",
    "ReasonCode": "ACCEPTED",
    "EffectiveTime": "2026-03-23T10:00:00Z",
    "ProfileID": "burst-protect",
    "Scenario": "predictive-burst",
    "StoryPhase": "prepared",
    "GNBDecision": "ACCEPTED",
    "PredictedAirDelayMs": 8,
    "BlockSuccessRatio": 0.99
  }
}
```

UI should treat `lastReport` and `lastFeedback` as the primary source for the flow detail card.

### 4. Sidecar trace
`GET /trace`

Used for the UI timeline.

Response body:
```json
[
  {
    "seq": 1,
    "timestamp": "2026-03-23T10:00:00Z",
    "component": "sidecar",
    "stage": "story1_started",
    "flowId": "story1-flow-1",
    "detail": "predictive-burst"
  },
  {
    "seq": 2,
    "timestamp": "2026-03-23T10:00:00Z",
    "component": "sidecar",
    "stage": "report_submitted",
    "flowId": "story1-flow-1",
    "reportType": "INTENT_REPORT"
  },
  {
    "seq": 3,
    "timestamp": "2026-03-23T10:00:00Z",
    "component": "sidecar",
    "stage": "feedback_received",
    "flowId": "story1-flow-1",
    "status": "GUARANTEE_STARTED",
    "reason": "ACCEPTED",
    "detail": "burst-protect"
  }
]
```

Required new trace stages for Story 1:
- `story1_started`
- `story1_feedback_applied`
- `story1_completed`

The UI should display sidecar trace entries interleaved with UPF trace entries by timestamp.

### 5. UPF status
`GET /debug/adaptive-qos/status`

Used for the UPF and fake gNB state panel.

Response body:
```json
{
  "running": true,
  "startedAt": "2026-03-23T09:55:00Z",
  "masqueAddr": "10.60.0.254:4433",
  "reportAddr": "127.0.0.1:7777",
  "debugAddr": "0.0.0.0:9082",
  "template": "https://10.60.0.254:4433/masque?h={target_host}&p={target_port}",
  "traceDepth": 24,
  "serveError": "",
  "story": {
    "scenario": "predictive-burst",
    "flowId": "story1-flow-1",
    "phase": "prepared",
    "profileId": "burst-protect",
    "gnbDecision": "ACCEPTED",
    "predictedAirDelayMs": 8,
    "blockSuccessRatio": 0.99,
    "burstSize": 6291456,
    "burstDurationMs": 120,
    "deadlineMs": 150
  }
}
```

`story` is the minimum new section required by the UI.

### 6. UPF trace
`GET /debug/adaptive-qos/trace`

Used for the system timeline.

Response body:
```json
[
  {
    "seq": 20,
    "timestamp": "2026-03-23T10:00:00Z",
    "component": "upf",
    "stage": "report_received",
    "flowId": "story1-flow-1",
    "reportType": "INTENT_REPORT"
  },
  {
    "seq": 21,
    "timestamp": "2026-03-23T10:00:00Z",
    "component": "upf",
    "stage": "profile_selected",
    "flowId": "story1-flow-1",
    "detail": "burst-protect"
  },
  {
    "seq": 22,
    "timestamp": "2026-03-23T10:00:00Z",
    "component": "upf",
    "stage": "fake_gnb_accepted",
    "flowId": "story1-flow-1",
    "detail": "predictedAirDelayMs=8"
  },
  {
    "seq": 23,
    "timestamp": "2026-03-23T10:00:00Z",
    "component": "upf",
    "stage": "feedback_returned",
    "flowId": "story1-flow-1",
    "status": "GUARANTEE_STARTED",
    "reason": "ACCEPTED"
  }
]
```

Required new trace stages for Story 1:
- `fake_gnb_accepted`
- `story1_burst_completed`
- `story1_success_published`

## Polling Model
- poll `GET /status` every 1 second
- poll `GET /debug/adaptive-qos/status` every 1 second
- poll `GET /trace` every 1 second
- poll `GET /debug/adaptive-qos/trace` every 1 second
- poll `GET /flows/{flowId}` every 1 second after story start

No websocket support is required for the first build.

## UI Rendering Requirements

### Top controls
- `Run Predictive Burst`
- `Reset View`

### Main cards
- **UE App**
  - story label
  - burst size
  - expected arrival
  - deadline
  - priority
- **Sidecar**
  - latest report type
  - guarantee status
  - current phase
- **UPF**
  - selected profile
  - flow ID
- **Fake gNB**
  - decision
  - predicted air delay
  - block success ratio

### Timeline
The UI should merge sidecar trace and UPF trace by timestamp and display:
- component
- stage
- flow ID
- short detail text

### Health states
If an endpoint call fails:
- show the card in degraded state
- keep the last successful data
- show the HTTP error text in a small status area

## Non-Goals For This First UI Build
- Story 2
- multi-flow dashboards
- editable advanced knobs
- websocket streaming
- authentication
- long-term persistence

## Backend Notes For Parallel Work
- The UI should assume fields may appear before all backend logic is complete.
- The UI should ignore unknown JSON fields.
- The UI should treat missing story-specific fields as "not available yet".
- The backend should preserve existing endpoints and only extend their JSON responses.
