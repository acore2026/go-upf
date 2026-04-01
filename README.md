# go-upf

## Adaptive QoS Work

This repo currently contains two demo-oriented adaptive QoS surfaces in addition to the upstream UPF code:

- [cmd/adaptive-qos-demo/qos/README.md](/root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd/adaptive-qos-demo/qos/README.md): the main adaptive QoS demo UI used with the `ue` container and live UPF/sidecar APIs.
- [cmd/adaptive-qos-demo/qos-graph-lab/README.md](/root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd/adaptive-qos-demo/qos-graph-lab/README.md): the standalone graph lab for illustrating `off`, `conventional`, and `adaptive` QoS behavior without a backend.

### Cluster Bring-Up

The live demo stack is started from the compose workspace, not from this UPF subdirectory.

Compose workspace:
- `/root/proj/go/free5gc-compose`

Relevant files:
- [docker-compose.yaml](/root/proj/go/free5gc-compose/docker-compose.yaml)
- [docker-compose-build.yaml](/root/proj/go/free5gc-compose/docker-compose-build.yaml)
- [adaptive-qos-sidecar.yaml](/root/proj/go/free5gc-compose/config/adaptive-qos-sidecar.yaml)
- [entrypoint-ue-sidecar.sh](/root/proj/go/free5gc-compose/ueransim/entrypoint-ue-sidecar.sh)

Build the images:

```bash
cd /root/proj/go/free5gc-compose
docker compose -f docker-compose-build.yaml build
```

Start the cluster:

```bash
cd /root/proj/go/free5gc-compose
docker compose -f docker-compose.yaml up -d
```

Expected runtime pieces for the adaptive QoS prototype:
- `upf`
- `amf`
- `smf`
- `ueransim`
- `ue`

Live demo endpoints:
- Main adaptive QoS demo UI: `http://127.0.0.1:8082`
- Graph lab: `http://127.0.0.1:8084`

### QoS Graph Lab

The graph lab is a standalone simulation focused on bandwidth, GBR ceiling behavior, and latency response under three RAN load modes:

- `Lite`
- `Crowded`
- `Overload`

And three QoS modes:

- `Off`
- `Conventional`
- `Adaptive`

Current behavior:

- `Off` uses a low fixed GBR baseline across modes.
- `Conventional` raises GBR from recent average demand and clears the steady-state bottleneck, but still misses short burst spikes.
- `Adaptive` raises the QoS ceiling one tick before a manually triggered burst, holds it for a short fixed window, and then drops back to baseline.

Burst behavior is manual:

- Use the `Burst` button to schedule a burst for tick `+2`.
- This gives adaptive QoS one tick to pre-raise the ceiling before the demand spike lands.

Run locally from [cmd/adaptive-qos-demo/qos-graph-lab](/root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd/adaptive-qos-demo/qos-graph-lab):

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

### Story 1 Demo Runbook

The live Story 1 backend is exposed through the demo server on `8082`.

Preconditions:
- the compose stack is running
- the `ue` container is up
- the UE tunnel exists

Check the UE tunnel:

```bash
docker exec ue ip -4 addr show uesimtun0
```

Expected tunnel IP is usually `10.60.0.1/24`.

Clear story state:

```bash
curl -sS -X POST http://127.0.0.1:8082/api/reset \
  -H 'content-type: application/json' \
  -d '{}'
```

Run Story 1:

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

Expected accepted response:
- `status = started`
- `reasonCode = ACCEPTED`
- `profileId = burst-protect`

Verify state:

```bash
curl -sS http://127.0.0.1:8082/api/sidecar/status
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/status
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/trace
```

Expected during the burst:
- `activeSessions = 1`
- `activeFlows = 1`
- `currentQoSProfile.selectedProfileId = burst-protect`

### Debugging `SESSION_NOT_FOUND`

`SESSION_NOT_FOUND` means the Story 1 request reached the adaptive QoS path, but the UPF could not resolve an active UE/PDU session for the requested flow.

Typical causes:
- the UE tunnel is missing or down
- the UE attach is stale after a reset or restart
- AMF/SMF/UE state is out of sync

Debug steps:

1. Check the UE tunnel:

```bash
docker exec ue ip -4 addr show uesimtun0
```

If `uesimtun0` is missing or down, do not rerun Story 1 yet.

2. Check current demo state:

```bash
curl -sS http://127.0.0.1:8082/api/sidecar/status
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/status
curl -sS http://127.0.0.1:8082/api/upf/debug/adaptive-qos/trace
```

Typical stale-session signature:
- sidecar accepted the request path
- UPF status shows `activeSessions = 0`
- UPF trace contains `SESSION_NOT_FOUND`

3. Reattach the core session:

```bash
cd /root/proj/go/free5gc-compose
docker restart free5gc-amf
docker restart free5gc-smf
docker restart ueransim
docker restart ue
```

4. Wait for the tunnel to come back:

```bash
docker exec ue ip -4 addr show uesimtun0
```

5. Clear and rerun Story 1:

```bash
curl -sS -X POST http://127.0.0.1:8082/api/reset \
  -H 'content-type: application/json' \
  -d '{}'

curl -sS -X POST http://127.0.0.1:8082/api/sidecar/demo/story1/start \
  -H 'content-type: application/json' \
  -d '{}'
```

If `SESSION_NOT_FOUND` persists after the tunnel is back, inspect the UPF trace first. In practice, this issue has been a stale UE/AMF/SMF session problem rather than a story-request formatting problem.

### The specific version
**Note:** Please make sure to check your UPF version and use a compatible gtp5g version according to the table below.

|free5GC Version| UPF Version | Compatible gtp5g Versions |
|-----------------|-----------------|--------------------------|
|v3.4.4| v1.2.4 | >= 0.9.5 and < 0.10.0 |
|v3.4.3| v1.2.3 | >= 0.8.6 and < 0.9.0 |
|v3.4.2| v1.2.3 | >= 0.8.6 and < 0.9.0 |
|v3.4.1| v1.2.2 | >= 0.8.6 and < 0.9.0 |
|v3.4.0| v1.2.1 | >= 0.8.6 and < 0.9.0 |
|v3.3.0| v1.2.0 | >= 0.8.1 and < 0.9.0 |
|v3.2.1| v1.1.0 | >= 0.7.0 and < 0.7.0 |
|v3.2.0| v1.1.0 | >= 0.7.0 and < 0.7.0 |
