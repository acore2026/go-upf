# Story 1 Test Background And Methods

## Background
Story 1 is the demo path for **predictive burst assistance**.

The goal is to show that:
- the UE can announce an upcoming downlink burst before it arrives,
- the sidecar forwards that intent to the UPF,
- the UPF selects a burst-protect QoS profile,
- the fake gNB accepts the request and returns a predicted air delay,
- the flow is automatically cleared after the expected arrival plus a small grace window.

This test is intentionally prototype-grade. It only needs to demonstrate the idea end-to-end, not a standards-complete QoS policy.

## Test Method
Run the flow in this order:
1. Reset the story state.
2. Confirm the UE tunnel exists and note its IPv4 address.
3. Start Story 1 through the demo backend.
4. Verify the initial accepted response.
5. Poll UPF status and trace until the flow clears itself.
6. Confirm the sidecar trace and UPF trace both show the accepted path.

The live demo backend is on `http://127.0.0.1:8082`.

## Preconditions
- `upf`, `amf`, `smf`, `ueransim`, and `ue` containers are running.
- The demo backend is reachable on `8082`.
- The UE tunnel is up.

Check the tunnel IP:
```bash
docker exec ue ip -4 addr show uesimtun0
```

If the tunnel is present, the address is typically `10.60.0.1/24`.

## Execution

### 1. Clear current story state
```bash
curl -sS -X POST http://127.0.0.1:8082/api/reset \
  -H 'content-type: application/json' \
  -d '{}'
```

### 2. Confirm the UPF is idle
```bash
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/status
```
Expected:
- `activeSessions = 0`
- `activeFlows = 0`
- `defaultQoSProfile.selectedProfileId = adaptive-default`

### 3. Run Story 1
Use the UE tunnel IP from the previous step.

```bash
curl -sS -X POST http://127.0.0.1:8082/api/sidecar/demo/story1/start \
  -H 'content-type: application/json' \
  -d '{
    "ueAddress": "10.60.0.1",
    "flowId": "story1-flow-1",
    "reportType": "intent",
    "scenario": "predictive-burst",
    "trafficPattern": "burst",
    "burstSize": 6291456,
    "burstDurationMs": 120,
    "deadlineMs": 150,
    "priority": "high"
  }'
```

Expected start response:
- `status = started`
- `reasonCode = ACCEPTED`
- `profileId = burst-protect`
- `gnbDecision = ACCEPTED`
- `predictedAirDelayMs = 8`
- `blockSuccessRatio = 0.99`

### 4. Verify active state
```bash
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/status
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/trace
```

Expected during the burst:
- `activeSessions = 1`
- `activeFlows = 1`
- `currentQoSProfile.selectedProfileId = burst-protect`
- `defaultQoSProfile.selectedProfileId = adaptive-default`
- trace contains an `upf-profile-applied` event

### 5. Wait for automatic end
The profile should clear itself after `expectedArrivalTime + grace`.

Recheck:
```bash
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/status
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/trace
curl -sS http://127.0.0.1:8082/api/sidecar/status
```

Expected after completion:
- `activeFlows = 0`
- UPF trace contains `upf-profile-cleared`
- sidecar last feedback remains `started` / `ACCEPTED`

## Success Criteria
Story 1 is clean when all of these are true:
- the start response is `started` and `ACCEPTED`,
- UPF status shows the burst-protect profile during the active window,
- the trace shows the accepted request and the later clear event,
- the flow disappears on its own without manual cleanup.

## Troubleshooting
- If Story 1 returns `SESSION_NOT_FOUND`, the UE/AMF/SMF session is stale.
- Restart `amf`, `smf`, `ueransim`, and `ue`, in that order or as a full reattach cycle, then rerun the test.
- If `uesimtun0` is missing, wait for the UE attach to complete before starting the story.
