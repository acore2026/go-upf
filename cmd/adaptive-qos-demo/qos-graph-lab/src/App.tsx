import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw, Sparkles, WandSparkles, Zap } from 'lucide-react';

type LoadMode = 'lite' | 'crowded' | 'overload';
type QosMode = 'off' | 'conventional' | 'adaptive';
type BurstState = 'idle' | 'approaching' | 'active' | 'recovering';

type Sample = {
  seq: number;
  timestampMs: number;
  qosMode: QosMode;
  demandMbps: number;
  deliveredMbps: number;
  gbrMbps: number;
  effectiveCeilingMbps: number;
  baseGbrMbps: number;
  latencyMs: number;
  baselineLatencyMs: number;
  availableBandwidthMbps: number;
  burstState: BurstState;
  degraded: boolean;
  improving: boolean;
  recentAverageDemandMbps: number;
};

type Marker = {
  seq: number;
  kind: 'load' | 'qos' | 'burst';
  label: string;
  tone?: 'neutral' | 'green' | 'yellow' | 'red';
};

type Percentiles = {
  p50: number;
  p70: number;
  p99: number;
};

type Profile = {
  label: string;
  subtitle: string;
  baseDemandMbps: number;
  burstAmplitudeMbps: number;
  baseAvailableMbps: number;
  availableDipMbps: number;
  baseLatencyMs: number;
  latencyBurstMs: number;
  baseGbrMbps: number;
  conventionalMaxGbrMbps: number;
  adaptiveMaxGbrMbps: number;
  cycleSeconds: number;
  burstCenters: number[];
  burstWidths: number[];
  phase: number;
};

const SAMPLE_INTERVAL_MS = 1000;
const WINDOW_SECONDS = 20;
const WINDOW_SAMPLES = WINDOW_SECONDS * 1000 / SAMPLE_INTERVAL_MS;
const PERCENTILE_SECONDS = 10;
const PERCENTILE_SAMPLES = PERCENTILE_SECONDS * 1000 / SAMPLE_INTERVAL_MS;
const WARMUP_SECONDS = 8;
const WARMUP_SAMPLES = WARMUP_SECONDS * 1000 / SAMPLE_INTERVAL_MS;
const CONVENTIONAL_WINDOW = 5;
const CONVENTIONAL_STEP_Mbps = 5;
const ADAPTIVE_LEAD_SECONDS = 1;
const OFF_FIXED_GBR_Mbps = 18;
const ADAPTIVE_HOLD_TICKS = 4;

const COLORS = {
  demand: '#94a3b8',
  delivered: '#1d4ed8',
  gbr: '#ca8a04',
  available: '#475569',
  latency: '#0f172a',
  spikeOutline: '#334155',
};

const PROFILES: Record<LoadMode, Profile> = {
  lite: {
    label: 'Lite',
    subtitle: 'Healthy path with a fixed GBR and smooth latency.',
    baseDemandMbps: 16,
    burstAmplitudeMbps: 5,
    baseAvailableMbps: 34,
    availableDipMbps: 1,
    baseLatencyMs: 18,
    latencyBurstMs: 4,
    baseGbrMbps: OFF_FIXED_GBR_Mbps,
    conventionalMaxGbrMbps: 24,
    adaptiveMaxGbrMbps: 24,
    cycleSeconds: 6.2,
    burstCenters: [1.5, 4.7],
    burstWidths: [0.12, 0.1],
    phase: 0.25,
  },
  crowded: {
    label: 'Crowded',
    subtitle: 'Reactive conventional QoS can recover this case, but slowly.',
    baseDemandMbps: 24,
    burstAmplitudeMbps: 12,
    baseAvailableMbps: 31,
    availableDipMbps: 11,
    baseLatencyMs: 44,
    latencyBurstMs: 40,
    baseGbrMbps: OFF_FIXED_GBR_Mbps,
    conventionalMaxGbrMbps: 40,
    adaptiveMaxGbrMbps: 44,
    cycleSeconds: 5.4,
    burstCenters: [0.95, 2.2, 4.1],
    burstWidths: [0.14, 0.12, 0.13],
    phase: 0.95,
  },
  overload: {
    label: 'Overload',
    subtitle: 'Only predictive GBR uplift can cleanly absorb the short spikes.',
    baseDemandMbps: 31,
    burstAmplitudeMbps: 21,
    baseAvailableMbps: 38,
    availableDipMbps: 19,
    baseLatencyMs: 82,
    latencyBurstMs: 112,
    baseGbrMbps: OFF_FIXED_GBR_Mbps,
    conventionalMaxGbrMbps: 46,
    adaptiveMaxGbrMbps: 56,
    cycleSeconds: 4.8,
    burstCenters: [0.95, 2.15, 3.35],
    burstWidths: [0.14, 0.13, 0.12],
    phase: 1.9,
  },
};

