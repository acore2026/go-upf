import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Cpu,
  Play,
  Radio,
  Router,
  Smartphone,
  Square,
} from 'lucide-react';
import {
  Background,
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn, formatBitrate, formatBytes } from './utils';

type DemoStage =
  | 'idle'
  | 'triggered'
  | 'ul_qos_prep'
  | 'ul_sending'
  | 'service_path_selected'
  | 'processing'
  | 'dl_qos_prep'
  | 'dl_sending'
  | 'complete'
  | 'stopped';

type StageDirection = 'UL' | 'DL' | 'BIDIR' | 'NONE';
type NodeKind = 'endpoint' | 'access' | 'upf' | 'router' | 'service';
type NodeRole = 'IDLE' | 'ANCHOR' | 'SERVICE' | 'ANCHOR + SERVICE';
type LinkKind = 'baseline' | 'burst' | 'optimized';

type DemoNodeData = {
  label: string;
  kind: NodeKind;
  location?: string;
  status: string;
  sideTitle?: string;
  sideValue?: string;
  meta?: string;
  role?: NodeRole;
  accent?: 'blue' | 'cyan' | 'green' | 'amber' | 'pink';
  active?: boolean;
  emphasis?: boolean;
  badges?: string[];
  ports?: Array<{ id: string; label: string; side: 'left' | 'right' }>;
};

type DemoEdgeData = {
  label: string;
  kind: LinkKind;
  state: 'idle' | 'active' | 'selected';
  detail: string;
};

type RegionNodeData = {
  label: string;
  tone: 'shenzhen' | 'backbone' | 'shanghai';
};

type DemoEvent = {
  id: string;
  stage: DemoStage;
  title: string;
  detail: string;
  tone: 'neutral' | 'good' | 'accent';
};

type StageDefinition = {
  stage: DemoStage;
  durationMs: number;
  status: string;
  qosDirection: StageDirection;
  qosProfile: string;
  qosState: string;
  burstState: string;
  burstTargetBitrate: number;
  burstSize: number;
  pathSummary: string;
  pathScore: string;
  latency: string;
  bandwidth: string;
  resultStatus: string;
  resultSummary: string;
  event: DemoEvent;
};

