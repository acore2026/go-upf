export interface StorySummary {
  scenario: string;
  flowId: string;
  phase: string;
  profileId?: string;
  gnbDecision?: string;
  predictedAirDelayMs?: number;
  blockSuccessRatio?: number;
  burstSize?: number;
  burstDurationMs?: number;
  deadlineMs?: number;
  expectedArrivalTime?: string;
  flowDescription?: string;
  packetCount?: number;
}

export interface PacketFiveTuple {
  srcIp?: string;
  dstIp?: string;
  srcPort?: number;
  dstPort?: number;
  protocol?: string;
}

export interface Story1StartRequest {
  flowId?: string;
  ueAddress?: string;
  reportType?: string;
  scenario?: string;
  trafficPattern?: string;
  latencySensitivity?: string;
  packetLossTolerance?: string;
  priority?: string;
  expectedArrivalDelayMs?: number;
  expectedArrivalTime?: string;
  burstSize?: number;
  burstDurationMs?: number;
  deadlineMs?: number;
  flowDescription?: string;
  packet?: PacketFiveTuple;
}

export interface SidecarStatus {
  lastReportAt: string;
  lastError: string;
  activeFlows: number;
  managedFlowIds: string[];
  traceDepth: number;
  story?: StorySummary;
}

export interface UPFStatus {
  running: boolean;
  startedAt: string;
  masqueAddr: string;
  reportAddr: string;
  debugAddr: string;
  template: string;
  activeFlows?: number;
  traceDepth: number;
  serveError: string;
  story?: StorySummary;
  cpProvisionedRange?: {
    qerCount: number;
    authorizationMaxBitrateUl: number;
    authorizationMaxBitrateDl: number;
    authorizationMaxGfbrUl: number;
    authorizationMaxGfbrDl: number;
    mbrUlMin: number;
    mbrUlMax: number;
    mbrDlMin: number;
    mbrDlMax: number;
  };
  currentQoSProfile?: {
    selectedProfileId: string;
    decisionReason: string;
    overrideGfbrDl: number;
    overrideGfbrUl: number;
    overrideMbrDl: number;
    overrideMbrUl: number;
  };
  defaultQoSProfile?: {
    selectedProfileId: string;
    decisionReason: string;
    overrideGfbrDl: number;
    overrideGfbrUl: number;
    overrideMbrDl: number;
    overrideMbrUl: number;
  };
  qosDecision?: {
    defaultProfileId: string;
    decisionReason: string;
    requestedPriority: string;
    requestedBitrateDl: number;
    requestedBitrateUl: number;
    overrideGfbrDl: number;
    overrideGfbrUl: number;
    defaultGfbrDl: number;
    defaultGfbrUl: number;
    overrideMbrDl: number;
    overrideMbrUl: number;
  };
}

export interface TraceEntry {
  seq: number;
  timestamp: string;
  component: string;
  stage?: string;
  flowId?: string;
  reportType?: string;
  status?: string;
  reason?: string;
  detail?: string;
  profileId?: string;
  qosDecision?: any;
  requestMessage?: any;
  responseMessage?: any;
}

export interface FlowDetail {
  flowId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastError: string;
  lastReport: any;
  lastFeedback: any;
}

const fetchJSON = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`.trim());
  }
  return response.json();
};

export const api = {
  getSidecarStatus: () => fetchJSON<SidecarStatus>('/api/sidecar/status'),
  getSidecarTrace: () => fetchJSON<TraceEntry[]>('/api/sidecar/trace'),
  getUPFStatus: () => fetchJSON<UPFStatus>('/api/upf/debug/adaptive-qos/status'),
  getUPFTrace: () => fetchJSON<TraceEntry[]>('/api/upf/debug/adaptive-qos/trace'),
  getFlowDetail: (flowId: string) => fetchJSON<FlowDetail>(`/api/sidecar/flows/${encodeURIComponent(flowId)}`),
  startStory1: (body: Story1StartRequest = {}) => fetchJSON<any>('/api/sidecar/demo/story1/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  reset: () => fetchJSON<any>('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }),
  injectBurst: (ueAddress: string, flowId: string) => fetchJSON<any>('/api/upf/debug/adaptive-qos/inject-burst', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ueAddress, flowId }),
  }),
};
