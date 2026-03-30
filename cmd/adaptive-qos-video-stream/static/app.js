const state = {
  flowId: "",
  pollHandle: null,
  errors: {},
  lastPacketCount: 0,
  packetFlashUntil: 0,
  data: {
    sidecarStatus: null,
    flow: null,
    sidecarTrace: [],
    upfStatus: null,
    upfTrace: [],
  },
};

const fields = {
  ue: document.getElementById("ue-fields"),
  sidecar: document.getElementById("sidecar-fields"),
  upf: document.getElementById("upf-fields"),
  gnb: document.getElementById("gnb-fields"),
  current: document.getElementById("state-fields"),
  timeline: document.getElementById("timeline"),
  status: document.getElementById("status-line"),
  timer: document.getElementById("story-timer"),
  timerValue: document.getElementById("story-timer-value"),
  timerMeta: document.getElementById("story-timer-meta"),
  flowPill: document.getElementById("flow-pill"),
  timelineCount: document.getElementById("timeline-count"),
  liveSummary: document.getElementById("live-summary"),
  activityStrip: document.getElementById("activity-strip"),
  liveBadge: document.getElementById("live-badge"),
  diagramPhase: document.getElementById("diagram-phase"),
  masqueLine: document.getElementById("diagram-masque-line"),
  qosLine: document.getElementById("diagram-qos-line"),
  scope: document.getElementById("scope-fields"),
};

document.getElementById("run-story").addEventListener("click", runStory);
document.getElementById("reset-view").addEventListener("click", resetStory);

render();
refreshAll();
state.pollHandle = window.setInterval(refreshAll, 1000);

