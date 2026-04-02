import { useCallback, useMemo, useState } from 'react';
import { 
  Repeat, Cpu, Play, Radio, Router, Smartphone, Square, Clock, BarChart3, Network,
  UserCheck, ShieldCheck, Settings, Settings2, Database, Waypoints, Globe, Lock, Unlock, Sparkles, Bot
} from 'lucide-react';
import { Background, BaseEdge, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getBezierPath, getSmoothStepPath, getStraightPath, applyNodeChanges, applyEdgeChanges, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes, type OnNodesChange, type OnEdgesChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from './utils';

type DemoStage = 'idle'|'running'|'complete'|'stopped';
type NodeKind = 'endpoint'|'access'|'upf'|'router'|'service'|'idm'|'agent'|'srf'|'scf'|'up'|'gw'|'robot';
type LinkKind = 'baseline' | 'bus' | 'logic' | 'wireless';

type DemoNodeData = { 
  label: string; 
  kind: NodeKind; 
  status: string; 
  role?: string; 
  active?: boolean; 
  emphasis?: boolean; 
  handles?: string[];
  appearance?: 'default' | 'phone' | 'robot' | 'gateway';
};
type DemoEdgeData = { kind: LinkKind; state: 'idle'|'active'|'selected'; };
type RegionNodeData = { label: string; variant?: 'domain' | 'subdomain'; };
type BusNodeData = { label: string; caption: string; idm: string; acnAgent: string; srf: string; scf: string; cmccGw: string; };

const nodeTypes: NodeTypes = { mission: MissionNode, region: RegionNode, bus: BusNode };
const kindMeta: Record<NodeKind, { icon: any; tint: string }> = {
  endpoint: { icon: Smartphone, tint: 'var(--node-blue)' }, 
  access: { icon: Radio, tint: 'var(--node-green)' }, 
  upf: { icon: Router, tint: 'var(--node-cyan)' }, 
  router: { icon: Repeat, tint: 'var(--node-amber)' }, 
  service: { icon: Cpu, tint: 'var(--node-pink)' },
  idm: { icon: UserCheck, tint: '#6366f1' },
  agent: { icon: ShieldCheck, tint: '#8b5cf6' },
  srf: { icon: Settings, tint: '#ec4899' },
  scf: { icon: Settings2, tint: '#f43f5e' },
  up: { icon: Database, tint: '#06b6d4' },
  gw: { icon: Waypoints, tint: '#f59e0b' },
  robot: { icon: Bot, tint: '#0f766e' },
};

export default function App() { return ( <ReactFlowProvider><Dashboard /></ReactFlowProvider> ); }

function Dashboard() {
  const [missionState, setMissionState] = useState<'idle'|'running'|'complete'|'stopped'>('idle');
  const [stage, setStage] = useState<DemoStage>('idle');
  const [isLocked, setIsLocked] = useState(true);

  const snapshot = {
    qosProfile: 'Active',
    qosState: 'Normal',
    targetBitrate: 0,
    burstSize: 0,
    pathScore: '98/100',
    latency: '5ms',
    bandwidth: '10Gbps',
    activePathLabel: 'CMCC Internal',
    resultStatus: 'Running',
    resultSummary: 'System redesign complete.',
    stage
  };

  const initialGraph = useMemo(() => buildGraph(snapshot), []);
  const [nodes, setNodes] = useState<Node[]>(initialGraph.nodes);
  const [edges, setEdges] = useState<Edge[]>(initialGraph.edges);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const copyLayout = () => {
    const layout = {
      nodes: nodes.map(n => ({ id: n.id, position: n.position })),
    };
    const text = JSON.stringify(layout, null, 2);
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        alert('Layout JSON copied to clipboard!');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  };

  const fallbackCopy = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      alert('Layout JSON copied to clipboard!');
    } catch (err) {
      console.error('Unable to copy', err);
      prompt("Copy layout JSON manually:", text);
    }
    document.body.removeChild(textArea);
  };

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="header-left"><Network className="text-blue-500" size={24} /><h1 className="dashboard-title">CMCC Redesign Demo</h1><div className="control-group ml-10"><StatusBadge label={missionState === 'running' ? 'Live' : 'Ready'} tone={missionState === 'running' ? 'live' : 'idle'} /></div></div>
        <div className="control-group">
          {!isLocked && <button className="primary-button" style={{ background: '#334155' }} onClick={copyLayout}>Export JSON</button>}
          <button className={cn("primary-button", isLocked ? "bg-slate-600!" : "bg-emerald-600!")} onClick={() => setIsLocked(!isLocked)}>
            {isLocked ? <Lock size={16} className="mr-2" /> : <Unlock size={16} className="mr-2" />}
            {isLocked ? 'Unlock' : 'Lock'}
          </button>
          <button className="primary-button" onClick={() => { setMissionState('running'); setStage('running'); }}><Play size={16} fill="currentColor" />Start</button>
          <button className="icon-button" onClick={() => { setMissionState('idle'); setStage('idle'); }}><Square size={14} fill="currentColor" /></button>
        </div>
      </header>
      <main className="dashboard-main">
        <section className="canvas-area">
          <ReactFlow 
            nodes={nodes} 
            edges={edges} 
            nodeTypes={nodeTypes} 
            edgeTypes={{ mission: MissionEdge }} 
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView 
            fitViewOptions={{ padding: 0.1 }} 
            nodesConnectable={false} 
            nodesDraggable={!isLocked} 
            panOnDrag 
            zoomOnScroll 
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={40} size={1} color="#f1f5f9" />
          </ReactFlow>
        </section>
        <aside className="sidebar">
          <Panel label="System Overview"><StatItem label="Profile" value={snapshot.qosProfile} /><StatItem label="State" value={snapshot.qosState} /></Panel>
          <Panel label="Network Path"><StatItem label="Path" value={snapshot.activePathLabel} /><StatItem label="Score" value={snapshot.pathScore} /></Panel>
          <Panel label="Performance"><div className="grid grid-cols-2 gap-4"><MetricBox icon={Clock} label="Latency" value={snapshot.latency} color="blue" /><MetricBox icon={BarChart3} label="Bandwidth" value={snapshot.bandwidth} color="green" /></div></Panel>
          <Panel label="Status"><div className="panel-card bg-slate-50 border-dashed mt-1 min-h-[60px] flex items-center justify-center"><p className="text-[0.7rem] text-muted italic text-center px-4">{snapshot.resultSummary}</p></div></Panel>
        </aside>
      </main>
    </div>
  );
}

