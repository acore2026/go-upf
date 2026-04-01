## 0. Current Topology Direction

The current preferred topology direction for the mission-control demo is:

- `Robot Dog / UE`
- `gNB - Shenzhen`
- `UPF - Shenzhen`
- `Router GZ-1`
- `Router SH-1`
- `Router D-1`
- `Router D-2`
- `AI Server - Shanghai`

### Path model

Two routes should be visually distinguishable:

- `N6 Direct Out`
  - ordinary breakout
  - dimmer and more generic
  - remains ghosted when the dedicated path is active
- `Dedicated A-UPF / S-UPF Path`
  - brighter and thicker
  - looks purpose-built
  - activates when service traffic is identified

### UPF representation

UPF is represented as a combined dual-role node rather than separate heavy A-UPF and S-UPF cards.

- main card stays minimal: icon + title
- attached slim side annotation carries state
- dual-role mini-cards inside the UPF show:
  - `A-UPF`
  - `S-UPF`
- the active role lights up according to current stage

### Handle model

UPF cards should expose visible labeled handle chips:

- `N3`
- `N6`
- `N9`

The route should visibly enter and exit UPF nodes through the corresponding handles.

### Visual rules

- links should be easier to read than the current thin baseline
- routers should be extra-minimal and visually distinct from endpoint / access / UPF / service cards
- node bodies should stay minimal while operational detail moves into side annotations

## 1. Goal
Design a **single-screen demo UI** that makes two ideas immediately visible:
- **Flexible QoS for burst traffic**: temporary uplink/downlink QoS treatment is activated before each burst and released after delivery.
- **Dynamic user-plane selection**: once the application traffic is identified, the network selects a better service path and forwards traffic through the selected UPF route.
This is a **demo-first design**, not a protocol-accurate implementation. The UI should feel like a **live service path theater**, not a telecom OSS screen.
---
## 2. Main UI Form
Use the existing **React Flow topology canvas** as the main demo surface.
The screen should combine:
- **Topology canvas** as the main visual story area
- **Small overlay control panels** for QoS, path selection, metrics, and status
- **Bottom timeline and event log** for narration and step-by-step playback
The user should understand the story at a glance:
**task starts → burst is predicted → QoS is activated → service path is optimized → result returns → temporary assurance ends**
---
## 3. Screen Structure
## A. Top bar
Show:
- Demo title
- Scenario selector
- Play / Pause / Step controls
- Demo speed selector
- Current status badge
Recommended status values:
- `Idle`
- `UL QoS Prep`
- `UL Sending`
- `Service Path Selected`
- `Processing`
- `DL QoS Prep`
- `DL Sending`
- `Complete`
---
## B. Main canvas
The canvas is the primary stage.
It should contain:
- service endpoints
- access network
- UPFs
- routers
- live path animations
- dynamic node/card state updates
- dynamic link state updates
The canvas should support:
- node glow / badge updates
- link lighting / color changes
- directional packet animation
- temporary path highlighting
- role badges on UPFs
- small floating labels for latency, bandwidth, and selection status
---
## C. Overlay panels
Use floating or corner panels rather than extra path nodes where possible.
Recommended overlay panels:
1. **Flexible QoS panel**
    - preconfigured profiles
    - current active profile
    - direction: UL / DL
    - burst status: Pending / Active / Released
2. **Path selection panel**
    - selected anchor UPF
    - selected service UPF
    - selected path summary
    - path score / latency / bandwidth summary
3. **Current burst panel**
    - burst size estimate
    - target bitrate
    - active direction
    - current traffic stage
4. **Result preview panel**
    - processed image preview
    - object labels or result summary
---
## D. Bottom strip
Show:
- step timeline
- event log
- a few key metrics
Recommended metrics:
- current direction
- active QoS profile
- selected path
- displayed delay
- temporary assurance state
Optional:
- baseline vs enhanced comparison toggle
---
## 4. Canvas Layers
Treat the canvas as a **geographic network sandbox** with three visual layers.
## Layer 1: Service endpoints
Business-facing nodes:
- UE / phone / MR glasses
- robot dog
- remote AI inference server
## Layer 2: Access and user plane
Forwarding-facing nodes:
- gNB / RAN
- city or province UPFs
- inter-UPF routers
## Layer 3: Control overlays
Supporting panels, not necessarily path nodes:
- Flexible QoS state
- selected path summary
- flow stage
- burst metrics
- result preview
---
## 5. Exact Node Inventory
Use a small fixed topology so the audience can understand it immediately.
## A. Endpoint nodes
1. **UE / User Device**
    - examples: `UE - Phone`, `UE - MR Glasses`
    - shows trigger, encoding, UL/DL status
2. **Robot Dog**
    - can be the actual capture source
    - optional if the UE alone is enough for the story
3. **AI Inference Server**
    - remote city or remote region
    - shows receiving / processing / result ready
---
## B. Access node
4. **Local gNB / RAN**
    - connected to the device side
    - shows current UL/DL Flexible QoS profile
    - changes state when temporary burst assurance is active
