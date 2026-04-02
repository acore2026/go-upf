import { useCallback, useEffect, useRef, useState } from 'react';
import { 
  Repeat, Cpu, Play, Radio, Router, Smartphone, Square, Network,
  UserCheck, Settings, Settings2, Database, Waypoints, Globe, Lock, Unlock, Sparkles, Bot, Wrench, LoaderCircle, BrainCircuit
} from 'lucide-react';
import { Background, BaseEdge, Handle, Position, ReactFlow, ReactFlowProvider, getBezierPath, getStraightPath, applyNodeChanges, applyEdgeChanges, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes, type OnNodesChange, type OnEdgesChange } from '@xyflow/react';
import { load as loadYaml } from 'js-yaml';
import '@xyflow/react/dist/style.css';
import { cn } from './utils';

type DemoPhase = 'standby' | 'running' | 'paused' | 'gate' | 'complete';
type NodeKind = 'endpoint'|'access'|'upf'|'router'|'service'|'idm'|'agent'|'srf'|'scf'|'up'|'gw'|'robot'|'arm';
type LinkKind = 'baseline' | 'bus' | 'logic' | 'wireless';

type DemoNodeData = { 
  label: string; 
  kind: NodeKind;
  status?: string;
  role?: string; 
  active?: boolean; 
  processing?: boolean;
  context?: boolean;
  emphasis?: boolean; 
  handles?: string[];
  appearance?: 'default' | 'phone' | 'robot' | 'robot-arm' | 'gateway' | 'pill';
  message?: string;
  plan?: { title: string; items: Array<{ id: string; label: string; done: boolean; active: boolean }> };
};
type DemoEdgeData = { kind: LinkKind; state: 'idle'|'active'|'selected'; note?: string; tone?: string; };
type RegionNodeData = { label: string; variant?: 'domain' | 'subdomain' | 'family' | 'external'; };
type BusNodeData = { label: string; caption: string; idm: string; acnAgent: string; srf: string; scf: string; up: string; cmccGw: string; context?: boolean; emphasis?: boolean; };
type ScriptBubble = { node: string; text: string };
type ScriptAction = {
  id: string;
  kind: 'talk' | 'flash';
  path?: string[];
  nodes?: string[];
  bubbles?: ScriptBubble[];
  revealNodes?: string[];
  delayMs?: number;
};
type ScriptChecklist = {
  id: string;
  title?: string;
  type: 'checklist';
  delayMs?: number;
  items: ScriptAction[];
};
type ScriptStep = ScriptAction | ScriptChecklist;
type ScriptStage = { id: string; title: string; steps: ScriptStep[] };
type DemoScript = {
  standby: {
    hiddenNodes: string[];
    hiddenRegions: string[];
  };
  stages: ScriptStage[];
};
type FlatAction = ScriptAction & {
  stageId: string;
  stageTitle: string;
  stageIndex: number;
  stepLabel: string;
  checklistTitle?: string;
};
type PlaybackFrame = {
  phase: DemoPhase;
  stageIndex: number;
  actionIndex: number;
  actionId?: string;
  activeEdgeTone?: string;
  currentStageTitle?: string;
  nextStageTitle?: string;
  currentStepLabel?: string;
  activeNodeIds: string[];
  activeEdgeIds: string[];
  visibleNodeIds: string[];
  revealedNodeIds: string[];
  bubbles: Record<string, string>;
  planBubble?: { nodeId: string; title: string; items: Array<{ id: string; label: string; done: boolean; active: boolean }> };
  checklistItems: Array<{ id: string; label: string; done: boolean; active: boolean }>;
};

const ACTION_DELAY_MS = 5000;
const DEFAULT_SCRIPT_YAML = `standby:
  hiddenNodes:
    - robot-dog
  hiddenRegions:
    - r-family
stages:
  - id: stage-1
    title: STAGE 1
    steps:
      - id: stage1-robot-dog-to-acn
        kind: talk
        path: [robot-dog, acn-agent]
        bubbles:
          - node: robot-dog
            text: "Apply for digital ID and Create domain"
        revealNodes:
          - robot-dog
      - id: stage1-checklist
        type: checklist
        title: acn agent bubbles a checklist
        delayMs: 3500
        items:
          - id: stage1-apply-digital-id
            kind: talk
            path: [acn-agent, idm]
            delayMs: 2500
            bubbles:
              - node: idm
                text: "digital id assigned: DIDI"
              - node: robot-dog
                text: "DIDI"
          - id: stage1-publish-agent-card
            kind: talk
            path: [acn-agent, agent-gw]
            delayMs: 2500
            bubbles:
              - node: agent-gw
                text: "agent card added: DIDI"
          - id: stage1-setup-family-domain
            kind: talk
            path: [acn-agent, up, scf]
            delayMs: 3500
            bubbles:
              - node: up
                text: Family Domain created
            revealNodes:
              - robot-dog
  - id: stage-2
    title: STAGE 2
    steps:
      - id: stage2-phone-to-ordering
        kind: talk
        path: [phone, ott-ordering]
        bubbles:
          - node: phone
            text: "placing order"
          - node: agent-gw
            text: "Agent protocol converted"
          - node: ott-ordering
            text: "order received"
      - id: stage2-checklist
        type: checklist
        title: Ordering Agent order ready for pickup
        delayMs: 3200
        items:
          - id: stage2-discover-delivery-agent
            kind: talk
            path: [ott-ordering, mno-gw]
            delayMs: 2600
          - id: stage2-assign-delivery-task
            kind: talk
            path: [ott-ordering, mno-endpoint]
            delayMs: 2600
            bubbles:
              - node: mno-endpoint
                text: "task received"
  - id: stage-3
    title: STAGE 3
    steps:
      - id: stage3-notify-user
        kind: talk
        path: [ott-ordering, phone]
        bubbles:
          - node: phone
            text: "Robot arm ID received"
  - id: stage-4
    title: STAGE 4
    steps:
      - id: stage4-location
        kind: talk
        path: [mno-endpoint, robot-dog]
        bubbles:
          - node: mno-endpoint
            text: "my location is at (coordinate PLACEHOLDER)"
      - id: stage4-verify
        type: checklist
        title: Robot Arm -> Robot Dog
        delayMs: 3200
        items:
          - id: stage4-dog-verify
            kind: talk
            path: [mno-endpoint, robot-dog]
            delayMs: 2500
            bubbles:
              - node: robot-dog
                text: "verify peer digital id"
          - id: stage4-arm-verify
            kind: talk
            path: [mno-endpoint, robot-dog]
            delayMs: 2500
            bubbles:
              - node: mno-endpoint
                text: "verify peer digital id"
          - id: stage4-idm-flash
            kind: flash
            delayMs: 1800
            nodes: [idm]
`;