function Panel({ label, children }: any) { return ( <div className="panel-section"><div className="panel-label">{label}</div>{children}</div> ); }
function StatItem({ label, value }: any) { return ( <div className="stat-item"><span className="stat-label">{label}</span><span className="stat-value">{value}</span></div> ); }
function MetricBox({ icon: Icon, label, value, color }: any) { return ( <div className="panel-card flex flex-col items-center gap-1"><Icon size={18} className={`text-${color}-500`} /><span className="text-[0.65rem] text-muted uppercase font-bold tracking-wider">{label}</span><span className="text-sm font-bold">{value}</span></div> ); }

function MissionNode({ data }: NodeProps<Node<DemoNodeData>>) {
  const meta = kindMeta[data.kind] || { icon: Globe, tint: '#64748b' };
  const statusLine = data.status || 'Standby';
  const handles = new Set(data.handles || []);
  const isCompactDevice = data.appearance === 'phone' || data.appearance === 'robot';

  return (
    <div className={cn(
      "mission-node-shell",
      data.emphasis && "mission-node-emphasis",
      data.active && "mission-node-active-shell",
      data.appearance === 'gateway' && "mission-node-gateway-shell",
      data.appearance === 'phone' && "mission-node-phone-shell",
      data.appearance === 'robot' && "mission-node-robot-shell",
    )} style={{ '--node-tint': meta.tint } as any}>
      <div className={cn("mission-node", data.active && "mission-node-active")}>
        <div className="mission-node-head">
          <div className={cn("mission-node-icon", data.appearance === 'phone' && "mission-node-icon-phone", data.appearance === 'robot' && "mission-node-icon-robot")}><meta.icon size={16} /></div>
          <div>
            <div className="mission-node-label">{data.label}</div>
            {!isCompactDevice && (
              <div className="mission-node-meta">
                <span className="mission-node-online-dot mission-node-online-dot-inline" />
                <span className="mission-node-role">{statusLine}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {handles.has('in-top') && <Handle id="in-top" type="target" position={Position.Top} className="mission-handle mission-handle-top" />}
      {handles.has('out-top') && <Handle id="out-top" type="source" position={Position.Top} className="mission-handle mission-handle-top" />}
      {handles.has('in-bottom') && <Handle id="in-bottom" type="target" position={Position.Bottom} className="mission-handle mission-handle-bottom" />}
      {handles.has('out-bottom') && <Handle id="out-bottom" type="source" position={Position.Bottom} className="mission-handle mission-handle-bottom" />}
      {handles.has('in-left') && <Handle id="in-left" type="target" position={Position.Left} className="mission-handle mission-handle-left" />}
      {handles.has('out-left') && <Handle id="out-left" type="source" position={Position.Left} className="mission-handle mission-handle-left" />}
      {handles.has('in-right') && <Handle id="in-right" type="target" position={Position.Right} className="mission-handle mission-handle-right" />}
      {handles.has('out-right') && <Handle id="out-right" type="source" position={Position.Right} className="mission-handle mission-handle-right" />}
      {handles.has('in-left-top') && <Handle id="in-left-top" type="target" position={Position.Left} className="mission-handle mission-handle-left" style={{ top: '38%' }} />}
      {handles.has('in-left-bottom') && <Handle id="in-left-bottom" type="target" position={Position.Left} className="mission-handle mission-handle-left" style={{ top: '68%' }} />}
      {handles.has('out-right-top') && <Handle id="out-right-top" type="source" position={Position.Right} className="mission-handle mission-handle-right" style={{ top: '38%' }} />}
      {handles.has('out-right-bottom') && <Handle id="out-right-bottom" type="source" position={Position.Right} className="mission-handle mission-handle-right" style={{ top: '68%' }} />}
    </div>
  );
}

function MissionEdge(props: EdgeProps<Edge<DemoEdgeData>>) {
  const { kind = 'baseline', state = 'idle' } = props.data || {};
  const [path] = kind === 'bus'
    ? getStraightPath(props)
    : kind === 'logic'
      ? getBezierPath(props)
      : getSmoothStepPath({
          ...props,
          borderRadius: 16,
          offset: 18,
        });
  const color = state === 'idle' ? '#94a3b8' : kind === 'bus' ? '#5b6cff' : kind === 'logic' ? '#ec4899' : kind === 'wireless' ? '#0ea5e9' : '#10b981';
  const isActive = state === 'active' || state === 'selected';
  const dash = kind === 'wireless' ? '4 5' : !isActive ? (kind === 'bus' ? '2.5 4' : '2 3.5') : kind === 'logic' ? '5 5' : undefined;
  return ( <BaseEdge path={path} markerEnd={isActive ? props.markerEnd : undefined} className={isActive ? "edge-animated edge-active" : "edge-idle"} style={{ stroke: color, strokeWidth: kind === 'bus' ? 3.1 : 2.35, strokeDasharray: dash, transition: 'all 0.5s', opacity: isActive ? (kind === 'bus' ? 0.98 : 1) : 0.58 }} /> );
}

function RegionNode({ data }: NodeProps<Node<RegionNodeData>>) {
  return <div className={cn("region-node", data.variant === 'subdomain' && "region-node-subdomain")}>{data.label}</div>;
}

function BusNode({ data }: NodeProps<Node<BusNodeData>>) {
  return (
    <div className="bus-node-shell">
      <div className="bus-node-header">
        <span className="bus-node-pill">
          <Sparkles size={14} />
          {data.label}
        </span>
        <span className="bus-node-caption">{data.caption}</span>
      </div>
      <div className="bus-backbone">
      </div>

      <Handle type="target" position={Position.Top} id="h-t-idm" style={{ left: data.idm, top: 24, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="target" position={Position.Top} id="h-t-agent" style={{ left: data.acnAgent, top: 24, background: 'transparent', border: 'none', opacity: 0 }} />

      <Handle type="source" position={Position.Bottom} id="h-b-srf" style={{ left: data.srf, bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="h-b-scf" style={{ left: data.scf, bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="h-b-gw" style={{ left: data.cmccGw, bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
    </div>
  );
}

function StatusBadge({ label, tone }: any) { return <span className={cn('status-badge', `status-badge-${tone}`)}>{label}</span>; }

const LAYOUT = {
  cmcc: { x: -48, y: -48, width: 900, height: 840 },
  ott: { x: 932, y: 64, width: 316, height: 244 },
  mno: { x: 932, y: 374, width: 316, height: 250 },
  core: { x: 36, y: 36, width: 708, height: 388 },
  access: { x: 36, y: 456, width: 708, height: 228 },
  family: { x: 74, y: 548, width: 292, height: 112 },
  bus: { x: 142, y: 206, width: 520, height: 52 },
  nodes: {
    idm: { x: 164, y: 90, width: 136 },
    acnAgent: { x: 508, y: 90, width: 136 },
    srf: { x: 164, y: 304, width: 128 },
    scf: { x: 362, y: 304, width: 128 },
    cmccGw: { x: 560, y: 304, width: 128 },
    ran: { x: 164, y: 472, width: 128 },
    up: { x: 330, y: 472, width: 196 },
    phone: { x: 114, y: 580, width: 78 },
    robotDog: { x: 230, y: 580, width: 96 },
    ottOrdering: { x: 1070, y: 112, width: 146 },
    ottGw: { x: 964, y: 214, width: 150 },
    mnoGw: { x: 964, y: 420, width: 150 },
    mnoEndpoint: { x: 1096, y: 516, width: 120 },
  },
} as const;

function buildGraph(snapshot: any) {
  const active = snapshot.stage !== 'idle';
  const standby = 'Standby';
  const statusText = (activeText: string) => active ? activeText : standby;
  const busStops = {
    idm: `${((LAYOUT.nodes.idm.x + LAYOUT.nodes.idm.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    acnAgent: `${((LAYOUT.nodes.acnAgent.x + LAYOUT.nodes.acnAgent.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    srf: `${((LAYOUT.nodes.srf.x + LAYOUT.nodes.srf.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    scf: `${((LAYOUT.nodes.scf.x + LAYOUT.nodes.scf.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    cmccGw: `${((LAYOUT.nodes.cmccGw.x + LAYOUT.nodes.cmccGw.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
  };

  const nodes: Node[] = [
    // Main Boxes
    { id: 'r-cmcc', type: 'region', position: { x: LAYOUT.cmcc.x, y: LAYOUT.cmcc.y }, style: { width: LAYOUT.cmcc.width, height: LAYOUT.cmcc.height, zIndex: -1 }, data: { label: 'CMCC' }, draggable: false },
    { id: 'r-ott', type: 'region', position: { x: LAYOUT.ott.x, y: LAYOUT.ott.y }, style: { width: LAYOUT.ott.width, height: LAYOUT.ott.height, zIndex: -1 }, data: { label: 'OTT' }, draggable: false },
    { id: 'r-mno-b', type: 'region', position: { x: LAYOUT.mno.x, y: LAYOUT.mno.y }, style: { width: LAYOUT.mno.width, height: LAYOUT.mno.height, zIndex: -1 }, data: { label: 'MNO B' }, draggable: false },
    { id: 'r-core', type: 'region', position: { x: LAYOUT.core.x, y: LAYOUT.core.y }, style: { width: LAYOUT.core.width, height: LAYOUT.core.height, zIndex: -1 }, data: { label: 'Core Network', variant: 'subdomain' }, draggable: false },
    { id: 'r-access', type: 'region', position: { x: LAYOUT.access.x, y: LAYOUT.access.y }, style: { width: LAYOUT.access.width, height: LAYOUT.access.height, zIndex: -1 }, data: { label: 'Access Network', variant: 'subdomain' }, draggable: false },
    { id: 'r-family', type: 'region', position: { x: LAYOUT.family.x, y: LAYOUT.family.y }, style: { width: LAYOUT.family.width, height: LAYOUT.family.height, zIndex: -1 }, data: { label: 'Family Domain', variant: 'subdomain' }, draggable: false },

    // Core network control
    { id: 'idm', type: 'mission', position: { x: LAYOUT.nodes.idm.x, y: LAYOUT.nodes.idm.y }, style: { width: LAYOUT.nodes.idm.width }, data: { label: 'IDM', kind: 'idm', role: 'IDM', status: statusText('Identity Function'), active, handles: ['out-bottom'] } },
    { id: 'acn-agent', type: 'mission', position: { x: LAYOUT.nodes.acnAgent.x, y: LAYOUT.nodes.acnAgent.y }, style: { width: LAYOUT.nodes.acnAgent.width }, data: { label: 'ACN Agent', kind: 'agent', role: 'ACN Agent', status: statusText('Agent / Policy'), active, emphasis: true, handles: ['out-bottom'] } },

    // ABI backbone
    { id: 'bus-line', type: 'bus', position: { x: LAYOUT.bus.x, y: LAYOUT.bus.y }, style: { width: LAYOUT.bus.width, height: LAYOUT.bus.height, zIndex: 0 }, data: { label: 'ABI', caption: 'Agent Based Interface', ...busStops }, draggable: false },

    // Core network services and transport
    { id: 'srf', type: 'mission', position: { x: LAYOUT.nodes.srf.x, y: LAYOUT.nodes.srf.y }, style: { width: LAYOUT.nodes.srf.width }, data: { label: 'SRF', kind: 'srf', role: 'SRF', status: statusText('Service Routing'), active, handles: ['in-top', 'out-bottom'] } },
    { id: 'scf', type: 'mission', position: { x: LAYOUT.nodes.scf.x, y: LAYOUT.nodes.scf.y }, style: { width: LAYOUT.nodes.scf.width }, data: { label: 'SCF', kind: 'scf', role: 'SCF', status: statusText('Service Control'), active, handles: ['in-top', 'out-bottom'] } },
    { id: 'agent-gw', type: 'mission', position: { x: LAYOUT.nodes.cmccGw.x, y: LAYOUT.nodes.cmccGw.y }, style: { width: LAYOUT.nodes.cmccGw.width }, data: { label: 'Agent GW', kind: 'gw', role: 'Agent GW (CMCC)', status: statusText('CMCC Gateway'), active, handles: ['in-top', 'in-left', 'out-right-top', 'out-right-bottom'], appearance: 'gateway' } },
    { id: 'ran', type: 'mission', position: { x: LAYOUT.nodes.ran.x, y: LAYOUT.nodes.ran.y }, style: { width: LAYOUT.nodes.ran.width }, data: { label: 'RAN', kind: 'access', role: 'RAN', status: statusText('Radio Access Side'), active, handles: ['in-top', 'in-left', 'in-right', 'out-right'] } },
    { id: 'up', type: 'mission', position: { x: LAYOUT.nodes.up.x, y: LAYOUT.nodes.up.y }, style: { width: LAYOUT.nodes.up.width }, data: { label: 'UP', kind: 'up', role: 'UP', status: statusText('User Plane Gateway'), active, handles: ['in-top', 'in-left', 'out-right'], appearance: 'gateway' } },

    // Family domain
    { id: 'phone', type: 'mission', position: { x: LAYOUT.nodes.phone.x, y: LAYOUT.nodes.phone.y }, style: { width: LAYOUT.nodes.phone.width }, data: { label: 'Phone', kind: 'endpoint', status: standby, active, handles: ['out-right'], appearance: 'phone' } },
    { id: 'robot-dog', type: 'mission', position: { x: LAYOUT.nodes.robotDog.x, y: LAYOUT.nodes.robotDog.y }, style: { width: LAYOUT.nodes.robotDog.width }, data: { label: 'Robot Dog', kind: 'robot', status: standby, active, handles: ['out-right'], appearance: 'robot' } },

    // External Boxes Components
    { id: 'ott-ordering', type: 'mission', position: { x: LAYOUT.nodes.ottOrdering.x, y: LAYOUT.nodes.ottOrdering.y }, style: { width: LAYOUT.nodes.ottOrdering.width }, data: { label: 'Ordering Agent', kind: 'service', role: 'OTT', status: statusText('Application / Agent'), active, handles: ['in-bottom'] } },
    { id: 'ott-gw', type: 'mission', position: { x: LAYOUT.nodes.ottGw.x, y: LAYOUT.nodes.ottGw.y }, style: { width: LAYOUT.nodes.ottGw.width }, data: { label: 'Agent GW', kind: 'gw', role: 'Agent GW (OTT)', status: statusText('OTT Peer Gateway'), active, handles: ['in-left', 'out-top', 'out-bottom'], appearance: 'gateway' } },
    { id: 'mno-gw', type: 'mission', position: { x: LAYOUT.nodes.mnoGw.x, y: LAYOUT.nodes.mnoGw.y }, style: { width: LAYOUT.nodes.mnoGw.width }, data: { label: 'Agent GW', kind: 'gw', role: 'Agent GW (MNO B)', status: statusText('Partner Peer Gateway'), active, handles: ['in-top', 'in-left', 'out-right'], appearance: 'gateway' } },
    { id: 'mno-endpoint', type: 'mission', position: { x: LAYOUT.nodes.mnoEndpoint.x, y: LAYOUT.nodes.mnoEndpoint.y }, style: { width: LAYOUT.nodes.mnoEndpoint.width }, data: { label: 'External Endpoint', kind: 'endpoint', role: 'MNO B', status: statusText('External Device'), active, handles: ['in-left'] } },
  ];

  const edges: Edge[] = [
    // Vertical drops from Row 1 to Bus (Specific target handles)
    { id: 'e-idm-bus', source: 'idm', sourceHandle: 'out-bottom', target: 'bus-line', targetHandle: 'h-t-idm', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },
    { id: 'e-agent-bus', source: 'acn-agent', sourceHandle: 'out-bottom', target: 'bus-line', targetHandle: 'h-t-agent', type: 'mission', data: { kind: 'bus', state: active ? 'selected' : 'idle' } },

    // Backbone drops
    { id: 'e-bus-srf', source: 'bus-line', sourceHandle: 'h-b-srf', target: 'srf', targetHandle: 'in-top', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },
    { id: 'e-bus-scf', source: 'bus-line', sourceHandle: 'h-b-scf', target: 'scf', targetHandle: 'in-top', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },
    { id: 'e-bus-cmcc-gw', source: 'bus-line', sourceHandle: 'h-b-gw', target: 'agent-gw', targetHandle: 'in-top', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },

    // Internal service and transport
    { id: 'e-srf-ran', source: 'srf', sourceHandle: 'out-bottom', target: 'ran', targetHandle: 'in-top', type: 'mission', data: { kind: 'logic', state: active ? 'active' : 'idle' } },
    { id: 'e-scf-up', source: 'scf', sourceHandle: 'out-bottom', target: 'up', targetHandle: 'in-top', type: 'mission', data: { kind: 'logic', state: active ? 'active' : 'idle' } },
    { id: 'e-ran-up', source: 'ran', sourceHandle: 'out-right', target: 'up', targetHandle: 'in-left', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
    { id: 'e-up-gw', source: 'up', sourceHandle: 'out-right', target: 'agent-gw', targetHandle: 'in-left', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
    { id: 'e-phone-ran', source: 'phone', sourceHandle: 'out-right', target: 'ran', targetHandle: 'in-left', type: 'mission', data: { kind: 'wireless', state: active ? 'active' : 'idle' } },
    { id: 'e-dog-ran', source: 'robot-dog', sourceHandle: 'out-right', target: 'ran', targetHandle: 'in-right', type: 'mission', data: { kind: 'wireless', state: active ? 'active' : 'idle' } },

    // Cross-domain
    { id: 'e-cmcc-ott-gw', source: 'agent-gw', sourceHandle: 'out-right-top', target: 'ott-gw', targetHandle: 'in-left', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
    { id: 'e-cmcc-mno-gw', source: 'agent-gw', sourceHandle: 'out-right-bottom', target: 'mno-gw', targetHandle: 'in-left', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
    { id: 'e-ott-gw-ordering', source: 'ott-gw', sourceHandle: 'out-top', target: 'ott-ordering', targetHandle: 'in-bottom', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
    { id: 'e-ott-gw-mno-gw', source: 'ott-gw', sourceHandle: 'out-bottom', target: 'mno-gw', targetHandle: 'in-top', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
    { id: 'e-mno-gw-endpoint', source: 'mno-gw', sourceHandle: 'out-right', target: 'mno-endpoint', targetHandle: 'in-left', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
  ];


  return { 
    nodes, 
    edges: edges.map(e => ({ 
      ...e, 
      markerEnd: e.data?.kind === 'bus' || e.data?.state === 'idle' ? undefined : { 
        type: MarkerType.ArrowClosed, 
        color: e.data?.kind === 'logic' ? '#ec4899' : '#10b981' 
      } 
    })) 
  };
}