---
## C. UPF nodes
Use **one reusable UPF card type** only.
Recommended nodes:
5. **UPF - Access City**
6. **UPF - Regional Metro**
7. **UPF - Service City**
You may rename them to actual province/city names, but generic labels are usually clearer for the demo.
### UPF role model
A-UPF and S-UPF are **not separate node types**.  
They are the same UPF card with **dynamic role badges**.
Use these dynamic badges:
- `IDLE`
- `ANCHOR`
- `SERVICE`
- `ANCHOR + SERVICE` if needed
Recommended visual rules:
- `ANCHOR`: blue badge
- `SERVICE`: purple badge
- active forwarding: glowing border
- selected best path: thicker halo or stronger outline
This keeps the graph simple while still showing role changes per flow.
---
## D. Router nodes
Add explicit routers between UPFs so path optimization becomes visible.
Recommended nodes:
8. **Router R1 - Local Edge Router**
9. **Router R2 - Backbone Router**
10. **Router R3 - Service-side Router**
Routers mainly support visual storytelling:
- default route can look longer and dimmer
- optimized service path can look cleaner, brighter, and better scored
---
## E. Optional overlay nodes or fixed widgets
11. **Flexible QoS Panel**
12. **Path Intelligence Panel**
These are usually better as floating panels rather than graph nodes.
---
## 6. Recommended Topology Layout
Arrange the main line from left to right:
`UE / Robot Dog → gNB → UPF - Access City → Router R1 → Router R2 → UPF - Service City → Router R3 → AI Server`
Place `UPF - Regional Metro` slightly above or below the main line so the canvas visually suggests alternative paths and service-aware selection.
This gives the audience a clear story:
- there is an initial nearby UPF close to the user
- once service traffic is identified, another UPF closer to the server or better suited to the service becomes important
- the traffic switches onto a better-looking service path
---
## 7. Link Types and Visual Logic
Define three link classes.
## A. Default link
Use for baseline or ordinary connectivity.
Style:
- thin
- dim or neutral
- more hops visible
- low emphasis
## B. Active burst link
Use while UL or DL traffic is currently in flight.
Style:
- brighter
- animated particles or moving dash
- directional motion
- temporary highlight
## C. Optimized service link
Use when the selected A-UPF → S-UPF forwarding path is active.
Style:
- thicker
- smoother curve
- stronger glow
- cleaner geometry
- floating tags such as:
    - `Selected`
    - `Lower Delay`
    - `Higher Bandwidth`
