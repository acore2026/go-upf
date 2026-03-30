import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Activity, 
  Settings, 
  Wifi, 
  Smartphone, 
  RefreshCw, 
  Play, 
  AlertCircle,
  Network,
  Clock,
  CheckCircle2,
  Database,
  ArrowRightLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api';
import type { SidecarStatus, UPFStatus, TraceEntry, FlowDetail, StorySummary } from './api';
import { cn, formatBytes, formatBitrate, formatCountdown, formatTime } from './utils';

// --- Sub-components ---

const Card = ({ title, icon: Icon, children, className, status }: { 
  title: string, 
  icon: any, 
  children: React.ReactNode, 
  className?: string,
  status?: 'active' | 'idle' | 'error'
}) => (
  <motion.div 
    layout
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={cn(
      "relative overflow-hidden bg-white/80 backdrop-blur-xl border rounded-3xl p-6 transition-all duration-300 shadow-sm",
      status === 'active' ? "border-blue-200 ring-1 ring-blue-50 shadow-blue-100/50 shadow-lg" : "border-slate-200",
      className
    )}
  >
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-3">
        <div className={cn(
          "p-2.5 rounded-2xl shadow-sm transition-colors duration-300",
          status === 'active' ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
        )}>
          <Icon size={20} strokeWidth={2.5} />
        </div>
        <h2 className="text-base font-bold text-slate-900 tracking-tight">{title}</h2>
      </div>
      {status === 'active' && (
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
        </span>
      )}
    </div>
    <div className="space-y-0.5">
      {children}
    </div>
  </motion.div>
);

const Metric = ({ label, value, subtext, highlight }: { 
  label: string, 
  value: React.ReactNode, 
  subtext?: string,
  highlight?: boolean
}) => (
  <div className="group flex flex-col py-2.5 border-b border-slate-100 last:border-0 transition-all">
    <div className="flex justify-between items-baseline mb-0.5">
      <span className="text-[13px] font-semibold text-slate-500/80 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={cn(
          "text-[15px] font-bold tracking-tight",
          highlight ? "text-blue-600" : "text-slate-800"
        )}>
          {value}
        </span>
      </div>
    </div>
    {subtext && <span className="text-[11px] font-medium text-slate-400">{subtext}</span>}
  </div>
);

