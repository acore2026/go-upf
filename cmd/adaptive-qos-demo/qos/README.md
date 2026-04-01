# Adaptive QoS Demo UI

This frontend is now a demo-only React Flow mission-control screen for the proposals in `QOS_PROPOSAL.md` and `DUAL_UPF_PROPOSAL.md`.

## Current behavior

- Single-screen kiosk-style UI
- Local emulated demo state machine
- `Trigger` and `Stop` controls
- Combined story:
  - burst-aware QoS preparation
  - A-UP / S-UP selection
  - remote inference result return

The page is intentionally mock-driven for now. Real sidecar, UPF, and backend integration is a future TODO.

## Development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The Go demo still embeds `qos/dist/*`, so rebuild the frontend before rebuilding the container image.