const stageSequence: StageDefinition[] = [
  {
    stage: 'triggered',
    durationMs: 1400,
    status: 'Workflow initialized',
    qosDirection: 'NONE',
    qosProfile: 'Standby',
    qosState: 'Monitoring burst signature',
    burstState: 'Task accepted',
    burstTargetBitrate: 0,
    burstSize: 0,
    pathSummary: 'Baseline route retained',
    pathScore: '52 / 100',
    latency: '31 ms',
    bandwidth: '1.8 Gbps',
    resultStatus: 'Awaiting uplink',
    resultSummary: 'Vision request queued for remote inference',
    event: {
      id: 'mission-armed',
      stage: 'triggered',
      title: 'Task request received',
      detail: 'Robot vision workload registered. Monitoring burst intent before temporary assurance is applied.',
      tone: 'neutral',
    },
  },
  {
    stage: 'ul_qos_prep',
    durationMs: 1800,
    status: 'UL assurance prep',
    qosDirection: 'UL',
    qosProfile: 'Burst UL Gold',
    qosState: 'Temporary UL assurance active',
    burstState: 'Burst predicted',
    burstTargetBitrate: 480_000_000,
    burstSize: 13_200_000,
    pathSummary: 'A-UP locked at Access City',
    pathScore: '71 / 100',
    latency: '24 ms',
    bandwidth: '3.4 Gbps',
    resultStatus: 'Uplink about to start',
    resultSummary: 'RAN and access UPF reserve headroom for one-shot image burst',
    event: {
      id: 'ul-qos',
      stage: 'ul_qos_prep',
      title: 'Flexible QoS activated for uplink',
      detail: 'Burst estimate is published before transmission. Temporary UL assurance is active at the gNB path.',
      tone: 'accent',
    },
  },
  {
    stage: 'ul_sending',
    durationMs: 1900,
    status: 'UL burst in flight',
    qosDirection: 'UL',
    qosProfile: 'Burst UL Gold',
    qosState: 'UL burst being delivered',
    burstState: 'Uplink sending',
    burstTargetBitrate: 480_000_000,
    burstSize: 13_200_000,
    pathSummary: 'A-UP handles initial anchor',
    pathScore: '76 / 100',
    latency: '22 ms',
    bandwidth: '3.8 Gbps',
    resultStatus: 'Frames entering core',
    resultSummary: 'Image burst leaves the device and crosses the access path under temporary UL treatment',
    event: {
      id: 'ul-send',
      stage: 'ul_sending',
      title: 'Burst enters user plane',
      detail: 'The current path is still anchored close to the UE while the system evaluates a better service route.',
      tone: 'good',
    },
  },
  {
    stage: 'service_path_selected',
    durationMs: 2100,
    status: 'Service path optimized',
    qosDirection: 'UL',
    qosProfile: 'Burst UL Gold',
    qosState: 'UL assurance maintained',
    burstState: 'Service route selected',
    burstTargetBitrate: 480_000_000,
    burstSize: 13_200_000,
    pathSummary: 'A-UP Access City -> S-UP Service City',
    pathScore: '93 / 100',
    latency: '14 ms',
    bandwidth: '5.6 Gbps',
    resultStatus: 'Optimized route active',
    resultSummary: 'A-UP remains near the UE while traffic is redirected through an S-UP close to the AI service',
    event: {
      id: 'service-select',
      stage: 'service_path_selected',
      title: 'A-UP / S-UP roles assigned',
      detail: 'The network keeps the anchor UPF near the user and inserts a service UPF close to the remote inference endpoint.',
      tone: 'accent',
    },
  },
  {
    stage: 'processing',
    durationMs: 2200,
    status: 'Remote inference running',
    qosDirection: 'BIDIR',
    qosProfile: 'Burst UL Gold',
    qosState: 'UL assurance winding down',
    burstState: 'Server processing',
    burstTargetBitrate: 240_000_000,
    burstSize: 13_200_000,
    pathSummary: 'Optimized service chain stable',
    pathScore: '95 / 100',
    latency: '12 ms',
    bandwidth: '5.9 Gbps',
    resultStatus: 'Object set resolved',
    resultSummary: 'Remote inference server is producing mission labels from the uploaded scene',
    event: {
      id: 'processing',
      stage: 'processing',
      title: 'Inference workload executing',
      detail: 'The service-side UPF remains active while the central AI server processes the burst and prepares a compact response.',
      tone: 'good',
    },
  },
  {
    stage: 'dl_qos_prep',
    durationMs: 1700,
    status: 'DL assurance prep',
    qosDirection: 'DL',
    qosProfile: 'Result DL Priority',
    qosState: 'Temporary DL assurance active',
    burstState: 'Return path prepared',
    burstTargetBitrate: 120_000_000,
    burstSize: 1_600_000,
    pathSummary: 'Optimized service path preserved',
    pathScore: '92 / 100',
    latency: '13 ms',
    bandwidth: '4.7 Gbps',
    resultStatus: 'Result package staged',
    resultSummary: 'The return payload is smaller but latency-sensitive, so the downlink burst is prepared separately',
    event: {
      id: 'dl-qos',
      stage: 'dl_qos_prep',
      title: 'Flexible QoS activated for downlink',
      detail: 'Downlink assurance is armed independently from the uplink burst to protect the result delivery window.',
      tone: 'accent',
    },
  },
  {
    stage: 'dl_sending',
    durationMs: 1800,
    status: 'DL burst in flight',
    qosDirection: 'DL',
    qosProfile: 'Result DL Priority',
    qosState: 'DL burst being delivered',
    burstState: 'Downlink sending',
    burstTargetBitrate: 120_000_000,
    burstSize: 1_600_000,
    pathSummary: 'S-UP returning via A-UP anchor',
    pathScore: '89 / 100',
    latency: '15 ms',
    bandwidth: '4.2 Gbps',
    resultStatus: 'Result crossing access network',
    resultSummary: 'Inference summary returns through the selected service path and lands back on the local anchor',
    event: {
      id: 'dl-send',
      stage: 'dl_sending',
      title: 'Result burst delivered',
      detail: 'The return path stays optimized while the local anchor protects continuity back to the device.',
      tone: 'good',
    },
  },
  {
    stage: 'complete',
    durationMs: 0,
    status: 'Workflow complete',
    qosDirection: 'NONE',
    qosProfile: 'Released',
    qosState: 'Temporary assurance released',
    burstState: 'Delivery complete',
    burstTargetBitrate: 0,
    burstSize: 0,
    pathSummary: 'Route released to baseline',
    pathScore: 'Baseline restored',
    latency: '28 ms',
    bandwidth: '1.8 Gbps',
    resultStatus: 'Preview ready',
    resultSummary: 'Detected assets: robot dog, pallet, warning cone, worker',
    event: {
      id: 'complete',
      stage: 'complete',
      title: 'Temporary assurance released',
      detail: 'UL and DL burst treatment ends after delivery. The path falls back to baseline while the result stays on screen.',
      tone: 'good',
    },
  },
];

