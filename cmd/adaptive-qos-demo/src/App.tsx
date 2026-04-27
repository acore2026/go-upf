import { useEffect, useMemo, useState } from 'react';
import { Repeat, Cpu, Play, Radio, Router, Smartphone, Square, Clock, BarChart3, Network, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Background, BaseEdge, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getBezierPath, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn, formatBitrate, formatBytes } from './utils';

type DemoStage = 'idle'|'triggered'|'ul_qos_prep'|'ul_qos_active'|'ul_sending'|'path_identifying'|'service_path_active'|'ul_complete'|'processing'|'dl_marking'|'dl_qos_active'|'dl_sending'|'complete'|'stopped';
type StageDirection = 'UL'|'DL'|'BIDIR'|'NONE';
type NodeKind = 'endpoint'|'access'|'upf'|'router'|'service';
type NodeRole = 'IDLE' | 'ANCHOR' | 'SERVICE' | 'ORDINARY' | 'UE' | '6G RAN' | '6G UPF' | 'Router' | 'Shanghai';
type LinkKind = 'baseline' | 'burst' | 'optimized';

type DemoNodeData = { 
  label: string; 
  kind: NodeKind; 
  status: string; 
  role?: NodeRole; 
  active?: boolean; 
  emphasis?: boolean; 
  ports?: string[]; 
  info?: string;
  upfRoles?: {
    anchor: 'idle' | 'active' | 'pending';
    service: 'idle' | 'active' | 'pending';
  };
};
type DemoEdgeData = { kind: LinkKind; state: 'idle'|'active'|'selected'; };
type RegionNodeData = { label: string; };

type StageDefinition = {
  stage: DemoStage; durationMs: number; status: string; qosDirection: StageDirection; qosProfile: string; qosState: string; burstState: string; burstTargetBitrate: number; burstSize: number; pathSummary: string; pathScore: string; latency: string; bandwidth: string; resultStatus: string; resultSummary: string;
  event: { id: string; title: string; detail: string; tone: 'neutral'|'good'|'accent'; };
};

