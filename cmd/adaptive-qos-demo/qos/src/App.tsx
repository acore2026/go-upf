import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Database,
  Gauge,
  Play,
  Radio,
  RefreshCw,
  Router,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type NodeTypes,
  BaseEdge,
  getBezierPath,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from './api';
import type { FlowDetail, SidecarStatus, StorySummary, TraceEntry, UPFStatus } from './api';
import { cn, formatBitrate, formatBytes, formatCountdown, formatTime } from './utils';

type DeviceKind = 'ue' | 'sidecar' | 'ran' | 'upf' | 'policy' | 'app';
type LinkKind = 'access' | 'tunnel' | 'qos' | 'telemetry';
type GraphSelection =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | null;

type DeviceNodeData = {
  label: string;
  kind: DeviceKind;
  active?: boolean;
  emphasis?: boolean;
  meta?: string;
  badges?: string[];
};

type GraphEdgeData = {
  kind: LinkKind;
  label: string;
  active?: boolean;
  emphasis?: boolean;
  detail?: string;
};

type GraphBlueprint = {
  nodes: Node<DeviceNodeData>[];
  edges: Edge<GraphEdgeData>[];
};

type TimelineEvent = TraceEntry & {
  origin: 'upf' | 'sidecar';
};

const kindMeta: Record<DeviceKind, { icon: typeof Smartphone; tint: string }> = {
  ue: { icon: Smartphone, tint: 'var(--graph-ue)' },
  sidecar: { icon: ShieldCheck, tint: 'var(--graph-sidecar)' },
  ran: { icon: Radio, tint: 'var(--graph-ran)' },
  upf: { icon: Router, tint: 'var(--graph-upf)' },
  policy: { icon: Gauge, tint: 'var(--graph-policy)' },
  app: { icon: Database, tint: 'var(--graph-app)' },
};

const edgeMeta: Record<LinkKind, { color: string; dash?: string }> = {
  access: { color: 'var(--graph-ran)' },
  tunnel: { color: 'var(--graph-sidecar)' },
  qos: { color: 'var(--graph-policy)' },
  telemetry: { color: 'var(--graph-upf)', dash: '8 8' },
};

const nodeTypes: NodeTypes = {
  device: DeviceNode,
};

export default function App() {
  return (
    <ReactFlowProvider>
      <Dashboard />
    </ReactFlowProvider>
  );
}

