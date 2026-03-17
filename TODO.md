# Userspace Forwarder TODO

This backlog tracks the remaining work to bring `forwarder: userspace` closer to `gtp5g` feature coverage without compromising the existing `gtp5g` backend.

## Guardrails

- Keep `forwarder: gtp5g` behavior unchanged.
- Keep the `forwarder.Driver` interface stable unless there is a strong reason to change both backends.
- Prefer userspace-only packages and code paths for new work.
- Every new userspace feature should have:
  - unit coverage
  - PFCP integration coverage where practical
  - explicit regression protection for backend selection

## Current Status

- `forwarder: userspace` is wired and selectable by config.
- Real free5GC + UERANSIM traffic works on the userspace path.
- `N3` ping works.
- Internet ping through both UE tunnels works.
- Basic support exists for:
  - `PDR/FAR/QER/URR/BAR` lifecycle
  - multi-worker packet processing
  - uplink decap and downlink encap
  - `FORW`, `DROP`, `BUFF`, `NOCP`
  - `QER` `MBR` enforcement
  - threshold/quota and periodic `URR` reporting
  - basic buffering, delayed downlink-data notification, and buffered-packet release
  - basic SDF-aware PDR selection
  - userspace observability counters
  - internal packet-I/O abstraction with `UDP + TUN` as the reference backend

## Phase 1: Correctness Gaps

- Implement fuller `QER` behavior:
  - define whether `GBR` is enforced or only stored
  - confirm `GateStatus` semantics match current PFCP expectations
- Strengthen `URR` behavior:
  - richer `ReportingTrigger` support beyond threshold/quota
  - confirm final-report behavior for `UpdateURR` and `RemoveURR`
- Enforce `BAR` behavior more fully:
  - better buffering policy and eviction accounting
- Review `OuterHeaderRemoval` semantics:
  - verify current unconditional decap is correct for all PDR shapes
- Improve non-IPv4 handling:
  - decide whether to drop, pass through, or explicitly support more payload types

Acceptance:

- Userspace behavior is deterministic for PFCP session establishment, modification, deletion, buffering, and reporting.
- No false PDR selection when multiple PDRs share TEID or UE IP and differ by SDF/QER state.

## Phase 2: Classification and Policy Depth

- Expand SDF flow-description support:
  - more protocol forms
  - more port expressions
  - better error handling for unsupported filters
- Decide how to handle `ApplicationID`:
  - unsupported with explicit logging
  - or integrate with a local application-to-flow mapping
- Decide how to use `NetworkInstance`:
  - route/NIC selection
  - DNN separation
- Decide how to use `DestinationInterface`, `ForwardingPolicy`, and `PFCPSMReqFlags`

Acceptance:

- PDR selection is based on more than TEID and UE IP when PFCP provides richer match criteria.

## Phase 3: Runtime and Scale

- Remove hot-path avoidable allocations where possible.
- Move from coarse shared state to clearer read-mostly snapshots plus cheap counter updates.
- Validate worker sharding under mixed-session load.
- Add backpressure policy for worker queues and egress queues.
- Bound memory for:
  - buffered packets
  - pending reports
  - per-session state growth

Acceptance:

- No unbounded growth in packet buffers or session-side runtime structures during long-running tests.

## Phase 4: Packet I/O Backends

- Keep current `UDP + TUN` backend as the reference implementation.
- Add optional higher-performance backend(s):
  - `AF_XDP` first choice
  - evaluate whether `TUN` stays as the default fallback
- Define a clean internal packet-I/O interface so the rule engine is backend-agnostic.
- Support multiple RX/TX queues and worker affinity.

Acceptance:

- Packet I/O backend can be swapped without changing PFCP/session logic.

## Phase 5: Observability and Operations

- Add structured counters for:
  - PDR match hits/misses
  - drops by reason
  - buffer enqueue/evict/drain
  - URR trigger emissions
  - worker queue pressure
- Add lightweight debug dumps for session/runtime state.
- Add clear startup logs for userspace-only config.

Acceptance:

- Common data-plane failures can be diagnosed without ad hoc code instrumentation.

## Phase 6: Validation Matrix

- Unit tests:
  - PDR matching
  - SDF matching
  - FAR transitions
  - QER enforcement
  - URR trigger behavior
  - BAR buffering behavior
- Integration tests:
  - PFCP establish/modify/delete
  - buffered packet notification and release
  - URR query/update/remove
- Cluster validation:
  - free5GC + UERANSIM attach
  - `N3` ping
  - internet ping
  - concurrent PDU sessions
  - repeated restart/recovery tests
- Regression tests:
  - `forwarder: gtp5g`
  - `forwarder: userspace`
  - backend selection and config defaults

Acceptance:

- Every userspace milestone is validated locally and does not regress `gtp5g`.

## Suggested Next Work Order

1. decide and implement `GBR` semantics, or document it as stored-only
2. expand `URR` trigger coverage beyond threshold/quota/periodic
3. add explicit buffer eviction accounting and queue-pressure metrics
4. add `AF_XDP` backend under the current internal packet-I/O abstraction
5. re-run full live free5GC + UERANSIM validation after the latest userspace changes

## Do Not Forget

- Re-run live free5GC/UERANSIM validation after each nontrivial datapath change.
- Keep root-required and container-required tests documented separately from ordinary `go test` coverage.
- Do not merge userspace-only shortcuts into shared code paths if they can alter `gtp5g`.