const stageSequence: StageDefinition[] = [
  { stage: 'triggered', durationMs: 1400, status: 'Mission Triggered', qosDirection: 'NONE', qosProfile: 'Standby', qosState: 'Monitoring Signature', burstState: 'Capture Triggered', burstTargetBitrate: 0, burstSize: 0, pathSummary: 'Awaiting path selection', pathScore: '52/100', latency: '31ms', bandwidth: '1.8Gbps', resultStatus: 'Waiting...', resultSummary: 'Robot vision workload registered.', event: { id: 'e1', title: 'Visual task started', detail: 'Phone UE triggers recognition task.', tone: 'neutral' } },
  { stage: 'ul_qos_prep', durationMs: 1800, status: 'UL QoS Preparation', qosDirection: 'UL', qosProfile: 'Burst UL Gold', qosState: 'UL QoS Pending', burstState: 'Burst Predicted', burstTargetBitrate: 480000000, burstSize: 13200000, pathSummary: 'Baseline route active', pathScore: '58/100', latency: '28ms', bandwidth: '2.1Gbps', resultStatus: 'Staging UL', resultSummary: 'Burst estimated. Target UL QoS derived.', event: { id: 'e2', title: 'UL QoS estimated', detail: 'Target uplink QoS profile derived.', tone: 'accent' } },
  { stage: 'ul_qos_active', durationMs: 1500, status: 'Temporary UL Active', qosDirection: 'UL', qosProfile: 'Burst UL Gold', qosState: 'UL Flexible QoS Active', burstState: 'Assurance Armed', burstTargetBitrate: 480000000, burstSize: 13200000, pathSummary: 'Access path brightened', pathScore: '65/100', latency: '24ms', bandwidth: '3.2Gbps', resultStatus: 'UL Ready', resultSummary: 'Temporary UL treatment active.', event: { id: 'e3', title: 'UL QoS activated', detail: 'Network applies temporary uplink treatment.', tone: 'good' } },
  { stage: 'ul_sending', durationMs: 1900, status: 'UL Transmission', qosDirection: 'UL', qosProfile: 'Burst UL Gold', qosState: 'Traffic Ingress', burstState: 'UL Sending', burstTargetBitrate: 480000000, burstSize: 13200000, pathSummary: 'Generic N6 Breakout', pathScore: '72/100', latency: '22ms', bandwidth: '3.8Gbps', resultStatus: 'Data flowing', resultSummary: 'Image data crossing access path.', event: { id: 'e4', title: 'UL Transmission started', detail: 'Local encoding complete.', tone: 'good' } },
  { stage: 'path_identifying', durationMs: 1600, status: 'Identifying Service', qosDirection: 'UL', qosProfile: 'Burst UL Gold', qosState: 'Monitoring Flow', burstState: 'Flow Identified', burstTargetBitrate: 480000000, burstSize: 13200000, pathSummary: 'Evaluating service route', pathScore: '85/100', latency: '18ms', bandwidth: '4.5Gbps', resultStatus: 'Optimizing...', resultSummary: 'App traffic recognized.', event: { id: 'e5', title: 'Service identified', detail: 'Selecting dedicated UPF route.', tone: 'accent' } },
  { stage: 'service_path_active', durationMs: 2200, status: 'Service Path Selected', qosDirection: 'UL', qosProfile: 'Burst UL Gold', qosState: 'Dual-UPF active', burstState: 'Service Route Active', burstTargetBitrate: 480000000, burstSize: 13200000, pathSummary: 'Dedicated A-UP/S-UP Path', pathScore: '94/100', latency: '11ms', bandwidth: '6.2Gbps', resultStatus: 'Route established', resultSummary: 'Traffic switched to dedicated UPF chain.', event: { id: 'e6', title: 'Dedicated path established', detail: 'A-UPF and S-UPF roles active.', tone: 'good' } },
  { stage: 'ul_complete', durationMs: 1500, status: 'UL Delivery Complete', qosDirection: 'NONE', qosProfile: 'Burst UL Gold', qosState: 'Assurance Ending', burstState: 'UL Complete', burstTargetBitrate: 0, burstSize: 0, pathSummary: 'Optimized chain stable', pathScore: '96/100', latency: '10ms', bandwidth: '6.4Gbps', resultStatus: 'Received', resultSummary: 'Uplink delivery ended.', event: { id: 'e7', title: 'UL Delivery ended', detail: 'Burst reached the AI server.', tone: 'good' } },
  { stage: 'processing', durationMs: 2400, status: 'Server Processing', qosDirection: 'BIDIR', qosProfile: 'Released', qosState: 'Idle', burstState: 'Processing', burstTargetBitrate: 0, burstSize: 0, pathSummary: 'Service path reserved', pathScore: '95/100', latency: '12ms', bandwidth: '6.0Gbps', resultStatus: 'Resolving labels', resultSummary: 'Server produces labels from scene.', event: { id: 'e8', title: 'Inference executing', detail: 'AI server processing burst.', tone: 'neutral' } },
  { stage: 'dl_marking', durationMs: 1800, status: 'DL QoS Marking', qosDirection: 'DL', qosProfile: 'Result DL Priority', qosState: 'DL QoS Pending', burstState: 'DL Burst Marked', burstTargetBitrate: 120000000, burstSize: 1600000, pathSummary: 'Optimized return path', pathScore: '92/100', latency: '13ms', bandwidth: '4.8Gbps', resultStatus: 'Result Ready', resultSummary: 'DL target QoS derived.', event: { id: 'e9', title: 'DL burst marked', detail: 'Downlink target QoS derived.', tone: 'accent' } },
  { stage: 'dl_qos_active', durationMs: 1500, status: 'Temporary DL Active', qosDirection: 'DL', qosProfile: 'Result DL Priority', qosState: 'DL Flexible QoS Active', burstState: 'Assurance Active', burstTargetBitrate: 120000000, burstSize: 1600000, pathSummary: 'Path glowing (DL)', pathScore: '90/100', latency: '14ms', bandwidth: '4.5Gbps', resultStatus: 'Delivering', resultSummary: 'RAN applies DL profile.', event: { id: 'e10', title: 'DL QoS activated', detail: 'Downlink assurance armed.', tone: 'good' } },
  { stage: 'dl_sending', durationMs: 2000, status: 'Result Delivered', qosDirection: 'DL', qosProfile: 'Result DL Priority', qosState: 'Traffic Egress', burstState: 'Receiving Result', burstTargetBitrate: 120000000, burstSize: 1600000, pathSummary: 'Optimized Delivery', pathScore: '88/100', latency: '15ms', bandwidth: '4.1Gbps', resultStatus: 'Finished', resultSummary: 'Results returning through optimized route.', event: { id: 'e11', title: 'Result delivered', detail: 'Object labels received.', tone: 'good' } },
  { stage: 'complete', durationMs: 0, status: 'Task Complete', qosDirection: 'NONE', qosProfile: 'Released', qosState: 'Assurance Released', burstState: 'Mission Done', burstTargetBitrate: 0, burstSize: 0, pathSummary: 'Path Released', pathScore: '--', latency: '26ms', bandwidth: '1.8Gbps', resultStatus: 'Ready', resultSummary: 'Mission finished.', event: { id: 'e12', title: 'Mission finished', detail: 'Network state normalized.', tone: 'good' } },
];

