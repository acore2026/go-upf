import { useCallback, useMemo, useState } from 'react';
import { 
  Repeat, Cpu, Play, Radio, Router, Smartphone, Square, Clock, BarChart3, Network,
  UserCheck, ShieldCheck, Settings, Settings2, Database, Waypoints, Globe, Lock, Unlock, Sparkles
} from 'lucide-react';
import { Background, BaseEdge, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getBezierPath, getSmoothStepPath, applyNodeChanges, applyEdgeChanges, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes, type OnNodesChange, type OnEdgesChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from './utils';

type DemoStage = 'idle'|'running'|'complete'|'stopped';
type NodeKind = 'endpoint'|'access'|'upf'|'router'|'service'|'idm'|'agent'|'srf'|'scf'|'up'|'gw';
type NodeRole = 'IDM' | 'ACN Agent' | 'SRF' | 'SCF' | 'RAN' | 'UP' | 'Agent GW' | 'OTT' | 'MNO B';
type LinkKind = 'baseline' | 'bus' | 'logic';

type DemoNodeData = { 
  label: string; 
  kind: NodeKind; 
  status: string; 
  role?: NodeRole; 
  active?: boolean; 
  emphasis?: boolean; 
  handles?: string[];
};
type DemoEdgeData = { kind: LinkKind; state: 'idle'|'active'|'selected'; };
type RegionNodeData = { label: string; };
type BusNodeData = { label: string; caption: string; };

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
  const metaLine = data.status || data.role || data.kind;
  const handles = new Set(data.handles || []);

  return (
    <div className={cn("mission-node-shell", data.emphasis && "mission-node-emphasis", data.active && "mission-node-active-shell")} style={{ '--node-tint': meta.tint } as any}>
      <div className={cn("mission-node", data.active && "mission-node-active")}>
        <div className="mission-node-head">
          <div className="mission-node-icon"><meta.icon size={16} /></div>
          <div>
            <div className="mission-node-label">{data.label}</div>
            <div className="mission-node-role">{metaLine}</div>
          </div>
        </div>
      </div>
      {handles.has('in-top') && <Handle id="in-top" type="target" position={Position.Top} className="mission-handle mission-handle-top" />}
      {handles.has('out-bottom') && <Handle id="out-bottom" type="source" position={Position.Bottom} className="mission-handle mission-handle-bottom" />}
      {handles.has('in-left') && <Handle id="in-left" type="target" position={Position.Left} className="mission-handle mission-handle-left" />}
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
    ? getBezierPath({
        ...props,
        curvature: 0.18,
      })
    : kind === 'logic'
      ? getBezierPath(props)
      : getSmoothStepPath({
          ...props,
          borderRadius: 16,
          offset: 18,
        });
  const color = state === 'idle' ? '#cbd5e1' : kind === 'bus' ? '#5b6cff' : kind === 'logic' ? '#ec4899' : '#10b981';
  const isActive = state === 'active' || state === 'selected';
  const dash = !isActive ? (kind === 'bus' ? '8 8' : '6 6') : kind === 'logic' ? '5 5' : undefined;
  return ( <BaseEdge path={path} markerEnd={isActive ? props.markerEnd : undefined} className={isActive ? "edge-animated edge-active" : "edge-idle"} style={{ stroke: color, strokeWidth: kind === 'bus' ? 3 : 2.2, strokeDasharray: dash, transition: 'all 0.5s', opacity: isActive ? (kind === 'bus' ? 0.98 : 1) : 0.42 }} /> );
}

function RegionNode({ data }: NodeProps<Node<RegionNodeData>>) { return ( <div className="region-node">{data.label}</div> ); }

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
        <span className="bus-stop bus-stop-left" />
        <span className="bus-stop bus-stop-mid" />
        <span className="bus-stop bus-stop-right" />
      </div>

      <Handle type="target" position={Position.Top} id="h-t-idm" style={{ left: '17.92%', top: 24, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="target" position={Position.Top} id="h-t-agent" style={{ left: '82.08%', top: 24, background: 'transparent', border: 'none', opacity: 0 }} />

      <Handle type="source" position={Position.Bottom} id="h-b-srf" style={{ left: '13.21%', bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="h-b-scf" style={{ left: '48.11%', bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="h-b-gw" style={{ left: '83.02%', bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
    </div>
  );
}

function StatusBadge({ label, tone }: any) { return <span className={cn('status-badge', `status-badge-${tone}`)}>{label}</span>; }

function buildGraph(snapshot: any) {
  const active = snapshot.stage !== 'idle';
  const topY = 88;
  const busX = 70;
  const busY = 214;
  const busWidth = 530;
  const serviceY = 326;
  const planeY = 486;

  const nodes: Node[] = [
    // Main Boxes
    { id: 'r-cmcc', type: 'region', position: { x: -40, y: -40 }, style: { width: 720, height: 720, zIndex: -1 }, data: { label: 'CMCC (China Mobile)' }, draggable: false },
    { id: 'r-ott', type: 'region', position: { x: 780, y: 24 }, style: { width: 280, height: 250, zIndex: -1 }, data: { label: 'OTT Services' }, draggable: false },
    { id: 'r-mno-b', type: 'region', position: { x: 780, y: 376 }, style: { width: 280, height: 250, zIndex: -1 }, data: { label: 'MNO B Partner' }, draggable: false },

    // Row 1: Control anchors
    { id: 'idm', type: 'mission', position: { x: 90, y: topY }, style: { width: 150 }, data: { label: 'IDM', kind: 'idm', role: 'IDM', status: 'Identity Management', active, handles: ['out-bottom'] } },
    { id: 'acn-agent', type: 'mission', position: { x: 430, y: topY }, style: { width: 150 }, data: { label: 'ACN Agent', kind: 'agent', role: 'ACN Agent', status: 'Policy Orchestration', active, emphasis: true, handles: ['out-bottom'] } },

    // ABI backbone
    { id: 'bus-line', type: 'bus', position: { x: busX, y: busY }, style: { width: busWidth, height: 52, zIndex: 0 }, data: { label: 'ABI', caption: 'Agent Based Interface' }, draggable: false },

    // Row 2: ABI-attached services
    { id: 'srf', type: 'mission', position: { x: 70, y: serviceY }, style: { width: 140 }, data: { label: 'SRF', kind: 'srf', role: 'SRF', status: 'Service Routing', active, handles: ['in-top', 'out-bottom'] } },
    { id: 'scf', type: 'mission', position: { x: 255, y: serviceY }, style: { width: 140 }, data: { label: 'SCF', kind: 'scf', role: 'SCF', status: 'Service Control', active, handles: ['in-top', 'out-bottom'] } },
    { id: 'agent-gw', type: 'mission', position: { x: 440, y: serviceY }, style: { width: 140 }, data: { label: 'Agent GW', kind: 'gw', role: 'Agent GW', status: 'Northbound Gateway', active, handles: ['in-top', 'in-left', 'out-right-top', 'out-right-bottom'] } },

    // Row 3: Delivery plane
    { id: 'ran', type: 'mission', position: { x: 65, y: planeY }, style: { width: 150 }, data: { label: 'RAN', kind: 'access', role: 'RAN', status: 'Radio Access', active, handles: ['in-top', 'out-right'] } },
    { id: 'up', type: 'mission', position: { x: 250, y: planeY }, style: { width: 150 }, data: { label: 'UP', kind: 'up', role: 'UP', status: 'User Plane', active, handles: ['in-top', 'in-left', 'out-right'] } },

    // External Boxes Components
    { id: 'ott-srv', type: 'mission', position: { x: 850, y: 112 }, style: { width: 150 }, data: { label: 'OTT Platform', kind: 'service', role: 'OTT', status: 'External Content', active, handles: ['in-left-top'] } },
    { id: 'mno-b-srv', type: 'mission', position: { x: 850, y: 448 }, style: { width: 150 }, data: { label: 'MNO B Node', kind: 'router', role: 'MNO B', status: 'Peering Point', active, handles: ['in-left-bottom'] } },
  ];

  const edges: Edge[] = [
    // Vertical drops from Row 1 to Bus (Specific target handles)
    { id: 'e-idm-bus', source: 'idm', sourceHandle: 'out-bottom', target: 'bus-line', targetHandle: 'h-t-idm', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },
    { id: 'e-agent-bus', source: 'acn-agent', sourceHandle: 'out-bottom', target: 'bus-line', targetHandle: 'h-t-agent', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },

    // Vertical drops from Bus to Row 2 & Row 3 (Specific source handles)
    { id: 'e-bus-srf', source: 'bus-line', sourceHandle: 'h-b-srf', target: 'srf', targetHandle: 'in-top', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },
    { id: 'e-bus-scf', source: 'bus-line', sourceHandle: 'h-b-scf', target: 'scf', targetHandle: 'in-top', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },
    { id: 'e-bus-gw', source: 'bus-line', sourceHandle: 'h-b-gw', target: 'agent-gw', targetHandle: 'in-top', type: 'mission', data: { kind: 'bus', state: active ? 'active' : 'idle' } },

    // Local vertical logic
    { id: 'e-srf-ran', source: 'srf', sourceHandle: 'out-bottom', target: 'ran', targetHandle: 'in-top', type: 'mission', data: { kind: 'logic', state: active ? 'active' : 'idle' } },
    { id: 'e-scf-up', source: 'scf', sourceHandle: 'out-bottom', target: 'up', targetHandle: 'in-top', type: 'mission', data: { kind: 'logic', state: active ? 'active' : 'idle' } },

    // User Plane Horizontal connections
    { id: 'e-ran-up', source: 'ran', sourceHandle: 'out-right', target: 'up', targetHandle: 'in-left', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
    { id: 'e-up-gw', source: 'up', sourceHandle: 'out-right', target: 'agent-gw', targetHandle: 'in-left', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },

    // External connections
    { id: 'e-gw-ott', source: 'agent-gw', sourceHandle: 'out-right-top', target: 'ott-srv', targetHandle: 'in-left-top', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
    { id: 'e-gw-mno', source: 'agent-gw', sourceHandle: 'out-right-bottom', target: 'mno-b-srv', targetHandle: 'in-left-bottom', type: 'mission', data: { kind: 'baseline', state: active ? 'active' : 'idle' } },
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