function App() {
  const [loadMode, setLoadMode] = useState<LoadMode>('lite');
  const [qosMode, setQosMode] = useState<QosMode>('off');
  const [running, setRunning] = useState(true);
  const [runSeed, setRunSeed] = useState(0);
  const [plannedSpikes, setPlannedSpikes] = useState<number[]>([]);
  const [samples, setSamples] = useState<Sample[]>(() => buildHistory('lite', 'off', 0, []));
  const [markers, setMarkers] = useState<Marker[]>([]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!running) {
        return;
      }

      setSamples((current) => {
        const nextSeq = current.at(-1)?.seq ?? 0;
        const next = generateSample(nextSeq + 1, current, loadMode, qosMode, runSeed, plannedSpikes);
        return [...current.slice(-(WINDOW_SAMPLES - 1)), next];
      });
    }, SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [running, loadMode, qosMode, runSeed, plannedSpikes]);

  const visibleMarkers = useMemo(() => {
    const startSeq = samples[0]?.seq ?? 0;
    const endSeq = samples.at(-1)?.seq ?? 0;
    return markers.filter((marker) => marker.seq >= startSeq && marker.seq <= endSeq);
  }, [markers, samples]);

  const recentSamples = samples.slice(-PERCENTILE_SAMPLES);
  const latest = samples.at(-1);
  const currentProfile = PROFILES[loadMode];

  const bandwidthStats = useMemo(
    () => computePercentiles(recentSamples.map((sample) => sample.deliveredMbps)),
    [recentSamples],
  );
  const latencyStats = useMemo(
    () => computePercentiles(recentSamples.map((sample) => sample.latencyMs)),
    [recentSamples],
  );

  const switchLoadMode = (mode: LoadMode) => {
    if (mode === loadMode) {
      return;
    }
    const pivotSeq = samples.at(-1)?.seq ?? 0;
    setMarkers((current) => [...current, { seq: pivotSeq, kind: 'load', label: `${PROFILES[mode].label} load`, tone: 'neutral' }]);
    setLoadMode(mode);
  };

  const switchQosMode = (mode: QosMode) => {
    if (mode === qosMode) {
      return;
    }
    const pivotSeq = samples.at(-1)?.seq ?? 0;
    setMarkers((current) => [...current, { seq: pivotSeq, kind: 'qos', label: qosLabel(mode), tone: qosTone(mode, loadMode) }]);
    setQosMode(mode);
  };

  const resetStream = () => {
    const nextSeed = runSeed + 1;
    setRunSeed(nextSeed);
    setPlannedSpikes([]);
    setSamples(buildHistory(loadMode, qosMode, nextSeed, []));
    setMarkers([]);
    setRunning(true);
  };

  const planSpike = () => {
    const baseSeq = samples.at(-1)?.seq ?? 0;
    const spikeSeq = baseSeq + 2;
    setPlannedSpikes((current) => [...current.filter((seq) => seq > baseSeq), spikeSeq]);
    setMarkers((current) => [...current, { seq: spikeSeq, kind: 'burst', label: 'Burst', tone: qosMode === 'adaptive' ? 'green' : 'red' }]);
  };

  return (
    <main className="lab-shell">
      <section className="hero">
        <div className="eyebrow">
          <Sparkles size={16} />
          <span>predictive qos simulation</span>
        </div>
        <h1>Adaptive QoS Graph Lab</h1>
        <p>
          Live samples arrive every {SAMPLE_INTERVAL_MS} ms. The charts hold the last {WINDOW_SECONDS}s,
          while the summary strip computes percentiles over the latest {PERCENTILE_SECONDS}s only.
        </p>

        <div className="control-row">
          <ControlGroup label="RAN Load" tone="load">
            {(['lite', 'crowded', 'overload'] as LoadMode[]).map((mode) => (
              <button
                key={mode}
                className={`segment-button load-${mode} ${loadMode === mode ? 'active' : ''}`}
                onClick={() => switchLoadMode(mode)}
              >
                {PROFILES[mode].label}
              </button>
            ))}
          </ControlGroup>

          <ControlGroup label="QoS Mode" tone="qos">
            {(['off', 'conventional', 'adaptive'] as QosMode[]).map((mode) => (
              <button
                key={mode}
                className={`segment-button qos-${mode} ${qosMode === mode ? 'active' : ''}`}
                onClick={() => switchQosMode(mode)}
              >
                {mode === 'adaptive' ? <WandSparkles size={14} /> : null}
                {qosShortLabel(mode)}
              </button>
            ))}
          </ControlGroup>

          <button className="btn primary" onClick={() => setRunning((current) => !current)}>
            {running ? <Pause size={16} /> : <Play size={16} />}
            {running ? 'Pause' : 'Resume'}
          </button>

          <button className="btn ghost" onClick={resetStream}>
            <RefreshCw size={16} />
            Reset
          </button>

          <button className="btn burst" onClick={planSpike}>
            <Zap size={16} />
            Burst
          </button>
        </div>

        <div className="headline-strip">
          <HeadlineMetric label="Active Ceiling" value={formatMbps(latest?.effectiveCeilingMbps ?? latest?.gbrMbps ?? currentProfile.baseGbrMbps)} />
          <HeadlineMetric label="Burst State" value={headlineBurst(latest?.burstState ?? 'idle')} />
          <HeadlineMetric label="Mode" value={`${currentProfile.label} / ${qosShortLabel(qosMode)}`} />
        </div>
      </section>

      <section className="summary-row">
        <PercentileCard title="Bandwidth" unit="Mbps" stats={bandwidthStats} />
        <PercentileCard title="Latency" unit="ms" stats={latencyStats} />
      </section>

      <section className="charts">
        <BandwidthChart
          samples={samples}
          markers={visibleMarkers}
          loadMode={loadMode}
          qosMode={qosMode}
          subtitle={currentProfile.subtitle}
          live={running}
        />
        <LatencyChart samples={samples} markers={visibleMarkers} loadMode={loadMode} qosMode={qosMode} live={running} />
      </section>
    </main>
  );
}