function Dashboard() {
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);
  const [upfStatus, setUpfStatus] = useState<UPFStatus | null>(null);
  const [sidecarTrace, setSidecarTrace] = useState<TraceEntry[]>([]);
  const [upfTrace, setUpfTrace] = useState<TraceEntry[]>([]);
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [flowId, setFlowId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isInjecting, setIsInjecting] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [showAuxiliary, setShowAuxiliary] = useState(true);
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [selection, setSelection] = useState<GraphSelection>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DeviceNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<GraphEdgeData>>([]);

  const refreshAll = async () => {
    try {
      const [sStatus, sTrace, uStatus, uTrace] = await Promise.all([
        api.getSidecarStatus(),
        api.getSidecarTrace(),
        api.getUPFStatus(),
        api.getUPFTrace(),
      ]);

      setSidecarStatus(sStatus);
      setSidecarTrace(sTrace || []);
      setUpfStatus(uStatus);
      setUpfTrace(uTrace || []);
      setLastUpdate(new Date());

      if (flowId) {
        setFlow(await api.getFlowDetail(flowId));
      } else {
        setFlow(null);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refreshAll();
    const interval = window.setInterval(refreshAll, 1000);
    return () => window.clearInterval(interval);
  }, [flowId]);

  const handleStartStory = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const randomId =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).substring(2, 10);
      const generatedFlowId = `flow-${randomId}`;
      const resp = await api.startStory1({
        flowId: generatedFlowId,
        ueAddress: '10.60.0.1',
        packet: {
          srcIp: '10.60.0.1',
          dstIp: '198.51.100.10',
          srcPort: 40000,
          dstPort: 9999,
          protocol: 'udp',
        },
      });

      const responseFlowId = resp?.flowId || resp?.FlowID || generatedFlowId;
      if (isRejectedStoryStart(resp)) {
        setFlowId('');
        setFlow(null);
        throw new Error(resp?.reasonCode || resp?.status || 'story start rejected');
      }

      setFlowId(responseFlowId);
      setSelection({ type: 'node', id: 'ue-main' });
      await refreshAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    setError(null);
    try {
      await api.reset();
      setFlowId('');
      setFlow(null);
      setSelection(null);
      await refreshAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsResetting(false);
    }
  };

  const handleInjectBurst = async () => {
    if (!flowId) return;
    setIsInjecting(true);
    setError(null);
    try {
      await api.injectBurst('10.60.0.1', flowId);
      setSelection({ type: 'edge', id: 'ran-upf' });
      await refreshAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsInjecting(false);
    }
  };

  const mergedTimeline = useMemo<TimelineEvent[]>(() => {
    return [...sidecarTrace.map((entry) => ({ ...entry, origin: 'sidecar' as const })), ...upfTrace.map((entry) => ({ ...entry, origin: 'upf' as const }))]
      .sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return (a.seq || 0) - (b.seq || 0);
      })
      .slice(-80);
  }, [sidecarTrace, upfTrace]);

  const story = useMemo<StorySummary | undefined>(
    () => upfStatus?.story || sidecarStatus?.story,
    [sidecarStatus, upfStatus],
  );

  const storyExpiry = useMemo(() => {
    const expectedArrivalTime =
      sidecarStatus?.story?.expectedArrivalTime ||
      upfStatus?.story?.expectedArrivalTime ||
      flow?.lastReport?.expectedArrivalTime;

    if (!expectedArrivalTime) return null;

    const arrivalMs = new Date(expectedArrivalTime).getTime();
    if (Number.isNaN(arrivalMs)) return null;

    const expiryMs = arrivalMs + 10_000;
    return {
      expiryMs,
      remainingMs: expiryMs - Date.now(),
    };
  }, [flow, lastUpdate, sidecarStatus, upfStatus]);

  const flowActive =
    !!flow?.active || (sidecarStatus?.activeFlows || 0) > 0 || (upfStatus?.activeFlows || 0) > 0;
  const storyLive = !!storyExpiry && storyExpiry.remainingMs > 0 && flowActive;
  const activeProfileId =
    upfStatus?.currentQoSProfile?.selectedProfileId ||
    story?.profileId ||
    flow?.lastFeedback?.profileId ||
    '';

  const blueprint = useMemo(
    () =>
      buildGraphBlueprint({
        story,
        sidecarStatus,
        upfStatus,
        flow,
        flowActive,
        storyLive,
        activeProfileId,
        showAuxiliary,
        showTelemetry,
      }),
    [activeProfileId, flow, flowActive, showAuxiliary, showTelemetry, sidecarStatus, story, storyLive, upfStatus],
  );

  useEffect(() => {
    setNodes((prev) =>
      blueprint.nodes.map((node) => {
        const existing = prev.find((candidate) => candidate.id === node.id);
        return existing
          ? {
              ...node,
              position: existing.position,
              selected: selection?.type === 'node' && selection.id === node.id,
            }
          : {
              ...node,
              selected: selection?.type === 'node' && selection.id === node.id,
            };
      }),
    );
    setEdges(
      blueprint.edges.map((edge) => ({
        ...edge,
        selected: selection?.type === 'edge' && selection.id === edge.id,
      })),
    );
  }, [blueprint, selection, setEdges, setNodes]);

  const selectedNode = selection?.type === 'node' ? nodes.find((node) => node.id === selection.id) : null;
  const selectedEdge = selection?.type === 'edge' ? edges.find((edge) => edge.id === selection.id) : null;

  const summaryItems = [
    { label: 'Current flow', value: flowId || 'Idle' },
    { label: 'Profile', value: activeProfileId || 'default' },
    { label: 'Packets', value: String(upfStatus?.story?.packetCount || 0) },
    { label: 'Timer', value: storyExpiry ? formatCountdown(storyExpiry.remainingMs) : 'Standby' },
  ];

  return (
    <div className="dashboard-shell">
      <div className="dashboard-backdrop" />

      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Adaptive QoS</p>
          <h1>Path dashboard</h1>
          <p className="header-copy">
            Interactive topology for UE, sidecar, RAN, UPF, and supporting links. Drag nodes, select a path, and inspect live state.
          </p>
        </div>

        <div className="header-actions">
          <button onClick={handleReset} disabled={isResetting} className="button button-muted">
            <RefreshCw size={16} className={cn(isResetting && 'spin-fast')} />
            Reset
          </button>
          <button onClick={handleInjectBurst} disabled={isInjecting || !flowId || !flowActive} className="button button-secondary">
            <Activity size={16} className={cn(isInjecting && 'spin-fast')} />
            Inject burst
          </button>
          <button onClick={handleStartStory} disabled={isStarting} className="button button-primary">
            {isStarting ? <RefreshCw size={16} className="spin-fast" /> : <Play size={16} />}
            Start flow
          </button>
        </div>
      </header>

      {error && (
        <div className="alert-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <section className="summary-strip">
        {summaryItems.map((item) => (
          <div key={item.label} className="summary-card">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
        <div className="summary-card summary-card-status">
          <span>Services</span>
          <div className="status-pills">
            <StatusPill label="UPF" active={!!upfStatus?.running} />
            <StatusPill label="Sidecar" active={!!sidecarStatus} />
            <StatusPill label="Flow" active={flowActive} />
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="panel panel-graph">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Topology</p>
              <h2>Flexible path map</h2>
            </div>
            <div className="toggle-row">
              <ToggleChip
                label="Aux devices"
                active={showAuxiliary}
                onClick={() => setShowAuxiliary((value) => !value)}
              />
              <ToggleChip
                label="Telemetry links"
                active={showTelemetry}
                onClick={() => setShowTelemetry((value) => !value)}
              />
            </div>
          </div>

          <div className="graph-shell">
            <ReactFlow
              fitView
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => setSelection({ type: 'node', id: node.id })}
              onEdgeClick={(_, edge) => setSelection({ type: 'edge', id: edge.id })}
              onPaneClick={() => setSelection(null)}
              nodeTypes={nodeTypes}
              edgeTypes={{ path: PathEdge }}
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.45}
              maxZoom={1.5}
              defaultEdgeOptions={{ type: 'path' }}
              nodesDraggable
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(39, 57, 92, 0.08)" />
              <MiniMap
                pannable
                zoomable
                nodeStrokeColor={(node) => (node.selected ? 'var(--accent-strong)' : 'rgba(34, 47, 76, 0.25)')}
                nodeColor={(node) => String(node.data?.active ? node.data?.emphasis ? '#f97316' : '#1d4ed8' : '#d9dfec')}
                maskColor="rgba(244, 247, 252, 0.72)"
              />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          </div>
        </div>

        <div className="panel panel-side">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Inspector</p>
              <h2>{selectedNode ? selectedNode.data.label : selectedEdge ? selectedEdge.data?.label : 'Selection'}</h2>
            </div>
            <span className="subtle-meta">{formatTime(lastUpdate.toISOString())}</span>
          </div>

          <div className="inspector-section">
            {selectedNode && <NodeInspector node={selectedNode} story={story} flow={flow} upfStatus={upfStatus} />}
            {selectedEdge && <EdgeInspector edge={selectedEdge} />}
            {!selectedNode && !selectedEdge && (
              <div className="empty-state">
                <p>Select a device or link in the graph.</p>
                <span>The map already supports multiple device and link categories. Toggle extra elements as needed.</span>
              </div>
            )}
          </div>

          <div className="inspector-section">
            <p className="eyebrow">Live metrics</p>
            <div className="metric-list">
              <Metric label="Scenario" value={story?.scenario || 'None'} />
              <Metric label="Flow tuple" value={story?.flowDescription || 'N/A'} />
              <Metric label="Predicted air delay" value={story?.predictedAirDelayMs ? `${story.predictedAirDelayMs} ms` : 'N/A'} />
              <Metric label="Selected profile" value={activeProfileId || 'default'} />
              <Metric label="GFBR DL" value={formatBitrate(upfStatus?.currentQoSProfile?.overrideGfbrDl || upfStatus?.defaultQoSProfile?.overrideGfbrDl)} />
              <Metric label="Payload" value={formatBytes(flow?.lastReport?.BurstSize || story?.burstSize)} />
            </div>
          </div>
        </div>
      </section>

      <section className="workspace-grid workspace-grid-secondary">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Links</p>
              <h2>Path legend</h2>
            </div>
          </div>

          <div className="legend-grid">
            {(['access', 'tunnel', 'qos', 'telemetry'] as LinkKind[]).map((kind) => (
              <div key={kind} className="legend-card">
                <span className={`legend-line legend-${kind}`} />
                <div>
                  <strong>{titleize(kind)}</strong>
                  <p>{linkDescription(kind)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Events</p>
              <h2>Recent telemetry</h2>
            </div>
            <span className="subtle-meta">{mergedTimeline.length} events</span>
          </div>

          <div className="timeline">
            {mergedTimeline.length === 0 && (
              <div className="empty-state">
                <p>No events yet.</p>
                <span>Start a flow to populate the log.</span>
              </div>
            )}

            {mergedTimeline
              .slice()
              .reverse()
              .map((event, index) => (
                <button
                  key={`${event.timestamp}-${event.seq}-${index}`}
                  className="timeline-row"
                  onClick={() => setSelection({ type: 'node', id: event.origin === 'upf' ? 'upf-main' : 'sidecar-main' })}
                >
                  <span className={cn('timeline-dot', event.origin === 'upf' ? 'timeline-dot-upf' : 'timeline-dot-sidecar')} />
                  <div className="timeline-copy">
                    <div className="timeline-title">
                      <strong>{formatTraceStage(event.stage)}</strong>
                      <span>{formatTime(event.timestamp)}</span>
                    </div>
                    <p>
                      {event.component.toUpperCase()} · {event.detail || event.status || event.reason || 'Event received'}
                    </p>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function DeviceNode({ data, selected }: NodeProps<Node<DeviceNodeData>>) {
  const meta = kindMeta[data.kind];
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        'device-node',
        data.active && 'device-node-active',
        data.emphasis && 'device-node-emphasis',
        selected && 'device-node-selected',
      )}
      style={{ '--device-tint': meta.tint } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="device-handle" />
      <Handle type="source" position={Position.Right} className="device-handle" />

      <div className="device-node-icon">
        <Icon size={18} />
      </div>
      <div className="device-node-copy">
        <strong>{data.label}</strong>
        {data.meta && <span>{data.meta}</span>}
      </div>
      {!!data.badges?.length && (
        <div className="device-node-badges">
          {data.badges.slice(0, 2).map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function PathEdge(props: EdgeProps<Edge<GraphEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath(props);
  const meta = edgeMeta[props.data?.kind || 'access'];
  const active = !!props.data?.active;
  const selected = !!props.selected;

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={props.markerEnd}
        style={{
          stroke: meta.color,
          strokeWidth: selected ? 4 : active ? 3 : 2,
          strokeOpacity: active ? 0.95 : 0.42,
          strokeDasharray: meta.dash,
        }}
      />
      <foreignObject x={labelX - 72} y={labelY - 16} width={144} height={32}>
        <div className={cn('edge-label', active && 'edge-label-active', selected && 'edge-label-selected')}>
          {props.data?.label}
        </div>
      </foreignObject>
    </>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={cn('status-pill', active && 'status-pill-active')}>
      <span className="status-pill-dot" />
      {label}
    </span>
  );
}

function ToggleChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={cn('toggle-chip', active && 'toggle-chip-active')} onClick={onClick}>
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NodeInspector({
  node,
  story,
  flow,
  upfStatus,
}: {
  node: Node<DeviceNodeData>;
  story?: StorySummary;
  flow: FlowDetail | null;
  upfStatus: UPFStatus | null;
}) {
  const items = nodeInspectorRows(node, story, flow, upfStatus);

  return (
    <>
      <p className="inspector-copy">
        {node.data.kind === 'ue' && 'Traffic source and session owner.'}
        {node.data.kind === 'sidecar' && 'Local signaling and MASQUE coordination point.'}
        {node.data.kind === 'ran' && 'Radio path decision point.'}
        {node.data.kind === 'upf' && 'User-plane forwarding and adaptive QoS enforcement point.'}
        {node.data.kind === 'policy' && 'Profile and bandwidth shaping context.'}
        {node.data.kind === 'app' && 'Destination application endpoint.'}
      </p>
      <div className="metric-list">
        {items.map((item) => (
          <Metric key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
    </>
  );
}

function EdgeInspector({ edge }: { edge: Edge<GraphEdgeData> }) {
  return (
    <>
      <p className="inspector-copy">{edge.data?.detail || 'Transport path between two devices.'}</p>
      <div className="metric-list">
        <Metric label="Type" value={titleize(edge.data?.kind || 'access')} />
        <Metric label="State" value={edge.data?.active ? 'Active' : 'Idle'} />
        <Metric label="Route" value={`${edge.source} -> ${edge.target}`} />
        <Metric label="Label" value={edge.data?.label || 'Unnamed'} />
      </div>
    </>
  );
}

function buildGraphBlueprint({
  story,
  sidecarStatus,
  upfStatus,
  flow,
  flowActive,
  storyLive,
  activeProfileId,
  showAuxiliary,
  showTelemetry,
}: {
  story?: StorySummary;
  sidecarStatus: SidecarStatus | null;
  upfStatus: UPFStatus | null;
  flow: FlowDetail | null;
  flowActive: boolean;
  storyLive: boolean;
  activeProfileId: string;
  showAuxiliary: boolean;
  showTelemetry: boolean;
}): GraphBlueprint {
  const packetCount = upfStatus?.story?.packetCount || 0;
  const hasProfile = !!activeProfileId;

  const nodes: Node<DeviceNodeData>[] = [
    graphNode('ue-main', { x: 0, y: 120 }, {
      label: 'UE',
      kind: 'ue',
      active: flowActive,
      emphasis: storyLive,
      meta: flow?.lastReport?.ueAddress || '10.60.0.1',
      badges: [story?.scenario || 'demo', flow?.active ? 'active' : 'idle'],
    }),
    graphNode('ran-main', { x: 280, y: 120 }, {
      label: 'gNB / RAN',
      kind: 'ran',
      active: !!story?.gnbDecision || storyLive,
      emphasis: story?.gnbDecision === 'ACCEPTED',
      meta: story?.gnbDecision || 'pending',
      badges: story?.predictedAirDelayMs ? [`${story.predictedAirDelayMs} ms`] : ['radio path'],
    }),
    graphNode('upf-main', { x: 560, y: 120 }, {
      label: 'UPF',
      kind: 'upf',
      active: !!upfStatus?.running,
      emphasis: packetCount > 0,
      meta: upfStatus?.masqueAddr || 'core active',
      badges: [hasProfile ? activeProfileId : 'default', `${packetCount} pkts`],
    }),
    graphNode('app-main', { x: 840, y: 120 }, {
      label: 'Application',
      kind: 'app',
      active: flowActive,
      emphasis: packetCount > 0,
      meta: story?.flowDescription || '198.51.100.10:9999/udp',
      badges: [story?.deadlineMs ? `${story.deadlineMs} ms deadline` : 'sink'],
    }),
  ];

  if (showAuxiliary) {
    nodes.push(
      graphNode('sidecar-main', { x: 150, y: 300 }, {
        label: 'UE Sidecar',
        kind: 'sidecar',
        active: !!sidecarStatus,
        emphasis: storyLive,
        meta: `${sidecarStatus?.activeFlows || 0} active flows`,
        badges: ['MASQUE', story?.phase || 'standby'],
      }),
      graphNode('policy-main', { x: 560, y: 300 }, {
        label: 'QoS Policy',
        kind: 'policy',
        active: hasProfile || !!upfStatus?.defaultQoSProfile,
        emphasis: hasProfile && activeProfileId !== upfStatus?.defaultQoSProfile?.selectedProfileId,
        meta: activeProfileId || upfStatus?.defaultQoSProfile?.selectedProfileId || 'default',
        badges: [
          formatBitrate(
            upfStatus?.currentQoSProfile?.overrideMbrDl || upfStatus?.defaultQoSProfile?.overrideMbrDl,
          ),
        ],
      }),
    );
  }

  const edges: Edge<GraphEdgeData>[] = [
    graphEdge('ue-ran', 'ue-main', 'ran-main', 'access', {
      label: 'Radio access',
      active: flowActive,
      detail: 'UE traffic enters the radio path.',
    }),
    graphEdge('ran-upf', 'ran-main', 'upf-main', 'access', {
      label: 'User plane',
      active: story?.gnbDecision === 'ACCEPTED' || packetCount > 0,
      emphasis: packetCount > 0,
      detail: 'Forwarding from RAN into the UPF.',
    }),
    graphEdge('upf-app', 'upf-main', 'app-main', 'access', {
      label: 'Service path',
      active: packetCount > 0,
      detail: 'Forwarded packets leave the UPF toward the application endpoint.',
    }),
  ];

  if (showAuxiliary) {
    edges.push(
      graphEdge('ue-sidecar', 'ue-main', 'sidecar-main', 'tunnel', {
        label: 'Local attach',
        active: !!sidecarStatus,
        detail: 'Local coordination between UE and sidecar.',
      }),
      graphEdge('sidecar-upf', 'sidecar-main', 'upf-main', 'tunnel', {
        label: 'MASQUE tunnel',
        active: storyLive || !!story?.phase,
        emphasis: story?.phase === 'prepared',
        detail: 'Sidecar signaling and transport coordination with the UPF.',
      }),
      graphEdge('policy-upf', 'policy-main', 'upf-main', 'qos', {
        label: 'QoS profile',
        active: hasProfile || !!upfStatus?.defaultQoSProfile,
        emphasis: hasProfile,
        detail: 'Selected policy profile applied by the UPF.',
      }),
    );
  }

  if (showTelemetry) {
    if (showAuxiliary) {
      edges.push(
        graphEdge('sidecar-ran', 'sidecar-main', 'ran-main', 'telemetry', {
          label: 'Assist hints',
          active: !!story?.gnbDecision || !!story?.predictedAirDelayMs,
          detail: 'Assistive decisioning or telemetry shared toward the radio path.',
        }),
      );
    }
    edges.push(
      graphEdge('upf-policy-app', 'upf-main', showAuxiliary ? 'policy-main' : 'app-main', 'telemetry', {
        label: showAuxiliary ? 'Usage feedback' : 'Usage signals',
        active: packetCount > 0,
        detail: 'Runtime signals flowing back from the UPF.',
      }),
    );
  }

  return { nodes, edges };
}

function graphNode(id: string, position: { x: number; y: number }, data: DeviceNodeData): Node<DeviceNodeData> {
  return {
    id,
    type: 'device',
    position,
    data,
  };
}

function graphEdge(
  id: string,
  source: string,
  target: string,
  kind: LinkKind,
  data: Omit<GraphEdgeData, 'kind'>,
): Edge<GraphEdgeData> {
  return {
    id,
    source,
    target,
    type: 'path',
    animated: false,
    data: { ...data, kind },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edgeMeta[kind].color,
    },
  };
}

function nodeInspectorRows(
  node: Node<DeviceNodeData>,
  story: StorySummary | undefined,
  flow: FlowDetail | null,
  upfStatus: UPFStatus | null,
) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Kind', value: titleize(node.data.kind) },
    { label: 'Status', value: node.data.active ? 'Active' : 'Idle' },
  ];

  if (node.data.meta) rows.push({ label: 'Primary', value: node.data.meta });

  if (node.id === 'ue-main') {
    rows.push({ label: 'Flow ID', value: story?.flowId || flow?.flowId || 'N/A' });
  }
  if (node.id === 'ran-main') {
    rows.push({ label: 'Decision', value: story?.gnbDecision || 'Pending' });
  }
  if (node.id === 'upf-main') {
    rows.push({ label: 'Packets', value: String(upfStatus?.story?.packetCount || 0) });
    rows.push({
      label: 'Profile',
      value:
        upfStatus?.currentQoSProfile?.selectedProfileId ||
        upfStatus?.defaultQoSProfile?.selectedProfileId ||
        'default',
    });
  }
  if (node.id === 'policy-main') {
    rows.push({
      label: 'MBR DL',
      value: formatBitrate(upfStatus?.currentQoSProfile?.overrideMbrDl || upfStatus?.defaultQoSProfile?.overrideMbrDl),
    });
  }

  return rows;
}

function formatTraceStage(stage?: string) {
  if (!stage) return 'EVENT';
  return stage.replace(/_/g, ' ').toUpperCase();
}

function titleize(value: string) {
  return value
    .split(/[-_ ]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function linkDescription(kind: LinkKind) {
  switch (kind) {
    case 'access':
      return 'Main traffic forwarding path between user, radio, and application.';
    case 'tunnel':
      return 'Overlay or sidecar-managed transport, including MASQUE.';
    case 'qos':
      return 'Policy or shaping relationship applied to traffic handling.';
    case 'telemetry':
      return 'Feedback, assist signals, or runtime reporting.';
  }
}

function isRejectedStoryStart(resp: any) {
  if (!resp || typeof resp !== 'object') return true;

  const status = String(resp.status || resp.Status || '').toLowerCase();
  if (status && ['rejected', 'error', 'failed', 'failure'].includes(status)) return true;

  const reasonCode = String(resp.reasonCode || resp.ReasonCode || '').toUpperCase();
  if (reasonCode && reasonCode !== 'ACCEPTED' && reasonCode !== 'OK') return true;

  return false;
}