const stageIndexById = new Map(stageSequence.map((item, index) => [item.stage, index]));
const nodeTypes: NodeTypes = { mission: MissionNode, region: RegionNode };

const kindMeta: Record<NodeKind, { icon: typeof Smartphone; tint: string }> = {
  endpoint: { icon: Smartphone, tint: 'var(--node-blue)' },
  access: { icon: Radio, tint: 'var(--node-green)' },
  upf: { icon: Router, tint: 'var(--node-cyan)' },
  router: { icon: Activity, tint: 'var(--node-amber)' },
  service: { icon: Cpu, tint: 'var(--node-pink)' },
};

export default function App() {
  return (
    <ReactFlowProvider>
      <MissionControl />
    </ReactFlowProvider>
  );
}

function MissionControl() {
  const [missionState, setMissionState] = useState<'idle' | 'running' | 'complete' | 'stopped'>('idle');
  const [stage, setStage] = useState<DemoStage>('idle');

  useEffect(() => {
    if (missionState !== 'running') return;

    const currentIndex = stageIndexById.get(stage);
    const nextIndex = stage === 'idle' ? 0 : currentIndex === undefined ? 0 : currentIndex + 1;

    if (nextIndex >= stageSequence.length) {
      setMissionState('complete');
      setStage('complete');
      return;
    }

    const delay = stage === 'idle' ? 80 : stageSequence[currentIndex ?? 0].durationMs;
    const timeout = window.setTimeout(() => {
      const nextStage = stageSequence[nextIndex].stage;
      setStage(nextStage);
      if (nextStage === 'complete') setMissionState('complete');
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [missionState, stage]);

  const activeStage = useMemo<StageDefinition | null>(() => {
    if (stage === 'idle' || stage === 'stopped') return null;
    return stageSequence[stageIndexById.get(stage) ?? 0] ?? null;
  }, [stage]);

  const visibleEvents = useMemo(() => {
    if (stage === 'idle') return [];
    if (stage === 'stopped') {
      return [
        {
          id: 'stopped',
          stage: 'stopped' as DemoStage,
          title: 'Demo stopped',
          detail: 'Playback was stopped by the operator. The dashboard returns to standby while keeping the topology visible.',
          tone: 'neutral' as const,
        },
      ];
    }

    const lastStageIndex = stageIndexById.get(stage) ?? stageSequence.length - 1;
    return stageSequence.slice(0, lastStageIndex + 1).map((item) => item.event).reverse();
  }, [stage]);

  const statusLabel =
    missionState === 'idle'
      ? 'Standby'
      : missionState === 'stopped'
        ? 'Stopped'
        : activeStage?.status || 'Workflow complete';

  const snapshot = buildSnapshot(stage, activeStage);
  const graph = useMemo(() => buildGraph(snapshot), [snapshot]);

  const handleTrigger = () => {
    setMissionState('running');
    setStage('idle');
  };

  const handleStop = () => {
    setMissionState('stopped');
    setStage('stopped');
  };

  return (
    <div className="mission-shell">
      <div className="mission-grid" />

      <header className="mission-header">
        <div className="mission-header-compact">
          <p className="mission-kicker">Adaptive QoS Topology</p>
        </div>

        <div className="mission-toolbar">
          <div className="status-cluster">
            <StatusBadge label={statusLabel} tone={missionState === 'running' ? 'live' : missionState === 'complete' ? 'good' : 'idle'} />
            <StatusBadge label={snapshot.direction === 'NONE' ? 'No burst' : `${snapshot.direction} traffic`} tone="accent" />
            <StatusBadge label={snapshot.serviceUpf === 'Pending' || snapshot.serviceUpf === 'Not selected' ? 'Single path' : 'Dual-UPF active'} tone="idle" />
          </div>

          <div className="toolbar-actions">
            <button className="control-button control-button-primary" onClick={handleTrigger}>
              <Play size={16} />
              Start demo
            </button>
            <button className="control-button" onClick={handleStop}>
              <Square size={16} />
              Reset
            </button>
          </div>
        </div>
      </header>

      <main className="mission-main">
        <section className="canvas-panel">
          <div className="canvas-header">
            <div>
              <p className="panel-kicker">Active Topology</p>
              <h2>Service-path routing workspace</h2>
            </div>
          </div>

        <div className="canvas-shell">
          <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={{ mission: MissionEdge }}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              nodesConnectable={false}
              nodesDraggable={false}
              nodesFocusable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnDoubleClick={false}
              zoomOnScroll
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={36} size={1} color="rgba(95, 126, 161, 0.16)" />
            </ReactFlow>
          </div>
        </section>

        <aside className="focus-panel">
          <div className="overlay-panel">
            <PanelTitle eyebrow="QoS Control" title={snapshot.qosState} />
            <StatRow label="Direction" value={snapshot.direction} />
            <StatRow label="Profile" value={snapshot.qosProfile} />
            <StatRow label="Burst state" value={snapshot.burstState} />
            <StatRow label="Target bitrate" value={formatBitrate(snapshot.targetBitrate)} />
          </div>

          <div className="overlay-panel">
            <PanelTitle eyebrow="Routing Decision" title={snapshot.activePathLabel} />
            <StatRow label="Anchor UPF" value={snapshot.anchorUpf} />
            <StatRow label="Service UPF" value={snapshot.serviceUpf} />
            <StatRow label="Path score" value={snapshot.pathScore} />
            <StatRow label="Latency / BW" value={`${snapshot.latency} / ${snapshot.bandwidth}`} />
          </div>

          <div className="overlay-panel">
            <PanelTitle eyebrow="Traffic Snapshot" title={snapshot.taskTitle} />
            <StatRow label="Payload" value={formatBytes(snapshot.burstSize)} />
            <StatRow label="Stage" value={statusLabel} />
            <StatRow label="Return window" value={snapshot.returnWindow} />
          </div>

          <div className="overlay-panel">
            <PanelTitle eyebrow="Inference Output" title={snapshot.resultStatus} />
            <div className="result-preview">
              <p>{snapshot.resultSummary}</p>
            </div>
          </div>
        </aside>
      </main>

      <section className="bottom-panel">
        <div className="bottom-card">
          <PanelTitle eyebrow="Stage Timeline" title="Workflow trace" />
          <div className="timeline-strip">
            <TimelineStep label="Start" active={stage !== 'idle' && stage !== 'stopped'} complete={stage !== 'idle' && stage !== 'stopped'} />
            <TimelineStep label="UL QoS" active={stage === 'ul_qos_prep'} complete={hasReached(stage, 'ul_qos_prep')} />
            <TimelineStep label="UL Send" active={stage === 'ul_sending'} complete={hasReached(stage, 'ul_sending')} />
            <TimelineStep label="Path Select" active={stage === 'service_path_selected'} complete={hasReached(stage, 'service_path_selected')} />
            <TimelineStep label="Processing" active={stage === 'processing'} complete={hasReached(stage, 'processing')} />
            <TimelineStep label="DL QoS" active={stage === 'dl_qos_prep'} complete={hasReached(stage, 'dl_qos_prep')} />
            <TimelineStep label="DL Send" active={stage === 'dl_sending'} complete={hasReached(stage, 'dl_sending')} />
            <TimelineStep label="Complete" active={stage === 'complete'} complete={stage === 'complete'} />
          </div>
        </div>

        <div className="bottom-card">
          <PanelTitle eyebrow="Activity Feed" title={`${visibleEvents.length} activity events`} />
          <div className="event-feed">
            {visibleEvents.length === 0 ? (
              <div className="event-empty">Start the demo to populate the staged activity feed.</div>
            ) : (
              visibleEvents.map((event) => (
                <div key={event.id} className={cn('event-row', `event-row-${event.tone}`)}>
                  <div className="event-dot" />
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function MissionNode({ data }: NodeProps<Node<DemoNodeData>>) {
  const meta = kindMeta[data.kind];
  const Icon = meta.icon;
  const isRouter = data.kind === 'router';
  const isUpf = data.kind === 'upf';
  const infoPrimary = data.sideTitle ?? data.status;
  const infoSecondary = data.sideValue ?? (data.role && data.role !== 'IDLE' ? data.role : (data.badges || [])[0]);
  const upfAnchorActive = data.role === 'ANCHOR' || data.role === 'ANCHOR + SERVICE';
  const upfServiceActive = data.role === 'SERVICE' || data.role === 'ANCHOR + SERVICE';

  return (
    <div
      className={cn(
        'mission-node-shell',
        isRouter && 'mission-node-shell-router',
      )}
      style={{ '--node-tint': meta.tint } as React.CSSProperties}
    >
      {isUpf ? (
        <>
          {data.ports?.map((port, index) => {
            const offset = port.side === 'left' ? { top: `${32 + index * 26}%`, left: -8 } : { top: `${32 + index * 26}%`, right: -8 };
            return (
              <Handle
                key={port.id}
                id={port.id}
                type={port.side === 'left' ? 'target' : 'source'}
                position={port.side === 'left' ? Position.Left : Position.Right}
                className="mission-handle mission-handle-upf"
                style={offset}
              />
            );
          })}
        </>
      ) : (
        <>
          <Handle type="target" position={Position.Left} className="mission-handle" />
          <Handle type="source" position={Position.Right} className="mission-handle" />
        </>
      )}

      <div
        className={cn(
          'mission-node',
          isRouter && 'mission-node-router',
          isUpf && 'mission-node-upf',
          data.active && 'mission-node-active',
          data.emphasis && 'mission-node-emphasis',
        )}
      >
        <div className="mission-node-head">
          <div className="mission-node-icon">
            <Icon size={18} />
          </div>
          <div className="mission-node-copy">
            <strong>{data.label}</strong>
          </div>
        </div>

        {isUpf && (
          <div className="mission-node-duo">
            <div className={cn('mission-node-duo-card', upfAnchorActive && 'mission-node-duo-card-active')}>
              <span>A-UPF</span>
            </div>
            <div className={cn('mission-node-duo-card', upfServiceActive && 'mission-node-duo-card-active service')}>
              <span>S-UPF</span>
            </div>
          </div>
        )}

      </div>

      {!isRouter && (
        <div className="mission-node-aside">
          <span className="mission-node-aside-primary">{infoPrimary}</span>
          {infoSecondary ? <strong className="mission-node-aside-secondary">{infoSecondary}</strong> : null}
        </div>
      )}
    </div>
  );
}

function MissionEdge(props: EdgeProps<Edge<DemoEdgeData>>) {
  const [path] = getBezierPath(props);
  const state = props.data?.state || 'idle';
  const kind = props.data?.kind || 'baseline';

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={props.markerEnd}
        style={{
          stroke: edgeColor(kind, state),
          strokeWidth: state === 'selected' ? 5 : state === 'active' ? 3.6 : 2.4,
          strokeOpacity: state === 'idle' ? 0.55 : 0.98,
          strokeDasharray: kind === 'baseline' ? '10 8' : kind === 'burst' ? '18 8' : undefined,
        }}
      />
    </>
  );
}

function RegionNode({ data }: NodeProps<Node<RegionNodeData>>) {
  return (
    <div className={cn('region-node', `region-node-${data.tone}`)}>
      <span>{data.label}</span>
    </div>
  );
}

function PanelTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="panel-title">
      <p>{eyebrow}</p>
      <h3>{title}</h3>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: 'idle' | 'live' | 'good' | 'accent' }) {
  return <span className={cn('status-badge', `status-badge-${tone}`)}>{label}</span>;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TimelineStep({
  active,
  complete,
  label,
}: {
  active: boolean;
  complete: boolean;
  label: string;
}) {
  return (
    <div className={cn('timeline-step', active && 'timeline-step-active', complete && 'timeline-step-complete')}>
      <span className="timeline-step-dot" />
      <strong>{label}</strong>
    </div>
  );
}

function buildSnapshot(stage: DemoStage, activeStage: StageDefinition | null) {
  const idleSnapshot = {
    direction: 'NONE' as StageDirection,
    qosProfile: 'Standby',
    qosState: 'No temporary assurance',
    burstState: 'Waiting for trigger',
    targetBitrate: 0,
    burstSize: 0,
    pathScore: '52 / 100',
    latency: '31 ms',
    bandwidth: '1.8 Gbps',
    anchorUpf: 'UPF Access City',
    serviceUpf: 'Not selected',
    activePathLabel: 'Baseline path',
    taskTitle: 'Remote vision workflow',
    resultStatus: 'Standby',
    resultSummary: 'No preview yet. Trigger the mission to start the demo.',
    returnWindow: 'Not armed',
    stage,
  };

  if (stage === 'stopped') {
    return {
      ...idleSnapshot,
      qosState: 'Playback halted',
      burstState: 'Stopped by operator',
      resultStatus: 'Playback stopped',
    };
  }

  if (!activeStage) return idleSnapshot;

  return {
    direction: activeStage.qosDirection,
    qosProfile: activeStage.qosProfile,
    qosState: activeStage.qosState,
    burstState: activeStage.burstState,
    targetBitrate: activeStage.burstTargetBitrate,
    burstSize: activeStage.burstSize,
    pathScore: activeStage.pathScore,
    latency: activeStage.latency,
    bandwidth: activeStage.bandwidth,
    anchorUpf: 'UPF - Shenzhen',
    serviceUpf:
      activeStage.stage === 'service_path_selected' ||
      activeStage.stage === 'processing' ||
      activeStage.stage === 'dl_qos_prep' ||
      activeStage.stage === 'dl_sending' ||
      activeStage.stage === 'complete'
        ? 'UPF - Shanghai'
        : 'Pending',
    activePathLabel: activeStage.pathSummary,
    taskTitle: 'Robot dog visual inspection',
    resultStatus: activeStage.resultStatus,
    resultSummary: activeStage.resultSummary,
    returnWindow:
      activeStage.stage === 'dl_qos_prep' || activeStage.stage === 'dl_sending' || activeStage.stage === 'complete'
        ? '12 ms target'
        : 'Waiting for result',
    stage: activeStage.stage,
  };
}

function buildGraph(snapshot: ReturnType<typeof buildSnapshot>) {
  const usingServicePath =
    snapshot.stage === 'service_path_selected' ||
    snapshot.stage === 'processing' ||
    snapshot.stage === 'dl_qos_prep' ||
    snapshot.stage === 'dl_sending' ||
    snapshot.stage === 'complete';

  const nodes: Array<Node<DemoNodeData | RegionNodeData>> = [
    {
      id: 'region-shenzhen',
      type: 'region',
      className: 'region-shell',
      position: { x: -70, y: 58 },
      draggable: false,
      selectable: false,
      data: { label: 'Shenzhen', tone: 'shenzhen' },
      style: { width: 760, height: 470, zIndex: 0 },
    },
    {
      id: 'region-backbone',
      type: 'region',
      className: 'region-shell',
      position: { x: 835, y: 42 },
      draggable: false,
      selectable: false,
      data: { label: 'Backbone', tone: 'backbone' },
      style: { width: 520, height: 500, zIndex: 0 },
    },
    {
      id: 'region-shanghai',
      type: 'region',
      className: 'region-shell',
      position: { x: 1385, y: 58 },
      draggable: false,
      selectable: false,
      data: { label: 'Shanghai', tone: 'shanghai' },
      style: { width: 430, height: 470, zIndex: 0 },
    },
    graphNode('ue', { x: 38, y: 250 }, {
      label: 'Robot Dog / UE',
      kind: 'endpoint',
      status: snapshot.stage === 'idle' ? 'Idle sensor endpoint' : snapshot.direction === 'DL' ? 'Receiving result payload' : 'Producing burst traffic',
      sideTitle: snapshot.direction === 'NONE' ? 'Standby endpoint' : snapshot.direction === 'DL' ? 'Downlink receiving' : 'Uplink burst source',
      sideValue: snapshot.direction === 'NONE' ? 'Idle' : formatBytes(snapshot.burstSize),
      active: snapshot.stage !== 'idle' && snapshot.stage !== 'stopped',
      emphasis: snapshot.stage === 'ul_qos_prep' || snapshot.stage === 'ul_sending' || snapshot.stage === 'dl_sending',
      badges: [snapshot.direction === 'NONE' ? 'Standby' : `${snapshot.direction} active`, formatBytes(snapshot.burstSize)],
    }),
    graphNode('gnb', { x: 260, y: 132 }, {
      label: 'gNB - Shenzhen',
      kind: 'access',
      status: snapshot.qosState,
      sideTitle: 'RAN QoS state',
      sideValue: snapshot.qosProfile,
      active: snapshot.direction !== 'NONE',
      emphasis: snapshot.stage === 'ul_qos_prep' || snapshot.stage === 'dl_qos_prep',
      badges: [snapshot.qosProfile, snapshot.direction === 'NONE' ? 'No burst' : snapshot.direction],
    }),
    graphNode('upf-shenzhen', { x: 500, y: 250 }, {
      label: 'UPF - Shenzhen',
      kind: 'upf',
      status: usingServicePath ? 'A-UPF active, direct N6 ghosted' : 'Ordinary breakout / local UPF',
      sideTitle: usingServicePath ? 'Local role' : 'Direct route',
      sideValue: usingServicePath ? 'A-UPF active' : 'N6 Direct Out',
      role: usingServicePath ? 'ANCHOR' : snapshot.stage === 'idle' ? 'IDLE' : 'ANCHOR',
      active: snapshot.stage !== 'idle' && snapshot.stage !== 'stopped',
      emphasis: snapshot.stage === 'ul_sending' || snapshot.stage === 'service_path_selected',
      badges: [snapshot.pathScore],
      ports: [
        { id: 'n3', label: 'N3', side: 'left' },
        { id: 'n6', label: 'N6', side: 'right' },
        { id: 'n9', label: 'N9', side: 'right' },
      ],
    }),
    graphNode('router-gz1', { x: 860, y: 112 }, {
      label: 'Router GZ-1',
      kind: 'router',
      status: 'Shared backbone',
      active: snapshot.stage !== 'idle' && snapshot.stage !== 'stopped',
      emphasis: !usingServicePath && (snapshot.stage === 'ul_sending' || snapshot.stage === 'dl_sending'),
      badges: ['N6 Direct Out', snapshot.latency],
    }),
    graphNode('router-sh1', { x: 1108, y: 112 }, {
      label: 'Router SH-1',
      kind: 'router',
      status: 'Shared backbone',
      active: snapshot.stage !== 'idle' && snapshot.stage !== 'stopped',
      emphasis: !usingServicePath,
      badges: ['N6 Direct Out', snapshot.bandwidth],
    }),
    graphNode('router-d1', { x: 860, y: 382 }, {
      label: 'Router D-1',
      kind: 'router',
      status: 'Dedicated service path',
      active: usingServicePath,
      emphasis: usingServicePath,
      badges: ['Dedicated A-UPF / S-UPF Path'],
    }),
    graphNode('router-d2', { x: 1108, y: 382 }, {
      label: 'Router D-2',
      kind: 'router',
      status: 'Dedicated service path',
      active: usingServicePath,
      emphasis: usingServicePath,
      badges: ['Dedicated A-UPF / S-UPF Path'],
    }),
    graphNode('upf-shanghai', { x: 1370, y: 250 }, {
      label: 'UPF - Shanghai',
      kind: 'upf',
      status: usingServicePath ? 'S-UPF active near service' : 'Service-side UPF idle',
      sideTitle: usingServicePath ? 'Remote role' : 'Service role',
      sideValue: usingServicePath ? 'S-UPF active' : 'Standby',
      role: usingServicePath ? 'SERVICE' : 'IDLE',
      active: usingServicePath,
      emphasis: snapshot.stage === 'service_path_selected' || snapshot.stage === 'processing' || snapshot.stage === 'dl_sending',
      badges: [usingServicePath ? 'Dedicated path' : 'Idle'],
      ports: [
        { id: 'n9', label: 'N9', side: 'left' },
        { id: 'n6', label: 'N6', side: 'right' },
      ],
    }),
    graphNode('server', { x: 1605, y: 132 }, {
      label: 'AI Inference Server',
      kind: 'service',
      status: snapshot.resultStatus,
      sideTitle: 'Service side',
      sideValue: snapshot.resultStatus,
      active: snapshot.stage === 'processing' || snapshot.stage === 'dl_qos_prep' || snapshot.stage === 'dl_sending' || snapshot.stage === 'complete',
      emphasis: snapshot.stage === 'processing' || snapshot.stage === 'complete',
      badges: ['GPU pool', snapshot.stage === 'complete' ? 'Result ready' : 'Queued'],
    }),
  ];

  const edges: Array<Edge<DemoEdgeData>> = [
    graphEdge('ue-gnb', 'ue', 'gnb', 'burst', {
      label: snapshot.direction === 'DL' ? 'DL air path' : 'UL air path',
      state: snapshot.direction === 'NONE' ? 'idle' : 'active',
      detail: 'Temporary air-interface treatment is visible before the burst starts.',
    }),
    graphEdge('gnb-upf-shenzhen', 'gnb', 'upf-shenzhen', 'burst', {
      label: 'N3 ingress',
      state: snapshot.stage === 'idle' || snapshot.stage === 'stopped' ? 'idle' : 'active',
      detail: 'The local anchor UPF stays close to the user equipment.',
      targetHandle: 'n3',
    }),
    graphEdge('upf-shenzhen-gz1', 'upf-shenzhen', 'router-gz1', 'baseline', {
      label: 'N6 Direct Out',
      state: usingServicePath ? 'idle' : snapshot.stage === 'ul_sending' || snapshot.stage === 'dl_sending' ? 'active' : 'selected',
      detail: 'Ordinary breakout via shared backbone routers.',
      sourceHandle: 'n6',
    }),
    graphEdge('gz1-sh1', 'router-gz1', 'router-sh1', 'baseline', {
      label: 'Shared backbone',
      state: usingServicePath ? 'idle' : 'selected',
      detail: 'Less optimized ordinary route across shared transit.',
    }),
    graphEdge('sh1-server', 'router-sh1', 'server', 'baseline', {
      label: 'N6 Direct Out',
      state: usingServicePath ? 'idle' : snapshot.stage === 'processing' || snapshot.stage === 'dl_sending' ? 'active' : 'selected',
      detail: 'Ordinary direct breakout to the Shanghai service side.',
    }),
    graphEdge('upf-shenzhen-d1', 'upf-shenzhen', 'router-d1', 'optimized', {
      label: 'Dedicated A-UPF / S-UPF Path',
      state: usingServicePath ? 'selected' : 'idle',
      detail: 'Deliberately established service chain leaves Shenzhen UPF via N9.',
      sourceHandle: 'n9',
    }),
    graphEdge('d1-d2', 'router-d1', 'router-d2', 'optimized', {
      label: 'Dedicated transit',
      state: usingServicePath ? 'selected' : 'idle',
      detail: 'Dedicated inter-UPF corridor.',
    }),
    graphEdge('d2-upf-shanghai', 'router-d2', 'upf-shanghai', 'optimized', {
      label: 'N9 service ingress',
      state: usingServicePath ? 'selected' : 'idle',
      detail: 'Remote service-side UPF receives traffic on N9.',
      targetHandle: 'n9',
    }),
    graphEdge('upf-shanghai-server', 'upf-shanghai', 'server', 'optimized', {
      label: 'Service-side N6',
      state: usingServicePath ? 'active' : 'idle',
      detail: 'S-UPF near the server exits to the AI service through N6.',
      sourceHandle: 'n6',
    }),
  ];

  return { nodes, edges };
}

function graphNode(id: string, position: { x: number; y: number }, data: DemoNodeData): Node<DemoNodeData> {
  return { id, type: 'mission', position, data };
}

function graphEdge(
  id: string,
  source: string,
  target: string,
  kind: LinkKind,
  data: Omit<DemoEdgeData, 'kind'> & { sourceHandle?: string; targetHandle?: string },
): Edge<DemoEdgeData> {
  return {
    id,
    source,
    target,
    sourceHandle: data.sourceHandle,
    targetHandle: data.targetHandle,
    type: 'mission',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edgeColor(kind, data.state),
    },
    data: {
      ...data,
      kind,
    },
  };
}

function edgeColor(kind: LinkKind, state: DemoEdgeData['state']) {
  if (state === 'idle') return 'rgba(113, 137, 167, 0.38)';
  if (kind === 'optimized') return '#45c3ff';
  if (kind === 'burst') return '#97ffb8';
  return '#f8c15d';
}

function hasReached(stage: DemoStage, target: DemoStage) {
  if (stage === 'idle' || stage === 'stopped') return false;
  const current = stageIndexById.get(stage) ?? -1;
  const desired = stageIndexById.get(target) ?? -1;
  return current >= desired;
}