function parseDemoScript(text: string): DemoScript {
  const raw = loadYaml(text) as any;
  if (!raw || typeof raw !== 'object') {
    throw new Error('YAML must define a demo object.');
  }

  const standby = raw.standby ?? {};
  const stages = Array.isArray(raw.stages) ? raw.stages : [];

  return {
    standby: {
      hiddenNodes: Array.isArray(standby.hiddenNodes) ? standby.hiddenNodes.filter((value: any) => typeof value === 'string') : [],
      hiddenRegions: Array.isArray(standby.hiddenRegions) ? standby.hiddenRegions.filter((value: any) => typeof value === 'string') : [],
    },
    stages: stages.map((stage: any, stageIndex: number) => ({
      id: String(stage?.id ?? `stage-${stageIndex + 1}`),
      title: String(stage?.title ?? `STAGE ${stageIndex + 1}`),
      steps: Array.isArray(stage?.steps)
        ? stage.steps.map((step: any, stepIndex: number) => normalizeStep(step, stageIndex, stepIndex))
        : [],
    })),
  };
}

function normalizeStep(step: any, stageIndex: number, stepIndex: number): ScriptStep {
  if (step && step.type === 'checklist') {
    return {
      id: String(step.id ?? `stage-${stageIndex + 1}-step-${stepIndex + 1}`),
      type: 'checklist',
      title: step.title ? String(step.title) : undefined,
      delayMs: typeof step.delayMs === 'number' && Number.isFinite(step.delayMs) ? step.delayMs : undefined,
      items: Array.isArray(step.items)
        ? step.items.map((item: any, itemIndex: number) => normalizeTalkAction(item, stageIndex, stepIndex, itemIndex))
        : [],
    };
  }
  return normalizeTalkAction(step, stageIndex, stepIndex, 0);
}

function normalizeTalkAction(step: any, stageIndex: number, stepIndex: number, itemIndex: number): ScriptAction {
  return {
    id: String(step?.id ?? `stage-${stageIndex + 1}-step-${stepIndex + 1}-item-${itemIndex + 1}`),
    kind: step?.kind === 'flash' ? 'flash' : 'talk',
    path: Array.isArray(step?.path) ? step.path.filter((value: any) => typeof value === 'string') : undefined,
    nodes: Array.isArray(step?.nodes) ? step.nodes.filter((value: any) => typeof value === 'string') : undefined,
    delayMs: typeof step?.delayMs === 'number' && Number.isFinite(step.delayMs) ? step.delayMs : undefined,
    bubbles: Array.isArray(step?.bubbles)
      ? step.bubbles
          .filter((bubble: any) => bubble && typeof bubble === 'object' && typeof bubble.node === 'string' && typeof bubble.text === 'string')
          .map((bubble: any) => ({ node: bubble.node, text: bubble.text }))
      : undefined,
    revealNodes: Array.isArray(step?.revealNodes) ? step.revealNodes.filter((value: any) => typeof value === 'string') : undefined,
  };
}

function flattenStage(stage: ScriptStage): FlatAction[] {
  const actions: FlatAction[] = [];
  for (const step of stage.steps) {
    if ('type' in step && step.type === 'checklist') {
      const checklistDelayMs = step.delayMs;
      step.items.forEach((item) => {
        actions.push({
          ...(item as ScriptAction),
          delayMs: item.delayMs ?? checklistDelayMs,
          stageId: stage.id,
          stageTitle: stage.title,
          stageIndex: 0,
          stepLabel: checklistDisplayId(item.id),
          checklistTitle: step.title,
        } as FlatAction);
      });
      continue;
    }
    const action = step as ScriptAction;
    actions.push({
      ...action,
      stageId: stage.id,
      stageTitle: stage.title,
      stageIndex: 0,
      stepLabel: describeAction(action),
    } as FlatAction);
  }
  return actions;
}

function describeAction(action: ScriptAction, fallback?: string) {
  if (action.kind === 'flash') {
    if (action.nodes?.length) {
      return `flash: ${action.nodes.join(', ')}`;
    }
    return fallback ?? 'flash';
  }
  if (action.path?.length) {
    return `${action.path.join(' -> ')}`;
  }
  return fallback ?? action.id;
}

function checklistDisplayId(id: string) {
  return id.replace(/^stage\d+-/, '');
}

function deriveVisibleNodeIds(script: DemoScript, revealedNodeIds: string[]) {
  const visible = new Set<string>();
  for (const node of [...ALL_NODE_IDS, ...ALL_REGION_IDS]) {
    visible.add(node);
  }
  for (const hidden of script.standby.hiddenNodes) {
    visible.delete(hidden);
  }
  for (const hidden of script.standby.hiddenRegions) {
    visible.delete(hidden);
  }
  for (const revealed of revealedNodeIds) {
    visible.add(revealed);
  }
  return [...visible];
}

function createStandbyFrame(script: DemoScript): PlaybackFrame {
    return {
      phase: 'standby',
      stageIndex: -1,
      actionIndex: -1,
      activeEdgeTone: undefined,
      activeNodeIds: [],
      activeEdgeIds: [],
      visibleNodeIds: deriveVisibleNodeIds(script, []),
      revealedNodeIds: [],
      bubbles: {},
      planBubble: undefined,
      checklistItems: [],
    };
}

function buildPlaybackFrame(script: DemoScript, stageIndex: number, actionIndex: number, phase: DemoPhase, revealedNodeIds: string[]): PlaybackFrame {
  const stage = script.stages[stageIndex];
  if (!stage) {
    return {
      phase: 'complete',
      stageIndex,
      actionIndex,
      activeEdgeTone: undefined,
      activeNodeIds: [],
      activeEdgeIds: [],
      visibleNodeIds: deriveVisibleNodeIds(script, revealedNodeIds),
      revealedNodeIds,
      bubbles: {},
      planBubble: undefined,
      checklistItems: [],
    };
  }

  const actions = flattenStage(stage);
  const action = actions[actionIndex];
  const nextStage = script.stages[stageIndex + 1];
  const checklistItems = actions.map((item, index) => ({
    id: item.id,
    label: item.checklistTitle ? checklistDisplayId(item.id) : item.stepLabel,
    done: index < actionIndex || (action.checklistTitle === item.checklistTitle && index === actionIndex),
    active: index === actionIndex,
  }));

  if (!action) {
    return {
      phase,
      stageIndex,
      actionIndex,
      activeEdgeTone: undefined,
      currentStageTitle: stage.title,
      nextStageTitle: nextStage?.title ?? 'Finish',
      activeNodeIds: [],
      activeEdgeIds: [],
      visibleNodeIds: deriveVisibleNodeIds(script, revealedNodeIds),
      revealedNodeIds,
      bubbles: {},
      planBubble: undefined,
      checklistItems,
    };
  }

  const pathNodeIds = action.path ?? action.nodes ?? [];
  const edgeIds = resolvePathEdgeIds(pathNodeIds);
  const bubbles = Object.fromEntries((action.bubbles ?? []).map((bubble) => [bubble.node, bubble.text]));
  const checklistGroup = action.checklistTitle
    ? actions.filter((item) => item.checklistTitle === action.checklistTitle)
    : [];
  const currentChecklistIndex = action.checklistTitle
    ? checklistGroup.findIndex((item) => item.id === action.id)
    : -1;
  const currentVisible = new Set(deriveVisibleNodeIds(script, revealedNodeIds));
  for (const nodeId of action.revealNodes ?? []) {
    currentVisible.add(nodeId);
  }
  const bubbleNodeIds = (action.bubbles ?? []).map((bubble) => bubble.node);
  const activeNodeIds = action.kind === 'flash'
    ? [...new Set([...(action.nodes ?? []), ...bubbleNodeIds])]
    : [...new Set([
        ...(pathNodeIds.length ? [pathNodeIds[0], pathNodeIds[pathNodeIds.length - 1]] : []),
        ...bubbleNodeIds,
        ...(action.revealNodes ?? []),
      ])];

  return {
    phase,
    stageIndex,
    actionIndex,
    actionId: action.id,
    activeEdgeTone: action.kind === 'talk' ? '#7c3aed' : '#10b981',
    currentStageTitle: stage.title,
    nextStageTitle: nextStage?.title ?? 'Finish',
    currentStepLabel: action.stepLabel,
    activeNodeIds,
    activeEdgeIds: edgeIds,
    visibleNodeIds: [...currentVisible],
    revealedNodeIds: [...new Set([...revealedNodeIds, ...(action.revealNodes ?? [])])],
    bubbles,
    planBubble: action.checklistTitle ? {
      nodeId: action.path?.[0] ?? action.nodes?.[0] ?? action.id,
      title: action.checklistTitle,
      items: checklistGroup.map((item, index) => ({
        id: item.id,
        label: checklistDisplayId(item.id),
        done: index <= currentChecklistIndex,
        active: index === currentChecklistIndex,
      })),
    } : undefined,
    checklistItems,
  };
}