function ControlGroup({ label, tone, children }: { label: string; tone: 'load' | 'qos'; children: React.ReactNode }) {
  return (
    <div className="segment">
      <span className="segment-label">{label}</span>
      <div className={`segment-group ${tone}`}>{children}</div>
    </div>
  );
}

function HeadlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="headline-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PercentileCard({ title, unit, stats }: { title: string; unit: string; stats: Percentiles }) {
  return (
    <div className="panel percentile-panel">
      <div className="panel-title compact">
        <h2>{title}</h2>
        <p>Last 10s</p>
      </div>
      <div className="percentile-grid">
        <Metric label="p50" value={formatStat(stats.p50, unit)} />
        <Metric label="p70" value={formatStat(stats.p70, unit)} />
        <Metric label="p99" value={formatStat(stats.p99, unit)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BandwidthChart({
  samples,
  markers,
  loadMode,
  qosMode,
  subtitle,
  live,
}: {
  samples: Sample[];
  markers: Marker[];
  loadMode: LoadMode;
  qosMode: QosMode;
  subtitle: string;
  live: boolean;
}) {
  const width = 500;
  const height = 190;
  const pad = 24;
  const { min, max, ticks } = bandwidthScale(PROFILES[loadMode]);
  const demand = samples.map((sample) => sample.demandMbps);
  const delivered = samples.map((sample) => sample.deliveredMbps);
  const gbr = samples.map((sample) => sample.gbrMbps);
  const demandPath = linePath(demand, width, height, pad, min, max);
  const deliveredPath = linePath(delivered, width, height, pad, min, max);
  const gbrPath = linePath(gbr, width, height, pad, min, max);
  const gapPaths = gapAreaPaths(samples, width, height, pad, min, max);
  const latestX = pointX(samples.length - 1, samples.length, width, pad);
  const latestY = valueToY(delivered.at(-1) ?? 0, min, max, height, pad);

  return (
    <div className="panel chart-panel">
      <div className="panel-title">
        <div>
          <h2>Bandwidth / GBR</h2>
          <p>{subtitle}</p>
        </div>
        <span className={`mode-pill ${live ? 'live' : ''}`}>{live ? 'Live' : 'Paused'}</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="chart" aria-label="Bandwidth chart" role="img">
        {gridLines(5, height, pad).map((y) => (
          <line key={y} x1={pad} x2={width - pad} y1={y} y2={y} className="grid-line" />
        ))}
        {ticks.map((tick) => (
          <text
            key={`bandwidth-tick-${tick}`}
            x={8}
            y={valueToY(tick, min, max, height, pad) + 4}
            className="axis-label"
          >
            {tick}
          </text>
        ))}

        {markers.map((marker) => (
          <MarkerLine key={`${marker.kind}-${marker.seq}`} marker={marker} samples={samples} width={width} height={height} pad={pad} />
        ))}

        {gapPaths.map((path, index) => (
          <path key={`gap-${index}`} d={path} className={`gap-fill ${qosFillClass(qosMode, loadMode)}`} />
        ))}

        <path d={demandPath} fill="none" stroke={COLORS.demand} strokeWidth="1.05" strokeDasharray="1 5" strokeLinecap="round" />
        <path d={gbrPath} fill="none" stroke={COLORS.gbr} strokeWidth="1.5" />
        <path d={deliveredPath} fill="none" stroke={COLORS.delivered} strokeWidth="1.7" />

        <circle cx={latestX} cy={latestY} r="3.6" className="live-dot" />
      </svg>

      <div className="legend">
        <LegendChip color={COLORS.demand} label="Demand" />
        <LegendChip color={COLORS.delivered} label="Delivered" />
        <LegendChip color={COLORS.gbr} label="QoS ceiling" />
      </div>
    </div>
  );
}

function LatencyChart({
  samples,
  markers,
  loadMode,
  qosMode,
  live,
}: {
  samples: Sample[];
  markers: Marker[];
  loadMode: LoadMode;
  qosMode: QosMode;
  live: boolean;
}) {
  const width = 500;
  const height = 190;
  const pad = 24;
  const { min, max, ticks } = latencyScale(PROFILES[loadMode]);
  const baseline = samples.map((sample) => sample.baselineLatencyMs);
  const observed = samples.map((sample) => sample.latencyMs);
  const baselinePath = linePath(baseline, width, height, pad, min, max);
  const observedPath = linePath(observed, width, height, pad, min, max);
  const spikeSegments = segmentedPaths(samples, width, height, pad, min, max);
  const spikeClass = qosMode === 'adaptive' ? 'adaptive' : 'stressed';
  const latestX = pointX(samples.length - 1, samples.length, width, pad);
  const latestY = valueToY(observed.at(-1) ?? 0, min, max, height, pad);

  return (
    <div className="panel chart-panel">
      <div className="panel-title">
        <div>
          <h2>Latency</h2>
          <p>Bandwidth back-pressure shows up here as short spike outlines when QoS lags the burst.</p>
        </div>
        <span className={`mode-pill ${live ? 'live' : ''}`}>{live ? 'Live' : 'Paused'}</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="chart" aria-label="Latency chart" role="img">
        {gridLines(5, height, pad).map((y) => (
          <line key={y} x1={pad} x2={width - pad} y1={y} y2={y} className="grid-line" />
        ))}
        {ticks.map((tick) => (
          <text
            key={`latency-tick-${tick}`}
            x={8}
            y={valueToY(tick, min, max, height, pad) + 4}
            className="axis-label"
          >
            {tick}
          </text>
        ))}

        {markers.map((marker) => (
          <MarkerLine key={`${marker.kind}-${marker.seq}`} marker={marker} samples={samples} width={width} height={height} pad={pad} />
        ))}

        <path d={baselinePath} fill="none" stroke={COLORS.demand} strokeWidth="1.1" strokeDasharray="6 5" />
        <path d={observedPath} fill="none" stroke={COLORS.latency} strokeWidth="1.7" />
        {spikeSegments.map((segment, index) => (
          <path
            key={`spike-${index}`}
            d={segment}
            fill="none"
            strokeWidth="2.6"
            className={`spike-outline ${spikeClass}`}
          />
        ))}

        <circle cx={latestX} cy={latestY} r="3.6" className="live-dot" />
      </svg>

      <div className="legend">
        <LegendChip color={COLORS.demand} label="Baseline" />
        <LegendChip color={COLORS.latency} label="Observed" />
        <LegendChip color={qosMode === 'adaptive' ? '#16a34a' : '#dc2626'} label="Spike outline" />
      </div>
    </div>
  );
}

function MarkerLine({
  marker,
  samples,
  width,
  height,
  pad,
}: {
  marker: Marker;
  samples: Sample[];
  width: number;
  height: number;
  pad: number;
}) {
  const x = markerX(marker.seq, samples, width, pad);
  if (x === null) {
    return null;
  }

  return (
    <>
      <line x1={x} x2={x} y1={pad} y2={height - pad} className={`marker-line ${marker.kind} ${marker.tone ?? 'neutral'}`} />
      <text
        x={x + 6}
        y={marker.kind === 'load' ? pad + 12 : pad + 26}
        className={`marker-label ${marker.kind} ${marker.tone ?? 'neutral'}`}
      >
        {marker.label}
      </text>
    </>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="legend-chip">
      <i style={{ background: color }} />
      {label}
    </span>
  );
}

function buildHistory(loadMode: LoadMode, qosMode: QosMode, runSeed: number, plannedSpikes: number[]) {
  const samples: Sample[] = [];
  for (let seq = 0; seq < Math.max(WARMUP_SAMPLES, WINDOW_SAMPLES); seq += 1) {
    samples.push(generateSample(seq, samples, loadMode, qosMode, runSeed, plannedSpikes));
  }
  return samples.slice(-WINDOW_SAMPLES);
}

function generateSample(seq: number, history: Sample[], loadMode: LoadMode, qosMode: QosMode, runSeed: number, plannedSpikes: number[]): Sample {
  const profile = PROFILES[loadMode];
  const timeSeconds = seq * SAMPLE_INTERVAL_MS / 1000 + runSeed * 0.73;
  const burstNow = burstIntensity(seq, plannedSpikes);
  const burstLead = burstIntensity(seq + ADAPTIVE_LEAD_SECONDS, plannedSpikes);
  const demandMbps = demandAtTime(timeSeconds, profile, seq, plannedSpikes);

  const availableBandwidthMbps = deriveAvailable(profile, loadMode, burstNow, timeSeconds);
  const previous = history.at(-1);
  const burstState = deriveBurstState(burstNow, burstLead, previous?.burstState ?? 'idle');
  const recentAverageDemandMbps = average(history.slice(-CONVENTIONAL_WINDOW).map((sample) => sample.demandMbps).concat(demandMbps));
  const gbrTarget = deriveGbrTarget(seq, profile, loadMode, qosMode, previous, recentAverageDemandMbps, plannedSpikes);
  const gbrMbps = deriveCurrentGbr(qosMode, previous, gbrTarget);
  const effectiveCeiling = deriveEffectiveCeiling(loadMode, qosMode, availableBandwidthMbps, gbrMbps);
  const deliveredMbps = deriveDelivered(loadMode, demandMbps, effectiveCeiling);
  const baselineLatencyMs = deriveBaselineLatency(profile, loadMode, timeSeconds);
  const latencyMs = deriveLatency(profile, loadMode, qosMode, baselineLatencyMs, burstNow, demandMbps - deliveredMbps, burstLead);
  const degraded = demandMbps - deliveredMbps > (loadMode === 'overload' ? 2.6 : loadMode === 'crowded' ? 1.4 : 0.45) || latencyMs - baselineLatencyMs > (loadMode === 'overload' ? 18 : loadMode === 'crowded' ? 10 : 3);
  const improving = previous !== undefined && qosMode !== 'off' && latencyMs < previous.latencyMs - (loadMode === 'lite' ? 0.8 : 2.2);

  return {
    seq,
    timestampMs: seq * SAMPLE_INTERVAL_MS,
    qosMode,
    demandMbps,
    deliveredMbps,
    gbrMbps,
    effectiveCeilingMbps: effectiveCeiling,
    baseGbrMbps: profile.baseGbrMbps,
    latencyMs,
    baselineLatencyMs,
    availableBandwidthMbps,
    burstState,
    degraded,
    improving,
    recentAverageDemandMbps,
  };
}

function deriveAvailable(profile: Profile, loadMode: LoadMode, burstNow: number, timeSeconds: number) {
  if (loadMode === 'lite') {
    return profile.baseAvailableMbps + Math.max(0, Math.sin(timeSeconds * 0.35 + profile.phase)) * 0.6;
  }

  const wobble = Math.max(0, Math.sin(timeSeconds * 0.64 + profile.phase * 0.4)) * (loadMode === 'overload' ? 1.6 : 0.8);
  return Math.max(6, profile.baseAvailableMbps - burstNow * profile.availableDipMbps - wobble);
}

function deriveGbrTarget(
  seq: number,
  profile: Profile,
  loadMode: LoadMode,
  qosMode: QosMode,
  previous: Sample | undefined,
  recentAverageDemandMbps: number,
  plannedSpikes: number[],
) {
  if (loadMode === 'lite') {
    return profile.baseGbrMbps;
  }

  if (qosMode === 'off') {
    return OFF_FIXED_GBR_Mbps;
  }

  if (qosMode === 'conventional') {
    if (!previous) {
      return OFF_FIXED_GBR_Mbps;
    }

    const shouldUpdate = seq % 5 === 0;
    if (!shouldUpdate) {
      return previous.gbrMbps;
    }

    const coarseTarget = roundUpStep(Math.max(OFF_FIXED_GBR_Mbps, recentAverageDemandMbps + 4), CONVENTIONAL_STEP_Mbps);
    return clamp(coarseTarget, OFF_FIXED_GBR_Mbps, profile.conventionalMaxGbrMbps);
  }

  const activeAdaptiveSpike = plannedSpikes.find((spikeSeq) => seq >= spikeSeq - 1 && seq <= spikeSeq + ADAPTIVE_HOLD_TICKS - 2);

  if (activeAdaptiveSpike !== undefined) {
    const predictiveTarget = profile.baseDemandMbps + profile.burstAmplitudeMbps + (loadMode === 'overload' ? 4 : 3);
    return clamp(predictiveTarget, OFF_FIXED_GBR_Mbps, profile.adaptiveMaxGbrMbps);
  }

  return clamp(profile.baseDemandMbps + 3, OFF_FIXED_GBR_Mbps, profile.adaptiveMaxGbrMbps);
}

function deriveCurrentGbr(qosMode: QosMode, previous: Sample | undefined, gbrTarget: number) {
  if (!previous) {
    return gbrTarget;
  }

  const startingPoint = previous.gbrMbps;
  const lowerBound = OFF_FIXED_GBR_Mbps;

  if (qosMode === 'conventional') {
    const next =
      gbrTarget >= startingPoint
        ? startingPoint + (gbrTarget - startingPoint) * 0.55
        : startingPoint + (gbrTarget - startingPoint) * 0.12;
    return clamp(next, lowerBound, Math.max(startingPoint, gbrTarget));
  }

  if (qosMode === 'adaptive') {
    return clamp(gbrTarget, lowerBound, Math.max(startingPoint, gbrTarget));
  }

  return Math.max(OFF_FIXED_GBR_Mbps, startingPoint + (OFF_FIXED_GBR_Mbps - startingPoint) * 0.1);
}

function deriveEffectiveCeiling(
  loadMode: LoadMode,
  qosMode: QosMode,
  availableBandwidthMbps: number,
  gbrMbps: number,
) {
  if (loadMode === 'lite') {
    return Math.max(availableBandwidthMbps, gbrMbps);
  }

  if (qosMode === 'off') {
    return Math.min(availableBandwidthMbps, gbrMbps);
  }

  if (qosMode === 'conventional') {
    return Math.min(availableBandwidthMbps, gbrMbps);
  }

  return gbrMbps;
}

function deriveDelivered(loadMode: LoadMode, demandMbps: number, effectiveCeiling: number) {
  if (loadMode === 'lite') {
    return demandMbps;
  }

  return Math.max(2, Math.min(demandMbps, effectiveCeiling));
}

function deriveBaselineLatency(profile: Profile, loadMode: LoadMode, timeSeconds: number) {
  if (loadMode === 'lite') {
    return profile.baseLatencyMs + Math.max(0, Math.sin(timeSeconds * 0.3 + profile.phase)) * 0.8;
  }

  return profile.baseLatencyMs + Math.max(0, Math.sin(timeSeconds * 0.55 + profile.phase * 0.4)) * (loadMode === 'overload' ? 5 : 3);
}

function deriveLatency(
  profile: Profile,
  loadMode: LoadMode,
  qosMode: QosMode,
  baselineLatencyMs: number,
  burstNow: number,
  throughputGap: number,
  burstLead: number,
) {
  if (loadMode === 'lite') {
    return baselineLatencyMs + burstNow * 0.8;
  }

  const burstPenalty =
    qosMode === 'adaptive'
      ? profile.latencyBurstMs * burstNow * (loadMode === 'overload' ? 0.03 : 0.045)
      : qosMode === 'conventional'
        ? profile.latencyBurstMs * burstNow * (loadMode === 'overload' ? 0.48 : 0.22)
        : profile.latencyBurstMs * burstNow * (loadMode === 'overload' ? 0.85 : 0.42);
  const queuePenalty =
    qosMode === 'adaptive'
      ? Math.max(0, throughputGap) * 0.12
      : qosMode === 'conventional'
        ? Math.max(0, throughputGap) * (loadMode === 'overload' ? 9.2 : 4.8)
        : Math.max(0, throughputGap) * 7.4;
  const predictiveCredit = qosMode === 'adaptive' ? burstLead * (loadMode === 'overload' ? 10 : 5) : 0;

  return Math.max(8, baselineLatencyMs + burstPenalty + queuePenalty - predictiveCredit);
}

function deriveBurstState(current: number, future: number, previous: BurstState): BurstState {
  if (future > 0.45 && current < 0.3) {
    return 'approaching';
  }
  if (current > 0.35) {
    return 'active';
  }
  if (previous === 'active' && current < 0.18) {
    return 'recovering';
  }
  return 'idle';
}

function burstIntensity(seq: number, plannedSpikes: number[]) {
  return plannedSpikes.some((spikeSeq) => spikeSeq === seq) ? 1 : 0;
}

function demandAtTime(timeSeconds: number, profile: Profile, seq: number, plannedSpikes: number[]) {
  const burst = burstIntensity(seq, plannedSpikes);
  const ripple = Math.sin(timeSeconds * 0.52 + profile.phase) * 0.42 + Math.sin(timeSeconds * 1.7 + profile.phase * 0.6) * 0.12;
  return clamp(
    profile.baseDemandMbps + burst * profile.burstAmplitudeMbps + ripple,
    2,
    profile.baseDemandMbps + profile.burstAmplitudeMbps + 2.5,
  );
}

function computePercentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p70: percentile(sorted, 0.7),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted: number[], ratio: number) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

function gapAreaPaths(samples: Sample[], width: number, height: number, pad: number, min: number, max: number) {
  const groups = consecutiveGroups(samples, (sample) => sample.degraded);
  return groups.map((group) => {
    const top = group
      .map((sample, index) => {
        const x = pointX(indexOfSeq(samples, sample.seq), samples.length, width, pad);
        const y = valueToY(sample.demandMbps, min, max, height, pad);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    const bottom = [...group]
      .reverse()
      .map((sample) => {
        const x = pointX(indexOfSeq(samples, sample.seq), samples.length, width, pad);
        const y = valueToY(sample.deliveredMbps, min, max, height, pad);
        return `L ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    return `${top} ${bottom} Z`;
  });
}

function segmentedPaths(
  samples: Sample[],
  width: number,
  height: number,
  pad: number,
  min: number,
  max: number,
) {
  const groups = consecutiveGroups(samples, (sample) => sample.latencyMs - sample.baselineLatencyMs > 6);

  return groups.map((group) =>
    group
      .map((sample, index) => {
        const x = pointX(indexOfSeq(samples, sample.seq), samples.length, width, pad);
        const y = valueToY(sample.latencyMs, min, max, height, pad);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' '),
  );
}

function consecutiveGroups(samples: Sample[], predicate: (sample: Sample) => boolean) {
  const groups: Sample[][] = [];
  let current: Sample[] = [];

  for (const sample of samples) {
    if (predicate(sample)) {
      current.push(sample);
    } else if (current.length > 1) {
      groups.push(current);
      current = [];
    } else {
      current = [];
    }
  }

  if (current.length > 1) {
    groups.push(current);
  }

  return groups;
}

function linePath(values: number[], width: number, height: number, pad: number, min: number, max: number) {
  return values
    .map((value, index) => {
      const x = pointX(index, values.length, width, pad);
      const y = valueToY(value, min, max, height, pad);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function markerX(seq: number, samples: Sample[], width: number, pad: number) {
  const start = samples[0]?.seq ?? 0;
  const end = samples.at(-1)?.seq ?? 0;
  if (seq < start || seq > end) {
    return null;
  }
  const ratio = (seq - start) / Math.max(end - start, 1);
  return pad + ratio * (width - pad * 2);
}

function pointX(index: number, count: number, width: number, pad: number) {
  return pad + (index / Math.max(count - 1, 1)) * (width - pad * 2);
}

function valueToY(value: number, min: number, max: number, height: number, pad: number) {
  const span = Math.max(max - min, 1);
  const normalized = (value - min) / span;
  return height - pad - normalized * (height - pad * 2);
}

function gridLines(count: number, height: number, pad: number) {
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    return pad + ratio * (height - pad * 2);
  });
}

function bandwidthScale(profile: Profile) {
  const max = roundUpStep(Math.max(profile.adaptiveMaxGbrMbps, profile.baseDemandMbps + profile.burstAmplitudeMbps + 4), 10);
  const ticks = Array.from({ length: 5 }, (_, index) => Math.round((max / 4) * (4 - index)));
  return { min: 0, max, ticks };
}

function latencyScale(profile: Profile) {
  const min = Math.max(0, Math.floor(profile.baseLatencyMs * 0.7 / 10) * 10);
  const max = roundUpStep(profile.baseLatencyMs + profile.latencyBurstMs + 40, 20);
  const ticks = Array.from({ length: 5 }, (_, index) => Math.round(max - ((max - min) / 4) * index));
  return { min, max, ticks };
}

function qosFillClass(qosMode: QosMode, loadMode: LoadMode) {
  if (qosMode === 'adaptive') {
    return 'adaptive';
  }
  if (qosMode === 'conventional') {
    return 'conventional';
  }
  if (loadMode === 'lite') {
    return 'off-lite';
  }
  return 'off-stressed';
}

function qosTone(qosMode: QosMode, loadMode: LoadMode): Marker['tone'] {
  if (qosMode === 'adaptive') {
    return 'green';
  }
  if (qosMode === 'conventional') {
    return 'yellow';
  }
  return loadMode === 'lite' ? 'neutral' : 'red';
}

function indexOfSeq(samples: Sample[], seq: number) {
  return samples.findIndex((sample) => sample.seq === seq);
}

function qosLabel(mode: QosMode) {
  if (mode === 'off') {
    return 'QoS Off';
  }
  if (mode === 'conventional') {
    return 'Conventional QoS';
  }
  return 'Adaptive QoS';
}

function qosShortLabel(mode: QosMode) {
  if (mode === 'off') {
    return 'Off';
  }
  if (mode === 'conventional') {
    return 'Conventional';
  }
  return 'Adaptive';
}

function headlineBurst(state: BurstState) {
  if (state === 'approaching') {
    return 'Burst incoming';
  }
  if (state === 'active') {
    return 'Burst active';
  }
  if (state === 'recovering') {
    return 'Recovering';
  }
  return 'Stable';
}

function formatMbps(value: number) {
  return `${value.toFixed(1)} Mbps`;
}

function formatStat(value: number, unit: string) {
  return unit === 'Mbps' ? `${value.toFixed(1)} ${unit}` : `${value.toFixed(0)} ${unit}`;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundUpStep(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default App;