The optimized route should look intentionally better than the default route even if both still cross routers.
---
## 8. Card Content Design
## A. UE / Robot Dog card
States:
- Idle
- Triggered
- Burst Estimated
- Encoding
- Uplink Sending
- Waiting Result
- Downlink Receiving
- Completed
Fields:
- current task
- estimated burst size
- estimated bitrate
- target UL QoS
Effects:
- pulse when burst is predicted
- outgoing particle stream during UL
---
## B. gNB / RAN card
Fields:
- active direction: UL / DL
- active Flexible QoS profile
- temporary assurance state
- radio load gauge
Effects:
- `UL Burst Profile Applied`
- `DL Burst Profile Applied`
- card glow during burst
This visually anchors the Flexible QoS idea.
---
## C. UPF card
Fields:
- node name
- city / region
- current role badge
- path score
- active flow count
- forwarding state
Effects:
- blue badge appears when used as anchor
- purple badge appears when used as service UPF
- border glows when carrying active traffic
- throughput strip or activity bar animates while forwarding
---
## D. Router card
Fields:
- route state
- latency grade
- utilization
- selected / non-selected
Effects:
- dim when unused
- bright when active
- directional animation when carrying traffic
- optimized path routers can show greener or better score
---
## E. AI server card
Fields:
- received input
- processing state
- output type
- DL burst estimate
Effects:
- input image thumbnail appears on arrival
- processing spinner
- `Result Ready` badge
- downlink transmission begins
---
## 9. Flexible QoS Panel Design
Use a compact stacked card with 3 example profiles:
- `Profile 1 - Low`
- `Profile 2 - Medium`
- `Profile 3 - Burst / High`
Show:
- active direction: UL / DL
- active profile chip
- burst state: Pending / Active / Released
- current estimate: size / bitrate / expected delay class
Behavior:
- a profile lights up before UL starts
- another profile may light up before DL starts
- only one profile is active at a time
This should make the audience feel that QoS is **prepared per burst**, not permanently overprovisioned.
---
## 10. Path Selection Panel Design
Use a compact path summary card.
Show:
- selected anchor UPF
- selected service UPF
- path rationale
- displayed path score
- displayed latency and bandwidth summary
Recommended factors:
- service fit
- topology proximity
- path performance
You may show simple ranked candidates, for example:
- `Regional Metro: 82`
- `Service City: 94`
- `Selected: Service City`
This is for storytelling, not engineering accuracy.
---
## 11. Stepwise UI Effects
Use the following step flow for autoplay or step mode.
## Phase 0 — Idle
Visible state:
- all nodes visible
- only default links shown
- UPFs are `IDLE`
- QoS panel shows `No Active Burst`
Effect:
- calm, dim network
---
## Phase 1 — Trigger
Action:
- user presses capture, or robot dog triggers recognition
UI effects:
- source card flashes
- status changes to `Capture Requested`
- event log adds `Visual Task Triggered`
---
## Phase 2 — UL burst prediction
Action:
- UE estimates burst size, bitrate, and UL target QoS
UI effects:
- source card expands a small prediction block
- gNB gets `UL Flexible QoS Preparing`
- top status becomes `UL QoS Prep`
- QoS panel shows pending UL profile
---
## Phase 3 — UL Flexible QoS activated
Action:
- corresponding temporary UL treatment becomes active
UI effects:
- gNB changes highlight state
- UL profile chip lights up in the QoS panel
- access link brightens
- temporary badge appears: `UL Assurance Active`
---
## Phase 4 — Encoding complete, UL starts
Action:
- local encoding completes and image uplink starts
UI effects:
- source card changes to `Uplink Sending`
- packet animation starts from source to gNB
- first active path segment lights up
- throughput number animates upward
---
## Phase 5 — Anchor selected
Action:
- nearest UPF becomes the anchor for the service traffic
UI effects:
- nearby UPF receives blue `ANCHOR` badge
- link from gNB to that UPF lights up
- other UPFs remain dim
This should be brief and easy to read.
---
## Phase 6 — Service traffic identified, service path selected
Action:
- application traffic is recognized and a better service-side UPF is selected
UI effects:
- remote UPF receives purple `SERVICE` badge
- optimized A-UPF → S-UPF path appears or lights up
- baseline route remains faint in the background
- traffic visibly switches to the optimized route
The optimized route should look better by:
- smoother line
- fewer emphasized hops
- brighter glow
- lower displayed delay
- higher displayed bandwidth
This is the main visual effect for dynamic user-plane selection.
---
## Phase 7 — UL delivery completed
Action:
- image reaches the server
UI effects:
- server card receives image thumbnail
- UL traffic animation stops
- UL assurance badge fades
- top or bottom status shows `UL Assurance Ended`
---
## Phase 8 — Server processing
Action:
- server processes the image
UI effects:
- server shows spinner / progress
- result preview placeholder appears
- optimized path remains selected but traffic pauses
---
## Phase 9 — DL burst prediction and marking
Action:
- server estimates result characteristics and the network side derives the DL target QoS
UI effects:
- server expands a result burst estimate block
- service-side UPF shows `DL Burst Marked`
- QoS panel switches to DL mode
- gNB shows `DL Flexible QoS Preparing`
---
## Phase 10 — DL Flexible QoS activated
Action:
- corresponding temporary DL treatment becomes active
UI effects:
- gNB enters DL highlight state
- DL profile chip lights up
- path arrows reverse direction
- temporary badge appears: `DL Assurance Active`
---
## Phase 11 — Result sent back
Action:
- processed result is sent downlink through the selected path
UI effects:
- traffic animates from server → service UPF → anchor UPF → gNB → UE
- selected route remains bright
- source card changes to `Receiving Result`
- result preview fills in
---
## Phase 12 — Completion and release
Action:
- result delivery ends and temporary assurance ends
UI effects:
- DL traffic animation stops
- gNB glow fades
- UPF role badges either fade after a short delay or remain as a summary of the chosen route
- final status becomes `Complete`
- event log adds `Assurance Released`
---
## 12. Comparison Mode
If time allows, support two modes.
## A. Enhanced mode
Show:
- burst prediction before UL and DL
- temporary Flexible QoS activation
- service-aware UPF path selection
- optimized route animation
## B. Baseline mode
Show:
- no pre-burst QoS effect
- no service-specific path activation
- flatter path visuals
- weaker performance labels
This makes the enhancement visible without needing real protocol implementation.
---
## 13. Minimal Version for Fastest Delivery
If only a minimal prototype is needed, implement these pieces first:
1. Main topology canvas
2. Flexible QoS panel
3. Path selection panel
4. Timeline and event log
Minimum useful node set:
5. UE / Phone
6. Robot Dog
7. gNB
8. UPF - Access City
9. Router R1
10. Router R2
11. UPF - Service City
12. Router R3
13. AI Server
14. QoS / Path Summary overlay
This is enough for a convincing end-to-end demo.
---
## 14. Design Tone
Use a **clean control-center style**.
Recommended tone:
- dark or neutral background
- glowing but restrained path lines
- clear card borders
- minimal protocol text
- short labels only
Recommended labels:
- `Burst Predicted`
- `UL QoS Active`
- `Anchor Selected`
- `Service UP Selected`
- `Optimized Path Established`
- `UL Assurance Ended`
- `DL QoS Active`
- `Result Delivered`
- `Assurance Released`
The screen should feel polished, readable, and presentation-friendly.
---
## 15. Final Principle
The canvas should present a live visual story:
- the task is triggered
- the burst is anticipated
- the radio treatment changes in time
- an anchor path is formed
- a better service path is selected
- the result returns on that path
- temporary assurance disappears after delivery
That is the cleanest merged expression of both proposals in one demo UI.