function resolveActionDelay(action?: FlatAction) {
  if (!action || typeof action.delayMs !== 'number' || !Number.isFinite(action.delayMs)) {
    return ACTION_DELAY_MS;
  }
  return Math.max(0, action.delayMs);
}

function applyActionReveal(revealedNodeIds: string[], action?: FlatAction) {
  if (!action) {
    return revealedNodeIds;
  }
  return [...new Set([...revealedNodeIds, ...(action.revealNodes ?? [])])];
}

function resolvePathEdgeIds(pathNodeIds: string[]) {
  if (pathNodeIds.length < 2) {
    return [];
  }
  const edgeIds: string[] = [];
  for (let index = 0; index < pathNodeIds.length - 1; index += 1) {
    const source = pathNodeIds[index];
    const target = pathNodeIds[index + 1];
    edgeIds.push(...findPathEdgesBetween(source, target));
  }
  return edgeIds;
}

function findPathEdgesBetween(source: string, target: string) {
  if (source === target) {
    return [];
  }
  const queue: string[] = [source];
  const visited = new Set<string>([source]);
  const previous = new Map<string, { node: string; edgeId: string }>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const neighbors = GRAPH_ADJACENCY.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor.node)) continue;
      visited.add(neighbor.node);
      previous.set(neighbor.node, { node: current, edgeId: neighbor.edgeId });
      if (neighbor.node === target) {
        queue.length = 0;
        break;
      }
      queue.push(neighbor.node);
    }
  }

  if (!previous.has(target)) {
    return [];
  }

  const edgeIds: string[] = [];
  let cursor = target;
  while (cursor !== source) {
    const previousEntry = previous.get(cursor);
    if (!previousEntry) break;
    edgeIds.unshift(previousEntry.edgeId);
    cursor = previousEntry.node;
  }
  return edgeIds;
}

function edgeKey(source: string, target: string) {
  return source < target ? `${source}::${target}` : `${target}::${source}`;
}

const ALL_NODE_IDS = [
  'bus-line',
  'idm',
  'acn-agent',
  'srf',
  'scf',
  'up',
  'agent-gw',
  'ran',
  'phone',
  'robot-dog',
  'ott-ordering',
  'ott-gw',
  'mno-gw',
  'mno-endpoint',
] as const;

const ALL_REGION_IDS = ['r-ott', 'r-mno-b', 'r-core', 'r-family'] as const;

const GRAPH_EDGE_INDEX = new Map<string, string>([
  [edgeKey('agent-gw', 'ott-gw'), 'e-cmcc-ott-gw'],
  [edgeKey('agent-gw', 'mno-gw'), 'e-cmcc-mno-gw'],
  [edgeKey('acn-agent', 'bus-line'), 'e-agent-bus'],
  [edgeKey('idm', 'bus-line'), 'e-idm-bus'],
  [edgeKey('bus-line', 'scf'), 'e-bus-scf'],
  [edgeKey('bus-line', 'srf'), 'e-bus-srf'],
  [edgeKey('bus-line', 'up'), 'e-bus-up'],
  [edgeKey('bus-line', 'agent-gw'), 'e-bus-cmcc-gw'],
  [edgeKey('phone', 'ran'), 'e-ran-phone'],
  [edgeKey('ran', 'robot-dog'), 'e-ran-dog'],
  [edgeKey('ran', 'srf'), 'e-srf-ran'],
  [edgeKey('ran', 'up'), 'e-up-ran'],
  [edgeKey('agent-gw', 'up'), 'e-up-gw'],
  [edgeKey('mno-gw', 'mno-endpoint'), 'e-mno-gw-endpoint'],
  [edgeKey('mno-gw', 'ott-gw'), 'e-ott-gw-mno-gw'],
  [edgeKey('ott-gw', 'ott-ordering'), 'e-ott-gw-ordering'],
]);

const GRAPH_ADJACENCY = new Map<string, Array<{ node: string; edgeId: string }>>();
for (const [edgePair, edgeId] of GRAPH_EDGE_INDEX.entries()) {
  const [left, right] = edgePair.split('::');
  const leftNeighbors = GRAPH_ADJACENCY.get(left) ?? [];
  leftNeighbors.push({ node: right, edgeId });
  GRAPH_ADJACENCY.set(left, leftNeighbors);
  const rightNeighbors = GRAPH_ADJACENCY.get(right) ?? [];
  rightNeighbors.push({ node: left, edgeId });
  GRAPH_ADJACENCY.set(right, rightNeighbors);
}

const nodeTypes: NodeTypes = { mission: MissionNode, region: RegionNode, bus: BusNode };
const kindMeta: Record<NodeKind, { icon: any; tint: string }> = {
  endpoint: { icon: Smartphone, tint: 'var(--node-blue)' }, 
  access: { icon: Radio, tint: 'var(--node-green)' }, 
  upf: { icon: Router, tint: 'var(--node-cyan)' }, 
  router: { icon: Repeat, tint: 'var(--node-amber)' }, 
  service: { icon: Cpu, tint: 'var(--node-pink)' },
  idm: { icon: UserCheck, tint: '#6366f1' },
  agent: { icon: BrainCircuit, tint: '#8b5cf6' },
  srf: { icon: Settings, tint: '#ec4899' },
  scf: { icon: Settings2, tint: '#f43f5e' },
  up: { icon: Database, tint: '#06b6d4' },
  gw: { icon: Waypoints, tint: '#f59e0b' },
  robot: { icon: Bot, tint: '#0f766e' },
  arm: { icon: Wrench, tint: '#f97316' },
};

export default function App() { return ( <ReactFlowProvider><Dashboard /></ReactFlowProvider> ); }

