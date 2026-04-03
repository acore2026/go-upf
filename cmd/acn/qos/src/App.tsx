import { useCallback, useEffect, useRef, useState } from 'react';
import { 
  Repeat, Cpu, Play, Radio, Router, Smartphone, Square,
  UserCheck, Settings, Database, Waypoints, Globe, Sparkles, Bot, Wrench, LoaderCircle, BrainCircuit, CheckCircle2, ScanSearch, SkipBack, SkipForward, RotateCcw, WifiOff, Ellipsis, MessageSquareText, Workflow, ScrollText
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Background, BaseEdge, Handle, Position, ReactFlow, ReactFlowProvider, getBezierPath, applyNodeChanges, applyEdgeChanges, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes, type OnNodesChange, type OnEdgesChange, type Viewport } from '@xyflow/react';
import { load as loadYaml } from 'js-yaml';
import '@xyflow/react/dist/style.css';
import { cn } from './utils';
import state0Raw from '../scenarios/state_0.json?raw';
import state1Raw from '../scenarios/state_1.json?raw';
import state2Raw from '../scenarios/state_2.json?raw';
import state3Raw from '../scenarios/state_3.json?raw';
import state4Raw from '../scenarios/state_4.json?raw';
import state5Raw from '../scenarios/state_5.json?raw';
import state6Raw from '../scenarios/state_6.json?raw';
import state8Raw from '../scenarios/state_8.json?raw';

type DemoPhase = 'standby' | 'running' | 'paused' | 'gate' | 'complete';
type NodeKind = 'endpoint'|'access'|'upf'|'router'|'service'|'idm'|'agent'|'srf'|'scf'|'up'|'gw'|'robot'|'arm'|'card';
type LinkKind = 'baseline' | 'bus' | 'logic' | 'wireless';

type DemoNodeData = { 
  label: string; 
  kind: NodeKind;
  status?: string;
  role?: string; 
  details?: Array<{ label: string; value?: string; values?: string[] }>;
  active?: boolean; 
  flashActive?: boolean;
  transitioning?: boolean;
  processing?: boolean;
  context?: boolean;
  emphasis?: boolean; 
  handles?: string[];
  appearance?: 'default' | 'phone' | 'robot' | 'robot-arm' | 'gateway' | 'pill' | 'agent-card';
  message?: string;
  messageIcon?: BubbleIcon;
  messageState?: 'processing' | 'done';
  messageLeaving?: boolean;
  embeddedCard?: {
    visible: boolean;
    chips: string[];
  };
  plan?: { title: string; items: Array<{ id: string; label: string; phase: 'pending' | 'processing' | 'done'; bubbleText: string }> };
  planLeaving?: boolean;
};
type DemoEdgeData = { kind: LinkKind; state: 'idle'|'active'|'selected'; note?: string; tone?: string; transitioning?: boolean; animationDirection?: 'forward' | 'reverse'; plane?: 'control' | 'data'; };
type RegionNodeData = { label: string; variant?: 'domain' | 'subdomain' | 'family' | 'external'; };
type BusNodeData = { label: string; caption: string; context?: boolean; emphasis?: boolean; };
type BubbleIcon = 'spinner' | 'done' | 'sparkles' | 'radio' | 'brain' | 'scan';
type PresentationCopy = {
  title?: string;
  body?: string;
};
type ScenarioLogEntry = { Time?: string; Content?: string };
type ScenarioChatEntry = { agent?: string; time?: string; think?: string; content?: string };
type ScenarioPipelineEntry = { sender?: string; receiver?: string; action?: string; type?: string };
type ScenarioDoc = {
  description?: string;
  ui_log?: Record<string, ScenarioLogEntry[]>;
  agent_chat?: ScenarioChatEntry[];
  pipeline?: ScenarioPipelineEntry[];
};
type PresentationMessage = {
  kind: 'agent_chat' | 'message' | 'log';
  title: string;
  body: string;
  time?: string;
  icon?: 'message' | 'agent' | 'log';
};
type ScriptBubble = { node: string; text: string; icon?: BubbleIcon };
type ScriptAction = {
  id: string;
  kind: 'talk' | 'flash';
  path?: string[];
  nodes?: string[];
  bubbles?: ScriptBubble[];
  revealNodes?: string[];
  hideNodes?: string[];
  delayMs?: number;
  bubbleText?: {
    plan?: string;
    processing?: string;
    done?: string;
  };
  presentation?: PresentationCopy;
};
type ScriptChecklist = {
  id: string;
  title?: string;
  type: 'checklist';
  delayMs?: number;
  bubbleText?: {
    plan?: string;
    processing?: string;
    done?: string;
  };
  presentation?: PresentationCopy;
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
  checklistBubbleText?: {
    plan?: string;
    processing?: string;
    done?: string;
  };
};
type ResolvedEdgeTraversal = {
  edgeId: string;
  from: string;
  to: string;
};
type PlaybackFrame = {
  phase: DemoPhase;
  stageIndex: number;
  actionIndex: number;
  actionId?: string;
  checklistPhase?: 'processing' | 'finished' | 'checklist-finished';
  activeEdgeTone?: string;
  currentStageTitle?: string;
  nextStageTitle?: string;
  currentStepLabel?: string;
  activeNodeIds: string[];
  activeEdgeIds: string[];
  activeEdgeDirections: Record<string, 'forward' | 'reverse'>;
  visibleNodeIds: string[];
  revealedNodeIds: string[];
  bubbles: Record<string, string>;
  bubbleStates: Record<string, 'processing' | 'done'>;
  bubbleIcons: Record<string, BubbleIcon | undefined>;
  planBubble?: { nodeId: string; title: string; items: Array<{ id: string; label: string; phase: 'pending' | 'processing' | 'done'; bubbleText: string }> };
  checklistItems: Array<{ id: string; label: string; phase: 'pending' | 'processing' | 'done' }>;
};
type RetainedBubble = { text: string; state: 'processing' | 'done'; icon?: BubbleIcon };
type RetainedPlan = NonNullable<PlaybackFrame['planBubble']>;
type BackendStatus = { stage: number };

const ACTION_DELAY_MS = 5000;
const CHECKLIST_PROCESSING_DELAY_MS = 2000;
const CHECKLIST_SETTLE_DELAY_MS = 1000;
const BACKEND_STATUS_POLL_MS = 500;
const BACKEND_ENDPOINT_STORAGE_KEY = 'acn.demo.backendEndpoint';
const DEFAULT_VIEWPORT: Viewport = { x: 27, y: 32, zoom: 1.16 };
const SCENARIO_RAW_BY_ID = {
  state_0: state0Raw,
  state_1: state1Raw,
  state_2: state2Raw,
  state_3: state3Raw,
  state_4: state4Raw,
  state_5: state5Raw,
  state_6: state6Raw,
  state_8: state8Raw,
} as const;
const ACTION_SCENARIO_MAP: Record<string, string[]> = {
  'stage1-session-online': ['state_1'],
  'stage1-robot-dog-to-acn': ['state_1'],
  'stage1-apply-digital-id': ['state_1'],
  'stage1-publish-agent-card': ['state_1'],
  'stage1-setup-family-domain': ['state_2'],
  'stage2-phone-to-ordering': ['state_3'],
  'stage2-discover-delivery-agent': ['state_4'],
  'stage2-assign-delivery-task': ['state_5'],
  'stage3-notify-user': ['state_5'],
  'stage4-location': ['state_6'],
  'stage4-verify': ['state_8'],
};
const STAGE_SCENARIO_MAP: Record<number, string[]> = {
  0: ['state_1', 'state_2'],
  1: ['state_3', 'state_4', 'state_5'],
  2: ['state_5'],
  3: ['state_6', 'state_8'],
};

function getDefaultBackendEndpoint() {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:18081';
  }
  return `${window.location.protocol}//${window.location.hostname}:18081`;
}

function normalizeBackendEndpoint(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

function isDebugPresentationUrl() {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.location.origin === 'http://101.245.78.174:8085' && window.location.search.includes('debug');
}

function parseScenarioDoc(raw: string): ScenarioDoc {
  const parsed = JSON.parse(raw) as ScenarioDoc;
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function cleanScenarioText(value?: string, maxLength = 220) {
  if (!value) {
    return '';
  }
  const withoutCode = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/####?/g, ' ')
    .replace(/[-*]\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutCode.length <= maxLength) {
    return withoutCode;
  }
  return `${withoutCode.slice(0, maxLength - 1).trimEnd()}…`;
}

const SCENARIOS: Record<string, ScenarioDoc> = Object.fromEntries(
  Object.entries(SCENARIO_RAW_BY_ID).map(([id, raw]) => [id, parseScenarioDoc(raw)]),
);

function getScenarioDocs(ids: string[]) {
  return ids.map((id) => SCENARIOS[id]).filter(Boolean);
}

function toLogMessages(ids: string[], matcher?: (label: string, entry: ScenarioLogEntry) => boolean): PresentationMessage[] {
  const messages: PresentationMessage[] = [];
  for (const scenario of getScenarioDocs(ids)) {
    for (const [label, entries] of Object.entries(scenario.ui_log ?? {})) {
      for (const entry of entries) {
        if (matcher && !matcher(label, entry)) {
          continue;
        }
        const body = cleanScenarioText(entry.Content, 160);
        if (!body) {
          continue;
        }
        messages.push({
          kind: 'log',
          title: label,
          body,
          time: entry.Time,
          icon: 'log',
        });
      }
    }
  }
  return messages;
}

function toPipelineMessages(ids: string[], matcher?: (entry: ScenarioPipelineEntry) => boolean): PresentationMessage[] {
  const messages: PresentationMessage[] = [];
  for (const scenario of getScenarioDocs(ids)) {
    for (const entry of scenario.pipeline ?? []) {
      if (matcher && !matcher(entry)) {
        continue;
      }
      const sender = entry.sender?.trim();
      const receiver = entry.receiver?.trim();
      const action = cleanScenarioText(entry.action, 120);
      if (!sender || !receiver || !action) {
        continue;
      }
      messages.push({
        kind: 'message',
        title: `${sender} -> ${receiver}`,
        body: action,
        icon: 'message',
      });
    }
  }
  return messages;
}

function resolveActionScenarioMessages(action: FlatAction): PresentationMessage[] {
  const ids = ACTION_SCENARIO_MAP[action.id] ?? [];
  switch (action.id) {
    case 'stage1-session-online':
      return [];
    case 'stage1-robot-dog-to-acn':
      return toPipelineMessages(ids, (entry) =>
        /digital id/i.test(entry.action ?? '') && /UE/i.test(entry.sender ?? '') && /ACN Agent/i.test(entry.receiver ?? ''),
      ).slice(0, 1);
    case 'stage1-apply-digital-id':
      return toPipelineMessages(ids, (entry) =>
        /digital id|Agent profile of RobotDog/i.test(entry.action ?? ''),
      ).slice(0, 1);
    case 'stage1-publish-agent-card':
      return toPipelineMessages(ids, (entry) => /Agent card|Register agent card/i.test(entry.action ?? '')).slice(0, 1);
    case 'stage1-setup-family-domain':
      return toPipelineMessages(ids).slice(0, 1);
    case 'stage2-phone-to-ordering':
      return toPipelineMessages(ids, (entry) => /Order Food/i.test(entry.action ?? ''));
    case 'stage2-discover-delivery-agent':
      return toPipelineMessages(ids, (entry) => /Agent discovery request|Agent card of RobotArm/i.test(entry.action ?? ''));
    case 'stage2-assign-delivery-task':
      return toPipelineMessages(ids, (entry) => /Pickup and delivery/i.test(entry.action ?? ''));
    case 'stage3-notify-user':
      return [
        {
          kind: 'message',
          title: 'Ordering Agent(OTT) -> UE(CMCC)',
          body: 'Order dispatch succeeded.\n\nRobot arm identity sent to the phone.',
          icon: 'message',
        },
      ];
    case 'stage4-location':
      return toPipelineMessages(ids, (entry) => /GIS data/i.test(entry.action ?? ''));
    case 'stage4-verify':
      return toLogMessages(ids, (_label, entry) => /authenticate each other|Task is completed/i.test(entry.Content ?? ''));
    default:
      return [];
  }
}

function buildVisiblePresentationMessages(script: DemoScript, playback: PlaybackFrame): PresentationMessage[] {
  if (playback.phase === 'standby' || playback.stageIndex < 0) {
    return [];
  }
  const stage = script.stages[playback.stageIndex];
  if (!stage) {
    return [];
  }
  const actions = flattenStage(stage);
  const visibleCount =
    playback.actionIndex < 0
      ? 0
      : Math.min(actions.length, playback.actionIndex + 1);
  return actions
    .slice(0, visibleCount)
    .flatMap((action) => resolveActionScenarioMessages(action));
}

function deriveScenarioNarrative(ids: string[], fallbackTitle: string, fallbackBody: string) {
  const docs = getScenarioDocs(ids);
  const description = docs.map((doc) => doc.description).find((value) => typeof value === 'string' && value.trim());
  const logLines = docs.flatMap((doc) =>
    Object.values(doc.ui_log ?? {}).flatMap((entries) =>
      entries.map((entry) => cleanScenarioText(entry.Content, 120)).filter(Boolean),
    ),
  );
  const body = logLines.slice(0, 2).join(' ') || fallbackBody;
  return {
    title: description ? cleanScenarioText(description, 80) : fallbackTitle,
    body,
  };
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

function renderMessageBody(text: string) {
  return text
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph, paragraphIndex) => (
      <p key={paragraphIndex} className="presentation-chat-paragraph">
        {paragraph.split('\n').map((line, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 ? <br /> : null}
            {renderInlineMarkdown(line)}
          </span>
        ))}
      </p>
    ));
}

function PresentationMessageIcon({ icon }: { icon?: PresentationMessage['icon'] }) {
  if (icon === 'agent') {
    return <MessageSquareText size={15} />;
  }
  if (icon === 'log') {
    return <ScrollText size={15} />;
  }
  return <Workflow size={15} />;
}