async function runStory() {
  setStatus("Starting the current demo scenario...");
  try {
    const response = await fetchJSON("/api/sidecar/demo/story1/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    state.flowId = response.flowId || response.FlowID || "story1-flow-1";
    setStatus(`Demo scenario running for ${state.flowId}`);
    await refreshAll();
  } catch (error) {
    state.errors.sidecar = error.message;
    setStatus(error.message, true);
    render();
  }
}

async function resetStory() {
  setStatus("Resetting story components...");
  try {
    const response = await fetchJSON("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    state.flowId = "";
    state.errors = {};
    state.data.sidecarStatus = null;
    state.data.flow = null;
    state.data.sidecarTrace = [];
    state.data.upfStatus = null;
    state.data.upfTrace = [];
    state.lastPacketCount = 0;
    state.packetFlashUntil = 0;
    setStatus(`Reset complete: UPF ${response.upf?.status || "unknown"}, sidecar ${response.sidecar?.status || "unknown"}`);
    await refreshAll();
  } catch (error) {
    state.errors.sidecar = error.message;
    setStatus(error.message, true);
    render();
  }
}

function resetView() {
  return resetStory();
}

async function refreshAll() {
  await Promise.all([
    loadInto("sidecarStatus", "/api/sidecar/status", "sidecar"),
    loadInto("sidecarTrace", "/api/sidecar/trace", "sidecar"),
    loadInto("upfStatus", "/api/upf/debug/adaptive-qos/status", "upf"),
    loadInto("upfTrace", "/api/upf/debug/adaptive-qos/trace", "upf"),
  ]);

  const derivedFlowId = state.flowId ||
    state.data.sidecarStatus?.story?.flowId ||
    state.data.sidecarStatus?.story?.FlowID ||
    state.data.sidecarStatus?.story?.flowID;
  if (derivedFlowId) {
    state.flowId = derivedFlowId;
    await loadInto("flow", `/api/sidecar/flows/${encodeURIComponent(derivedFlowId)}`, "sidecar");
  }

  render();
}

async function loadInto(key, url, namespace) {
  try {
    state.data[key] = await fetchJSON(url);
    delete state.errors[namespace];
  } catch (error) {
    state.errors[namespace] = error.message;
  }
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`.trim());
  }
  return response.json();
}

function render() {
  const sidecarStatus = state.data.sidecarStatus || {};
  const flow = state.data.flow || {};
  const lastReport = normalizeRequestMessage(flow.lastReport || sidecarStatus.lastReport || {});
  const lastFeedback = normalizeResponseMessage(flow.lastFeedback || sidecarStatus.lastFeedback || {});
  const sidecarStory = sidecarStatus.story || {};
  const upfStory = state.data.upfStatus?.story || {};
  const upfDecision = state.data.upfStatus?.qosDecision || {};
  const effectiveStory = Object.keys(upfStory).length ? upfStory : sidecarStory;
  const mergedTimeline = mergeTimeline(state.data.sidecarTrace || [], state.data.upfTrace || []);
  const liveStage = deriveLiveStage(effectiveStory, mergedTimeline, (sidecarStatus.activeFlows || 0) + (state.data.upfStatus?.activeFlows || 0));
  const defaultProfileId = upfDecision.defaultProfileId || upfStory.defaultProfileId || "adaptive-default";
  const activeProfileId = state.data.upfStatus?.currentQoSProfile?.selectedProfileId || upfStory.profileId || lastFeedback.profileId || "";
  const storyLive = (sidecarStatus.activeFlows || 0) + (state.data.upfStatus?.activeFlows || 0) > 0 && (!!expiry && expiry.remainingMs > 0);
  const hasMasqueTunnel = storyLive && ((sidecarStatus.activeFlows || 0) > 0 || !!effectiveStory.flowDescription);
  const hasAdaptiveProfile = storyLive && !!activeProfileId && activeProfileId !== defaultProfileId;
  const packetCount = state.data.upfStatus?.story?.packetCount || 0;
  if (packetCount > state.lastPacketCount) {
    state.packetFlashUntil = Date.now() + 1200;
  }
  state.lastPacketCount = packetCount;
  const packetFlash = packetCount > 0 && Date.now() < state.packetFlashUntil;
  const expiry = storyExpiryInfo(effectiveStory, lastReport);

  renderFields(fields.ue, [
    ["Scenario", effectiveStory.scenario || lastReport.scenario || "not started"],
    ["Traffic Signal", lastReport.trafficPattern || "not available"],
    ["Burst Size", formatBytes(lastReport.burstSize)],
    ["Expected Arrival", formatTime(lastReport.expectedArrivalTime)],
    ["Auto-End Timer", formatCountdown(storyExpiryRemainingMs(effectiveStory, lastReport))],
    ["Priority", lastReport.priority || "not available"],
  ]);

  renderFields(fields.sidecar, [
    ["Latest Report", lastReport.reportType || "not available"],
    ["Guarantee Status", lastFeedback.status || "not available"],
    ["Current Phase", lastFeedback.storyPhase || sidecarStory.phase || "not available"],
    ["Trace Depth", numberOrNA(sidecarStatus.traceDepth)],
    ["Last Error", sidecarStatus.lastError || state.errors.sidecar || "none"],
  ]);

  renderFields(fields.upf, [
    ["Selected Profile", lastFeedback.profileId || upfStory.profileId || "not available"],
    ["Default QoS Profile", defaultProfileId],
    ["Flow ID", effectiveStory.flowId || state.flowId || "not available"],
    ["Scenario", upfStory.scenario || effectiveStory.scenario || "not available"],
    ["Decision Reason", upfStory.decisionReason || upfDecision.decisionReason || "not available"],
    ["Requested Burst", formatBytes(upfStory.burstSize || lastReport.burstSize)],
    ["Requested Deadline", formatDuration(upfStory.deadlineMs || lastReport.deadlineMs)],
    ["Requested Priority", upfDecision.requestedPriority || lastReport.priority || "not available"],
    ["Requested DL Bitrate", formatBitrate(upfDecision.requestedBitrateDl)],
    ["Requested UL Bitrate", formatBitrate(upfDecision.requestedBitrateUl)],
    ["Burst GBR DL", formatBitrate(upfDecision.overrideGfbrDl)],
    ["Burst GBR UL", formatBitrate(upfDecision.overrideGfbrUl)],
    ["Default GBR DL", formatBitrate(resolveDefaultGbr(upfDecision.defaultGfbrDl))],
    ["Default GBR UL", formatBitrate(resolveDefaultGbr(upfDecision.defaultGfbrUl))],
    ["GBR Increase DL", formatBitrateDelta(resolveDefaultGbr(upfDecision.defaultGfbrDl), upfDecision.overrideGfbrDl)],
    ["GBR Increase UL", formatBitrateDelta(resolveDefaultGbr(upfDecision.defaultGfbrUl), upfDecision.overrideGfbrUl)],
    ["DL MBR", formatBitrate(upfDecision.overrideMbrDl)],
    ["UL MBR", formatBitrate(upfDecision.overrideMbrUl)],
    ["Debug Trace", numberOrNA(state.data.upfStatus?.traceDepth)],
    ["Serve Error", state.data.upfStatus?.serveError || state.errors.upf || "none"],
  ]);

  renderFields(fields.gnb, [
    ["Decision", lastFeedback.gnbDecision || upfStory.gnbDecision || "not available"],
    ["Predicted Air Delay", formatDuration(lastFeedback.predictedAirDelayMs || upfStory.predictedAirDelayMs)],
    ["Block Success Ratio", ratioOrNA(lastFeedback.blockSuccessRatio || upfStory.blockSuccessRatio)],
    ["Current Role", "RAN assist response"],
    ["Phase", upfStory.phase || lastFeedback.storyPhase || "not available"],
  ]);

  renderFields(fields.current, [
    ["Flow ID", effectiveStory.flowId || state.flowId || "not available"],
    ["Current Profile", activeProfileId || "not available"],
    ["Default QoS Profile", defaultProfileId],
    ["Requested Burst", formatBytes(upfStory.burstSize || lastReport.burstSize)],
    ["Requested Deadline", formatDuration(upfStory.deadlineMs || lastReport.deadlineMs)],
    ["Requested Priority", upfDecision.requestedPriority || lastReport.priority || "not available"],
    ["Requested DL Bitrate", formatBitrate(upfDecision.requestedBitrateDl)],
    ["Burst GBR DL", formatBitrate(upfDecision.overrideGfbrDl)],
    ["Default GBR DL", formatBitrate(resolveDefaultGbr(upfDecision.defaultGfbrDl))],
    ["GBR Increase DL", formatBitrateDelta(resolveDefaultGbr(upfDecision.defaultGfbrDl), upfDecision.overrideGfbrDl)],
    ["Predicted Air Delay", formatDuration(lastFeedback.predictedAirDelayMs || upfStory.predictedAirDelayMs)],
    ["Block Success Ratio", ratioOrNA(lastFeedback.blockSuccessRatio || upfStory.blockSuccessRatio)],
    ["Recommended Action", upfStory.qosDecision?.selectedProfileId || lastFeedback.profileId || "not available"],
  ]);

  renderFields(fields.scope, [
    ["Prototype", "Generic adaptive QoS collaboration loop"],
    ["Current scenario", effectiveStory.scenario || lastReport.scenario || "predictive-burst MVP"],
    ["Near-term demo focus", "Predictive traffic signalling and closed-loop QoS response"],
    ["Planned extension", "Congestion-aware application adaptation and network information exposure"],
  ]);

  renderLiveView(effectiveStory, lastReport, lastFeedback, liveStage, mergedTimeline, defaultProfileId);
  renderTimeline(mergedTimeline, lastReport, lastFeedback);

  fields.flowPill.textContent = effectiveStory.flowId || state.flowId || "No active flow";
  fields.liveBadge.textContent = liveStage.label;
  fields.diagramPhase.textContent = liveStage.label;
  fields.status.textContent = composeStatusLine();
  fields.timer.hidden = false;
  fields.timerValue.textContent = expiry ? formatCountdown(expiry.remainingMs) : "Standby";
  fields.timerMeta.textContent = expiry ? `Expires at ${formatTime(expiry.expiryMs)}` : "Waiting for expected arrival";

  setCardState("card-sidecar", !!state.errors.sidecar);
  setCardState("card-upf", !!state.errors.upf);
  setCardState("card-ue", false);
  setCardState("card-gnb", false);
  applyDiagramState(liveStage.activeNodes, hasMasqueTunnel, hasAdaptiveProfile, packetFlash);
}

function renderFields(node, entries) {
  node.innerHTML = entries.map(([label, value]) => `
    <div>
      <dt>${escapeHTML(label)}</dt>
      <dd>${escapeHTML(value)}</dd>
    </div>
  `).join("");
}

function renderTimeline(events, lastReport, lastFeedback) {
  fields.timelineCount.textContent = `${events.length} events`;
  if (!events.length) {
    fields.timeline.innerHTML = `<div class="event"><div><time>waiting</time></div><div><strong>No timeline data yet</strong><span>Run the story or wait for the next poll.</span></div></div>`;
    return;
  }
  fields.timeline.innerHTML = events.map((event, index) => {
    const aligned = alignTraceEvent(event, lastReport, lastFeedback);
    const detailId = `timeline-detail-${index}`;
    return `
      <details class="event event-detail">
        <summary>
          <div><time>${escapeHTML(formatTime(aligned.timestamp))}</time></div>
          <div>
            <strong>${escapeHTML(`${aligned.component} · ${formatTraceStage(aligned.stage)}`)}</strong>
            <span>${escapeHTML(describeEvent(aligned))}</span>
          </div>
        </summary>
        <pre id="${detailId}">${escapeHTML(JSON.stringify(aligned.fullMessage, null, 2))}</pre>
      </details>
    `;
  }).join("");
}

function renderLiveView(story, lastReport, lastFeedback, liveStage, timeline, defaultProfileId) {
  const latestEvent = timeline[timeline.length - 1];
  const expiry = storyExpiryInfo(story, lastReport);
  const chips = [
    ["Right now", liveStage.description],
    ["Current profile", lastFeedback.profileId || story.profileId || "not available"],
    ["Default profile", defaultProfileId],
    ["Current scenario", story.scenario || lastReport.scenario || "not available"],
    ["Burst window", formatTime(lastReport.expectedArrivalTime)],
    ["Latest event", latestEvent ? `${latestEvent.component} · ${formatTraceStage(latestEvent.stage)}` : "waiting for activity"],
  ];
  if (expiry) {
    chips.splice(4, 0, ["Auto-end", `${formatCountdown(expiry.remainingMs)} left`]);
  }
  fields.liveSummary.innerHTML = chips.map(([title, value]) => `
    <div class="summary-chip">
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(value)}</span>
    </div>
  `).join("");

  const rows = [
    ["UE signal", liveStage.progress.ue, ueSignalText(lastReport)],
    ["Transport", liveStage.progress.transport, latestTransportText(timeline)],
    ["UPF policy", liveStage.progress.upf, lastFeedback.profileId ? `Profile ${lastFeedback.profileId} selected` : "Waiting for policy selection"],
    ["RAN assist", liveStage.progress.gnb, lastFeedback.gnbDecision ? `${lastFeedback.gnbDecision} · ${formatDuration(lastFeedback.predictedAirDelayMs)}` : "Waiting for response"],
  ];
  fields.activityStrip.innerHTML = rows.map(([label, percent, text]) => `
    <div class="activity-row">
      <div class="activity-label">${escapeHTML(label)}</div>
      <div class="activity-bar">
        <div class="activity-fill" style="width:${percent}%"></div>
        <div class="activity-text">${escapeHTML(text)}</div>
      </div>
    </div>
  `).join("");
}

function applyDiagramState(activeNodes, hasMasqueTunnel, hasAdaptiveProfile, packetFlash) {
  document.querySelectorAll(".diagram-node").forEach((node) => {
    node.classList.toggle("active", activeNodes.includes(node.dataset.stage));
    node.classList.toggle("flash", packetFlash && node.dataset.stage === "upf");
  });
  fields.masqueLine?.classList.toggle("active", hasMasqueTunnel);
  fields.qosLine?.classList.toggle("active", hasAdaptiveProfile);
  document.getElementById("diagram-base-line")?.classList.toggle("active", hasMasqueTunnel || hasAdaptiveProfile);
}

function mergeTimeline(sidecarTrace, upfTrace) {
  return [...sidecarTrace, ...upfTrace]
    .sort((left, right) => {
      const leftTime = Date.parse(left.timestamp || 0);
      const rightTime = Date.parse(right.timestamp || 0);
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return (left.seq || 0) - (right.seq || 0);
    })
    .slice(-24);
}

function describeEvent(event) {
  const parts = [];
  if (event.flowId) parts.push(`flow ${event.flowId}`);
  if (event.profileId) parts.push(`profile ${event.profileId}`);
  if (event.detail) parts.push(event.detail);
  if (event.status) parts.push(`status ${event.status}`);
  if (event.reason) parts.push(`reason ${event.reason}`);
  if (!parts.length) {
    return "No extra detail";
  }
  return parts.join(" · ");
}

function formatTraceStage(stage) {
  if (!stage) {
    return "EVENT";
  }
  return String(stage).replace(/_/g, " ").toUpperCase();
}

function alignTraceEvent(event, lastReport, lastFeedback) {
  const component = event.component || "unknown";
  const stage = event.stage || "event";
  const requestMessageRaw =
    event.requestMessage ||
    event.request ||
    (component === "sidecar" && stage === "story_started" ? (lastReport || null) : null);
  const responseMessageRaw =
    event.responseMessage ||
    event.response ||
    (component === "sidecar" && (stage === "qos_response" || stage === "story_result") ? (lastFeedback || null) : null);
  const requestMessage = normalizeRequestMessage(requestMessageRaw);
  const responseMessage = normalizeResponseMessage(responseMessageRaw);
  const profileId =
    event.profileId ||
    event.qosDecision?.selectedProfileId ||
    responseMessage.profileId ||
    null;
  const reason =
    event.reason ||
    event.reasonCode ||
    responseMessage.reasonCode ||
    null;
  const status =
    event.status ||
    responseMessage.status ||
    null;

  return {
    timestamp: event.timestamp,
    component,
    stage,
    flowId: event.flowId || requestMessage.flowId || responseMessage.flowId,
    profileId,
    status,
    reason,
    detail: event.detail,
    fullMessage: {
      component,
      stage,
      flowId: event.flowId || null,
      status,
      reason,
      profileId,
      previousProfileId: event.previousProfileId || event.qosDecision?.previousProfileId || null,
      decisionReason: event.decisionReason || event.qosDecision?.decisionReason || null,
      cpProvisionedRange: event.cpProvisionedRange || null,
      qosDecision: event.qosDecision || null,
      requestMessage: hasKeys(requestMessage) ? requestMessage : null,
      responseMessage: hasKeys(responseMessage) ? responseMessage : null,
      raw: event,
    },
  };
}

function deriveLiveStage(story, timeline, activeFlowCount = 0) {
  const phase = story.phase || "";
  const latest = timeline[timeline.length - 1];
  if (activeFlowCount <= 0) {
    return {
      label: "Awaiting scenario",
      description: "No adaptive QoS collaboration flow is active yet.",
      activeNodes: [],
      progress: { ue: 0, transport: 0, upf: 0, gnb: 0 },
    };
  }
  if (phase === "prepared" && story.blockSuccessRatio > 0.9) {
    return {
      label: "Adaptive profile active",
      description: "The collaboration signal has been accepted and the active QoS treatment is in place end-to-end.",
      activeNodes: ["ue", "sidecar", "upf", "gnb"],
      progress: { ue: 100, transport: 100, upf: 100, gnb: 100 },
    };
  }
  if (latest?.stage === "profile_selected" || latest?.stage === "profile_applied") {
    return {
      label: "UPF adapting QoS",
      description: "The UPF has selected a scenario-specific profile and is preparing the traffic treatment before arrival.",
      activeNodes: ["ue", "sidecar", "upf"],
      progress: { ue: 100, transport: 82, upf: 88, gnb: 50 },
    };
  }
  if (latest?.stage === "report_submitted" || latest?.stage === "transport_send_started") {
    return {
      label: "Collaboration signal in transit",
      description: "The sidecar is forwarding the current collaboration signal across MASQUE toward the UPF.",
      activeNodes: ["ue", "sidecar"],
      progress: { ue: 90, transport: 60, upf: 20, gnb: 0 },
    };
  }
  if (story.scenario || timeline.length) {
    return {
      label: "Prototype active",
      description: "A collaboration flow exists and the UI is polling live state from the sidecar and the UPF.",
      activeNodes: ["ue"],
      progress: { ue: 60, transport: 20, upf: 10, gnb: 0 },
    };
  }
  return {
    label: "Awaiting scenario",
    description: "No adaptive QoS collaboration flow is active yet.",
    activeNodes: [],
    progress: { ue: 0, transport: 0, upf: 0, gnb: 0 },
  };
}

function latestTransportText(timeline) {
  const event = [...timeline].reverse().find((entry) =>
    entry.stage === "transport_send_started" ||
    entry.stage === "report_submitted" ||
    entry.stage === "report_received"
  );
  if (!event) {
    return "No transport activity yet";
  }
  if (event.stage === "report_received") {
    return "UPF has received the collaboration signal";
  }
  if (event.stage === "transport_send_started") {
    return "MASQUE transport is sending the current report";
  }
  return "Sidecar submitted the current report";
}

function setStatus(message, isError = false) {
  fields.status.textContent = message;
  fields.status.classList.toggle("error", isError);
}

function composeStatusLine() {
  const issues = Object.values(state.errors);
  if (issues.length) {
    return issues.join(" | ");
  }
  if (state.flowId) {
    return `Polling adaptive QoS state for ${state.flowId}`;
  }
  return "Polling sidecar and UPF every 1s";
}

function ueSignalText(lastReport) {
  if (!lastReport.scenario) {
    return "Awaiting scenario start";
  }
  if (lastReport.burstSize) {
    return `Predictive burst metadata prepared for ${formatBytes(lastReport.burstSize)}`;
  }
  if (lastReport.trafficPattern) {
    return `Traffic pattern ${lastReport.trafficPattern} reported to the network`;
  }
  return "Application-side signal prepared";
}

function normalizeRequestMessage(raw) {
  if (!raw || typeof raw !== "object") return {};
  return {
    ueAddress: pick(raw, "ueAddress", "UEAddress"),
    flowId: pick(raw, "flowId", "FlowID"),
    reportType: pick(raw, "reportType", "ReportType"),
    timestamp: pick(raw, "timestamp", "Timestamp"),
    scenario: pick(raw, "scenario", "Scenario"),
    trafficPattern: pick(raw, "trafficPattern", "TrafficPattern"),
    expectedArrivalTime: pick(raw, "expectedArrivalTime", "ExpectedArrivalTime"),
    latencySensitivity: pick(raw, "latencySensitivity", "LatencySensitivity"),
    packetLossTolerance: pick(raw, "packetLossTolerance", "PacketLossTolerance"),
    burstSize: pick(raw, "burstSize", "BurstSize"),
    burstDurationMs: pick(raw, "burstDurationMs", "BurstDurationMs"),
    deadlineMs: pick(raw, "deadlineMs", "DeadlineMs"),
    priority: pick(raw, "priority", "Priority"),
    seidHint: pick(raw, "seidHint", "SEIDHint"),
  };
}

function normalizeResponseMessage(raw) {
  if (!raw || typeof raw !== "object") return {};
  return {
    flowId: pick(raw, "flowId", "FlowID"),
    status: pick(raw, "status", "Status"),
    reasonCode: pick(raw, "reasonCode", "ReasonCode"),
    profileId: pick(raw, "profileId", "ProfileID"),
    scenario: pick(raw, "scenario", "Scenario"),
    storyPhase: pick(raw, "storyPhase", "StoryPhase"),
    gnbDecision: pick(raw, "gnbDecision", "GNBDecision"),
    predictedAirDelayMs: pick(raw, "predictedAirDelayMs", "PredictedAirDelayMs"),
    blockSuccessRatio: pick(raw, "blockSuccessRatio", "BlockSuccessRatio"),
    effectiveTime: pick(raw, "effectiveTime", "EffectiveTime"),
  };
}

function pick(raw, ...keys) {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) {
      return raw[key];
    }
  }
  return undefined;
}

function hasKeys(raw) {
  return Object.values(raw || {}).some((value) => value !== undefined && value !== null && value !== "");
}

function setCardState(id, degraded) {
  document.getElementById(id).classList.toggle("degraded", degraded);
}

function formatBytes(value) {
  if (!value) return "not available";
  const mib = value / (1024 * 1024);
  return `${mib.toFixed(1)} MiB`;
}

function formatBitrate(value) {
  if (!value) return "not available";
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} Mbps`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)} kbps`;
  }
  return `${value} bps`;
}

function formatBitrateDelta(base, value) {
  if (!value && !base) return "not available";
  const delta = (value || 0) - (base || 0);
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  return `${sign}${formatBitrate(Math.abs(delta))}`;
}

function resolveDefaultGbr(value) {
  return value || 1000000;
}

function formatDuration(value) {
  if (!value) return "not available";
  return `${value} ms`;
}

function formatCountdown(remainingMs) {
  if (remainingMs === undefined || remainingMs === null) return "not available";
  if (remainingMs <= 0) return "expired";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${totalSeconds}s`;
}

function formatTime(value) {
  if (!value) return "not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString();
}

function storyExpiryInfo(story, lastReport) {
  const expectedArrival = story.expectedArrivalTime || lastReport.expectedArrivalTime;
  if (!expectedArrival) {
    return null;
  }
  const arrivalMs = Date.parse(expectedArrival);
  if (Number.isNaN(arrivalMs)) {
    return null;
  }
  const expiryMs = arrivalMs + 10000;
  return { expectedArrival, expiryMs, remainingMs: expiryMs - Date.now() };
}

function storyExpiryRemainingMs(story, lastReport) {
  const expiry = storyExpiryInfo(story, lastReport);
  return expiry ? expiry.remainingMs : null;
}

function ratioOrNA(value) {
  if (typeof value !== "number" || value <= 0) return "not available";
  return `${(value * 100).toFixed(1)}%`;
}

function numberOrNA(value) {
  return typeof value === "number" ? String(value) : "not available";
}

function escapeHTML(value) {
  return String(value ?? "not available")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