function Dashboard() {
  const [sidebarTab, setSidebarTab] = useState<'playback' | 'script'>('playback');
  const [isLocked, setIsLocked] = useState(true);
  const [scriptText, setScriptText] = useState(DEFAULT_SCRIPT_YAML);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptDoc, setScriptDoc] = useState<DemoScript>(() => parseDemoScript(DEFAULT_SCRIPT_YAML));
  const [playback, setPlayback] = useState<PlaybackFrame>(() => createStandbyFrame(parseDemoScript(DEFAULT_SCRIPT_YAML)));
  const [nodes, setNodes] = useState<Node[]>(() => buildGraph(scriptDoc, playback).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => buildGraph(scriptDoc, playback).edges);
  const scriptRef = useRef(scriptDoc);
  const playbackRef = useRef(playback);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    scriptRef.current = scriptDoc;
  }, [scriptDoc]);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const applyScriptText = useCallback((nextText: string) => {
    setScriptText(nextText);
    try {
      const parsed = parseDemoScript(nextText);
      setScriptDoc(parsed);
      setScriptError(null);
      setPlayback(createStandbyFrame(parsed));
    } catch (error) {
      setScriptError(error instanceof Error ? error.message : 'Unable to parse YAML.');
    }
  }, []);

  const getActionsForStage = useCallback((script: DemoScript, stageIndex: number) => {
    const stage = script.stages[stageIndex];
    return stage ? flattenStage(stage) : [];
  }, []);

  const updatePlayback = useCallback((mode: 'start' | 'continue' | 'timer' | 'pause' | 'reset') => {
    clearTimer();
    setPlayback((prev) => {
      const script = scriptRef.current;
      if (mode === 'reset') {
        return createStandbyFrame(script);
      }
      if (mode === 'pause') {
        return prev.phase === 'running' ? { ...prev, phase: 'paused' } : prev;
      }
      if (mode === 'start') {
        if (prev.phase === 'running' || prev.phase === 'gate') {
          return prev;
        }
        if (prev.phase === 'paused') {
          return { ...prev, phase: 'running' };
        }
        if (script.stages.length === 0) {
          return createStandbyFrame(script);
        }
        return buildPlaybackFrame(script, 0, 0, 'running', []);
      }
      if (mode === 'continue') {
        if (prev.phase !== 'gate') {
          return prev;
        }
        const nextStageIndex = prev.stageIndex + 1;
        if (nextStageIndex >= script.stages.length) {
          return {
            ...prev,
            phase: 'complete',
            nextStageTitle: 'Finish',
            activeNodeIds: [],
            activeEdgeIds: [],
            bubbles: {},
          };
        }
        return buildPlaybackFrame(script, nextStageIndex, 0, 'running', prev.revealedNodeIds);
      }
      if (prev.phase !== 'running') {
        return prev;
      }
      const actions = getActionsForStage(script, prev.stageIndex);
      const currentAction = actions[prev.actionIndex];
      const revealed = applyActionReveal(prev.revealedNodeIds, currentAction);
      const nextActionIndex = prev.actionIndex + 1;
      if (nextActionIndex < actions.length) {
        return buildPlaybackFrame(script, prev.stageIndex, nextActionIndex, 'running', revealed);
      }
      return buildPlaybackFrame(script, prev.stageIndex, prev.actionIndex, 'gate', revealed);
    });
  }, [clearTimer, getActionsForStage]);

  useEffect(() => {
    const graph = buildGraph(scriptDoc, playback);
    setNodes((prev) => graph.nodes.map((node) => {
      const previous = prev.find((candidate) => candidate.id === node.id);
      return previous ? { ...node, position: previous.position } : node;
    }));
    setEdges(graph.edges);
  }, [playback, scriptDoc]);

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

  const currentStage = scriptDoc.stages[playback.stageIndex];
  const nextStage = scriptDoc.stages[playback.stageIndex + 1];
  const stageActions = currentStage ? flattenStage(currentStage) : [];
  const activeAction = stageActions[playback.actionIndex];

  useEffect(() => {
    clearTimer();
    if (playback.phase !== 'running') {
      return undefined;
    }
    const delayMs = resolveActionDelay(activeAction);
    timerRef.current = window.setTimeout(() => {
      updatePlayback('timer');
    }, delayMs);
    return () => clearTimer();
  }, [activeAction, clearTimer, playback.actionIndex, playback.phase, playback.stageIndex, updatePlayback]);

  const currentStatus = playback.phase === 'standby'
    ? 'STANDBY'
    : playback.phase === 'complete'
      ? 'COMPLETE'
      : currentStage?.title ?? 'STAGE';
  const nextStatus = playback.phase === 'gate'
    ? nextStage?.title ?? 'Finish'
    : nextStage?.title ?? 'Finish';

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="header-left">
          <Network className="text-blue-500" size={24} />
          <h1 className="dashboard-title">CMCC Redesign Demo</h1>
          <div className="control-group ml-10">
            <StatusBadge label={playback.phase === 'running' ? 'Live' : playback.phase === 'gate' ? 'Gate' : playback.phase === 'paused' ? 'Paused' : 'Ready'} tone={playback.phase === 'running' ? 'live' : playback.phase === 'gate' ? 'accent' : playback.phase === 'paused' ? 'accent' : 'idle'} />
          </div>
        </div>
        <div className="header-right">
          <div className="playback-status">
            <div className="playback-status-line"><span className="playback-status-label">Current</span><span className="playback-status-value">{currentStatus}</span></div>
            <div className="playback-status-line"><span className="playback-status-label">Next</span><span className="playback-status-value">{nextStatus}</span></div>
            <div className="playback-status-line"><span className="playback-status-label">Step</span><span className="playback-status-value">{activeAction?.stepLabel ?? 'Idle'}</span></div>
          </div>
          <div className="control-group">
            {!isLocked && <button className="primary-button" style={{ background: '#334155' }} onClick={copyLayout}>Export JSON</button>}
            <button className={cn("primary-button", isLocked ? "bg-slate-600!" : "bg-emerald-600!")} onClick={() => setIsLocked(!isLocked)}>
              {isLocked ? <Lock size={16} className="mr-2" /> : <Unlock size={16} className="mr-2" />}
              {isLocked ? 'Unlock' : 'Lock'}
            </button>
            <button className="primary-button" onClick={() => updatePlayback('start')}><Play size={16} fill="currentColor" />Start</button>
            <button className="primary-button" onClick={() => updatePlayback('pause')}><Square size={14} fill="currentColor" />Pause</button>
            <button className="primary-button" onClick={() => updatePlayback('reset')}>Reset</button>
            {playback.phase === 'gate' && <button className="primary-button" onClick={() => updatePlayback('continue')}>Continue</button>}
          </div>
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
          <div className="sidebar-tabs">
            <button className={cn('sidebar-tab', sidebarTab === 'playback' && 'sidebar-tab-active')} onClick={() => setSidebarTab('playback')}>Playback</button>
            <button className={cn('sidebar-tab', sidebarTab === 'script' && 'sidebar-tab-active')} onClick={() => setSidebarTab('script')}>Script</button>
          </div>
          {sidebarTab === 'playback' ? (
            <>
              <Panel label="Flow Status">
                <StatItem label="Current" value={currentStatus} />
                <StatItem label="Next" value={nextStatus} />
                <StatItem label="Gate" value={playback.phase === 'gate' ? 'Waiting continue' : playback.phase === 'running' ? 'Running' : playback.phase === 'paused' ? 'Paused' : playback.phase === 'complete' ? 'Complete' : 'Standby'} />
              </Panel>
              <Panel label="Step Queue">
                <div className="step-queue">
                  {stageActions.map((action, index) => (
                    <div key={action.id} className={cn('step-queue-item', index === playback.actionIndex && 'step-queue-item-active', index < playback.actionIndex && 'step-queue-item-done')}>
                      <span className="step-queue-dot">{index < playback.actionIndex ? '✓' : index === playback.actionIndex ? '•' : ''}</span>
                      <div className="step-queue-copy">
                        <div className="step-queue-label">{action.checklistTitle ?? currentStage?.title ?? 'Step'}</div>
                        <div className="step-queue-value">{action.stepLabel}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel label="Status">
                <div className="panel-card bg-slate-50 border-dashed mt-1 min-h-[60px] flex items-center justify-center">
                  <p className="text-[0.7rem] text-muted italic text-center px-4">{playback.currentStepLabel ?? 'Standby'}</p>
                </div>
              </Panel>
            </>
          ) : (
            <Panel label="YAML Script">
              <textarea
                className="script-editor"
                value={scriptText}
                onChange={(event) => applyScriptText(event.target.value)}
                spellCheck={false}
              />
              {scriptError && <div className="script-error">{scriptError}</div>}
            </Panel>
          )}
        </aside>
      </main>
    </div>
  );
}

function Panel({ label, children }: any) { return ( <div className="panel-section"><div className="panel-label">{label}</div>{children}</div> ); }
function StatItem({ label, value }: any) { return ( <div className="stat-item"><span className="stat-label">{label}</span><span className="stat-value">{value}</span></div> ); }

function MissionNode({ data }: NodeProps<Node<DemoNodeData>>) {
  const meta = kindMeta[data.kind] || { icon: Globe, tint: '#64748b' };
  const detailLine = data.role || data.status || data.kind;
  const handles = new Set(data.handles || []);
  const isCompactDevice = data.appearance === 'phone' || data.appearance === 'robot' || data.appearance === 'robot-arm' || data.appearance === 'pill';

  return (
    <div className={cn(
      "mission-node-shell",
      data.kind === 'agent' && "mission-node-agent-shell",
      data.context && "mission-node-context",
      data.emphasis && "mission-node-emphasis",
      data.active && "mission-node-active-shell",
      data.appearance === 'gateway' && "mission-node-gateway-shell",
      data.appearance === 'pill' && "mission-node-pill-shell",
      data.appearance === 'phone' && "mission-node-phone-shell",
      (data.appearance === 'robot' || data.appearance === 'robot-arm') && "mission-node-robot-shell",
      data.kind === 'robot' && data.processing && data.message && "mission-node-robot-bubble",
      ((data.processing && data.message) || data.plan) && "mission-node-with-bubble",
    )} style={{ '--node-tint': meta.tint } as any}>
      {data.plan && (
        <div className="mission-node-plan">
          <div className="mission-node-plan-header">
            <LoaderCircle size={12} className="mission-node-plan-icon" />
            <span className="mission-node-plan-title">Plan</span>
            <span className="mission-node-plan-name">{data.plan.title}</span>
          </div>
          <div className="mission-node-plan-list">
            {data.plan.items.map((item) => (
              <div key={item.id} className={cn("mission-node-plan-item", item.active && "mission-node-plan-item-active", item.done && "mission-node-plan-item-done")}>
                <span className="mission-node-plan-check">{item.done ? '✓' : ''}</span>
                <span className="mission-node-plan-text">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.message && (
        <div className="mission-node-bubble">
          <LoaderCircle size={12} className="mission-node-bubble-icon" />
          <span>{data.message}</span>
        </div>
      )}
      <div className={cn("mission-node", data.active && "mission-node-active")}>
        <div className="mission-node-head">
          <div className={cn("mission-node-icon", data.appearance === 'phone' && "mission-node-icon-phone", (data.appearance === 'robot' || data.appearance === 'robot-arm') && "mission-node-icon-robot")}><meta.icon size={16} /></div>
          <div>
            <div className="mission-node-label">{data.label}</div>
            {!isCompactDevice && (
              <div className="mission-node-meta">
                <span className="mission-node-role">{detailLine}</span>
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
      {handles.has('in-top-left') && <Handle id="in-top-left" type="target" position={Position.Top} className="mission-handle mission-handle-top" style={{ left: '38%' }} />}
      {handles.has('in-top-right') && <Handle id="in-top-right" type="target" position={Position.Top} className="mission-handle mission-handle-top" style={{ left: '68%' }} />}
      {handles.has('out-top-left') && <Handle id="out-top-left" type="source" position={Position.Top} className="mission-handle mission-handle-top" style={{ left: '38%' }} />}
      {handles.has('out-top-right') && <Handle id="out-top-right" type="source" position={Position.Top} className="mission-handle mission-handle-top" style={{ left: '68%' }} />}
      {data.label === 'RAN' && handles.has('out-top-left') && (
        <div className="handle-label handle-label-top-left">n2</div>
      )}
      {data.label === 'RAN' && handles.has('out-top-right') && (
        <div className="handle-label handle-label-top-right">n3</div>
      )}
      {data.label === 'SRF' && handles.has('out-bottom') && (
        <div className="handle-label handle-label-bottom-left">n2</div>
      )}
      {data.label === 'UP' && handles.has('out-bottom-right') && (
        <div className="handle-label handle-label-bottom-right">n3</div>
      )}
      {handles.has('out-right-top') && <Handle id="out-right-top" type="source" position={Position.Right} className="mission-handle mission-handle-right" style={{ top: '38%' }} />}
      {handles.has('out-right-bottom') && <Handle id="out-right-bottom" type="source" position={Position.Right} className="mission-handle mission-handle-right" style={{ top: '68%' }} />}
      {handles.has('out-bottom-left') && <Handle id="out-bottom-left" type="source" position={Position.Bottom} className="mission-handle mission-handle-bottom" style={{ left: '38%' }} />}
      {handles.has('out-bottom-right') && <Handle id="out-bottom-right" type="source" position={Position.Bottom} className="mission-handle mission-handle-bottom" style={{ left: '68%' }} />}
    </div>
  );
}

function MissionEdge(props: EdgeProps<Edge<DemoEdgeData>>) {
  const { kind = 'baseline', state = 'idle', note, tone } = props.data || {};
  const [path, labelX, labelY] = kind === 'bus'
    ? getStraightPath(props)
    : getBezierPath({
        ...props,
        curvature: kind === 'wireless' ? 0.2 : 0.16,
      });
  const isSelected = state === 'selected';
  const isActive = state === 'active' || isSelected;
  const isRanSrf = props.id === 'e-srf-ran';
  const isDataPipe = props.id === 'e-up-ran' || props.id === 'e-up-gw';
  const activeColor = tone ?? (
    kind === 'bus' ? '#5b6cff'
    : kind === 'logic' ? '#ec4899'
    : kind === 'wireless' ? '#0284c7'
    : isRanSrf ? '#64748b'
    : '#10b981'
  );
  const color = state === 'idle'
    ? kind === 'bus' ? '#7c8cff'
    : isDataPipe ? '#94a3b8'
    : kind === 'wireless' ? '#7dd3fc'
    : isRanSrf ? '#94a3b8'
    : '#7c8ca3'
    : activeColor;
  const dash = kind === 'wireless' ? '3 4' : isDataPipe ? (isActive ? '10 7' : undefined) : isActive ? '6 5' : undefined;
  const strokeWidth = isSelected
    ? isDataPipe ? 4.8
    : 3.05
    : isActive
      ? isDataPipe ? 4.35
      : 1.9
      : kind === 'wireless' ? 1.8
      : isDataPipe ? 3.7
      : 1.35;
  const opacity = isSelected ? 1 : isActive ? (isDataPipe ? 0.94 : 0.88) : kind === 'wireless' ? 0.72 : isDataPipe ? 0.82 : 0.66;
  const className = isSelected ? "edge-selected edge-animated" : isActive ? "edge-active edge-animated" : "edge-idle";
  return (
    <>
      <BaseEdge path={path} className={className} style={{ stroke: color, strokeWidth, strokeDasharray: dash, strokeLinecap: 'round', transition: 'all 0.5s', opacity }} />
      {note && (
        <foreignObject
          width={56}
          height={20}
          x={labelX - 28}
          y={labelY - 10}
          className="edge-note-fo"
          requiredExtensions="http://www.w3.org/1999/xhtml"
        >
          <div className="edge-note">{note}</div>
        </foreignObject>
      )}
    </>
  );
}

function RegionNode({ data }: NodeProps<Node<RegionNodeData>>) {
  return <div className={cn(
    "region-node",
    data.variant === 'subdomain' && "region-node-subdomain",
    data.variant === 'family' && "region-node-family",
    data.variant === 'external' && "region-node-external",
  )}>{data.label}</div>;
}

function BusNode({ data }: NodeProps<Node<BusNodeData>>) {
  return (
    <div className={cn("bus-node-shell", data.context && "bus-node-context", data.emphasis && "bus-node-emphasis")}>
      <div className="bus-node-header">
        <span className="bus-node-pill">
          <Sparkles size={14} />
          {data.label}
        </span>
        <span className="bus-node-caption">{data.caption}</span>
      </div>
      <div className="bus-backbone">
      </div>

      <Handle type="source" position={Position.Top} id="h-b-idm" style={{ left: data.idm, top: 24, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Top} id="h-b-agent" style={{ left: data.acnAgent, top: 24, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="h-t-srf" style={{ left: data.srf, bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />

      <Handle type="source" position={Position.Bottom} id="h-b-scf" style={{ left: data.scf, bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="h-b-up" style={{ left: data.up, bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="h-b-gw" style={{ left: data.cmccGw, bottom: 10, background: 'transparent', border: 'none', opacity: 0 }} />
    </div>
  );
}

function StatusBadge({ label, tone }: any) { return <span className={cn('status-badge', `status-badge-${tone}`)}>{label}</span>; }

const LAYOUT = {
  ott: { x: 980, y: 72, width: 306, height: 228 },
  mno: { x: 980, y: 356, width: 326, height: 244 },
  core: { x: 36, y: 36, width: 860, height: 420 },
  access: { x: 36, y: 492, width: 760, height: 232 },
  bus: { x: 156, y: 212, width: 620, height: 42 },
  nodes: {
    idm: { x: 182, y: 116, width: 136 },
    acnAgent: { x: 614, y: 116, width: 136 },
    srf: { x: 150, y: 288, width: 128 },
    scf: { x: 322, y: 288, width: 128 },
    up: { x: 482, y: 288, width: 128 },
    cmccGw: { x: 649, y: 288, width: 138 },
    ran: { x: 131.51878794372163, y: 608, width: 128 },
    phone: { x: 334.2599135776096, y: 581.5939397186081, width: 104 },
    robotDog: { x: 331.4822512677762, y: 638.3716020284417, width: 126 },
    ottOrdering: { x: 1098.7776623098334, y: 93.77870152133133, width: 148 },
    ottGw: { x: 1000, y: 204, width: 144 },
    mnoGw: { x: 1000, y: 404, width: 144 },
    mnoEndpoint: { x: 1128, y: 516, width: 134 },
  },
} as const;

const FAMILY_LAYOUT = (() => {
  const left = Math.min(LAYOUT.nodes.phone.x, LAYOUT.nodes.robotDog.x) - 10;
  const right = Math.max(
    LAYOUT.nodes.phone.x + LAYOUT.nodes.phone.width,
    LAYOUT.nodes.robotDog.x + LAYOUT.nodes.robotDog.width,
  ) + 10;
  const top = Math.min(LAYOUT.nodes.phone.y, LAYOUT.nodes.robotDog.y) - 34;
  const bottom = Math.max(LAYOUT.nodes.phone.y, LAYOUT.nodes.robotDog.y) + 66;

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
})();

function buildGraph(_script: DemoScript, playback: PlaybackFrame) {
  const visibleSet = new Set(playback.visibleNodeIds);
  const activeNodeSet = new Set(playback.activeNodeIds);
  const activeEdgeSet = new Set(playback.activeEdgeIds);
  const busStops = {
    idm: `${((LAYOUT.nodes.idm.x + LAYOUT.nodes.idm.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    acnAgent: `${((LAYOUT.nodes.acnAgent.x + LAYOUT.nodes.acnAgent.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    srf: `${((LAYOUT.nodes.srf.x + LAYOUT.nodes.srf.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    scf: `${((LAYOUT.nodes.scf.x + LAYOUT.nodes.scf.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    up: `${((LAYOUT.nodes.up.x + LAYOUT.nodes.up.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
    cmccGw: `${((LAYOUT.nodes.cmccGw.x + LAYOUT.nodes.cmccGw.width / 2 - LAYOUT.bus.x) / LAYOUT.bus.width) * 100}%`,
  };

  const nodes: Node[] = [
    // Main Boxes
    { id: 'r-ott', type: 'region', hidden: !visibleSet.has('r-ott'), position: { x: LAYOUT.ott.x, y: LAYOUT.ott.y }, style: { width: LAYOUT.ott.width, height: LAYOUT.ott.height, zIndex: -1 }, data: { label: 'OTT', variant: 'external' }, draggable: false },
    { id: 'r-mno-b', type: 'region', hidden: !visibleSet.has('r-mno-b'), position: { x: LAYOUT.mno.x, y: LAYOUT.mno.y }, style: { width: LAYOUT.mno.width, height: LAYOUT.mno.height, zIndex: -1 }, data: { label: 'MNO B', variant: 'external' }, draggable: false },
    { id: 'r-core', type: 'region', hidden: !visibleSet.has('r-core'), position: { x: LAYOUT.core.x, y: LAYOUT.core.y }, style: { width: LAYOUT.core.width, height: LAYOUT.core.height, zIndex: -1 }, data: { label: 'CMCC Core Network', variant: 'domain' }, draggable: false },
    { id: 'r-family', type: 'region', hidden: !visibleSet.has('r-family'), position: { x: FAMILY_LAYOUT.x, y: FAMILY_LAYOUT.y }, style: { width: FAMILY_LAYOUT.width, height: FAMILY_LAYOUT.height, zIndex: -1 }, data: { label: 'Family Domain', variant: 'family' }, draggable: false },

    // Core network control
    { id: 'idm', type: 'mission', hidden: !visibleSet.has('idm'), position: { x: LAYOUT.nodes.idm.x, y: LAYOUT.nodes.idm.y }, style: { width: LAYOUT.nodes.idm.width }, data: { label: 'IDM', kind: 'idm', role: 'Identity Function', active: activeNodeSet.has('idm'), context: activeNodeSet.has('idm'), handles: ['in-bottom', 'out-bottom'], processing: playback.phase === 'running' && activeNodeSet.has('idm'), message: playback.bubbles.idm } },
    { id: 'acn-agent', type: 'mission', hidden: !visibleSet.has('acn-agent'), position: { x: LAYOUT.nodes.acnAgent.x, y: LAYOUT.nodes.acnAgent.y }, style: { width: LAYOUT.nodes.acnAgent.width }, data: { label: 'ACN Agent', kind: 'agent', role: 'Agent / Policy Function', active: activeNodeSet.has('acn-agent'), emphasis: true, handles: ['in-bottom', 'out-bottom'], processing: playback.phase === 'running' && activeNodeSet.has('acn-agent'), message: playback.bubbles['acn-agent'], plan: playback.planBubble && playback.planBubble.nodeId === 'acn-agent' ? { title: playback.planBubble.title, items: playback.planBubble.items } : undefined } },

    // ABI backbone
    { id: 'bus-line', type: 'bus', hidden: !visibleSet.has('bus-line'), position: { x: LAYOUT.bus.x, y: LAYOUT.bus.y }, style: { width: LAYOUT.bus.width, height: LAYOUT.bus.height, zIndex: 0 }, data: { label: 'ABI', caption: 'Agent Based Interface', context: playback.phase === 'running', emphasis: playback.phase === 'running' || playback.phase === 'gate', ...busStops }, draggable: false },

    // Core network services and transport
    { id: 'srf', type: 'mission', hidden: !visibleSet.has('srf'), position: { x: LAYOUT.nodes.srf.x, y: LAYOUT.nodes.srf.y }, style: { width: LAYOUT.nodes.srf.width }, data: { label: 'SRF', kind: 'srf', role: 'Service Routing Function', active: activeNodeSet.has('srf'), handles: ['in-top', 'in-bottom', 'out-bottom'], processing: playback.phase === 'running' && activeNodeSet.has('srf'), message: playback.bubbles.srf } },
    { id: 'scf', type: 'mission', hidden: !visibleSet.has('scf'), position: { x: LAYOUT.nodes.scf.x, y: LAYOUT.nodes.scf.y }, style: { width: LAYOUT.nodes.scf.width }, data: { label: 'SCF', kind: 'scf', role: 'Service Control Function', active: activeNodeSet.has('scf'), context: activeNodeSet.has('scf'), handles: ['in-top'], processing: playback.phase === 'running' && activeNodeSet.has('scf'), message: playback.bubbles.scf } },
    { id: 'up', type: 'mission', hidden: !visibleSet.has('up'), position: { x: LAYOUT.nodes.up.x, y: LAYOUT.nodes.up.y }, style: { width: LAYOUT.nodes.up.width, height: 64 }, data: { label: 'UP', kind: 'up', role: 'User Plane', active: activeNodeSet.has('up'), context: activeNodeSet.has('up'), handles: ['in-top', 'in-bottom', 'in-left', 'out-right'], appearance: 'gateway', processing: playback.phase === 'running' && activeNodeSet.has('up'), message: playback.bubbles.up } },
    { id: 'agent-gw', type: 'mission', hidden: !visibleSet.has('agent-gw'), position: { x: LAYOUT.nodes.cmccGw.x, y: LAYOUT.nodes.cmccGw.y }, style: { width: LAYOUT.nodes.cmccGw.width, height: 64 }, data: { label: 'Agent GW', kind: 'gw', role: 'CMCC Agent Gateway', active: activeNodeSet.has('agent-gw'), context: activeNodeSet.has('agent-gw'), handles: ['in-top', 'in-left', 'out-right-top', 'out-right-bottom'], appearance: 'gateway', processing: playback.phase === 'running' && activeNodeSet.has('agent-gw'), message: playback.bubbles['agent-gw'] } },
    { id: 'ran', type: 'mission', hidden: !visibleSet.has('ran'), position: { x: LAYOUT.nodes.ran.x, y: LAYOUT.nodes.ran.y }, style: { width: LAYOUT.nodes.ran.width }, data: { label: 'RAN', kind: 'access', role: 'Radio Access Network', active: activeNodeSet.has('ran'), handles: ['in-right', 'out-top-left', 'out-top-right', 'out-right-bottom'], appearance: 'pill', processing: playback.phase === 'running' && activeNodeSet.has('ran'), message: playback.bubbles.ran } },

    // Family domain
    { id: 'phone', type: 'mission', hidden: !visibleSet.has('phone'), position: { x: LAYOUT.nodes.phone.x, y: LAYOUT.nodes.phone.y }, style: { width: LAYOUT.nodes.phone.width }, data: { label: 'Phone', kind: 'endpoint', active: activeNodeSet.has('phone'), handles: ['in-left', 'out-left'], appearance: 'phone', processing: playback.phase === 'running' && activeNodeSet.has('phone'), message: playback.bubbles.phone } },
    { id: 'robot-dog', type: 'mission', hidden: !visibleSet.has('robot-dog'), position: { x: LAYOUT.nodes.robotDog.x, y: LAYOUT.nodes.robotDog.y }, style: { width: LAYOUT.nodes.robotDog.width }, data: { label: 'Robot Dog', kind: 'robot', active: activeNodeSet.has('robot-dog'), handles: ['in-left', 'out-left'], appearance: 'robot', processing: playback.phase === 'running' && activeNodeSet.has('robot-dog'), message: playback.bubbles['robot-dog'] } },

    // External Boxes Components
    { id: 'ott-ordering', type: 'mission', hidden: !visibleSet.has('ott-ordering'), position: { x: LAYOUT.nodes.ottOrdering.x, y: LAYOUT.nodes.ottOrdering.y }, style: { width: LAYOUT.nodes.ottOrdering.width }, data: { label: 'Ordering Agent', kind: 'agent', role: 'OTT Application Agent', active: activeNodeSet.has('ott-ordering'), context: activeNodeSet.has('ott-ordering'), handles: ['in-bottom'], processing: playback.phase === 'running' && activeNodeSet.has('ott-ordering'), message: playback.bubbles['ott-ordering'], plan: playback.planBubble && playback.planBubble.nodeId === 'ott-ordering' ? { title: playback.planBubble.title, items: playback.planBubble.items } : undefined } },
    { id: 'ott-gw', type: 'mission', hidden: !visibleSet.has('ott-gw'), position: { x: LAYOUT.nodes.ottGw.x, y: LAYOUT.nodes.ottGw.y }, style: { width: LAYOUT.nodes.ottGw.width }, data: { label: 'Agent GW', kind: 'gw', role: 'OTT Agent Gateway', active: activeNodeSet.has('ott-gw'), context: activeNodeSet.has('ott-gw'), handles: ['in-left', 'out-right', 'out-bottom'], appearance: 'gateway', processing: playback.phase === 'running' && activeNodeSet.has('ott-gw'), message: playback.bubbles['ott-gw'] } },
    { id: 'mno-gw', type: 'mission', hidden: !visibleSet.has('mno-gw'), position: { x: LAYOUT.nodes.mnoGw.x, y: LAYOUT.nodes.mnoGw.y }, style: { width: LAYOUT.nodes.mnoGw.width }, data: { label: 'Agent GW', kind: 'gw', role: 'MNO B Agent Gateway', active: activeNodeSet.has('mno-gw'), context: activeNodeSet.has('mno-gw'), handles: ['in-top', 'in-left', 'out-bottom'], appearance: 'gateway', processing: playback.phase === 'running' && activeNodeSet.has('mno-gw'), message: playback.bubbles['mno-gw'] } },
    { id: 'mno-endpoint', type: 'mission', hidden: !visibleSet.has('mno-endpoint'), position: { x: LAYOUT.nodes.mnoEndpoint.x, y: LAYOUT.nodes.mnoEndpoint.y }, style: { width: LAYOUT.nodes.mnoEndpoint.width }, data: { label: 'Robot Arm', kind: 'arm', active: activeNodeSet.has('mno-endpoint'), handles: ['in-left'], appearance: 'robot-arm', processing: playback.phase === 'running' && activeNodeSet.has('mno-endpoint'), message: playback.bubbles['mno-endpoint'], plan: playback.planBubble && playback.planBubble.nodeId === 'mno-endpoint' ? { title: playback.planBubble.title, items: playback.planBubble.items } : undefined } },
  ];

  const edges: Edge[] = [
    // Vertical drops from Row 1 to Bus (Specific target handles)
    { id: 'e-idm-bus', source: 'bus-line', sourceHandle: 'h-b-idm', target: 'idm', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('idm') || !visibleSet.has('bus-line'), data: { kind: 'bus', state: activeEdgeSet.has('e-idm-bus') ? 'selected' : 'idle' } },
    { id: 'e-agent-bus', source: 'bus-line', sourceHandle: 'h-b-agent', target: 'acn-agent', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('acn-agent') || !visibleSet.has('bus-line'), data: { kind: 'bus', state: activeEdgeSet.has('e-agent-bus') ? 'selected' : 'idle' } },

    // Backbone drops
    { id: 'e-bus-srf', source: 'srf', sourceHandle: 'out-bottom', target: 'bus-line', targetHandle: 'h-t-srf', type: 'mission', hidden: !visibleSet.has('bus-line') || !visibleSet.has('srf'), data: { kind: 'bus', state: activeEdgeSet.has('e-bus-srf') ? 'selected' : 'idle' } },
    { id: 'e-bus-scf', source: 'bus-line', sourceHandle: 'h-b-scf', target: 'scf', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('bus-line') || !visibleSet.has('scf'), data: { kind: 'bus', state: activeEdgeSet.has('e-bus-scf') ? 'selected' : 'idle' } },
    { id: 'e-bus-up', source: 'bus-line', sourceHandle: 'h-b-up', target: 'up', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('bus-line') || !visibleSet.has('up'), data: { kind: 'bus', state: activeEdgeSet.has('e-bus-up') ? 'selected' : 'idle' } },
    { id: 'e-bus-cmcc-gw', source: 'bus-line', sourceHandle: 'h-b-gw', target: 'agent-gw', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('bus-line') || !visibleSet.has('agent-gw'), data: { kind: 'bus', state: activeEdgeSet.has('e-bus-cmcc-gw') ? 'selected' : 'idle' } },

    // Internal service and transport
    { id: 'e-srf-ran', source: 'ran', sourceHandle: 'out-top-left', target: 'srf', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('srf') || !visibleSet.has('ran'), data: { kind: 'logic', state: activeEdgeSet.has('e-srf-ran') ? 'selected' : 'idle', note: 'control' } },
    { id: 'e-up-ran', source: 'ran', sourceHandle: 'out-top-right', target: 'up', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('up') || !visibleSet.has('ran'), data: { kind: 'baseline', state: activeEdgeSet.has('e-up-ran') ? 'selected' : 'idle', note: 'data' } },
    { id: 'e-up-gw', source: 'up', sourceHandle: 'out-right', target: 'agent-gw', targetHandle: 'in-left', type: 'mission', hidden: !visibleSet.has('up') || !visibleSet.has('agent-gw'), data: { kind: 'baseline', state: activeEdgeSet.has('e-up-gw') ? 'selected' : 'idle' } },
    { id: 'e-ran-phone', source: 'phone', sourceHandle: 'out-left', target: 'ran', targetHandle: 'in-right', type: 'mission', hidden: !visibleSet.has('ran') || !visibleSet.has('phone'), data: { kind: 'wireless', state: activeEdgeSet.has('e-ran-phone') ? 'selected' : 'idle' } },
    { id: 'e-ran-dog', source: 'robot-dog', sourceHandle: 'out-left', target: 'ran', targetHandle: 'in-right', type: 'mission', hidden: !visibleSet.has('ran') || !visibleSet.has('robot-dog'), data: { kind: 'wireless', state: activeEdgeSet.has('e-ran-dog') ? 'selected' : 'idle' } },

    // Cross-domain
    { id: 'e-cmcc-ott-gw', source: 'agent-gw', sourceHandle: 'out-right-top', target: 'ott-gw', targetHandle: 'in-left', type: 'mission', hidden: !visibleSet.has('agent-gw') || !visibleSet.has('ott-gw'), data: { kind: 'baseline', state: activeEdgeSet.has('e-cmcc-ott-gw') ? 'selected' : 'idle' } },
    { id: 'e-cmcc-mno-gw', source: 'agent-gw', sourceHandle: 'out-right-bottom', target: 'mno-gw', targetHandle: 'in-left', type: 'mission', hidden: !visibleSet.has('agent-gw') || !visibleSet.has('mno-gw'), data: { kind: 'baseline', state: activeEdgeSet.has('e-cmcc-mno-gw') ? 'selected' : 'idle' } },
    { id: 'e-ott-gw-ordering', source: 'ott-gw', sourceHandle: 'out-right', target: 'ott-ordering', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('ott-gw') || !visibleSet.has('ott-ordering'), data: { kind: 'baseline', state: activeEdgeSet.has('e-ott-gw-ordering') ? 'selected' : 'idle' } },
    { id: 'e-ott-gw-mno-gw', source: 'ott-gw', sourceHandle: 'out-bottom', target: 'mno-gw', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('ott-gw') || !visibleSet.has('mno-gw'), data: { kind: 'baseline', state: activeEdgeSet.has('e-ott-gw-mno-gw') ? 'selected' : 'idle' } },
    { id: 'e-mno-gw-endpoint', source: 'mno-gw', sourceHandle: 'out-bottom', target: 'mno-endpoint', targetHandle: 'in-left', type: 'mission', hidden: !visibleSet.has('mno-gw') || !visibleSet.has('mno-endpoint'), data: { kind: 'baseline', state: activeEdgeSet.has('e-mno-gw-endpoint') ? 'selected' : 'idle' } },
  ];


  return { 
    nodes, 
    edges: edges.map((edge) => ({
      ...edge,
      data: edge.data
        ? {
            ...edge.data,
            tone: activeEdgeSet.has(edge.id) ? playback.activeEdgeTone : undefined,
          }
        : edge.data,
    }))
  };
}
