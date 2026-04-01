# Adaptive QoS UI Projects

This directory contains the UPF command code plus a merged demo server that can host three UI projects from one process.

In the current compose setup, that merged UI now runs in its own container instead of inside `ue`.

## Projects

### 1. `adaptive-qos-demo/qos`

Main adaptive QoS React UI.

- Route on merged server: `/`
- Type: React + Vite
- Backend usage: calls `/api/sidecar/*`, `/api/upf/*`, and `/api/reset`

### 2. `adaptive-qos-demo/qos-graph-lab`

Standalone graph lab for visualizing QoS behavior.

- Route on merged server: `/qos/`
- Alias: `/qos-graph-lab/`
- Type: React + Vite
- Backend usage: none

### 3. `adaptive-qos-video-stream/webapp`

Adaptive QoS video-stream React UI.

- Route on merged server: `/webapp/`
- Type: React + Vite
- Backend usage: calls `/api/sidecar/*`, `/api/upf/*`, and `/api/reset`

## Merged Server

The merged server entrypoint is:

- [adaptive-qos-demo/main.go](/root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd/adaptive-qos-demo/main.go)

It serves:

- `/` from `adaptive-qos-demo/qos/dist`
- `/qos/` from embedded `adaptive-qos-demo/qos-graph-lab/dist`
- `/webapp/` from `adaptive-qos-video-stream/webapp/dist`

The first two apps are embedded into the Go binary. The video-stream app is served from disk and defaults to:

```bash
adaptive-qos-video-stream/webapp/dist
```

Override that location with `WEBAPP_DIST` if needed.

## Container Layout

In `docker-compose-build.yaml`:

- `ue` runs the UE process and the adaptive QoS sidecar only
- `adaptive-qos-ui` runs the merged Go UI server

Network paths used by the UI container:

- sidecar: `http://ue:8083`
- UPF debug API: `http://upf:9082`

## Build

Build all three UI projects before rebuilding or running the merged server.

### Build the main demo UI

```bash
cd /root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd/adaptive-qos-demo/qos
npm install
npm run build
```

### Build the graph lab

```bash
cd /root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd/adaptive-qos-demo/qos-graph-lab
npm install
npm run build
```

### Build the video-stream UI

```bash
cd /root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd/adaptive-qos-video-stream/webapp
npm install
npm run build
```

## Run

Run the merged server from this directory:

```bash
cd /root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd
go run ./adaptive-qos-demo
```

Default listen address:

```bash
127.0.0.1:8088
```

Default URLs:

- Demo UI: `http://127.0.0.1:8088/`
- Graph Lab: `http://127.0.0.1:8088/qos/`
- Video Webapp: `http://127.0.0.1:8088/webapp/`

### Run with custom settings

```bash
cd /root/proj/go/free5gc-compose/base/free5gc/NFs/upf/cmd
WEBAPP_DIST=adaptive-qos-video-stream/webapp/dist \
go run ./adaptive-qos-demo \
  -listen 127.0.0.1:8088 \
  -sidecar-base http://127.0.0.1:18080 \
  -upf-base http://127.0.0.1:9082
```

Useful environment variables:

- `WEBAPP_DIST`: disk path for `adaptive-qos-video-stream/webapp/dist`
- `SIDECAR_BIN`: sidecar binary used by `/api/reset`
- `SIDECAR_CONFIG`: sidecar config used by `/api/reset`

## Compose Build And Run

Build the updated images from the compose workspace:

```bash
cd /root/proj/go/free5gc-compose
docker compose -f docker-compose-build.yaml build ue adaptive-qos-ui
```

Start the stack:

```bash
cd /root/proj/go/free5gc-compose
docker compose -f docker-compose-build.yaml up -d
```

UI endpoints after startup:

- merged adaptive QoS UI: `http://127.0.0.1:8084/`
- graph lab: `http://127.0.0.1:8084/qos/`
- video UI: `http://127.0.0.1:8084/webapp/`
- sidecar API: `http://127.0.0.1:8083/`

## Notes

- If `qos/dist` or `qos-graph-lab/dist` is missing, the Go server still starts, but those routes will not serve the intended app.
- If `adaptive-qos-video-stream/webapp/dist` is missing, `/webapp/` will be empty until that app is built.
- The merged server reuses the adaptive QoS proxy/reset endpoints, so the live demo routes still depend on the sidecar and UPF debug endpoints being reachable.
