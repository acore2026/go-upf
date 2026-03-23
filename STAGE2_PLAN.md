# Stage 2 Plan: Story-Driven Adaptive QoS Demo

## Summary
The current prototype already proves the base collaboration loop:
UE sidecar -> MASQUE/HTTP3 -> userspace UPF -> rule-based QoS profile apply -> prototype gNB hint -> UE feedback.

Stage 2 should turn that base into a clear demo of the main ideas in [PROPOSAL.md](./PROPOSAL.md):
1. Predictive burst assistance
2. Congestion-aware app adaptation
3. A webpage that shows the whole process in real time

This stays demo-first:
- deterministic if/else rules
- fake gNB behavior inside the UPF
- scripted scenario timelines
- simplified metrics and outcomes
- no ML and no standards-complete control-plane work

## Current Gaps vs Proposal

### Already covered
- MASQUE `CONNECT-UDP` collaboration transport
- UE/application to UPF reporting over the real user-plane path
- UPF-side fast rule-based adaptation
- Local userspace QoS overlay application
- Prototype UPF-to-gNB control send
- UE-side sidecar APIs and tracing
- UPF-side debug trace and status

### Gaps for Story 1: Predictive burst assistance
- `AdaptiveReport` does not yet carry the full burst/block story inputs:
  - `expectedArrivalTime`
  - `deadline`
  - `priority`
  - block-oriented identifiers and size
- `AdaptiveFeedback` does not yet return fake gNB acceptance details such as predicted air delay
- There is no fake gNB acceptance/reply model; current behavior is only "UDP send succeeded"
- There is no burst outcome metric such as block success ratio
- There is no scripted story runner that shows "prepare before burst, then burst arrives, then success ratio is good"

### Gaps for Story 2: Congestion-aware app adaptation
- The UPF does not yet expose network information back to the UE beyond `GUARANTEE_*`
- No feedback fields exist for:
  - `availableBitrate`
  - `congestionLevel`
  - `preferredResolution`
  - `latencyState`
  - `recommendedAction`
- The sidecar does not maintain an app-facing adaptation state or report "adaptation applied"
- There is no fake congestion injection source
- There is no explicit profile transition story such as `aggressive` -> `conserve-rebalance`

### Gaps for the full demo
- No explicit network-information exposure loop from UPF to UE/application
- No story-specific scenario model; current rules are generic, not presentation-friendly
- No UI/webpage layer; only backend JSON endpoints exist today

## Stage 2 Design

### Story 1: Predictive burst assistance
Use case:
- XR scene load
- video seek
- large AI response chunk

Narrative:
1. UE app knows a downlink burst is about to arrive.
2. Sidecar reports burst size, expected arrival time, deadline, and priority.
3. UPF selects `burst-protect`.
4. Fake gNB accepts and returns predicted air delay.
5. Simulated burst arrives.
6. UPF publishes a good block success ratio.
7. Webpage shows the flow was prepared early and completed well.

What this demonstrates:
- future traffic characteristics can be signaled ahead of time
- UPF can prepare QoS before traffic arrives
- RAN assist can be driven from predictive application information

### Story 2: Congestion-aware app adaptation
Use case:
- adaptive video
- mixed-media session

Narrative:
1. Session starts at `1080p / 4500 kbps`.
2. Sidecar reports the session state.
3. UPF selects `aggressive-video`.
4. Fake gNB injects high congestion and lower available bitrate.
5. UPF returns network info: congestion high, cap `2500 kbps`, preferred resolution `720p`.
6. Sidecar/demo app applies the adaptation and reports it.
7. UPF changes profile to `conserve-rebalance`.
8. Session continues rather than being hard-rejected.

What this demonstrates:
- network information exposure from UPF to UE/application
- application adaptation based on network state
- closed-loop dynamic QoS behavior

## Implementation Changes

### 1. Extend the demo report/feedback model
Add optional prototype-only fields to the current report/feedback structs.

UE -> UPF report additions:
- `Scenario`
- `ExpectedArrivalTime`
- `BurstSize`
- `BurstDuration`
- `Deadline`
- `Priority`
- `BlockID`
- `BlockSize`
- `CurrentResolution`
- `CurrentBitrate`
- `TargetResolution`
- `AdaptationApplied`
- `AdaptationReason`

UPF -> UE feedback additions:
- `ProfileID`
- `GNBDecision`
- `PredictedAirDelay`
- `BlockSuccessRatio`
- `AvailableBitrate`
- `CongestionLevel`
- `PreferredResolution`
- `LatencyState`
- `RecommendedAction`

All fields remain optional and demo-scoped.

### 2. Add a fake gNB and network-state provider inside the UPF
Implement a demo-only provider inside the userspace adaptive QoS controller.

Requirements:
- scripted mode only
- deterministic replies
- one scenario state per `flowId`
- no real radio dependence

Story 1 behavior:
- burst report triggers fake gNB `ACCEPTED`
- returns `PredictedAirDelay`
- marks temporary `burst-protect`
- after scripted burst-arrival step, publishes `BlockSuccessRatio`

Story 2 behavior:
- starts healthy with `availableBitrate=4500` and profile `aggressive-video`
- injects `congestion=high`
- returns `availableBitrate=2500`, `preferredResolution=720p`, `recommendedAction=downshift`
- after sidecar reports `AdaptationApplied`, switches to `conserve-rebalance`

### 3. Replace generic demo rules with named story profiles
Use explicit named profiles:
- `burst-protect`
- `aggressive-video`
- `conserve-rebalance`

Rule logic should stay simple and fixed:
- `Scenario=predictive-burst` + burst fields -> `burst-protect`
- `Scenario=congestion-adaptation` + healthy state -> `aggressive-video`
- `Scenario=congestion-adaptation` + high congestion + adaptation confirmed -> `conserve-rebalance`