const nodeTypes: NodeTypes = { mission: MissionNode, region: RegionNode };
const kindMeta: Record<NodeKind, { icon: any; tint: string }> = {
  endpoint: { icon: Smartphone, tint: 'var(--node-blue)' }, access: { icon: Radio, tint: 'var(--node-green)' }, upf: { icon: Router, tint: 'var(--node-cyan)' }, router: { icon: Repeat, tint: 'var(--node-amber)' }, service: { icon: Cpu, tint: 'var(--node-pink)' },
};

export default function App() { return ( <ReactFlowProvider><Dashboard /></ReactFlowProvider> ); }

function Dashboard() {
  const [missionState, setMissionState] = useState<'idle'|'running'|'complete'|'stopped'>('idle');
  const [stage, setStage] = useState<DemoStage>('idle');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    if (missionState !== 'running') return;
    const currentIndex = stageSequence.findIndex(s => s.stage === stage);
    const nextIndex = stage === 'idle' ? 0 : currentIndex + 1;
    if (nextIndex >= stageSequence.length) { setMissionState('complete'); setStage('complete'); return; }
    const delay = stage === 'idle' ? 100 : stageSequence[currentIndex].durationMs;
    const timeout = window.setTimeout(() => setStage(stageSequence[nextIndex].stage), delay);
    return () => window.clearTimeout(timeout);
  }, [missionState, stage]);

  const activeStage = useMemo(() => (stage === 'idle' || stage === 'stopped' ? null : stageSequence.find(s => s.stage === stage) || null), [stage]);
  const snapshot = buildSnapshot(stage, activeStage);
  const graph = useMemo(() => buildGraph(snapshot), [snapshot]);
  const visibleEvents = useMemo(() => {
    if (stage === 'idle') return [];
    const idx = stageSequence.findIndex(s => s.stage === stage);
    return stageSequence.slice(0, idx === -1 ? stageSequence.length : idx + 1).map(s => s.event).reverse();
  }, [stage]);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="header-left"><Network className="text-blue-500" size={24} /><h1 className="dashboard-title">Dual-UPF Adaptive QoS Demo</h1><div className="control-group ml-10"><StatusBadge label={missionState === 'running' ? 'Live Mission' : missionState === 'complete' ? 'Success' : 'Ready'} tone={missionState === 'running' ? 'live' : missionState === 'complete' ? 'good' : 'idle'} /></div></div>
        <div className="control-group"><button className="primary-button" onClick={() => { setMissionState('running'); setStage('triggered'); }}><Play size={16} fill="currentColor" />Start Mission</button><button className="icon-button" onClick={() => { setMissionState('idle'); setStage('idle'); }}><Square size={14} fill="currentColor" /></button></div>
      </header>
      <main className={cn("dashboard-main", !isSidebarOpen && "dashboard-main-collapsed")}>
        <section className="canvas-area"><ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={{ mission: MissionEdge }} fitView fitViewOptions={{ padding: 0.1 }} nodesConnectable={false} nodesDraggable={false} panOnDrag zoomOnScroll proOptions={{ hideAttribution: true }}><Background gap={40} size={1} color="#f1f5f9" /></ReactFlow></section>
        <aside className={cn("sidebar", !isSidebarOpen && "sidebar-collapsed")}>
          <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(open => !open)} aria-label={isSidebarOpen ? 'Collapse right panel' : 'Expand right panel'}>
            {isSidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          {isSidebarOpen ? (
            <div className="sidebar-content">
              <Panel label="Flexible QoS Controls"><StatItem label="Profile" value={snapshot.qosProfile} /><StatItem label="Assurance" value={snapshot.qosState} /></Panel>
              <Panel label="Burst Telemetry"><StatItem label="Target Bitrate" value={formatBitrate(snapshot.targetBitrate)} /><StatItem label="Payload Size" value={formatBytes(snapshot.burstSize)} /></Panel>
              <Panel label="Path Intelligence"><StatItem label="Selected Route" value={snapshot.activePathLabel} /><StatItem label="Path Score" value={snapshot.pathScore} /></Panel>
              <Panel label="Performance Metrics"><div className="grid grid-cols-2 gap-4"><MetricBox icon={Clock} label="Latency" value={snapshot.latency} color="blue" /><MetricBox icon={BarChart3} label="Bandwidth" value={snapshot.bandwidth} color="green" /></div></Panel>
              <Panel label="Result Preview"><div className="panel-card bg-slate-50 border-dashed mt-1 min-h-[60px] flex items-center justify-center"><p className="text-[0.7rem] text-muted italic text-center px-4">{snapshot.resultSummary}</p></div></Panel>
              <Panel label="Latest Activity">
                <div className="event-feed">
                  {visibleEvents.length > 0 ? visibleEvents.map(e => ( <div key={e.id} className={cn('event-row', `event-row-${e.tone}`)}><div className="event-content"><strong>{e.title}</strong><p>{e.detail}</p></div></div> )) : <div className="panel-card"><p className="text-[0.75rem] text-muted">No mission activity yet.</p></div>}
                </div>
              </Panel>
            </div>
          ) : (
            <div className="sidebar-rail-label">Panel</div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Panel({ label, children }: any) { return ( <div className="panel-section"><div className="panel-label">{label}</div>{children}</div> ); }
function StatItem({ label, value }: any) { return ( <div className="stat-item"><span className="stat-label">{label}</span><span className="stat-value">{value}</span></div> ); }
function MetricBox({ icon: Icon, label, value, color }: any) { return ( <div className="panel-card flex flex-col items-center gap-1"><Icon size={18} className={`text-${color}-500`} /><span className="text-[0.65rem] text-muted uppercase font-bold tracking-wider">{label}</span><span className="text-sm font-bold">{value}</span></div> ); }

function MissionNode({ data }: NodeProps<Node<DemoNodeData>>) {
  const meta = kindMeta[data.kind];
  const isUpf = data.kind === 'upf';
  const isRouter = data.kind === 'router';
  const isUe = data.kind === 'endpoint';
  const isRan = data.kind === 'access';

  return (
    <div className={cn("mission-node-shell", data.emphasis && "mission-node-emphasis", data.active && "mission-node-active-shell", isRouter && "mission-node-router")} style={{ '--node-tint': meta.tint } as any}>
      <div className={cn("mission-node", data.active && "mission-node-active")}>
        <div className="mission-node-head"><div className="mission-node-icon"><meta.icon size={isRouter ? 14 : 18} /></div><div><div className="mission-node-label">{data.label}</div><div className="mission-node-role">{isUpf ? '6G UPF' : (data.role || data.kind)}</div></div></div>
        
        {isUpf && data.upfRoles ? (
          <div className="flex flex-col gap-1 mt-2">
            <div className={cn("flex items-center justify-between px-2 py-1 rounded bg-slate-100/50 border border-slate-200", data.upfRoles.anchor !== 'idle' && "bg-blue-50 border-blue-200")}>
              <span className="text-[0.6rem] font-bold text-slate-500">A-UPF</span>
              <div className={cn("w-1.5 h-1.5 rounded-full bg-slate-300", data.upfRoles.anchor === 'active' && "bg-blue-500 animate-pulse", data.upfRoles.anchor === 'pending' && "bg-amber-400")} />
            </div>
            <div className={cn("flex items-center justify-between px-2 py-1 rounded bg-slate-100/50 border border-slate-200", data.upfRoles.service !== 'idle' && "bg-purple-50 border-purple-200")}>
              <span className="text-[0.6rem] font-bold text-slate-500">S-UPF</span>
              <div className={cn("w-1.5 h-1.5 rounded-full bg-slate-300", data.upfRoles.service === 'active' && "bg-purple-500 animate-pulse", data.upfRoles.service === 'pending' && "bg-amber-400")} />
            </div>
          </div>
        ) : !isRouter ? (
          <div className="text-[0.65rem] text-muted truncate mt-1 font-semibold">{data.status}</div>
        ) : null}
      </div>
      {isUpf ? (
        <>
          <Handle type="target" position={Position.Left} id="n3" className="mission-handle mission-handle-n3 mission-handle-left" style={{ top: '70%' }}>
            <div className="handle-label">N3</div>
          </Handle>
          <Handle type="target" position={Position.Left} id="n9-in" className="mission-handle mission-handle-n9-in mission-handle-left" style={{ top: '30%' }}>
            <div className="handle-label">N9</div>
          </Handle>
          <Handle type="source" position={Position.Right} id="n6" className="mission-handle mission-handle-n6 mission-handle-right" style={{ top: '70%' }}>
            <div className="handle-label">N6</div>
          </Handle>
          <Handle type="source" position={Position.Right} id="n9-out" className="mission-handle mission-handle-n9-out mission-handle-right" style={{ top: '30%' }}>
            <div className="handle-label">N9</div>
          </Handle>
        </>
      ) : isUe ? (
        <Handle type="source" position={Position.Bottom} className="mission-handle mission-handle-bottom" />
      ) : isRan ? (
        <>
          <Handle type="target" position={Position.Top} className="mission-handle mission-handle-top" />
          <Handle type="source" position={Position.Right} className="mission-handle mission-handle-right" />
        </>
      ) : (
        <>
          <Handle type="target" position={Position.Left} className="mission-handle mission-handle-left" />
          <Handle type="source" position={Position.Right} className="mission-handle mission-handle-right" />
        </>
      )}
    </div>
  );
}

function MissionEdge(props: EdgeProps<Edge<DemoEdgeData>>) {
  const [path] = getBezierPath(props);
  const { kind = 'baseline', state = 'idle' } = props.data || {};
  const color = state === 'idle' ? '#e2e8f0' : kind === 'optimized' ? '#3b82f6' : kind === 'burst' ? '#10b981' : '#f59e0b';
  const isActive = state === 'active' || state === 'selected';
  return ( <BaseEdge path={path} markerEnd={props.markerEnd} className={isActive ? "edge-animated" : ""} style={{ stroke: color, strokeWidth: state === 'selected' ? 4 : state === 'active' ? 3 : 2, strokeDasharray: isActive ? '10 5' : kind === 'baseline' ? '8 6' : undefined, transition: 'all 0.5s' }} /> );
}

function RegionNode({ data }: NodeProps<Node<RegionNodeData>>) { return ( <div className="region-node">{data.label}</div> ); }
function StatusBadge({ label, tone }: any) { return <span className={cn('status-badge', `status-badge-${tone}`)}>{label}</span>; }

function buildSnapshot(stage: DemoStage, activeStage: StageDefinition | null) {
  const idle = { direction: 'NONE' as StageDirection, qosProfile: 'Standby', qosState: 'Monitoring Signature', burstState: 'Waiting', targetBitrate: 0, burstSize: 0, pathScore: '--', latency: '31ms', bandwidth: '1.8Gbps', activePathLabel: 'N6 Direct Out', resultStatus: 'Standby', resultSummary: 'Awaiting mission trigger.', stage };
  if (!activeStage) return idle;
  return { direction: activeStage.qosDirection, qosProfile: activeStage.qosProfile, qosState: activeStage.qosState, burstState: activeStage.burstState, targetBitrate: activeStage.burstTargetBitrate, burstSize: activeStage.burstSize, pathScore: activeStage.pathScore, latency: activeStage.latency, bandwidth: activeStage.bandwidth, activePathLabel: activeStage.pathSummary, resultStatus: activeStage.resultStatus, resultSummary: activeStage.resultSummary, stage: activeStage.stage };
}

function buildGraph(snapshot: any) {
  const usingService = ['service_path_active', 'ul_complete', 'processing', 'dl_marking', 'dl_qos_active', 'dl_sending', 'complete'].includes(snapshot.stage);
  const nodes: Node[] = [
    // City Regions
    { id: 'r1', type: 'region', position: { x: -20, y: -20 }, style: { width: 380, height: 480, zIndex: -1 }, data: { label: 'Shenzhen' }, draggable: false },
    { id: 'r4', type: 'region', position: { x: 780, y: -20 }, style: { width: 380, height: 480, zIndex: -1 }, data: { label: 'Shanghai' }, draggable: false },
    { id: 'r5', type: 'region', position: { x: 780, y: 490 }, style: { width: 380, height: 190, zIndex: -1 }, data: { label: 'Beijing' }, draggable: false },
    
    // Backbone Split Regions
    { id: 'r2', type: 'region', position: { x: 380, y: -20 }, style: { width: 380, height: 230, zIndex: -1 }, data: { label: 'Optimized Service Path' }, draggable: false },
    { id: 'r3', type: 'region', position: { x: 380, y: 230 }, style: { width: 380, height: 230, zIndex: -1 }, data: { label: 'Standard Public Path' }, draggable: false },
    
    // Shenzhen Triangle
    { id: 'ue', type: 'mission', position: { x: 40, y: 80 }, data: { label: 'Phone', role: 'UE', kind: 'endpoint', status: snapshot.direction === 'DL' ? 'Receiving result' : snapshot.direction === 'UL' ? 'UL sending' : 'Idle', active: snapshot.stage !== 'idle', emphasis: snapshot.stage === 'triggered' || snapshot.direction !== 'NONE' } },
    { id: 'gnb', type: 'mission', position: { x: 40, y: 320 }, data: { label: 'gNB-SZ01', role: '6G RAN', kind: 'access', status: snapshot.qosProfile, active: snapshot.stage.includes('qos_active') || snapshot.direction !== 'NONE', emphasis: snapshot.stage.includes('qos_active') || snapshot.stage === 'dl_sending' } },
    { id: 'upf-shenzhen', type: 'mission', position: { x: 210, y: 200 }, data: { label: 'UPF-SZ01', role: '6G UPF', kind: 'upf', status: 'N3 Ingress', active: snapshot.stage !== 'idle', emphasis: usingService, upfRoles: { anchor: snapshot.stage !== 'idle' ? 'active' : 'idle', service: 'idle' } } },
    
    // Public Path (Bottom)
    { id: 'router-gz1', type: 'mission', position: { x: 450, y: 335 }, data: { label: 'GZ-1', role: 'Router', kind: 'router', status: 'Best Effort', active: !usingService && snapshot.stage !== 'idle' } },
    { id: 'router-sh1', type: 'mission', position: { x: 620, y: 335 }, data: { label: 'SH-1', role: 'Router', kind: 'router', status: 'Best Effort', active: !usingService && snapshot.stage !== 'idle' } },
    
    // Dedicated Path (Top)
    { id: 'router-d1', type: 'mission', position: { x: 450, y: 85 }, data: { label: 'D-1', role: 'Router', kind: 'router', status: 'Dedicated Transit', active: usingService, emphasis: usingService } },
    { id: 'router-d2', type: 'mission', position: { x: 620, y: 85 }, data: { label: 'D-2', role: 'Router', kind: 'router', status: 'Dedicated Transit', active: usingService, emphasis: usingService } },
    
    // Shanghai
    { id: 'upf-shanghai', type: 'mission', position: { x: 830, y: 200 }, data: { label: 'UPF-SH01', role: '6G UPF', kind: 'upf', status: 'Service Ingress', active: usingService || snapshot.stage === 'path_identifying', emphasis: usingService, upfRoles: { anchor: 'idle', service: usingService ? 'active' : (snapshot.stage === 'path_identifying' ? 'pending' : 'idle') } } },
    { id: 'server', type: 'mission', position: { x: 1010, y: 295 }, data: { label: 'AI Server', role: 'Shanghai', kind: 'service', status: snapshot.resultStatus, active: snapshot.stage === 'processing' || snapshot.stage === 'complete' || snapshot.stage === 'ul_complete', emphasis: snapshot.stage === 'processing' } },

    // Beijing
    { id: 'upf-beijing', type: 'mission', position: { x: 900, y: 550 }, data: { label: 'UPF-BJ01', role: '6G UPF', kind: 'upf', status: 'Regional Standby', active: false, upfRoles: { anchor: 'idle', service: 'idle' } } },
  ];
  const edges: Edge[] = [
    { id: 'e-ue-gnb', source: 'ue', target: 'gnb', type: 'mission', data: { kind: 'burst', state: snapshot.direction !== 'NONE' ? 'active' : 'idle' } },
    { id: 'e-gnb-upf', source: 'gnb', target: 'upf-shenzhen', targetHandle: 'n3', type: 'mission', data: { kind: 'burst', state: snapshot.stage !== 'idle' ? 'active' : 'idle' } },
    
    // Public path
    { id: 'e-ord-gz1', source: 'upf-shenzhen', sourceHandle: 'n6', target: 'router-gz1', type: 'mission', data: { kind: 'baseline', state: !usingService && snapshot.stage !== 'idle' ? 'active' : 'idle' } },
    { id: 'e-gz1-sh1', source: 'router-gz1', target: 'router-sh1', type: 'mission', data: { kind: 'baseline', state: !usingService && snapshot.stage !== 'idle' ? 'active' : 'idle' } },
    { id: 'e-sh1-server', source: 'router-sh1', target: 'server', type: 'mission', data: { kind: 'baseline', state: !usingService && snapshot.stage !== 'idle' ? 'active' : 'idle' } },

    // Dedicated path
    { id: 'e-anchor-d1', source: 'upf-shenzhen', sourceHandle: 'n9-out', target: 'router-d1', type: 'mission', data: { kind: 'optimized', state: usingService ? 'selected' : 'idle' } },
    { id: 'e-d1-d2', source: 'router-d1', target: 'router-d2', type: 'mission', data: { kind: 'optimized', state: usingService ? 'selected' : 'idle' } },
    { id: 'e-d2-supf', source: 'router-d2', target: 'upf-shanghai', targetHandle: 'n9-in', type: 'mission', data: { kind: 'optimized', state: usingService ? 'selected' : 'idle' } },
    
    // Shanghai Exit
    { id: 'e-supf-server', source: 'upf-shanghai', sourceHandle: 'n6', target: 'server', type: 'mission', data: { kind: 'optimized', state: usingService ? 'active' : 'idle' } },
  ];
  return { nodes, edges: edges.map(e => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, color: e.data?.kind === 'optimized' ? '#3b82f6' : e.data?.kind === 'burst' ? '#10b981' : '#f59e0b' } })) };
}