const StatusIndicator = ({ label, active, pulseColor = "bg-emerald-500" }: { label: string, active: boolean, pulseColor?: string }) => (
  <div className="flex items-center gap-2.5 px-3 py-1.5 bg-slate-900/50 rounded-full border border-white/5 backdrop-blur-md">
    <span className="relative flex h-2 w-2">
      {active && <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", pulseColor)}></span>}
      <span className={cn("relative inline-flex rounded-full h-2 w-2", active ? pulseColor : "bg-slate-600")}></span>
    </span>
    <span className="text-xs font-bold text-slate-300 tracking-wide uppercase">{label}</span>
  </div>
);

// --- Main Application ---

export default function App() {
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus | null>(null);
  const [upfStatus, setUpfStatus] = useState<UPFStatus | null>(null);
  const [sidecarTrace, setSidecarTrace] = useState<TraceEntry[]>([]);
  const [upfTrace, setUpfTrace] = useState<TraceEntry[]>([]);
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [flowId, setFlowId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isInjecting, setIsInjecting] = useState(false);
  const [upfFlash, setUpfFlash] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  const traceRef = useRef<HTMLDivElement>(null);
  const lastPacketCountRef = useRef(0);

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
        const fDetail = await api.getFlowDetail(flowId);
        setFlow(fDetail);
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
    const interval = setInterval(refreshAll, 1000);
    return () => clearInterval(interval);
  }, [flowId]);

  useEffect(() => {
    const packetCount = upfStatus?.story?.packetCount || 0;
    if (packetCount > lastPacketCountRef.current) {
      setUpfFlash(true);
      const timer = window.setTimeout(() => setUpfFlash(false), 1200);
      lastPacketCountRef.current = packetCount;
      return () => window.clearTimeout(timer);
    }
    lastPacketCountRef.current = packetCount;
    return undefined;
  }, [upfStatus?.story?.packetCount]);

  const handleStartStory = async () => {
    setIsStarting(true);
    setError(null);
    try {
      // crypto.randomUUID requires a secure context (HTTPS or localhost)
      const randomId = typeof crypto.randomUUID === 'function' 
        ? crypto.randomUUID().slice(0, 8) 
        : Math.random().toString(36).substring(2, 10);
        
      const generatedFlowId = `flow-${randomId}`;
      const resp = await api.startStory1({
        flowId: generatedFlowId,
        ueAddress: "10.60.0.1",
        packet: {
          srcIp: "10.60.0.1",
          dstIp: "198.51.100.10",
          srcPort: 40000,
          dstPort: 9999,
          protocol: "udp",
        }
      });
      setFlowId(resp.flowId || generatedFlowId);
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
      setFlowId("");
      setFlow(null);
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
      await api.injectBurst("10.60.0.1", flowId);
      await refreshAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsInjecting(false);
    }
  };

  const mergedTimeline = useMemo(() => {
    return [...sidecarTrace, ...upfTrace]
      .sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return (a.seq || 0) - (b.seq || 0);
      })
      .slice(-100);
  }, [sidecarTrace, upfTrace]);

  const storyExpiry = useMemo(() => {
    const expectedArrivalTime =
      sidecarStatus?.story?.expectedArrivalTime ||
      upfStatus?.story?.expectedArrivalTime ||
      flow?.lastReport?.expectedArrivalTime;

    if (!expectedArrivalTime) {
      return null;
    }

    const arrivalMs = new Date(expectedArrivalTime).getTime();
    if (Number.isNaN(arrivalMs)) {
      return null;
    }

    const expiryMs = arrivalMs + 10_000;
    return {
      expectedArrivalTime,
      expiryMs,
      remainingMs: expiryMs - Date.now(),
    };
  }, [sidecarStatus, upfStatus, flow, lastUpdate]);

  const storyLive = !!storyExpiry && storyExpiry.remainingMs > 0 &&
    ((sidecarStatus?.activeFlows || 0) > 0 || (upfStatus?.activeFlows || 0) > 0);

  const formatTraceStage = (stage?: string) => {
    if (!stage) {
      return "EVENT";
    }
    return stage.replace(/_/g, ' ').toUpperCase();
  };

  const story: StorySummary | undefined = upfStatus?.story || sidecarStatus?.story;
  const lastReport = flow?.lastReport || {};
  const lastFeedback = flow?.lastFeedback || {};
  const defaultProfileId =
    upfStatus?.defaultQoSProfile?.selectedProfileId ||
    upfStatus?.qosDecision?.defaultProfileId ||
    'adaptive-default';

  const activeProfileId =
    upfStatus?.currentQoSProfile?.selectedProfileId ||
    story?.profileId ||
    lastFeedback.profileId ||
    '';

  const hasMasqueTunnel = storyLive && ((sidecarStatus?.activeFlows || 0) > 0 || !!story?.flowDescription);
  const hasAdaptiveProfile = storyLive && !!activeProfileId && activeProfileId !== defaultProfileId;
  const packetDetected = (upfStatus?.story?.packetCount || 0) > 0;

  return (
    <div className="min-h-screen bg-[#fcfdfe] font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* Visual background noise */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] z-0"></div>
      
      {/* Decorative Orbs */}
      <div className="fixed -top-[20%] -left-[10%] w-[50%] h-[50%] bg-blue-400/10 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="fixed -bottom-[10%] -right-[5%] w-[40%] h-[40%] bg-indigo-400/10 blur-[100px] rounded-full pointer-events-none"></div>

      <div className="relative z-10 max-w-[1400px] mx-auto p-4 md:p-8 space-y-8">
        
        {/* Navigation / Header */}
        <nav className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="bg-blue-600 p-3.5 rounded-2xl text-white shadow-xl shadow-blue-500/20">
                <Network size={28} strokeWidth={2.5} />
              </div>
              <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-lg border border-slate-100 shadow-sm">
                <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1.5">Adaptive QoS</h1>
              <div className="flex items-center gap-2 text-[13px] font-bold text-slate-400/80 tracking-wide uppercase">
                <span className="text-blue-600">Stage 2</span>
                <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                <span>User-Plane Collaboration</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={handleReset} 
              disabled={isResetting}
              className="group relative flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 rounded-2xl text-[14px] font-bold text-slate-600 hover:border-slate-300 hover:text-slate-900 hover:shadow-md transition-all duration-200 disabled:opacity-50"
            >
              <RefreshCw size={16} strokeWidth={2.5} className={cn(isResetting ? 'animate-spin' : 'group-hover:rotate-45 transition-transform')} />
              <span>Reset Scene</span>
            </button>
            <button 
              onClick={handleInjectBurst} 
              disabled={isInjecting || !flowId}
              className="group relative flex items-center gap-2 px-5 py-2.5 bg-emerald-600 border border-emerald-500 rounded-2xl text-[14px] font-bold text-white hover:bg-emerald-700 hover:shadow-md transition-all duration-200 disabled:opacity-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200"
            >
              <Activity size={16} strokeWidth={2.5} className={cn(isInjecting ? 'animate-pulse' : '')} />
              <span>Send Burst Packet</span>
            </button>
            <button 
              onClick={handleStartStory} 
              disabled={isStarting}
              className="relative flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-2xl text-[14px] font-black hover:bg-slate-800 transition-all duration-200 shadow-xl shadow-slate-900/10 disabled:opacity-70 group"
            >
              {isStarting ? (
                <RefreshCw size={16} strokeWidth={3} className="animate-spin" />
              ) : (
                <Play size={16} strokeWidth={3} className="fill-current" />
              )}
              <span>Initialize Burst</span>
            </button>
          </div>
        </nav>

        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex items-center gap-3 bg-red-50 border border-red-100 text-red-600 px-5 py-4 rounded-2xl shadow-sm"
            >
              <AlertCircle size={20} strokeWidth={2.5} />
              <span className="text-sm font-bold tracking-tight">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Infrastructure Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-slate-900 rounded-3xl p-6 shadow-2xl shadow-slate-900/10 flex flex-col md:flex-row items-center justify-between gap-6 border border-white/5">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/5 rounded-2xl text-blue-400">
                <Activity size={24} strokeWidth={2.5} />
              </div>
              <div className="space-y-0.5">
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-[0.15em]">System Orbit</p>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  {flowId ? <span className="text-blue-400 font-mono">{flowId}</span> : 'Awaiting initialization'}
                </h3>
              </div>
            </div>
            
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center gap-2">
                <div className="h-1.5 w-16 bg-white/10 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: upfStatus?.running ? '100%' : '0%' }}
                    className="h-full bg-emerald-500"
                  />
                </div>
                <StatusIndicator label="UPF Core" active={!!upfStatus?.running} />
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="h-1.5 w-16 bg-white/10 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: sidecarStatus ? '100%' : '0%' }}
                    className="h-full bg-emerald-500"
                  />
                </div>
                <StatusIndicator label="UE Sidecar" active={!!sidecarStatus} />
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl p-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-slate-100 rounded-2xl text-slate-500">
                <Clock size={24} strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Last Update</p>
                <h3 className="text-lg font-bold text-slate-800 tracking-tight font-mono">{formatTime(lastUpdate.toISOString())}</h3>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Status</span>
              <div className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-black tracking-widest uppercase">Live</div>
            </div>
          </div>
        </div>

        {/* E2E Network Visualization */}
        <div className="bg-white rounded-[40px] p-8 md:p-12 shadow-sm border border-slate-200 overflow-x-auto relative group">
          <div className="absolute top-8 left-12 right-12 flex items-start justify-between gap-4 pointer-events-none">
            <div className="text-[11px] font-black text-slate-300 uppercase tracking-[0.2em] group-hover:text-blue-200 transition-colors">
              Path Visualization
            </div>
            <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-2 shadow-sm backdrop-blur">
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Timer</span>
                <span className="text-sm font-black text-slate-900 font-mono">
                  {storyExpiry ? formatCountdown(storyExpiry.remainingMs) : "Standby"}
                </span>
              </div>
              <div className="h-8 w-px bg-slate-200"></div>
              <div className="flex flex-col leading-tight text-right">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Expires at</span>
                <span className="text-[11px] font-semibold text-slate-600 font-mono">
                  {storyExpiry ? formatTime(new Date(storyExpiry.expiryMs).toISOString()) : "Waiting for expected arrival"}
                </span>
              </div>
            </div>
          </div>
          
          <div className="min-w-[800px] flex items-center justify-between relative mt-14">
            
            {/* Base Path Line */}
            <div className={cn(
              "absolute top-1/2 left-10 right-10 h-1.5 -translate-y-1/2 z-0 rounded-full overflow-hidden shadow-inner transition-opacity duration-300",
              storyLive ? "bg-slate-100 opacity-100" : "bg-transparent opacity-0"
            )}>
               <motion.div 
                 initial={{ width: 0 }}
                 animate={{ 
                   width: storyLive ? (
                     story?.gnbDecision === 'ACCEPTED' ? '100%' : 
                     story?.profileId ? '66%' : 
                     story?.phase === 'prepared' ? '33%' : 
                     story?.phase ? '10%' : '0%'
                   ) : '0%'
                 }}
                 transition={{ duration: 0.8, ease: "circOut" }}
                 className="h-full bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]"
               />
            </div>
            <div className={cn(
              "absolute left-10 right-10 h-1.5 -translate-y-1/2 z-0 rounded-full overflow-hidden pointer-events-none transition-opacity duration-300",
              hasMasqueTunnel ? "opacity-100" : "opacity-0"
            )} style={{ top: "41%" }}>
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: hasMasqueTunnel ? '48%' : '0%', opacity: hasMasqueTunnel ? 1 : 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-blue-500 shadow-[0_0_20px_rgba(34,211,238,0.55)]"
              />
              <div className="absolute inset-0 h-full rounded-full bg-cyan-400/10 backdrop-blur-[1px]"></div>
            </div>
            <div className={cn(
              "absolute left-10 right-10 h-1.5 -translate-y-1/2 z-0 rounded-full overflow-hidden pointer-events-none transition-opacity duration-300",
              hasAdaptiveProfile ? "opacity-100" : "opacity-0"
            )} style={{ top: "59%" }}>
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: hasAdaptiveProfile ? '78%' : '0%', opacity: hasAdaptiveProfile ? 1 : 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 shadow-[0_0_20px_rgba(251,191,36,0.45)]"
              />
              <div className="absolute inset-0 h-full rounded-full bg-amber-400/10 backdrop-blur-[1px]"></div>
            </div>

              {[
              { id: 'ue', icon: Smartphone, label: 'UE', active: storyLive && !!story?.phase },
              { id: 'gnb', icon: Wifi, label: 'gNB', active: storyLive && (story?.gnbDecision === 'ACCEPTED' || !!story?.profileId) },
              { id: 'upf', icon: Settings, label: 'UPF', active: storyLive && !!story?.profileId, flash: upfFlash || packetDetected },
            ].map((node) => (
              <div key={node.id} className="relative z-10 flex flex-col items-center gap-5">
                <motion.div 
                  animate={{ 
                    scale: node.active ? 1.15 : 1,
                    y: node.active ? -5 : 0,
                    boxShadow: node.flash ? "0 0 0 14px rgba(59,130,246,0.10), 0 0 38px rgba(59,130,246,0.24)" : undefined
                  }}
                  className={cn(
                    "w-20 h-20 rounded-3xl flex items-center justify-center transition-all duration-500 shadow-sm",
                    node.active 
                      ? node.flash
                        ? "bg-white border-2 border-blue-600 text-blue-600 shadow-2xl shadow-blue-500/10 ring-8 ring-blue-50 animate-pulse"
                        : "bg-white border-2 border-blue-600 text-blue-600 shadow-2xl shadow-blue-500/10 ring-8 ring-blue-50"
                      : "bg-white text-slate-300 border-2 border-slate-100"
                  )}
                >
                  <node.icon size={32} strokeWidth={node.active ? 3 : 2} />
                </motion.div>
                <div className="flex flex-col items-center">
                  <span className={cn(
                    "text-[13px] font-black uppercase tracking-widest transition-colors duration-300",
                    node.active ? "text-slate-900" : "text-slate-300"
                  )}>
                    {node.label}
                  </span>
                  {node.active && (
                    <motion.div 
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="mt-2"
                    >
                      <CheckCircle2 size={14} className="text-emerald-500 fill-emerald-50" strokeWidth={3} />
                    </motion.div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detailed Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
            <Card title="Application Intent" icon={Smartphone} status={story?.phase ? 'active' : 'idle'}>
            <Metric label="Scenario" value={story?.scenario || 'None'} highlight={!!story?.scenario} />
            <Metric label="Flow 5-tuple" value={story?.flowDescription || 'N/A'} highlight={!!story?.flowDescription} />
            <Metric label="Payload" value={formatBytes(lastReport.BurstSize || story?.burstSize)} />
            <Metric label="Deadline" value={story?.deadlineMs ? `${story.deadlineMs} ms` : 'N/A'} />
            <Metric label="Priority" value={lastReport.Priority || 'N/A'} />
          </Card>

          <Card title="MASQUE Transport" icon={ArrowRightLeft} status={story?.phase === 'prepared' || !!story?.profileId ? 'active' : 'idle'}>
            <Metric label="UE Address" value={lastReport.ueAddress || '10.60.0.4'} />
            <Metric label="Signal Phase" value={story?.phase || 'Idle'} highlight={!!story?.phase} />
            <Metric label="Active Flow" value={sidecarStatus?.activeFlows || 0} />
            <Metric label="Status" value={lastFeedback.Status || 'Standby'} />
          </Card>

          <Card title="QoS Engine" icon={Settings} status={!!story?.profileId ? 'active' : 'idle'}>
            <Metric 
              label="Selected Profile" 
              value={upfStatus?.currentQoSProfile?.selectedProfileId || upfStatus?.defaultQoSProfile?.selectedProfileId || 'default'} 
              highlight={!!story?.profileId}
              subtext={upfStatus?.currentQoSProfile?.decisionReason || upfStatus?.defaultQoSProfile?.decisionReason || 'Waiting for match'}
            />
            <Metric label="GFBR DL" value={formatBitrate(upfStatus?.currentQoSProfile?.overrideGfbrDl || upfStatus?.defaultQoSProfile?.overrideGfbrDl)} />
            <Metric label="MBR DL" value={formatBitrate(upfStatus?.currentQoSProfile?.overrideMbrDl || upfStatus?.defaultQoSProfile?.overrideMbrDl)} />
            <Metric label="CP Auth Max DL" value={formatBitrate(upfStatus?.cpProvisionedRange?.authorizationMaxBitrateDl)} subtext="Limit from Control Plane" />
            <Metric label="Packet Count" value={upfStatus?.story?.packetCount || 0} highlight={!!upfStatus?.story?.packetCount} />
            <Metric label="Decision" value={lastFeedback.ReasonCode || 'Pending'} />
          </Card>

          <Card title="RAN" icon={Wifi} status={story?.gnbDecision === 'ACCEPTED' ? 'active' : 'idle'}>
            <Metric 
              label="Decision" 
              value={story?.gnbDecision || 'PENDING'} 
              highlight={story?.gnbDecision === 'ACCEPTED'}
            />
            <Metric label="Predicted Delay" value={story?.predictedAirDelayMs ? `${story.predictedAirDelayMs} ms` : 'N/A'} />
            <Metric 
              label="Success Ratio" 
              value={story?.blockSuccessRatio ? `${(story.blockSuccessRatio * 100).toFixed(1)}%` : 'N/A'} 
            />
            <Metric label="Assist Target" value="Burst Block" />
          </Card>

        </div>

        {/* Trace / Activity Log */}
        <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 overflow-hidden flex flex-col md:flex-row h-[500px]">
          
          {/* Side Info Panel */}
          <div className="w-full md:w-[320px] bg-slate-50 border-r border-slate-100 p-8 flex flex-col justify-between shrink-0">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-slate-900 rounded-xl text-white">
                  <Database size={20} strokeWidth={2.5} />
                </div>
                <h2 className="text-lg font-black text-slate-900 tracking-tight">System Log</h2>
              </div>
              <p className="text-sm text-slate-500 font-medium leading-relaxed">
                Real-time telemetry interleaved from UPF Core and UE Sidecar. All events are synchronized via MASQUE transport.
              </p>
              
              <div className="space-y-3 pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm shadow-blue-200"></div>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">UPF Controller</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-indigo-400 shadow-sm shadow-indigo-200"></div>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">UE Sidecar</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Live Feed</span>
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              </div>
              <div className="text-xl font-black text-slate-900 font-mono tracking-tighter">
                {mergedTimeline.length.toString().padStart(3, '0')}
              </div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Total Packets</div>
            </div>
          </div>

          {/* Trace Content */}
          <div ref={traceRef} className="flex-1 overflow-y-auto p-8 scroll-smooth custom-scrollbar">
            <AnimatePresence initial={false}>
              {mergedTimeline.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4">
                  <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center">
                    <Activity size={32} className="opacity-20" />
                  </div>
                  <p className="text-sm font-bold tracking-tight uppercase tracking-[0.2em] opacity-50">Empty Telemetry</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {mergedTimeline.map((ev, i) => (
                    <motion.div 
                      key={`${ev.timestamp}-${ev.seq}-${i}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="group flex gap-5 items-start"
                    >
                      <div className="text-[11px] font-bold text-slate-400 font-mono pt-1 shrink-0 w-20 text-right opacity-60">
                        {formatTime(ev.timestamp)}
                      </div>
                      <div className="relative flex flex-col items-center pt-1.5">
                        <div className={cn(
                          "w-2.5 h-2.5 rounded-full ring-4 ring-white transition-all duration-300",
                          ev.component === 'upf' ? "bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.4)]" : "bg-indigo-400"
                        )}></div>
                      </div>
                      <div className="flex-1 bg-white hover:bg-slate-50 transition-all duration-200 p-4 rounded-2xl border border-slate-100 hover:border-slate-200 hover:shadow-sm">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={cn(
                            "text-[10px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-lg",
                            ev.component === 'upf' ? "bg-blue-50 text-blue-700" : "bg-indigo-50 text-indigo-700"
                          )}>
                            {ev.component}
                          </span>
                          <span className="text-[11px] font-bold text-slate-300 font-mono uppercase tracking-widest">
                            Seq: {ev.seq?.toString().padStart(3, '0')}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-800 tracking-tight leading-none mb-2">
                          {formatTraceStage(ev.stage)}
                        </h4>
                        {(ev.detail || ev.profileId || ev.status) && (
                          <div className="text-[12px] text-slate-500 leading-relaxed font-mono bg-slate-50/50 p-2 rounded-lg mt-1 group-hover:bg-white transition-colors">
                            {ev.profileId && <><span className="text-blue-600 font-bold">{ev.profileId}</span> &middot; </>}
                            {ev.status && <><span className="text-slate-900 font-bold">{ev.status}</span> &middot; </>}
                            {ev.detail && <span className="text-slate-400 italic font-medium">{ev.detail}</span>}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )).reverse()}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}