Do not build a generalized policy engine in Stage 2.

### 4. Extend the sidecar into a demo-aware adapter
Keep the existing APIs and add story state:
- latest network info from the UPF
- current app state: resolution, bitrate, scenario phase
- adaptation-applied reporting back to the UPF
- story milestones recorded in the sidecar trace

Add demo-focused sidecar APIs:
- `POST /demo/start`
- `POST /demo/step`

Behavior:
- `/demo/start` starts one of the scripted stories with a fixed flow ID
- `/demo/step` advances the timeline for that scenario
- the sidecar remains the app-facing control point; the webpage should not send raw MASQUE traffic directly

### 5. Add a separate demo web app
Create a dedicated small demo web server in this repo, separate from sidecar and UPF.

Responsibilities:
- serve a single-page demo webpage
- call sidecar endpoints to start and step stories
- poll sidecar `/status`, `/flows`, `/trace`
- poll UPF `/debug/adaptive-qos/status` and `/debug/adaptive-qos/trace`
- render a live timeline and current-state view

Webpage layout:
- cards for `UE App`, `Sidecar`, `UPF`, `Fake gNB`
- scenario controls:
  - `Run Predictive Burst`
  - `Run Congestion Adaptation`
- current-state panel showing:
  - flow ID
  - current profile
  - available bitrate
  - congestion level
  - preferred resolution
  - predicted air delay
  - block success ratio
  - recommended action
- trace panel showing events from sidecar and UPF
- compact path diagram:
  - UE App -> Sidecar -> MASQUE -> UPF -> Fake gNB

Implementation style:
- simple server-rendered static assets plus polling JSON APIs
- no frontend framework requirement
- no websocket requirement
- 1 second polling is enough

### 6. Add a deterministic scenario coordinator
The demo must be repeatable, not presenter-driven by raw knobs.

Scenario 1 phases:
1. app declares impending burst
2. sidecar sends predictive report
3. UPF selects `burst-protect`
4. fake gNB accepts and returns predicted air delay
5. simulated burst arrives
6. UPF publishes block success ratio
7. webpage shows success outcome

Scenario 2 phases:
1. session starts at `1080p / 4500 kbps`
2. sidecar sends start report
3. UPF selects `aggressive-video`
4. fake gNB injects high congestion
5. UPF returns `availableBitrate=2500`, `preferredResolution=720p`, `recommendedAction=downshift`
6. sidecar/demo app applies adaptation and reports it
7. UPF switches to `conserve-rebalance`
8. webpage shows stable continuation instead of rejection

## Public Interfaces

### Sidecar HTTP
Existing:
- `POST /report`
- `POST /end`
- `GET /status`
- `GET /flows`
- `GET /flows/{flowId}`
- `GET /trace`

Add:
- `POST /demo/start`
- `POST /demo/step`

### UPF debug HTTP
Keep:
- `GET /debug/adaptive-qos/status`
- `GET /debug/adaptive-qos/trace`

Extend the status/trace payloads to include:
- current scenario and phase
- current selected profile
- fake gNB decision
- predicted air delay
- block success ratio
- available bitrate
- congestion level
- preferred resolution
- recommended action

### Internal state
Add demo-focused internal types for:
- `ScenarioState`
- `NetworkUpdate`
- `FakeGNBDecision`
- `DemoFlowView`

## Test Plan

### Story 1 checks
- predictive burst report selects `burst-protect`
- fake gNB returns `ACCEPTED`
- feedback includes `PredictedAirDelay`
- scripted burst arrival publishes `BlockSuccessRatio`
- webpage shows burst preparation before burst completion

### Story 2 checks
- initial video start selects `aggressive-video`
- congestion injection returns `availableBitrate=2500` and `preferredResolution=720p`
- sidecar reports adaptation applied
- UPF switches to `conserve-rebalance`
- session remains active instead of being rejected

### Webpage checks
- each story runs from a single button
- timeline updates from sidecar and UPF traces
- current-state panel reflects latest profile and network info
- the page makes these ideas obvious:
  - predictive traffic signaling
  - UPF-to-UE network information exposure
  - UE behavior adaptation

### Regression checks
- existing MASQUE tunnel still works
- existing `POST /report` and `POST /end` still work
- userspace-only scope remains intact
- fake gNB/demo logic stays isolated behind config or demo mode

## Demo Runbook

Use these commands from the host when the stack is already up and the UE, sidecar, and UPF containers are running.

### Run Story 1
```bash
curl -s -X POST http://127.0.0.1:8082/api/sidecar/demo/story1/start \
  -H 'content-type: application/json' \
  -d '{}'
```

### Clear Story 1 State
```bash
curl -s -X POST http://127.0.0.1:8082/api/reset \
  -H 'content-type: application/json' \
  -d '{}'
```

### Verify State
```bash
curl -s http://127.0.0.1:8082/api/sidecar/status
curl -s http://127.0.0.1:8082/api/upf/debug/adaptive-qos/status
```

If the story returns `SESSION_NOT_FOUND`, the core session is stale. Restart `free5gc-amf`, `free5gc-smf`, `ueransim`, and `ue`, then run Story 1 again.

## Assumptions And Defaults
- The Stage 2 webpage is a separate demo app, not embedded in sidecar or UPF.
- The fake gNB is implemented inside the UPF adaptive QoS controller.
- Both stories are scripted and repeatable.
- Network info exposure uses prototype JSON fields, not a standards-defined container.
- Block success ratio is synthetic and scenario-driven.
- App adaptation is explicitly reported by the sidecar/demo app, not inferred from payload traffic.
- Stage 2 optimizes for a clear live demonstration of the proposal’s concepts, not standards completeness.
