# Adaptive QoS Demo UI

This is the React frontend for the adaptive QoS demo used by the `ue` container.

## What it serves

- Root UI: `/`
- Alias: `/qos/`
- API proxy: `/api/*`

The app renders the burst demo and talks to:

- `GET /api/sidecar/status`
- `GET /api/sidecar/trace`
- `POST /api/sidecar/demo/story1/start`
- `GET /api/upf/debug/adaptive-qos/status`
- `GET /api/upf/debug/adaptive-qos/trace`
- `POST /api/upf/debug/adaptive-qos/inject-burst`

## Development

```bash
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8088`.

## Production build

```bash
npm run build
```

The Go demo embeds `qos/dist/*`, so the app must be built before rebuilding the `ue` image.

## Runtime notes

- The demo UI is started inside the `ue` container by `entrypoint-ue-sidecar.sh`.
- The current root route is `/`, not `/webapp/`.
- A burst can only be injected after the sidecar has created an active flow.