const DEFAULT_SCRIPT_YAML = `standby:
  hiddenNodes:
    - robot-dog
    - agent-card
  hiddenRegions:
    - r-family
stages:
  - id: stage-1
    title: STAGE 1
    steps:
      - id: stage1-session-online
        kind: talk
        delayMs: 1000
        presentation:
          title: "Robot dog session is now online"
          body: "The device is visible on the network and ready to begin onboarding."
        bubbles:
          - node: robot-dog
            text: "Session Online"
            icon: radio
        revealNodes:
          - robot-dog
      - id: stage1-robot-dog-to-acn
        kind: talk
        path: [phone, acn-agent]
        presentation:
          title: "The family device requests onboarding"
          body: "AiCore begins digital identity registration and creates the new family domain."
        bubbles:
          - node: phone
            text: "Applying for a Digital ID and Creating a Domain"
            icon: radio
          - node: acn-agent
            text: "Creating ACN Domain"
            icon: scan
      - id: stage1-checklist
        type: checklist
        title: ACN Domain Create
        delayMs: 1000
        bubbleText:
          done: "Digital ID Workflow Succeeded"
        presentation:
          title: "AiCore is provisioning the family domain"
          body: "Identity, agent presence, and domain resources are created in sequence."
        items:
          - id: stage1-apply-digital-id
            kind: talk
            path: [acn-agent, idm]
            presentation:
              title: "A digital identity is being issued"
              body: "Identity Management assigns a trusted ID to the robot dog."
            bubbleText:
              plan: "Assign Digital ID"
              processing: "Assigning Digital ID"
              done: "Digital ID Assigned"
            bubbles:
              - node: idm
                text: "Digital ID Assigned: DIDI"
                icon: done
              - node: robot-dog
                text: "DIDI"
                icon: done
            revealNodes:
              - agent-card
          - id: stage1-publish-agent-card
            kind: talk
            path: [acn-agent, agent-gw]
            presentation:
              title: "The agent card is being published"
              body: "The device identity is registered so the network can route agent traffic."
            bubbleText:
              plan: "Publish Agent Card"
              processing: "Publishing Agent Card"
              done: "Agent Card Published"
            bubbles:
              - node: agent-gw
                text: "Agent Card Added: DIDI"
                icon: done
          - id: stage1-setup-family-domain
            kind: talk
            path: [acn-agent, up, scf]
            presentation:
              title: "The family domain is being created"
              body: "User-plane and service functions allocate the new private domain environment."
            bubbleText:
              plan: "Set Up Family Domain"
              processing: "Setting Up Family Domain"
              done: "Family Domain Created"
            bubbles:
              - node: up
                text: "Family Domain Created"
                icon: done
            revealNodes:
              - r-family
              - robot-dog
  - id: stage-2
    title: STAGE 2
    steps:
      - id: stage2-phone-to-ordering
        kind: talk
        path: [phone, ott-ordering]
        presentation:
          title: "A new order is placed from the phone"
          body: "The request crosses domains and reaches the ordering agent in the application network."
        bubbles:
          - node: phone
            text: "Placing Order"
            icon: radio
          - node: agent-gw
            text: "Agent protocol converted"
            icon: scan
          - node: ott-ordering
            text: "Order Received"
            icon: done
      - id: stage2-checklist
        type: checklist
        title: Ordering Agent Ready for Pickup
        delayMs: 1000
        bubbleText:
          done: "Order Pickup Workflow Succeeded"
        presentation:
          title: "The ordering agent prepares delivery"
          body: "It discovers an available delivery robot and dispatches the pickup task."
        items:
          - id: stage2-discover-delivery-agent
            kind: talk
            path: [ott-ordering, mno-gw]
            presentation:
              title: "A delivery agent is being discovered"
              body: "The ordering workflow searches across the partner domain for a suitable robot."
            bubbleText:
              plan: "Discover Delivery Agent"
              processing: "Discovering Delivery Agent"
              done: "Delivery Agent Discovered"
          - id: stage2-assign-delivery-task
            kind: talk
            path: [ott-ordering, mno-endpoint]
            presentation:
              title: "The delivery task is being assigned"
              body: "The selected robot receives the pickup mission and prepares to act."
            bubbleText:
              plan: "Assign Delivery Task"
              processing: "Assigning Delivery Task"
              done: "Delivery Task Assigned"
            bubbles:
              - node: mno-endpoint
                text: "Task Received"
                icon: done
  - id: stage-3
    title: STAGE 3
    steps:
      - id: stage3-notify-user
        kind: talk
        path: [ott-ordering, phone]
        presentation:
          title: "The user is notified that dispatch succeeded"
          body: "The phone receives the robot arm identity and the order is ready for pickup."
        bubbles:
          - node: ott-ordering
            text: "Order Dispatch Succeeded. Notifying User..."
            icon: done
          - node: phone
            text: "Robot Arm ID Received"
            icon: done
  - id: stage-4
    title: STAGE 4
    steps:
      - id: stage4-location
        kind: talk
        path: [mno-endpoint, robot-dog]
        presentation:
          title: "The delivery robot shares its live location"
          body: "The robot dog receives the rendezvous coordinates for the pickup handoff."
        bubbles:
          - node: mno-endpoint
            text: "My Location Is (39.9042, 116.4074)"
            icon: radio
          - node: robot-dog
            text: "Location Received"
            icon: done
      - id: stage4-verify
        kind: talk
        path: [mno-endpoint, robot-dog]
        presentation:
          title: "Both robots verify each other before handoff"
          body: "Peer digital identity checks confirm the delivery can proceed securely."
        bubbles:
          - node: mno-endpoint
            text: "Verifying Peer Digital ID"
            icon: scan
          - node: robot-dog
            text: "Verifying Peer Digital ID"
            icon: scan
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
      bubbleText: step.bubbleText && typeof step.bubbleText === 'object'
        ? {
            plan: typeof step.bubbleText.plan === 'string' ? step.bubbleText.plan : undefined,
            processing: typeof step.bubbleText.processing === 'string' ? step.bubbleText.processing : undefined,
            done: typeof step.bubbleText.done === 'string' ? step.bubbleText.done : undefined,
          }
        : undefined,
      presentation: step.presentation && typeof step.presentation === 'object'
        ? {
            title: typeof step.presentation.title === 'string' ? step.presentation.title : undefined,
            body: typeof step.presentation.body === 'string' ? step.presentation.body : undefined,
          }
        : undefined,
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
          .map((bubble: any) => ({
            node: bubble.node,
            text: bubble.text,
            icon: typeof bubble.icon === 'string' ? bubble.icon as BubbleIcon : undefined,
          }))
      : undefined,
    revealNodes: Array.isArray(step?.revealNodes) ? step.revealNodes.filter((value: any) => typeof value === 'string') : undefined,
    hideNodes: Array.isArray(step?.hideNodes) ? step.hideNodes.filter((value: any) => typeof value === 'string') : undefined,
    bubbleText: step?.bubbleText && typeof step.bubbleText === 'object'
      ? {
          plan: typeof step.bubbleText.plan === 'string' ? step.bubbleText.plan : undefined,
          processing: typeof step.bubbleText.processing === 'string' ? step.bubbleText.processing : undefined,
          done: typeof step.bubbleText.done === 'string' ? step.bubbleText.done : undefined,
        }
      : undefined,
    presentation: step?.presentation && typeof step.presentation === 'object'
      ? {
          title: typeof step.presentation.title === 'string' ? step.presentation.title : undefined,
          body: typeof step.presentation.body === 'string' ? step.presentation.body : undefined,
        }
      : undefined,
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
          delayMs: item.delayMs ?? checklistDelayMs ?? CHECKLIST_PROCESSING_DELAY_MS,
          stageId: stage.id,
          stageTitle: stage.title,
          stageIndex: 0,
          stepLabel: checklistDisplayId(item.id),
          checklistTitle: step.title,
          checklistBubbleText: step.bubbleText,
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

function getChecklistOriginNode(action: FlatAction) {
  return action.path?.[0] ?? action.nodes?.[0] ?? action.id;
}

function getChecklistTargetNode(action: FlatAction) {
  const explicitBubbleTarget = action.bubbles?.[0]?.node;
  if (explicitBubbleTarget) {
    return explicitBubbleTarget;
  }
  return action.path?.at(-1) ?? action.nodes?.at(-1) ?? action.id;
}

function getChecklistGroup(actions: FlatAction[], action?: FlatAction) {
  if (!action?.checklistTitle) {
    return [];
  }
  return actions.filter((item) => item.checklistTitle === action.checklistTitle);
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
      checklistPhase: undefined,
      activeEdgeTone: undefined,
      activeNodeIds: [],
      activeEdgeIds: [],
      activeEdgeDirections: {},
      visibleNodeIds: deriveVisibleNodeIds(script, []),
      revealedNodeIds: [],
      bubbles: {},
      bubbleStates: {},
      bubbleIcons: {},
      planBubble: undefined,
      checklistItems: [],
    };
}

function createIdleFrame(
  script: DemoScript,
  phase: 'gate' | 'paused' | 'complete',
  stageIndex: number,
  actionIndex: number,
  revealedNodeIds: string[],
): PlaybackFrame {
  const stage = script.stages[stageIndex];
  const nextStage = script.stages[stageIndex + 1];
  const checklistItems = stage ? flattenStage(stage).map((item) => ({
    id: item.id,
    label: item.checklistTitle ? checklistDisplayId(item.id) : item.stepLabel,
    phase: 'pending' as const,
  })) : [];

  return {
    phase,
    stageIndex,
    actionIndex,
    checklistPhase: undefined,
    activeEdgeTone: undefined,
    currentStageTitle: stage?.title,
    nextStageTitle: nextStage?.title ?? 'Finish',
    activeNodeIds: [],
    activeEdgeIds: [],
    activeEdgeDirections: {},
    visibleNodeIds: deriveVisibleNodeIds(script, revealedNodeIds),
    revealedNodeIds,
    bubbles: {},
    bubbleStates: {},
    bubbleIcons: {},
    planBubble: undefined,
    checklistItems,
  };
}

function buildPlaybackFrame(
  script: DemoScript,
  stageIndex: number,
  actionIndex: number,
  phase: DemoPhase,
  revealedNodeIds: string[],
  checklistPhase?: 'processing' | 'finished' | 'checklist-finished',
): PlaybackFrame {
  const stage = script.stages[stageIndex];
  if (!stage) {
    return {
      phase: 'complete',
      stageIndex,
      actionIndex,
      checklistPhase: undefined,
      activeEdgeTone: undefined,
      activeNodeIds: [],
      activeEdgeIds: [],
      activeEdgeDirections: {},
      visibleNodeIds: deriveVisibleNodeIds(script, revealedNodeIds),
      revealedNodeIds,
      bubbles: {},
      bubbleStates: {},
      bubbleIcons: {},
      planBubble: undefined,
      checklistItems: [],
    };
  }

  const actions = flattenStage(stage);
  const action = actions[actionIndex];
  const effectiveChecklistPhase = action.checklistTitle ? (checklistPhase ?? 'processing') : undefined;
  const nextStage = script.stages[stageIndex + 1];
  const checklistGroup = getChecklistGroup(actions, action);
  const currentChecklistIndex = action.checklistTitle
    ? checklistGroup.findIndex((item) => item.id === action.id)
    : -1;
  const checklistItems: PlaybackFrame['checklistItems'] = actions.map((item, index) => {
    const phase: 'pending' | 'processing' | 'done' =
      index < actionIndex
        ? 'done'
        : action.checklistTitle === item.checklistTitle && index === actionIndex
          ? (effectiveChecklistPhase === 'processing' ? 'processing' : 'done')
          : 'pending';
    return {
      id: item.id,
    label: item.checklistTitle ? checklistDisplayId(item.id) : item.stepLabel,
    phase,
  };
  });

  if (!action) {
    return {
      phase,
      stageIndex,
      actionIndex,
      checklistPhase: undefined,
      activeEdgeTone: undefined,
      currentStageTitle: stage.title,
      nextStageTitle: nextStage?.title ?? 'Finish',
      activeNodeIds: [],
      activeEdgeIds: [],
      activeEdgeDirections: {},
      visibleNodeIds: deriveVisibleNodeIds(script, revealedNodeIds),
      revealedNodeIds,
      bubbles: {},
      bubbleStates: {},
      bubbleIcons: {},
      planBubble: undefined,
      checklistItems,
    };
  }

  const pathNodeIds = action.path ?? action.nodes ?? [];
  const edgeTraversals = resolvePathEdgeTraversals(pathNodeIds);
  const edgeIds = edgeTraversals.map((edge) => edge.edgeId);
  const activeEdgeDirections = Object.fromEntries(
    edgeTraversals.map((edge) => {
      const def = RENDER_EDGE_DEF_BY_ID.get(edge.edgeId);
      const direction: 'forward' | 'reverse' = def && def.from === edge.from && def.to === edge.to
        ? 'forward'
        : 'reverse';
      return [edge.edgeId, direction];
    }),
  ) as Record<string, 'forward' | 'reverse'>;
  const checklistOriginNode = action.checklistTitle ? getChecklistOriginNode(action) : undefined;
  const checklistTargetNode = action.checklistTitle ? getChecklistTargetNode(action) : undefined;
  const checklistBubbleText = action.checklistTitle ? action.checklistBubbleText : undefined;
  const checklistCompleted = action.checklistTitle && effectiveChecklistPhase === 'checklist-finished';
  const stepProcessingText = action.bubbleText?.processing ?? action.bubbleText?.plan ?? action.stepLabel;
  const stepDoneText = action.bubbleText?.done ?? action.bubbleText?.processing ?? action.bubbleText?.plan ?? action.stepLabel;
  const bubbles = action.checklistTitle
    ? (
        effectiveChecklistPhase === 'checklist-finished'
          ? (checklistBubbleText?.done && checklistOriginNode
              ? { [checklistOriginNode]: checklistBubbleText.done }
              : {})
          : (checklistTargetNode
              ? {
                  [checklistTargetNode]: effectiveChecklistPhase === 'finished'
                    ? stepDoneText
                    : stepProcessingText,
                }
              : {})
      )
    : Object.fromEntries((action.bubbles ?? []).map((bubble) => [bubble.node, bubble.text]));
  const bubbleIcons = action.checklistTitle
    ? (
        effectiveChecklistPhase === 'checklist-finished'
          ? {}
          : (checklistTargetNode
              ? {
                  [checklistTargetNode]: action.bubbles?.find((bubble) => bubble.node === checklistTargetNode)?.icon,
                }
              : {})
      )
    : (Object.fromEntries((action.bubbles ?? []).map((bubble) => [bubble.node, bubble.icon])) as Record<string, BubbleIcon | undefined>);
  const bubbleStates = action.checklistTitle
    ? (
        effectiveChecklistPhase === 'checklist-finished'
          ? (checklistOriginNode ? { [checklistOriginNode]: 'done' as const } : {})
          : (checklistTargetNode
              ? {
                  [checklistTargetNode]: effectiveChecklistPhase === 'finished' ? 'done' as const : 'processing' as const,
                }
              : {})
      )
    : (Object.fromEntries((action.bubbles ?? []).map((bubble) => [bubble.node, 'processing' as const])) as Record<string, 'processing' | 'done'>);
  const currentVisible = new Set(deriveVisibleNodeIds(script, revealedNodeIds));
  for (const nodeId of action.revealNodes ?? []) {
    currentVisible.add(nodeId);
  }
  const bubbleNodeIds = (action.bubbles ?? []).map((bubble) => bubble.node);
  const activeNodeIds = action.kind === 'flash'
    ? [...new Set([...(action.nodes ?? []), ...bubbleNodeIds])]
    : action.checklistTitle && effectiveChecklistPhase === 'checklist-finished'
      ? [...new Set([checklistOriginNode, ...(action.revealNodes ?? [])].filter(Boolean) as string[])]
    : [...new Set([
        ...(pathNodeIds.length ? [pathNodeIds[0], pathNodeIds[pathNodeIds.length - 1]] : []),
        ...(action.checklistTitle ? [checklistOriginNode, checklistTargetNode].filter(Boolean) as string[] : bubbleNodeIds),
        ...(action.revealNodes ?? []),
      ])];

  return {
    phase,
    stageIndex,
    actionIndex,
    actionId: action.id,
    checklistPhase: effectiveChecklistPhase,
    activeEdgeTone: action.kind === 'talk' ? '#7c3aed' : '#10b981',
    currentStageTitle: stage.title,
    nextStageTitle: nextStage?.title ?? 'Finish',
    currentStepLabel: action.checklistTitle
      ? effectiveChecklistPhase === 'checklist-finished'
        ? `Checklist finished: ${action.checklistTitle}`
        : `${effectiveChecklistPhase === 'finished' ? 'Finished' : 'Processing'}: ${action.stepLabel}`
      : action.stepLabel,
    activeNodeIds,
    activeEdgeIds: action.checklistTitle && effectiveChecklistPhase === 'checklist-finished' ? [] : edgeIds,
    activeEdgeDirections: action.checklistTitle && effectiveChecklistPhase === 'checklist-finished' ? {} : activeEdgeDirections,
    visibleNodeIds: [...currentVisible],
    revealedNodeIds: [...new Set([...revealedNodeIds, ...(action.revealNodes ?? [])])],
    bubbles,
    bubbleStates,
    bubbleIcons,
    planBubble: action.checklistTitle && !checklistCompleted ? {
      nodeId: checklistOriginNode ?? action.id,
      title: action.checklistTitle,
      items: checklistGroup.map((item, index) => {
        const phase: 'pending' | 'processing' | 'done' =
          index < currentChecklistIndex
            ? 'done'
            : index === currentChecklistIndex
              ? (effectiveChecklistPhase === 'processing' ? 'processing' : 'done')
              : 'pending';
        return {
          id: item.id,
          label: item.bubbleText?.plan ?? checklistDisplayId(item.id),
          phase,
          bubbleText: phase === 'processing'
            ? item.bubbleText?.processing ?? item.bubbleText?.plan ?? checklistDisplayId(item.id)
            : phase === 'done'
              ? item.bubbleText?.done ?? item.bubbleText?.processing ?? item.bubbleText?.plan ?? checklistDisplayId(item.id)
              : item.bubbleText?.plan ?? checklistDisplayId(item.id),
        };
      }),
    } : undefined,
    checklistItems,
  };
}

function resolveTalkDelay(action?: FlatAction) {
  if (!action || typeof action.delayMs !== 'number' || !Number.isFinite(action.delayMs)) {
    return ACTION_DELAY_MS;
  }
  return Math.max(0, action.delayMs);
}

function resolveChecklistProcessingDelay(action?: FlatAction) {
  if (!action || typeof action.delayMs !== 'number' || !Number.isFinite(action.delayMs)) {
    return CHECKLIST_PROCESSING_DELAY_MS;
  }
  return Math.max(0, action.delayMs);
}

function derivePresentationCard(
  script: DemoScript,
  playback: PlaybackFrame,
  activeAction?: FlatAction,
): { title: string; body: string; messages: PresentationMessage[] } {
  const stage = script.stages[playback.stageIndex];
  const stageTitle = stage?.title ?? 'Demo';
  const messages = buildVisiblePresentationMessages(script, playback);

  if (playback.phase === 'standby') {
    const narrative = deriveScenarioNarrative(
      ['state_0'],
      'Connect robots or place an order',
      'The phone and robot arm are online, registered, and ready for the next workflow.',
    );
    return { ...narrative, messages: [] };
  }

  if (playback.phase === 'complete') {
    const narrative = deriveScenarioNarrative(
      ['state_8'],
      'The end-to-end autonomous delivery workflow is complete',
      'Identity, domain creation, dispatch, location sharing, and peer verification all completed successfully.',
    );
    return { ...narrative, messages };
  }

  if (playback.phase === 'gate') {
    const narrative = deriveScenarioNarrative(
      STAGE_SCENARIO_MAP[playback.stageIndex] ?? [],
      `${stageTitle} is complete`,
      'The demonstration is ready to proceed to the next narrative moment.',
    );
    return { ...narrative, messages };
  }

  if (activeAction) {
    const scenarioIds = ACTION_SCENARIO_MAP[activeAction.id] ?? STAGE_SCENARIO_MAP[playback.stageIndex] ?? [];
    const narrative = deriveScenarioNarrative(
      scenarioIds,
      activeAction.presentation?.title ?? activeAction.stepLabel,
      activeAction.presentation?.body ?? activeAction.bubbleText?.processing ?? activeAction.stepLabel,
    );
    return { ...narrative, messages };
  }

  return {
    title: stageTitle,
    body: playback.currentStepLabel ?? 'The live workflow is progressing through the current stage.',
    messages,
  };
}

function applyActionVisibility(visibleOverrideNodeIds: string[], action?: FlatAction) {
  if (!action) {
    return visibleOverrideNodeIds;
  }

  const next = new Set(visibleOverrideNodeIds);
  for (const nodeId of action.revealNodes ?? []) {
    next.add(nodeId);
  }
  for (const nodeId of action.hideNodes ?? []) {
    next.delete(nodeId);
  }
  return [...next];
}

function deriveRevealedBefore(script: DemoScript, stageIndex: number, actionIndex: number) {
  if (stageIndex < 0) {
    return [] as string[];
  }

  let revealed: string[] = [];
  for (let currentStageIndex = 0; currentStageIndex <= stageIndex; currentStageIndex += 1) {
    const actions = flattenStage(script.stages[currentStageIndex] ?? { id: '', title: '', steps: [] });
    const limit = currentStageIndex === stageIndex ? actionIndex : actions.length;
    for (let currentActionIndex = 0; currentActionIndex < limit; currentActionIndex += 1) {
      revealed = applyActionVisibility(revealed, actions[currentActionIndex]);
    }
  }
  return revealed;
}

function findPreviousCursor(script: DemoScript, stageIndex: number, actionIndex: number) {
  if (stageIndex < 0) {
    return null;
  }
  if (actionIndex > 0) {
    return { stageIndex, actionIndex: actionIndex - 1 };
  }
  for (let previousStageIndex = stageIndex - 1; previousStageIndex >= 0; previousStageIndex -= 1) {
    const actions = flattenStage(script.stages[previousStageIndex]);
    if (actions.length > 0) {
      return { stageIndex: previousStageIndex, actionIndex: actions.length - 1 };
    }
  }
  return null;
}

function findNextCursor(script: DemoScript, stageIndex: number, actionIndex: number) {
  if (stageIndex < 0) {
    const firstStageIndex = script.stages.findIndex((stage) => flattenStage(stage).length > 0);
    return firstStageIndex >= 0 ? { stageIndex: firstStageIndex, actionIndex: 0 } : null;
  }

  const actions = flattenStage(script.stages[stageIndex]);
  if (actionIndex + 1 < actions.length) {
    return { stageIndex, actionIndex: actionIndex + 1 };
  }
  for (let nextStageIndex = stageIndex + 1; nextStageIndex < script.stages.length; nextStageIndex += 1) {
    const nextActions = flattenStage(script.stages[nextStageIndex]);
    if (nextActions.length > 0) {
      return { stageIndex: nextStageIndex, actionIndex: 0 };
    }
  }
  return null;
}

function resolvePathEdgeTraversals(pathNodeIds: string[]) {
  if (pathNodeIds.length < 2) {
    return [];
  }
  const edgeTraversals: ResolvedEdgeTraversal[] = [];
  for (let index = 0; index < pathNodeIds.length - 1; index += 1) {
    const source = pathNodeIds[index];
    const target = pathNodeIds[index + 1];
    edgeTraversals.push(...findPathEdgesBetween(source, target));
  }
  return edgeTraversals;
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

  const traversals: ResolvedEdgeTraversal[] = [];
  let cursor = target;
  while (cursor !== source) {
    const previousEntry = previous.get(cursor);
    if (!previousEntry) break;
    traversals.unshift({
      edgeId: previousEntry.edgeId,
      from: previousEntry.node,
      to: cursor,
    });
    cursor = previousEntry.node;
  }
  return traversals;
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
  'agent-card',
  'phone-agent-card',
  'ott-ordering',
  'ott-gw',
  'mno-gw',
  'mno-endpoint',
  'arm-agent-card',
] as const;

const ALL_REGION_IDS = ['r-ott', 'r-mno-b', 'r-core', 'r-family'] as const;

const GRAPH_EDGE_DEFS = [
  { id: 'e-cmcc-ott-gw', from: 'agent-gw', to: 'ott-gw' },
  { id: 'e-cmcc-mno-gw', from: 'agent-gw', to: 'mno-gw' },
  { id: 'e-agent-bus', from: 'bus-line', to: 'acn-agent' },
  { id: 'e-idm-bus', from: 'bus-line', to: 'idm' },
  { id: 'e-bus-scf', from: 'bus-line', to: 'scf' },
  { id: 'e-bus-srf', from: 'srf', to: 'bus-line' },
  { id: 'e-bus-up', from: 'bus-line', to: 'up' },
  { id: 'e-bus-cmcc-gw', from: 'bus-line', to: 'agent-gw' },
  { id: 'e-ran-phone', from: 'phone', to: 'ran' },
  { id: 'e-ran-dog', from: 'robot-dog', to: 'ran' },
  { id: 'e-srf-ran', from: 'ran', to: 'srf' },
  { id: 'e-up-ran', from: 'ran', to: 'up' },
  { id: 'e-up-gw', from: 'up', to: 'agent-gw' },
  { id: 'e-mno-gw-endpoint', from: 'mno-gw', to: 'mno-endpoint' },
  { id: 'e-ott-gw-mno-gw', from: 'ott-gw', to: 'mno-gw' },
  { id: 'e-ott-gw-ordering', from: 'ott-gw', to: 'ott-ordering' },
] as const;
const DATA_PLANE_EDGE_IDS = new Set([
  'e-ran-dog',
  'e-up-ran',
  'e-up-gw',
  'e-cmcc-ott-gw',
  'e-cmcc-mno-gw',
  'e-ott-gw-mno-gw',
  'e-mno-gw-endpoint',
  'e-ott-gw-ordering',
]);
const RENDER_EDGE_DEFS = [
  { id: 'e-cmcc-ott-gw', from: 'agent-gw', to: 'ott-gw' },
  { id: 'e-cmcc-mno-gw', from: 'agent-gw', to: 'mno-gw' },
  { id: 'e-agent-bus', from: 'bus-line', to: 'acn-agent' },
  { id: 'e-idm-bus', from: 'bus-line', to: 'idm' },
  { id: 'e-bus-scf', from: 'bus-line', to: 'scf' },
  { id: 'e-bus-srf', from: 'bus-line', to: 'srf' },
  { id: 'e-bus-up', from: 'bus-line', to: 'up' },
  { id: 'e-bus-cmcc-gw', from: 'bus-line', to: 'agent-gw' },
  { id: 'e-ran-phone', from: 'phone', to: 'ran' },
  { id: 'e-ran-dog', from: 'robot-dog', to: 'ran' },
  { id: 'e-srf-ran', from: 'ran', to: 'srf' },
  { id: 'e-up-ran', from: 'ran', to: 'up' },
  { id: 'e-up-gw', from: 'up', to: 'agent-gw' },
  { id: 'e-mno-gw-endpoint', from: 'mno-gw', to: 'mno-endpoint' },
  { id: 'e-ott-gw-mno-gw', from: 'ott-gw', to: 'mno-gw' },
  { id: 'e-ott-gw-ordering', from: 'ott-gw', to: 'ott-ordering' },
] as const;
const RENDER_EDGE_DEF_BY_ID = new Map<string, { id: string; from: string; to: string }>(
  RENDER_EDGE_DEFS.map((edge) => [edge.id, edge]),
);

const GRAPH_ADJACENCY = new Map<string, Array<{ node: string; edgeId: string }>>();
for (const edge of GRAPH_EDGE_DEFS) {
  const fromNeighbors = GRAPH_ADJACENCY.get(edge.from) ?? [];
  fromNeighbors.push({ node: edge.to, edgeId: edge.id });
  GRAPH_ADJACENCY.set(edge.from, fromNeighbors);
  const toNeighbors = GRAPH_ADJACENCY.get(edge.to) ?? [];
  toNeighbors.push({ node: edge.from, edgeId: edge.id });
  GRAPH_ADJACENCY.set(edge.to, toNeighbors);
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
  scf: { icon: Settings, tint: '#f43f5e' },
  up: { icon: Database, tint: '#06b6d4' },
  gw: { icon: Waypoints, tint: '#f59e0b' },
  robot: { icon: Bot, tint: '#0f766e' },
  arm: { icon: Wrench, tint: '#f97316' },
  card: { icon: UserCheck, tint: '#0f766e' },
};

export default function App() { return ( <ReactFlowProvider><Dashboard /></ReactFlowProvider> ); }

function CmccLogo() {
  return (
    <img
      className="cmcc-logo"
      src="https://upload.wikimedia.org/wikipedia/en/9/90/China_Mobile_logo_%282019%29.svg"
      alt="CMCC"
    />
  );
}

function Dashboard() {
  const debugMode = isDebugPresentationUrl();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scriptText, setScriptText] = useState(DEFAULT_SCRIPT_YAML);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptDoc, setScriptDoc] = useState<DemoScript>(() => parseDemoScript(DEFAULT_SCRIPT_YAML));
  const [playback, setPlayback] = useState<PlaybackFrame>(() => createStandbyFrame(parseDemoScript(DEFAULT_SCRIPT_YAML)));
  const [nodes, setNodes] = useState<Node[]>(() => buildGraph(scriptDoc, playback).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => buildGraph(scriptDoc, playback).edges);
  const [transitioningNodeIds, setTransitioningNodeIds] = useState<string[]>([]);
  const [transitioningEdgeIds, setTransitioningEdgeIds] = useState<string[]>([]);
  const [transitioningBubbles, setTransitioningBubbles] = useState<Record<string, RetainedBubble>>({});
  const [transitioningPlans, setTransitioningPlans] = useState<Record<string, RetainedPlan>>({});
  const [backendEndpointDraft, setBackendEndpointDraft] = useState(() => {
    if (typeof window === 'undefined') {
      return getDefaultBackendEndpoint();
    }
    return window.localStorage.getItem(BACKEND_ENDPOINT_STORAGE_KEY) ?? getDefaultBackendEndpoint();
  });
  const [backendEndpoint, setBackendEndpoint] = useState(() => {
    if (typeof window === 'undefined') {
      return getDefaultBackendEndpoint();
    }
    return normalizeBackendEndpoint(window.localStorage.getItem(BACKEND_ENDPOINT_STORAGE_KEY) ?? getDefaultBackendEndpoint());
  });
  const [backendStage, setBackendStage] = useState(0);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [backendResetPending, setBackendResetPending] = useState(false);
  const [lastBackendPollAt, setLastBackendPollAt] = useState<number | null>(null);
  const [canvasViewport, setCanvasViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [backendEnabled, setBackendEnabled] = useState(true);
  const [scriptPanelOpen, setScriptPanelOpen] = useState(false);
  const scriptRef = useRef(scriptDoc);
  const playbackRef = useRef(playback);
  const pollInFlightRef = useRef(false);
  const settingsPopoutRef = useRef<HTMLDivElement | null>(null);
  const transitionRef = useRef<{
    nodeIds: string[];
    edgeIds: string[];
    bubbles: Record<string, RetainedBubble>;
    planBubble?: RetainedPlan;
  }>({ nodeIds: [], edgeIds: [], bubbles: {}, planBubble: undefined });
  const transitionTimerRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    scriptRef.current = scriptDoc;
  }, [scriptDoc]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const container = settingsPopoutRef.current;
      if (!container) {
        return;
      }

      const target =
        event.target instanceof globalThis.Node ? event.target : null;
      if (target && !container.contains(target)) {
        setSettingsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    const previous = transitionRef.current;
    const nextNodeIds = playback.activeNodeIds;
    const nextEdgeIds = playback.activeEdgeIds;
    const nextBubbles = Object.fromEntries(
      Object.entries(playback.bubbles).map(([nodeId, text]) => [nodeId, { text, state: playback.bubbleStates[nodeId] ?? 'processing', icon: playback.bubbleIcons[nodeId] }]),
    ) as Record<string, RetainedBubble>;
    const nextPlan = playback.planBubble;
    const leavingNodeIds = previous.nodeIds.filter((id) => !nextNodeIds.includes(id));
    const leavingEdgeIds = previous.edgeIds.filter((id) => !nextEdgeIds.includes(id));
    const leavingBubbles = Object.fromEntries(
      Object.entries(previous.bubbles).filter(([nodeId, bubble]) => {
        const nextBubble = nextBubbles[nodeId];
        return !nextBubble || nextBubble.text !== bubble.text || nextBubble.state !== bubble.state;
      }),
    ) as Record<string, RetainedBubble>;
    const leavingPlan = previous.planBubble && (
      !nextPlan
      || nextPlan.nodeId !== previous.planBubble.nodeId
      || nextPlan.title !== previous.planBubble.title
      || JSON.stringify(nextPlan.items) !== JSON.stringify(previous.planBubble.items)
    )
      ? previous.planBubble
      : undefined;
    transitionRef.current = { nodeIds: nextNodeIds, edgeIds: nextEdgeIds, bubbles: nextBubbles, planBubble: nextPlan };
    clearTransitionTimer();
    if (leavingNodeIds.length || leavingEdgeIds.length || Object.keys(leavingBubbles).length || leavingPlan) {
      setTransitioningNodeIds(leavingNodeIds);
      setTransitioningEdgeIds(leavingEdgeIds);
      setTransitioningBubbles(leavingBubbles);
      setTransitioningPlans(leavingPlan ? { [leavingPlan.nodeId]: leavingPlan } : {});
      transitionTimerRef.current = window.setTimeout(() => {
        setTransitioningNodeIds([]);
        setTransitioningEdgeIds([]);
        setTransitioningBubbles({});
        setTransitioningPlans({});
        transitionTimerRef.current = null;
      }, 260);
    } else {
      setTransitioningNodeIds([]);
      setTransitioningEdgeIds([]);
      setTransitioningBubbles({});
      setTransitioningPlans({});
    }
  }, [clearTransitionTimer, playback.activeEdgeIds, playback.activeNodeIds, playback.bubbles, playback.bubbleStates, playback.planBubble]);

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

  const persistBackendEndpoint = useCallback((nextValue: string) => {
    const normalized = normalizeBackendEndpoint(nextValue);
    setBackendEndpointDraft(nextValue);
    setBackendEndpoint(normalized);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BACKEND_ENDPOINT_STORAGE_KEY, normalized || getDefaultBackendEndpoint());
    }
    setBackendError(null);
    setBackendConnected(false);
  }, []);

  const updatePlayback = useCallback((mode: 'start' | 'continue' | 'timer' | 'pause' | 'reset' | 'next-step' | 'previous-step') => {
    clearTimer();
    setPlayback((prev) => {
      const script = scriptRef.current;
      if (mode === 'reset') {
        return createStandbyFrame(script);
      }
      if (mode === 'pause') {
        return prev.phase === 'running'
          ? createIdleFrame(script, 'paused', prev.stageIndex, prev.actionIndex, prev.revealedNodeIds)
          : prev;
      }
      if (mode === 'previous-step') {
        const previousCursor = findPreviousCursor(script, prev.stageIndex, prev.actionIndex);
        if (!previousCursor) {
          return createStandbyFrame(script);
        }
        return buildPlaybackFrame(
          script,
          previousCursor.stageIndex,
          previousCursor.actionIndex,
          'paused',
          deriveRevealedBefore(script, previousCursor.stageIndex, previousCursor.actionIndex),
          undefined,
        );
      }
      if (mode === 'next-step') {
        const nextCursor = findNextCursor(script, prev.stageIndex, prev.actionIndex);
        if (!nextCursor) {
          return createIdleFrame(script, 'complete', prev.stageIndex, prev.actionIndex, prev.revealedNodeIds);
        }
        return buildPlaybackFrame(
          script,
          nextCursor.stageIndex,
          nextCursor.actionIndex,
          'paused',
          deriveRevealedBefore(script, nextCursor.stageIndex, nextCursor.actionIndex),
          undefined,
        );
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
        return buildPlaybackFrame(script, 0, 0, 'running', [], undefined);
      }
      if (mode === 'continue') {
        if (prev.phase !== 'gate') {
          return prev;
        }
        const nextStageIndex = prev.stageIndex + 1;
        if (nextStageIndex >= script.stages.length) {
          return createIdleFrame(script, 'complete', prev.stageIndex, prev.actionIndex, prev.revealedNodeIds);
        }
        return buildPlaybackFrame(script, nextStageIndex, 0, 'running', prev.revealedNodeIds, undefined);
      }
      if (prev.phase !== 'running') {
        return prev;
      }
      const actions = getActionsForStage(script, prev.stageIndex);
      const currentAction = actions[prev.actionIndex];
      const revealed = applyActionVisibility(prev.revealedNodeIds, currentAction);
      if (currentAction?.checklistTitle) {
        if (prev.checklistPhase === 'processing' || prev.checklistPhase === undefined) {
          return buildPlaybackFrame(script, prev.stageIndex, prev.actionIndex, 'running', revealed, 'finished');
        }
        if (prev.checklistPhase === 'finished') {
          const checklistGroup = getChecklistGroup(actions, currentAction);
          const currentChecklistIndex = checklistGroup.findIndex((item) => item.id === currentAction.id);
          const isFinalChecklistItem = currentChecklistIndex >= 0 && currentChecklistIndex === checklistGroup.length - 1;
          if (isFinalChecklistItem) {
            return buildPlaybackFrame(script, prev.stageIndex, prev.actionIndex, 'running', revealed, 'checklist-finished');
          }
          const nextActionIndex = prev.actionIndex + 1;
          if (nextActionIndex < actions.length) {
            return buildPlaybackFrame(script, prev.stageIndex, nextActionIndex, 'running', revealed, 'processing');
          }
          return createIdleFrame(script, 'gate', prev.stageIndex, prev.actionIndex, revealed);
        }
      }
      const nextActionIndex = prev.actionIndex + 1;
      if (nextActionIndex < actions.length) {
        return buildPlaybackFrame(script, prev.stageIndex, nextActionIndex, 'running', revealed, undefined);
      }
      return createIdleFrame(script, 'gate', prev.stageIndex, prev.actionIndex, revealed);
    });
  }, [clearTimer, getActionsForStage]);

  const fetchBackendStage = useCallback(async () => {
    if (!backendEnabled || !backendEndpoint || pollInFlightRef.current) {
      return;
    }
    pollInFlightRef.current = true;
    try {
      const response = await fetch(`${backendEndpoint}/status`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as BackendStatus;
      const nextStage = Number.isFinite(payload.stage) ? Math.max(0, Math.min(4, Math.trunc(payload.stage))) : 0;
      setBackendStage(nextStage);
      setBackendConnected(true);
      setBackendError(null);
      setLastBackendPollAt(Date.now());
    } catch (error) {
      setBackendConnected(false);
      setBackendError(error instanceof Error ? error.message : 'Unable to fetch backend status.');
    } finally {
      pollInFlightRef.current = false;
    }
  }, [backendEnabled, backendEndpoint]);

  const resetBackend = useCallback(async () => {
    if (!backendEnabled) {
      setBackendStage(0);
      setBackendConnected(false);
      setBackendError(null);
      updatePlayback('reset');
      return;
    }
    if (!backendEndpoint || backendResetPending) {
      return;
    }
    setBackendResetPending(true);
    try {
      const response = await fetch(`${backendEndpoint}/reset`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setBackendStage(0);
      setBackendConnected(true);
      setBackendError(null);
      updatePlayback('reset');
    } catch (error) {
      setBackendConnected(false);
      setBackendError(error instanceof Error ? error.message : 'Unable to reset backend.');
    } finally {
      setBackendResetPending(false);
    }
  }, [backendEnabled, backendEndpoint, backendResetPending, updatePlayback]);

  useEffect(() => {
    const graph = buildGraph(scriptDoc, playback, transitioningNodeIds, transitioningEdgeIds, transitioningBubbles, transitioningPlans);
    setNodes((prev) => graph.nodes.map((node) => {
      const previous = prev.find((candidate) => candidate.id === node.id);
      return previous ? { ...node, position: previous.position } : node;
    }));
    setEdges(graph.edges);
  }, [playback, scriptDoc, transitioningBubbles, transitioningEdgeIds, transitioningNodeIds, transitioningPlans]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const currentStage = scriptDoc.stages[playback.stageIndex];
  const stageActions = currentStage ? flattenStage(currentStage) : [];
  const activeAction = stageActions[playback.actionIndex];
  const activeActionId = activeAction?.id;
  const activeActionDelayMs = activeAction?.delayMs;
  const activeActionChecklistTitle = activeAction?.checklistTitle;

  useEffect(() => {
    clearTimer();
    if (playback.phase !== 'running') {
      return undefined;
    }
    if (activeAction?.checklistTitle) {
      const delayMs = playback.checklistPhase === 'finished' || playback.checklistPhase === 'checklist-finished'
        ? CHECKLIST_SETTLE_DELAY_MS
        : resolveChecklistProcessingDelay(activeAction);
      timerRef.current = window.setTimeout(() => {
        updatePlayback('timer');
      }, delayMs);
      return () => clearTimer();
    }
    const delayMs = resolveTalkDelay(activeAction);
    timerRef.current = window.setTimeout(() => {
      updatePlayback('timer');
    }, delayMs);
    return () => clearTimer();
  }, [activeActionChecklistTitle, activeActionDelayMs, activeActionId, clearTimer, playback.checklistPhase, playback.phase, playback.stageIndex, updatePlayback]);

  useEffect(() => {
    if (!backendEnabled) {
      pollInFlightRef.current = false;
      setBackendConnected(false);
      setBackendError(null);
      return undefined;
    }
    fetchBackendStage();
    const intervalId = window.setInterval(() => {
      fetchBackendStage();
    }, BACKEND_STATUS_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [backendEnabled, fetchBackendStage]);

  useEffect(() => {
    if (!backendEnabled) {
      return;
    }
    if (backendStage === 0) {
      if (playback.phase !== 'standby') {
        updatePlayback('reset');
      }
      return;
    }
    const unlockedStageIndex = Math.min(scriptDoc.stages.length - 1, backendStage - 1);
    if (playback.phase === 'standby' || playback.phase === 'paused') {
      updatePlayback('start');
      return;
    }
    if (playback.phase === 'gate' && playback.stageIndex < unlockedStageIndex) {
      updatePlayback('continue');
    }
  }, [backendEnabled, backendStage, playback.phase, playback.stageIndex, scriptDoc.stages.length, updatePlayback]);

  const savedBackendDisplay = backendEndpoint || 'Not configured';
  const viewportDisplay = `x ${Math.round(canvasViewport.x)}, y ${Math.round(canvasViewport.y)}, z ${canvasViewport.zoom.toFixed(2)}`;
  const playbackControlTitle = playback.phase === 'running'
    ? 'Pause'
    : playback.phase === 'gate'
      ? 'Continue'
      : 'Start';
  const presentationCard = derivePresentationCard(scriptDoc, playback, activeAction);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="header-left">
          <div className="dashboard-brand">
            <CmccLogo />
            <h1 className="dashboard-title">AiCore Dashboard</h1>
          </div>
        </div>
        <div className="header-right">
          <div className="control-group">
            <StatusBadge
              label={!backendEnabled || backendConnected ? 'Live' : 'Disconnected'}
              tone={!backendEnabled || backendConnected ? 'good' : 'idle'}
              icon={!backendEnabled || backendConnected ? <span className="status-live-dot" /> : <WifiOff size={13} />}
            />
          </div>
          {debugMode && (
            <div className="control-group">
              <button
                className="icon-button"
                onClick={() => updatePlayback(playback.phase === 'running' ? 'pause' : playback.phase === 'gate' ? 'continue' : 'start')}
                title={playbackControlTitle}
              >
                {playback.phase === 'running' ? <Square size={14} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
              </button>
              <button className="icon-button" onClick={() => updatePlayback('previous-step')} title="Previous Step"><SkipBack size={16} /></button>
              <button className="icon-button" onClick={() => updatePlayback('next-step')} title="Next Step"><SkipForward size={16} /></button>
            </div>
          )}
          <div className="control-group">
            <div className="settings-popout-anchor" ref={settingsPopoutRef}>
              <button className="icon-button" onClick={() => setSettingsOpen((open) => !open)} title="Settings" aria-expanded={settingsOpen}>
                <Settings size={16} />
              </button>
              {settingsOpen && (
                <div className="settings-popout">
                  <div className="settings-popout-title">Settings</div>
                  <label className="settings-field">
                    <span className="settings-label">Backend Endpoint</span>
                    <input
                      className="settings-input"
                      value={backendEndpointDraft}
                      onChange={(event) => setBackendEndpointDraft(event.target.value)}
                      placeholder="http://127.0.0.1:18081"
                      spellCheck={false}
                    />
                  </label>
                  {debugMode && (
                    <label className="settings-field settings-switch-field">
                      <span className="settings-label">Backend</span>
                      <button
                        type="button"
                        className={cn('settings-switch', backendEnabled && 'settings-switch-active')}
                        onClick={() => setBackendEnabled((enabled) => !enabled)}
                        aria-pressed={backendEnabled}
                        title={backendEnabled ? 'Disable backend' : 'Enable backend'}
                      >
                        <span className="settings-switch-thumb" />
                      </button>
                    </label>
                  )}
                  <div className="settings-actions">
                    <button className="primary-button settings-button" onClick={() => persistBackendEndpoint(backendEndpointDraft)}>Save</button>
                  </div>
                  <div className="settings-status">
                    <StatItem label="Saved" value={savedBackendDisplay} />
                    <StatItem label="Stage" value={String(backendStage)} />
                    <StatItem label="Poll" value={!backendEnabled ? 'Ignored' : backendConnected ? 'Connected' : 'Disconnected'} />
                    <StatItem label="Updated" value={lastBackendPollAt ? new Date(lastBackendPollAt).toLocaleTimeString() : 'Never'} />
                    <StatItem label="Canvas" value={viewportDisplay} />
                  </div>
                  {backendError && <div className="script-error">{backendError}</div>}
                  {debugMode && (
                    <>
                      <div className="settings-popout-subhead">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setScriptPanelOpen((open) => !open)}
                          title={scriptPanelOpen ? 'Hide script' : 'Show script'}
                          aria-expanded={scriptPanelOpen}
                        >
                          <Ellipsis size={16} />
                        </button>
                      </div>
                      {scriptPanelOpen && (
                        <>
                          <textarea
                            className="script-editor"
                            value={scriptText}
                            onChange={(event) => applyScriptText(event.target.value)}
                            spellCheck={false}
                          />
                          {scriptError && <div className="script-error">{scriptError}</div>}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <button className="icon-button" onClick={() => void resetBackend()} disabled={backendResetPending} title="Reset">
              <RotateCcw size={16} />
            </button>
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
            onInit={(instance) => setCanvasViewport(instance.getViewport())}
            onMove={(_, viewport) => setCanvasViewport(viewport)}
            defaultViewport={DEFAULT_VIEWPORT}
            nodesConnectable={false}
            nodesDraggable={false}
            panOnDrag
            zoomOnScroll
            onlyRenderVisibleElements
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={40} size={1} color="#f1f5f9" />
          </ReactFlow>
        </section>
        <aside className="sidebar">
          <div className="presentation-panel">
            <div className="presentation-panel-kicker">Live Narrative</div>
            <h2 className="presentation-panel-title">{presentationCard.title}</h2>
            <p className="presentation-panel-body">{presentationCard.body}</p>
            <div className="presentation-chat">
              <div className="presentation-chat-kicker">Agent Chat & Messages</div>
              <div className="presentation-chat-list">
                {presentationCard.messages.map((message, index) => (
                  <div key={`${message.kind}-${message.title}-${index}`} className={cn('presentation-chat-item', index < presentationCard.messages.length - 1 && 'presentation-chat-item-history')}>
                    <div className="presentation-chat-icon">
                      <PresentationMessageIcon icon={message.icon} />
                    </div>
                    <div className="presentation-chat-content">
                      <div className="presentation-chat-meta">
                      <span className="presentation-chat-speaker">{message.title}</span>
                      {message.time ? <span className="presentation-chat-time">{message.time}</span> : null}
                    </div>
                    <div className="presentation-chat-body">{renderMessageBody(message.body)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function StatItem({ label, value }: any) { return ( <div className="stat-item"><span className="stat-label">{label}</span><span className="stat-value">{value}</span></div> ); }

function BubbleIconGlyph({ icon, state }: { icon?: BubbleIcon; state?: 'processing' | 'done' }) {
  if (icon === 'radio') return <Radio size={12} className="mission-node-bubble-icon" />;
  if (icon === 'sparkles') return <Sparkles size={12} className="mission-node-bubble-icon" />;
  if (icon === 'brain') return <BrainCircuit size={12} className="mission-node-bubble-icon" />;
  if (icon === 'scan') return <ScanSearch size={12} className="mission-node-bubble-icon" />;
  if (icon === 'done') return <CheckCircle2 size={12} className="mission-node-bubble-icon mission-node-bubble-icon-done" />;
  if (icon === 'spinner') return <LoaderCircle size={12} className="mission-node-bubble-icon" />;
  return state === 'done'
    ? <CheckCircle2 size={12} className="mission-node-bubble-icon mission-node-bubble-icon-done" />
    : <LoaderCircle size={12} className="mission-node-bubble-icon" />;
}

function DeviceIllustration({ appearance }: { appearance: DemoNodeData['appearance'] }) {
  if (appearance === 'phone') {
    return (
      <svg viewBox="0 0 120 196" className="device-art device-art-phone" aria-hidden="true">
        <defs>
          <linearGradient id="phone-shell" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1f2937" />
            <stop offset="100%" stopColor="#334155" />
          </linearGradient>
          <linearGradient id="phone-screen" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#020617" />
            <stop offset="50%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#082f49" />
          </linearGradient>
        </defs>
        <rect x="24" y="8" width="72" height="180" rx="24" fill="url(#phone-shell)" />
        <rect x="29" y="16" width="62" height="164" rx="17" fill="url(#phone-screen)" />
        <rect x="48" y="22" width="24" height="6" rx="3" fill="#020617" fillOpacity="0.95" />
        <circle cx="76" cy="25" r="2.4" fill="#0f172a" fillOpacity="0.95" />
        <path d="M40 118c12-9 25-15 39-19" stroke="#7dd3fc" strokeWidth="4.5" strokeLinecap="round" strokeOpacity="0.34" />
        <path d="M45 135c9-5 19-9 31-12" stroke="#c084fc" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.22" />
        <rect x="52" y="182" width="16" height="2.5" rx="1.25" fill="#94a3b8" fillOpacity="0.42" />
      </svg>
    );
  }

  if (appearance === 'robot-arm') {
    return (
      <svg viewBox="0 0 190 170" className="device-art device-art-arm" aria-hidden="true">
        <defs>
          <linearGradient id="rover-body" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#f3f4f6" />
            <stop offset="100%" stopColor="#9ca3af" />
          </linearGradient>
          <linearGradient id="rover-accent" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <circle cx="52" cy="128" r="14" fill="#475569" />
        <circle cx="82" cy="128" r="14" fill="#475569" />
        <circle cx="112" cy="128" r="14" fill="#475569" />
        <circle cx="142" cy="128" r="14" fill="#475569" />
        <circle cx="52" cy="128" r="7" fill="#111827" />
        <circle cx="82" cy="128" r="7" fill="#111827" />
        <circle cx="112" cy="128" r="7" fill="#111827" />
        <circle cx="142" cy="128" r="7" fill="#111827" />
        <path d="M38 110h118" stroke="#64748b" strokeWidth="6" strokeLinecap="round" />
        <path d="M46 84h92l12 18H40z" fill="url(#rover-body)" />
        <rect x="74" y="70" width="26" height="16" rx="7" fill="#d1d5db" />
        <path d="M87 70V52" stroke="#6b7280" strokeWidth="5" strokeLinecap="round" />
        <circle cx="87" cy="50" r="7" fill="#4b5563" />
        <path d="M87 50L108 36" stroke="url(#rover-accent)" strokeWidth="8" strokeLinecap="round" />
        <circle cx="108" cy="36" r="7" fill="#4b5563" />
        <path d="M108 36L132 46" stroke="#cbd5e1" strokeWidth="7" strokeLinecap="round" />
        <circle cx="132" cy="46" r="6" fill="#64748b" />
        <path d="M132 46L146 24" stroke="url(#rover-accent)" strokeWidth="6" strokeLinecap="round" />
        <path d="M146 24L160 18" stroke="#475569" strokeWidth="4" strokeLinecap="round" />
        <path d="M146 24L154 36" stroke="#475569" strokeWidth="4" strokeLinecap="round" />
        <rect x="52" y="90" width="28" height="6" rx="3" fill="#f8fafc" fillOpacity="0.72" />
        <rect x="98" y="90" width="24" height="6" rx="3" fill="url(#rover-accent)" fillOpacity="0.92" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 900 560" className="device-art device-art-dog" aria-hidden="true">
      <defs>
        <linearGradient id="dog-body" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#d9dde3" />
          <stop offset="100%" stopColor="#aeb6c0" />
        </linearGradient>
        <linearGradient id="dog-leg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#cfd5dc" />
          <stop offset="100%" stopColor="#8f98a3" />
        </linearGradient>
        <linearGradient id="dog-dark" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#7d8792" />
          <stop offset="100%" stopColor="#555e68" />
        </linearGradient>
      </defs>
      <g transform="translate(35 20)">
        <path
          d="M230 110 C255 78, 315 58, 404 56 L585 54 C635 53, 682 76, 705 112 L725 146 C734 162, 734 185, 722 200 L698 230 C682 250, 657 262, 631 262 L290 262 C264 262, 239 250, 223 230 L202 204 C188 187, 187 160, 199 141 Z"
          fill="url(#dog-body)"
          stroke="#8d96a0"
          strokeWidth="4"
        />

        <path
          d="M303 75 C360 45, 553 43, 628 63 C649 69, 664 80, 672 97 L623 104 C550 93, 384 95, 302 113 C285 116, 273 112, 269 103 C266 94, 278 84, 303 75 Z"
          fill="#e6eaee"
          stroke="#b8c0c8"
          strokeWidth="3"
        />

        <path
          d="M171 122 C178 106, 196 94, 220 92 L272 89 C290 88, 303 102, 301 119 L293 196 C291 214, 276 227, 258 227 L206 227 C184 227, 167 210, 166 189 Z"
          fill="url(#dog-body)"
          stroke="#8d96a0"
          strokeWidth="4"
        />

        <ellipse cx="687" cy="145" rx="46" ry="52" fill="url(#dog-body)" stroke="#8d96a0" strokeWidth="4" />
        <ellipse cx="240" cy="143" rx="42" ry="48" fill="#bcc4cc" stroke="#8d96a0" strokeWidth="4" />
        <ellipse cx="612" cy="148" rx="40" ry="48" fill="#bcc4cc" stroke="#8d96a0" strokeWidth="4" />

        <rect x="173" y="143" width="50" height="70" rx="10" fill="#20252b" />
        <circle cx="192" cy="165" r="8" fill="#7fb2ff" />
        <circle cx="192" cy="191" r="8" fill="#7fb2ff" />
        <rect x="206" y="155" width="11" height="46" rx="4" fill="#0f1317" />

        <text x="218" y="157" fontFamily="Arial, Helvetica, sans-serif" fontSize="34" fontWeight="700" fill="#ffffff" opacity="0.88">02</text>
        <rect x="470" y="170" width="28" height="40" rx="5" fill="#747e88" />
        <rect x="507" y="170" width="12" height="40" rx="4" fill="#8b949d" />
        <path d="M250 166 L275 162" stroke="#e7ebef" strokeWidth="5" strokeLinecap="round" />
        <path d="M249 181 L278 174" stroke="#e7ebef" strokeWidth="5" strokeLinecap="round" />

        <g>
          <ellipse cx="235" cy="196" rx="35" ry="32" fill="url(#dog-body)" stroke="#8d96a0" strokeWidth="4" />
          <path d="M226 215 C214 250, 210 278, 214 308 C218 344, 210 380, 186 452" fill="none" stroke="url(#dog-leg)" strokeWidth="28" strokeLinecap="round" />
          <path d="M186 452 C178 476, 168 495, 155 515" fill="none" stroke="url(#dog-dark)" strokeWidth="20" strokeLinecap="round" />
          <ellipse cx="152" cy="520" rx="18" ry="9" fill="#535c66" />
        </g>

        <g transform="translate(122 4)">
          <ellipse cx="235" cy="196" rx="35" ry="32" fill="url(#dog-body)" stroke="#8d96a0" strokeWidth="4" />
          <path d="M245 214 C263 242, 286 274, 312 306 C340 340, 364 386, 382 474" fill="none" stroke="url(#dog-leg)" strokeWidth="28" strokeLinecap="round" />
          <path d="M382 474 C386 492, 392 506, 401 521" fill="none" stroke="url(#dog-dark)" strokeWidth="20" strokeLinecap="round" />
          <ellipse cx="406" cy="526" rx="19" ry="9" fill="#535c66" />
        </g>

        <g transform="translate(348 -8)">
          <ellipse cx="235" cy="196" rx="35" ry="32" fill="url(#dog-body)" stroke="#8d96a0" strokeWidth="4" />
          <path d="M220 214 C202 252, 189 294, 182 336 C177 368, 173 407, 171 468" fill="none" stroke="url(#dog-leg)" strokeWidth="28" strokeLinecap="round" />
          <path d="M171 468 C170 489, 167 506, 162 523" fill="none" stroke="url(#dog-dark)" strokeWidth="20" strokeLinecap="round" />
          <ellipse cx="161" cy="527" rx="18" ry="9" fill="#535c66" />
        </g>

        <g transform="translate(478 -16)">
          <ellipse cx="235" cy="196" rx="35" ry="32" fill="url(#dog-body)" stroke="#8d96a0" strokeWidth="4" />
          <path d="M245 214 C267 241, 291 274, 309 315 C324 348, 334 388, 341 466" fill="none" stroke="url(#dog-leg)" strokeWidth="28" strokeLinecap="round" />
          <path d="M341 466 C343 487, 348 506, 355 522" fill="none" stroke="url(#dog-dark)" strokeWidth="20" strokeLinecap="round" />
          <ellipse cx="360" cy="527" rx="18" ry="9" fill="#535c66" />
        </g>

        <path d="M275 262 L626 262" stroke="#87919b" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
        <path d="M305 238 C390 248, 525 247, 609 236" fill="none" stroke="#eef2f5" strokeWidth="4" opacity="0.6" />
      </g>
    </svg>
  );
}

function MissionNode({ data }: NodeProps<Node<DemoNodeData>>) {
  const meta = kindMeta[data.kind] || { icon: Globe, tint: '#64748b' };
  const detailLine = data.role || data.status || data.kind;
  const handles = new Set(data.handles || []);
  const isCompactDevice = data.appearance === 'phone' || data.appearance === 'robot' || data.appearance === 'robot-arm' || data.appearance === 'pill';
  const isIllustratedDevice = data.appearance === 'phone' || data.appearance === 'robot' || data.appearance === 'robot-arm';
  const hasDetailRows = Boolean(data.details?.length);
  const isAgentCard = data.appearance === 'agent-card' && hasDetailRows;
  const topHandleStyle = data.appearance === 'gateway' ? { top: '2px' } : undefined;
  const bottomHandleStyle = data.appearance === 'gateway' ? { bottom: '2px' } : undefined;
  const agentCardChips = data.details?.flatMap((detail) => detail.value ? [detail.value] : (detail.values ?? [])) ?? [];

  return (
    <div className={cn(
      "mission-node-shell",
      data.kind === 'agent' && data.appearance !== 'agent-card' && "mission-node-agent-shell",
      data.appearance === 'agent-card' && "mission-node-asset-card-shell",
      isAgentCard && "mission-node-expandable-shell",
      data.context && "mission-node-context",
      data.emphasis && "mission-node-emphasis",
      data.active && "mission-node-active-shell",
      data.flashActive && "mission-node-flash-shell",
      data.transitioning && "mission-node-transitioning-shell",
      data.appearance === 'gateway' && "mission-node-gateway-shell",
      data.appearance === 'pill' && "mission-node-pill-shell",
      data.appearance === 'phone' && "mission-node-phone-shell",
      (data.appearance === 'robot' || data.appearance === 'robot-arm') && "mission-node-robot-shell",
      data.label === 'Ordering Agent' && "mission-node-ordering-shell",
      data.kind === 'robot' && data.message && "mission-node-robot-bubble",
      (data.message || data.plan) && "mission-node-with-bubble",
    )} style={{ '--node-tint': meta.tint } as any}>
      {data.plan && (
        <div className={cn("mission-node-plan", data.planLeaving && "mission-node-plan-leaving")}>
          <div className="mission-node-plan-header">
            <LoaderCircle size={12} className="mission-node-plan-icon" />
            <span className="mission-node-plan-title">Plan</span>
            <span className="mission-node-plan-name">{data.plan.title}</span>
          </div>
          <div className="mission-node-plan-list">
            {data.plan.items.map((item) => (
              <div key={item.id} className={cn(
                "mission-node-plan-item",
                item.phase === 'processing' && "mission-node-plan-item-processing",
                item.phase === 'done' && "mission-node-plan-item-done",
              )}>
                <span className={cn("mission-node-plan-check", `mission-node-plan-check-${item.phase}`)}>
                  {item.phase === 'processing' ? <LoaderCircle size={9} className="mission-node-plan-check-icon" /> : item.phase === 'done' ? '✓' : ''}
                </span>
                <div className="mission-node-plan-copy">
                  <span className="mission-node-plan-text">{item.label}</span>
                  <span className="mission-node-plan-phase">
                    {item.phase}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.message && (
        <div className={cn("mission-node-bubble", data.messageState === 'done' && "mission-node-bubble-done", data.messageLeaving && "mission-node-bubble-leaving")}>
          <BubbleIconGlyph icon={data.messageIcon} state={data.messageState} />
          <span>{data.message}</span>
        </div>
      )}
      <div className={cn("mission-node", data.active && "mission-node-active", data.flashActive && "mission-node-flash", data.transitioning && "mission-node-transitioning")}>
        {isIllustratedDevice ? (
          <div
            className={cn(
              "mission-node-device-wrap",
              data.appearance === 'phone' && "mission-node-device-wrap-phone",
              data.appearance === 'robot' && data.embeddedCard?.visible && "mission-node-device-wrap-robot",
              data.appearance === 'robot' && !data.embeddedCard?.visible && "mission-node-device-wrap-collapsed",
            )}
          >
            <div className="mission-node-device-figure">
              <DeviceIllustration appearance={data.appearance} />
              <div className="mission-node-device-label">{data.label}</div>
            </div>
            {data.embeddedCard?.visible && (
              <div className="mission-node-embedded-card">
                <div className="mission-node-embedded-card-title">Agent Card</div>
                <div className="mission-node-agent-card-tags mission-node-embedded-card-tags">
                  {data.embeddedCard.chips.map((chip) => (
                    <span key={chip} className="mission-node-detail-chip mission-node-agent-card-chip">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mission-node-head">
            <div className={cn("mission-node-icon", data.appearance === 'phone' && "mission-node-icon-phone", (data.appearance === 'robot' || data.appearance === 'robot-arm') && "mission-node-icon-robot")}><meta.icon size={16} /></div>
            <div>
              <div className="mission-node-label">{data.label}</div>
              {!isCompactDevice && !hasDetailRows && (
                <div className="mission-node-meta">
                  <span className="mission-node-role">{detailLine}</span>
                </div>
              )}
            </div>
          </div>
        )}
        {hasDetailRows && isAgentCard && (
          <div className="mission-node-agent-card-tags">
            {agentCardChips.map((value) => (
              <span key={value} className={cn("mission-node-detail-chip", "mission-node-agent-card-chip")}>{value}</span>
            ))}
          </div>
        )}
        {hasDetailRows && !isAgentCard && (
          <div className="mission-node-detail-list">
            {data.details!.map((detail) => (
              <div key={detail.label} className="mission-node-detail-row">
                <span className="mission-node-detail-label">{detail.label}</span>
                {detail.value && <span className="mission-node-detail-value">{detail.value}</span>}
                {detail.values && (
                  <div className="mission-node-detail-chips">
                    {detail.values.map((value) => (
                      <span key={value} className="mission-node-detail-chip">{value}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {handles.has('in-top') && <Handle id="in-top" type="target" position={Position.Top} className="mission-handle mission-handle-top" style={topHandleStyle} />}
      {handles.has('out-top') && <Handle id="out-top" type="source" position={Position.Top} className="mission-handle mission-handle-top" style={topHandleStyle} />}
      {handles.has('in-bottom') && <Handle id="in-bottom" type="target" position={Position.Bottom} className="mission-handle mission-handle-bottom" style={bottomHandleStyle} />}
      {handles.has('out-bottom') && <Handle id="out-bottom" type="source" position={Position.Bottom} className="mission-handle mission-handle-bottom" style={bottomHandleStyle} />}
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
  const { kind = 'baseline', state = 'idle', note, tone, animationDirection, plane } = props.data || {};
  const [path, labelX, labelY] = getBezierPath({
    ...props,
    curvature: kind === 'wireless' ? 0.2 : kind === 'bus' ? 0.2 : 0.16,
  });
  const isSelected = state === 'selected';
  const isActive = state === 'active' || isSelected;
  const isControlPlane = plane === 'control' || kind === 'logic' || note === 'control' || props.id === 'e-srf-ran';
  const isDataPlane = plane === 'data' || DATA_PLANE_EDGE_IDS.has(props.id);
  const isWirelessDataPlane = kind === 'wireless' && isDataPlane;
  const activeColor = tone ?? (
    kind === 'bus' ? '#38bdf8'
    : isControlPlane ? '#7c3aed'
    : isDataPlane ? '#f59e0b'
    : kind === 'wireless' ? '#0284c7'
    : '#10b981'
  );
  const color = state === 'idle'
    ? kind === 'bus' ? '#bfd6e6'
    : kind === 'wireless' ? '#c7e8fb'
    : '#c3cedb'
    : activeColor;
  const dash = isActive && isWirelessDataPlane
    ? '7 12'
    : kind === 'wireless'
      ? '3 4'
    : isActive && isControlPlane
      ? '6 7'
      : isActive && isDataPlane
        ? '14 10'
        : isActive
          ? '11 8'
          : undefined;
  const strokeWidth = isSelected
    ? isWirelessDataPlane ? 3.4
    : isDataPlane ? 5.2
    : isControlPlane ? 2.7
    : 3.05
    : isActive
      ? isWirelessDataPlane ? 2.8
      : isDataPlane ? 4.7
      : isControlPlane ? 2.25
      : kind === 'bus' ? 1.8
      : 1.9
      : kind === 'wireless' ? 1.8
      : isDataPlane ? 4.1
      : isControlPlane ? 1.55
      : kind === 'bus' ? 1.45
      : 1.35;
  const opacity = isSelected
    ? 1
    : isActive
      ? (isWirelessDataPlane ? 0.9 : isDataPlane ? 0.96 : isControlPlane ? 0.92 : 0.88)
      : kind === 'wireless'
        ? 0.4
        : 0.32;
  const isTransitioning = Boolean(props.data?.transitioning);
  const animationClass = isActive
    ? isControlPlane
      ? (animationDirection === 'reverse' ? 'edge-control-animated-reverse' : 'edge-control-animated-forward')
      : isWirelessDataPlane
        ? (animationDirection === 'reverse' ? 'edge-wireless-data-animated-reverse' : 'edge-wireless-data-animated-forward')
      : isDataPlane
        ? (animationDirection === 'reverse' ? 'edge-data-animated-reverse' : 'edge-data-animated-forward')
        : (animationDirection === 'reverse' ? 'edge-animated-reverse' : 'edge-animated-forward')
    : '';
  const className = isSelected
    ? cn("edge-selected", animationClass)
    : isActive
      ? cn("edge-active", animationClass)
      : isTransitioning
        ? "edge-transitioning"
        : "edge-idle";
  const edgeOpacity = isTransitioning && !isActive ? Math.max(0.24, opacity * 0.55) : opacity;
  return (
    <>
      <BaseEdge path={path} className={className} style={{ stroke: color, strokeWidth, strokeDasharray: dash, strokeLinecap: 'round', transition: 'stroke 220ms ease, stroke-width 220ms ease, opacity 220ms ease', opacity: edgeOpacity, strokeDashoffset: isActive ? 0 : undefined }} />
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
      <div className="bus-backbone">
        <div className="bus-backbone-copy">
          <span className="bus-node-pill">
            <Sparkles size={13} />
            {data.label}
          </span>
          <span className="bus-node-caption">{data.caption}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Top} id="abi-top" style={{ left: '50%', top: 0, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="abi-bottom-in" style={{ left: '50%', bottom: 0, background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="abi-bottom-out" style={{ left: '50%', bottom: 0, background: 'transparent', border: 'none', opacity: 0 }} />
    </div>
  );
}

function StatusBadge({ label, tone, icon }: any) {
  return (
    <span className={cn('status-badge', `status-badge-${tone}`)}>
      {icon ? <span className="status-badge-icon">{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}

const LAYOUT = {
  ott: { x: 980, y: 72, width: 306, height: 228 },
  mno: { x: 980, y: 356, width: 424, height: 296 },
  core: { x: 36, y: 36, width: 860, height: 420 },
  access: { x: 36, y: 492, width: 760, height: 232 },
  bus: { x: 212, y: 216, width: 508, height: 24 },
  nodes: {
    idm: { x: 218, y: 116, width: 136 },
    acnAgent: { x: 578, y: 116, width: 136 },
    srf: { x: 150, y: 288, width: 128 },
    scf: { x: 322, y: 288, width: 128 },
    up: { x: 482, y: 288, width: 128 },
    cmccGw: { x: 649, y: 288, width: 138 },
    ran: { x: 202, y: 572, width: 128 },
    phone: { x: 392, y: 520, width: 296, height: 136 },
    robotDog: { x: 392, y: 678, width: 312, collapsedWidth: 156, height: 112 },
    phoneAgentCard: { x: 578, y: 532, width: 174 },
    agentCard: { x: 578, y: 592, width: 174 },
    ottOrdering: { x: 1098.7776623098334, y: 93.77870152133133, width: 148 },
    ottGw: { x: 1000, y: 204, width: 144 },
    mnoGw: { x: 1000, y: 404, width: 144 },
    mnoEndpoint: { x: 1096, y: 488, width: 282, height: 132 },
    armAgentCard: { x: 1120, y: 612, width: 174 },
  },
} as const;

function buildGraph(
  _script: DemoScript,
  playback: PlaybackFrame,
  transitioningNodeIds: string[] = [],
  transitioningEdgeIds: string[] = [],
  transitioningBubbles: Record<string, RetainedBubble> = {},
  transitioningPlans: Record<string, RetainedPlan> = {},
) {
  const visibleSet = new Set(playback.visibleNodeIds);
  const robotDogExpanded = visibleSet.has('agent-card');
  const robotDogWidth = robotDogExpanded ? LAYOUT.nodes.robotDog.width : LAYOUT.nodes.robotDog.collapsedWidth;
  const familyLayout = (() => {
    const left = Math.min(LAYOUT.nodes.phone.x, LAYOUT.nodes.robotDog.x) - 24;
    const right = Math.max(
      LAYOUT.nodes.phone.x + LAYOUT.nodes.phone.width,
      LAYOUT.nodes.robotDog.x + robotDogWidth,
    ) + 30;
    const top = Math.min(LAYOUT.nodes.phone.y, LAYOUT.nodes.robotDog.y) - 34;
    const bottom = Math.max(
      LAYOUT.nodes.phone.y + LAYOUT.nodes.phone.height,
      LAYOUT.nodes.robotDog.y + LAYOUT.nodes.robotDog.height,
    ) + 38;

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  })();
  const activeNodeSet = new Set(playback.activeNodeIds);
  const activeEdgeSet = new Set(playback.activeEdgeIds);
  const phoneRanPlane: 'control' | 'data' = playback.stageIndex >= 2 ? 'data' : 'control';
  const transitioningNodeSet = new Set(transitioningNodeIds);
  const transitioningEdgeSet = new Set(transitioningEdgeIds);
  const bubbleFor = (nodeId: string) => playback.bubbles[nodeId] ?? transitioningBubbles[nodeId]?.text;
  const bubbleIconFor = (nodeId: string) => playback.bubbleIcons[nodeId] ?? transitioningBubbles[nodeId]?.icon;
  const bubbleStateFor = (nodeId: string) => playback.bubbleStates[nodeId] ?? transitioningBubbles[nodeId]?.state;
  const bubbleLeavingFor = (nodeId: string) => !playback.bubbles[nodeId] && Boolean(transitioningBubbles[nodeId]);
  const planFor = (nodeId: string) => (
    playback.planBubble?.nodeId === nodeId ? playback.planBubble : transitioningPlans[nodeId]
  );
  const planLeavingFor = (nodeId: string) => playback.planBubble?.nodeId !== nodeId && Boolean(transitioningPlans[nodeId]);
  const flashFor = (nodeId: string) => {
    const bubbleState = bubbleStateFor(nodeId);
    const hasActivePlan = Boolean(planFor(nodeId) && !planLeavingFor(nodeId));
    const isProcessingBubble = bubbleState === 'processing';
    return hasActivePlan || isProcessingBubble;
  };
  const nodes: Node[] = [
    // Main Boxes
    { id: 'r-ott', type: 'region', hidden: !visibleSet.has('r-ott'), position: { x: LAYOUT.ott.x, y: LAYOUT.ott.y }, style: { width: LAYOUT.ott.width, height: LAYOUT.ott.height, zIndex: -1 }, data: { label: 'OTT', variant: 'external' }, draggable: false },
    { id: 'r-mno-b', type: 'region', hidden: !visibleSet.has('r-mno-b'), position: { x: LAYOUT.mno.x, y: LAYOUT.mno.y }, style: { width: LAYOUT.mno.width, height: LAYOUT.mno.height, zIndex: -1 }, data: { label: 'MNO B', variant: 'external' }, draggable: false },
    { id: 'r-core', type: 'region', hidden: !visibleSet.has('r-core'), position: { x: LAYOUT.core.x, y: LAYOUT.core.y }, style: { width: LAYOUT.core.width, height: LAYOUT.core.height, zIndex: -1 }, data: { label: 'CMCC Core Network', variant: 'domain' }, draggable: false },
    { id: 'r-family', type: 'region', hidden: !visibleSet.has('r-family'), position: { x: familyLayout.x, y: familyLayout.y }, style: { width: familyLayout.width, height: familyLayout.height, zIndex: -1 }, data: { label: 'FAMILY DOMAIN (4sg520s2.acn.domain.cmcc)', variant: 'family' }, draggable: false },

    // Core network control
    { id: 'idm', type: 'mission', hidden: !visibleSet.has('idm'), position: { x: LAYOUT.nodes.idm.x, y: LAYOUT.nodes.idm.y }, style: { width: LAYOUT.nodes.idm.width }, data: { label: 'IDM', kind: 'idm', role: 'Identity Management Function', active: activeNodeSet.has('idm'), flashActive: flashFor('idm'), transitioning: transitioningNodeSet.has('idm'), context: activeNodeSet.has('idm'), handles: ['in-bottom', 'out-bottom'], processing: playback.phase === 'running' && activeNodeSet.has('idm'), message: bubbleFor('idm'), messageIcon: bubbleIconFor('idm'), messageState: bubbleStateFor('idm'), messageLeaving: bubbleLeavingFor('idm') } },
    { id: 'acn-agent', type: 'mission', hidden: !visibleSet.has('acn-agent'), position: { x: LAYOUT.nodes.acnAgent.x, y: LAYOUT.nodes.acnAgent.y }, style: { width: LAYOUT.nodes.acnAgent.width }, data: { label: 'ACN Agent', kind: 'agent', role: 'Agent Communication Netork Agent', active: activeNodeSet.has('acn-agent'), flashActive: flashFor('acn-agent'), transitioning: transitioningNodeSet.has('acn-agent'), emphasis: true, handles: ['in-bottom', 'out-bottom'], processing: playback.phase === 'running' && activeNodeSet.has('acn-agent'), message: bubbleFor('acn-agent'), messageIcon: bubbleIconFor('acn-agent'), messageState: bubbleStateFor('acn-agent'), messageLeaving: bubbleLeavingFor('acn-agent'), plan: planFor('acn-agent') ? { title: planFor('acn-agent')!.title, items: planFor('acn-agent')!.items } : undefined, planLeaving: planLeavingFor('acn-agent') } },

    // ABI backbone
    { id: 'bus-line', type: 'bus', hidden: !visibleSet.has('bus-line'), position: { x: LAYOUT.bus.x, y: LAYOUT.bus.y }, style: { width: LAYOUT.bus.width, height: LAYOUT.bus.height, zIndex: 0 }, data: { label: 'ABI', caption: 'Agent Based Interface', context: playback.phase === 'running', emphasis: playback.phase === 'running' || playback.phase === 'gate' }, draggable: false },

    // Core network services and transport
    { id: 'srf', type: 'mission', hidden: !visibleSet.has('srf'), position: { x: LAYOUT.nodes.srf.x, y: LAYOUT.nodes.srf.y }, style: { width: LAYOUT.nodes.srf.width }, data: { label: 'SRF', kind: 'srf', role: 'Signaling Routing Function', active: activeNodeSet.has('srf'), flashActive: flashFor('srf'), transitioning: transitioningNodeSet.has('srf'), handles: ['in-top', 'in-bottom', 'out-bottom'], processing: playback.phase === 'running' && activeNodeSet.has('srf'), message: bubbleFor('srf'), messageIcon: bubbleIconFor('srf'), messageState: bubbleStateFor('srf'), messageLeaving: bubbleLeavingFor('srf') } },
    { id: 'scf', type: 'mission', hidden: !visibleSet.has('scf'), position: { x: LAYOUT.nodes.scf.x, y: LAYOUT.nodes.scf.y }, style: { width: LAYOUT.nodes.scf.width }, data: { label: 'SCF', kind: 'scf', role: 'Service Control Function', active: activeNodeSet.has('scf'), flashActive: flashFor('scf'), transitioning: transitioningNodeSet.has('scf'), context: activeNodeSet.has('scf'), handles: ['in-top'], processing: playback.phase === 'running' && activeNodeSet.has('scf'), message: bubbleFor('scf'), messageIcon: bubbleIconFor('scf'), messageState: bubbleStateFor('scf'), messageLeaving: bubbleLeavingFor('scf') } },
    { id: 'up', type: 'mission', hidden: !visibleSet.has('up'), position: { x: LAYOUT.nodes.up.x, y: LAYOUT.nodes.up.y }, style: { width: LAYOUT.nodes.up.width, height: 64 }, data: { label: 'UP', kind: 'up', role: 'User Plane', active: activeNodeSet.has('up'), flashActive: flashFor('up'), transitioning: transitioningNodeSet.has('up'), context: activeNodeSet.has('up'), handles: ['in-top', 'in-bottom', 'in-left', 'out-right'], appearance: 'gateway', processing: playback.phase === 'running' && activeNodeSet.has('up'), message: bubbleFor('up'), messageIcon: bubbleIconFor('up'), messageState: bubbleStateFor('up'), messageLeaving: bubbleLeavingFor('up') } },
    { id: 'agent-gw', type: 'mission', hidden: !visibleSet.has('agent-gw'), position: { x: LAYOUT.nodes.cmccGw.x, y: LAYOUT.nodes.cmccGw.y }, style: { width: LAYOUT.nodes.cmccGw.width, height: 64 }, data: { label: 'Agent GW', kind: 'gw', role: 'CMCC Agent Gateway', active: activeNodeSet.has('agent-gw'), flashActive: flashFor('agent-gw'), transitioning: transitioningNodeSet.has('agent-gw'), context: activeNodeSet.has('agent-gw'), handles: ['in-top', 'in-left', 'out-right-top', 'out-right-bottom'], appearance: 'gateway', processing: playback.phase === 'running' && activeNodeSet.has('agent-gw'), message: bubbleFor('agent-gw'), messageIcon: bubbleIconFor('agent-gw'), messageState: bubbleStateFor('agent-gw'), messageLeaving: bubbleLeavingFor('agent-gw') } },
    { id: 'ran', type: 'mission', hidden: !visibleSet.has('ran'), position: { x: LAYOUT.nodes.ran.x, y: LAYOUT.nodes.ran.y }, style: { width: LAYOUT.nodes.ran.width }, data: { label: 'RAN', kind: 'access', role: 'Radio Access Network', active: activeNodeSet.has('ran'), flashActive: flashFor('ran'), transitioning: transitioningNodeSet.has('ran'), handles: ['in-right', 'out-top-left', 'out-top-right', 'out-right-bottom'], appearance: 'pill', processing: playback.phase === 'running' && activeNodeSet.has('ran'), message: bubbleFor('ran'), messageIcon: bubbleIconFor('ran'), messageState: bubbleStateFor('ran'), messageLeaving: bubbleLeavingFor('ran') } },

    // Family domain
    { id: 'phone', type: 'mission', hidden: !visibleSet.has('phone'), position: { x: LAYOUT.nodes.phone.x, y: LAYOUT.nodes.phone.y }, style: { width: LAYOUT.nodes.phone.width, height: LAYOUT.nodes.phone.height }, data: { label: 'Phone', kind: 'endpoint', active: activeNodeSet.has('phone'), flashActive: flashFor('phone'), transitioning: transitioningNodeSet.has('phone'), handles: ['in-left', 'out-left'], appearance: 'phone', embeddedCard: { visible: true, chips: ['🪪 did:3gpp:4b92ac1e@cmcc.com', '📱 Phone', '⚙️ Huawei'] }, processing: playback.phase === 'running' && activeNodeSet.has('phone'), message: bubbleFor('phone'), messageIcon: bubbleIconFor('phone'), messageState: bubbleStateFor('phone'), messageLeaving: bubbleLeavingFor('phone') } },
    { id: 'robot-dog', type: 'mission', hidden: !visibleSet.has('robot-dog'), position: { x: LAYOUT.nodes.robotDog.x, y: LAYOUT.nodes.robotDog.y }, style: { width: robotDogWidth, height: LAYOUT.nodes.robotDog.height }, data: { label: 'Robot Dog', kind: 'robot', active: activeNodeSet.has('robot-dog'), flashActive: flashFor('robot-dog'), transitioning: transitioningNodeSet.has('robot-dog'), handles: ['in-left', 'out-left'], appearance: 'robot', embeddedCard: { visible: robotDogExpanded, chips: ['🪪 did:3gpp:6f0d5b7a@cmcc.com', '📷 Camera', '📦 Payload 10KG', '⚙️ Unitree'] }, processing: playback.phase === 'running' && activeNodeSet.has('robot-dog'), message: bubbleFor('robot-dog'), messageIcon: bubbleIconFor('robot-dog'), messageState: bubbleStateFor('robot-dog'), messageLeaving: bubbleLeavingFor('robot-dog') } },
    { id: 'phone-agent-card', type: 'mission', hidden: true, position: { x: LAYOUT.nodes.phoneAgentCard.x, y: LAYOUT.nodes.phoneAgentCard.y }, style: { width: LAYOUT.nodes.phoneAgentCard.width }, data: { label: 'Agent Card', kind: 'card', details: [{ label: 'DID', value: '🪪 did:3gpp:4b92ac1e@cmcc.com' }, { label: 'Type', values: ['📱 Phone', '⚙️ Huawei'] }], active: activeNodeSet.has('phone-agent-card'), flashActive: flashFor('phone-agent-card'), transitioning: transitioningNodeSet.has('phone-agent-card'), handles: ['in-left'], appearance: 'agent-card', processing: playback.phase === 'running' && activeNodeSet.has('phone-agent-card'), message: bubbleFor('phone-agent-card'), messageIcon: bubbleIconFor('phone-agent-card'), messageState: bubbleStateFor('phone-agent-card'), messageLeaving: bubbleLeavingFor('phone-agent-card') } },
    { id: 'agent-card', type: 'mission', hidden: true, position: { x: LAYOUT.nodes.agentCard.x, y: LAYOUT.nodes.agentCard.y }, style: { width: LAYOUT.nodes.agentCard.width }, data: { label: 'Agent Card', kind: 'card', details: [{ label: 'DID', value: '🪪 did:3gpp:6f0d5b7a@cmcc.com' }, { label: 'Capabilities', values: ['📷 Camera', '📦 Payload 10KG'] }, { label: 'Vendor', values: ['⚙️ Unitree'] }], active: activeNodeSet.has('agent-card'), flashActive: flashFor('agent-card'), transitioning: transitioningNodeSet.has('agent-card'), handles: ['in-left'], appearance: 'agent-card', processing: playback.phase === 'running' && activeNodeSet.has('agent-card'), message: bubbleFor('agent-card'), messageIcon: bubbleIconFor('agent-card'), messageState: bubbleStateFor('agent-card'), messageLeaving: bubbleLeavingFor('agent-card') } },

    // External Boxes Components
    { id: 'ott-ordering', type: 'mission', hidden: !visibleSet.has('ott-ordering'), position: { x: LAYOUT.nodes.ottOrdering.x, y: LAYOUT.nodes.ottOrdering.y }, style: { width: LAYOUT.nodes.ottOrdering.width }, data: { label: 'Ordering Agent', kind: 'agent', role: 'OTT Application Agent', active: activeNodeSet.has('ott-ordering'), flashActive: flashFor('ott-ordering'), transitioning: transitioningNodeSet.has('ott-ordering'), context: activeNodeSet.has('ott-ordering'), handles: ['in-bottom'], processing: playback.phase === 'running' && activeNodeSet.has('ott-ordering'), message: bubbleFor('ott-ordering'), messageIcon: bubbleIconFor('ott-ordering'), messageState: bubbleStateFor('ott-ordering'), messageLeaving: bubbleLeavingFor('ott-ordering'), plan: planFor('ott-ordering') ? { title: planFor('ott-ordering')!.title, items: planFor('ott-ordering')!.items } : undefined, planLeaving: planLeavingFor('ott-ordering') } },
    { id: 'ott-gw', type: 'mission', hidden: !visibleSet.has('ott-gw'), position: { x: LAYOUT.nodes.ottGw.x, y: LAYOUT.nodes.ottGw.y }, style: { width: LAYOUT.nodes.ottGw.width }, data: { label: 'Agent GW', kind: 'gw', role: 'OTT Agent Gateway', active: activeNodeSet.has('ott-gw'), flashActive: flashFor('ott-gw'), transitioning: transitioningNodeSet.has('ott-gw'), context: activeNodeSet.has('ott-gw'), handles: ['in-left', 'out-right', 'out-bottom'], appearance: 'gateway', processing: playback.phase === 'running' && activeNodeSet.has('ott-gw'), message: bubbleFor('ott-gw'), messageIcon: bubbleIconFor('ott-gw'), messageState: bubbleStateFor('ott-gw'), messageLeaving: bubbleLeavingFor('ott-gw') } },
    { id: 'mno-gw', type: 'mission', hidden: !visibleSet.has('mno-gw'), position: { x: LAYOUT.nodes.mnoGw.x, y: LAYOUT.nodes.mnoGw.y }, style: { width: LAYOUT.nodes.mnoGw.width }, data: { label: 'Agent GW', kind: 'gw', role: 'MNO B Agent Gateway', active: activeNodeSet.has('mno-gw'), flashActive: flashFor('mno-gw'), transitioning: transitioningNodeSet.has('mno-gw'), context: activeNodeSet.has('mno-gw'), handles: ['in-top', 'in-left', 'out-bottom'], appearance: 'gateway', processing: playback.phase === 'running' && activeNodeSet.has('mno-gw'), message: bubbleFor('mno-gw'), messageIcon: bubbleIconFor('mno-gw'), messageState: bubbleStateFor('mno-gw'), messageLeaving: bubbleLeavingFor('mno-gw') } },
    { id: 'mno-endpoint', type: 'mission', hidden: !visibleSet.has('mno-endpoint'), position: { x: LAYOUT.nodes.mnoEndpoint.x, y: LAYOUT.nodes.mnoEndpoint.y }, style: { width: LAYOUT.nodes.mnoEndpoint.width, height: LAYOUT.nodes.mnoEndpoint.height }, data: { label: 'Robot Arm', kind: 'arm', active: activeNodeSet.has('mno-endpoint'), flashActive: flashFor('mno-endpoint'), transitioning: transitioningNodeSet.has('mno-endpoint'), handles: ['in-left'], appearance: 'robot-arm', embeddedCard: { visible: true, chips: ['🪪 did:3gpp:a18f4d2c@mnob.com', '🦾 Robot Arm', '⚙️ RobotFactory'] }, processing: playback.phase === 'running' && activeNodeSet.has('mno-endpoint'), message: bubbleFor('mno-endpoint'), messageIcon: bubbleIconFor('mno-endpoint'), messageState: bubbleStateFor('mno-endpoint'), messageLeaving: bubbleLeavingFor('mno-endpoint'), plan: planFor('mno-endpoint') ? { title: planFor('mno-endpoint')!.title, items: planFor('mno-endpoint')!.items } : undefined, planLeaving: planLeavingFor('mno-endpoint') } },
    { id: 'arm-agent-card', type: 'mission', hidden: true, position: { x: LAYOUT.nodes.armAgentCard.x, y: LAYOUT.nodes.armAgentCard.y }, style: { width: LAYOUT.nodes.armAgentCard.width }, data: { label: 'Agent Card', kind: 'card', details: [{ label: 'DID', value: '🪪 did:3gpp:a18f4d2c@mnob.com' }, { label: 'Type', values: ['🦾 Robot Arm', '⚙️ RobotFactory'] }], active: activeNodeSet.has('arm-agent-card'), flashActive: flashFor('arm-agent-card'), transitioning: transitioningNodeSet.has('arm-agent-card'), handles: ['in-top'], appearance: 'agent-card', processing: playback.phase === 'running' && activeNodeSet.has('arm-agent-card'), message: bubbleFor('arm-agent-card'), messageIcon: bubbleIconFor('arm-agent-card'), messageState: bubbleStateFor('arm-agent-card'), messageLeaving: bubbleLeavingFor('arm-agent-card') } },
  ];

  const edges: Edge[] = [
    // Vertical drops from Row 1 to Bus (Specific target handles)
    { id: 'e-idm-bus', source: 'bus-line', sourceHandle: 'abi-top', target: 'idm', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('idm') || !visibleSet.has('bus-line'), data: { kind: 'bus', state: activeEdgeSet.has('e-idm-bus') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-idm-bus') } },
    { id: 'e-agent-bus', source: 'bus-line', sourceHandle: 'abi-top', target: 'acn-agent', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('acn-agent') || !visibleSet.has('bus-line'), data: { kind: 'bus', state: activeEdgeSet.has('e-agent-bus') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-agent-bus') } },

    // Backbone drops
    { id: 'e-bus-srf', source: 'bus-line', sourceHandle: 'abi-bottom-out', target: 'srf', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('bus-line') || !visibleSet.has('srf'), data: { kind: 'bus', state: activeEdgeSet.has('e-bus-srf') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-bus-srf') } },
    { id: 'e-bus-scf', source: 'bus-line', sourceHandle: 'abi-bottom-out', target: 'scf', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('bus-line') || !visibleSet.has('scf'), data: { kind: 'bus', state: activeEdgeSet.has('e-bus-scf') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-bus-scf') } },
    { id: 'e-bus-up', source: 'bus-line', sourceHandle: 'abi-bottom-out', target: 'up', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('bus-line') || !visibleSet.has('up'), data: { kind: 'bus', state: activeEdgeSet.has('e-bus-up') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-bus-up') } },
    { id: 'e-bus-cmcc-gw', source: 'bus-line', sourceHandle: 'abi-bottom-out', target: 'agent-gw', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('bus-line') || !visibleSet.has('agent-gw'), data: { kind: 'bus', state: activeEdgeSet.has('e-bus-cmcc-gw') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-bus-cmcc-gw') } },

    // Internal service and transport
    { id: 'e-srf-ran', source: 'ran', sourceHandle: 'out-top-left', target: 'srf', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('srf') || !visibleSet.has('ran'), data: { kind: 'logic', state: activeEdgeSet.has('e-srf-ran') ? 'selected' : 'idle', note: 'control', transitioning: transitioningEdgeSet.has('e-srf-ran') } },
    { id: 'e-up-ran', source: 'ran', sourceHandle: 'out-top-right', target: 'up', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('up') || !visibleSet.has('ran'), data: { kind: 'baseline', state: activeEdgeSet.has('e-up-ran') ? 'selected' : 'idle', note: 'data', transitioning: transitioningEdgeSet.has('e-up-ran') } },
    { id: 'e-up-gw', source: 'up', sourceHandle: 'out-right', target: 'agent-gw', targetHandle: 'in-left', type: 'mission', hidden: !visibleSet.has('up') || !visibleSet.has('agent-gw'), data: { kind: 'baseline', state: activeEdgeSet.has('e-up-gw') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-up-gw') } },
    { id: 'e-ran-phone', source: 'phone', sourceHandle: 'out-left', target: 'ran', targetHandle: 'in-right', type: 'mission', hidden: !visibleSet.has('ran') || !visibleSet.has('phone'), data: { kind: 'wireless', state: activeEdgeSet.has('e-ran-phone') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-ran-phone'), plane: phoneRanPlane } },
    { id: 'e-ran-dog', source: 'robot-dog', sourceHandle: 'out-left', target: 'ran', targetHandle: 'in-right', type: 'mission', hidden: !visibleSet.has('ran') || !visibleSet.has('robot-dog'), data: { kind: 'wireless', state: activeEdgeSet.has('e-ran-dog') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-ran-dog') } },
    { id: 'e-phone-agent-card', source: 'phone', sourceHandle: 'out-right', target: 'phone-agent-card', targetHandle: 'in-left', type: 'mission', hidden: true, data: { kind: 'baseline', state: activeEdgeSet.has('e-phone-agent-card') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-phone-agent-card') } },
    { id: 'e-dog-agent-card', source: 'robot-dog', sourceHandle: 'out-right', target: 'agent-card', targetHandle: 'in-left', type: 'mission', hidden: true, data: { kind: 'baseline', state: activeEdgeSet.has('e-dog-agent-card') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-dog-agent-card') } },

    // Cross-domain
    { id: 'e-cmcc-ott-gw', source: 'agent-gw', sourceHandle: 'out-right-top', target: 'ott-gw', targetHandle: 'in-left', type: 'mission', hidden: !visibleSet.has('agent-gw') || !visibleSet.has('ott-gw'), data: { kind: 'baseline', state: activeEdgeSet.has('e-cmcc-ott-gw') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-cmcc-ott-gw') } },
    { id: 'e-cmcc-mno-gw', source: 'agent-gw', sourceHandle: 'out-right-bottom', target: 'mno-gw', targetHandle: 'in-left', type: 'mission', hidden: !visibleSet.has('agent-gw') || !visibleSet.has('mno-gw'), data: { kind: 'baseline', state: activeEdgeSet.has('e-cmcc-mno-gw') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-cmcc-mno-gw') } },
    { id: 'e-ott-gw-ordering', source: 'ott-gw', sourceHandle: 'out-right', target: 'ott-ordering', targetHandle: 'in-bottom', type: 'mission', hidden: !visibleSet.has('ott-gw') || !visibleSet.has('ott-ordering'), data: { kind: 'baseline', state: activeEdgeSet.has('e-ott-gw-ordering') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-ott-gw-ordering') } },
    { id: 'e-ott-gw-mno-gw', source: 'ott-gw', sourceHandle: 'out-bottom', target: 'mno-gw', targetHandle: 'in-top', type: 'mission', hidden: !visibleSet.has('ott-gw') || !visibleSet.has('mno-gw'), data: { kind: 'baseline', state: activeEdgeSet.has('e-ott-gw-mno-gw') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-ott-gw-mno-gw') } },
    { id: 'e-mno-gw-endpoint', source: 'mno-gw', sourceHandle: 'out-bottom', target: 'mno-endpoint', targetHandle: 'in-left', type: 'mission', hidden: !visibleSet.has('mno-gw') || !visibleSet.has('mno-endpoint'), data: { kind: 'baseline', state: activeEdgeSet.has('e-mno-gw-endpoint') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-mno-gw-endpoint') } },
    { id: 'e-arm-agent-card', source: 'mno-endpoint', sourceHandle: 'out-bottom', target: 'arm-agent-card', targetHandle: 'in-top', type: 'mission', hidden: true, data: { kind: 'baseline', state: activeEdgeSet.has('e-arm-agent-card') ? 'selected' : 'idle', transitioning: transitioningEdgeSet.has('e-arm-agent-card') } },
  ];


  return { 
    nodes, 
    edges: edges.map((edge) => ({
      ...edge,
      data: edge.data
        ? {
            ...edge.data,
            tone:
              activeEdgeSet.has(edge.id) &&
              edge.id !== 'e-srf-ran' &&
              !DATA_PLANE_EDGE_IDS.has(edge.id)
                ? playback.activeEdgeTone
                : undefined,
            animationDirection: activeEdgeSet.has(edge.id) ? playback.activeEdgeDirections[edge.id] : undefined,
          }
        : edge.data,
    }))
  };
}
