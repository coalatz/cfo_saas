import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useSearch, Link } from "wouter";
import {
  Bot, Search, Globe, GitBranch, Code2, Download, CheckCircle2,
  Circle, Loader2, XCircle, Zap, ChevronDown, ChevronRight,
  ArrowLeft, Clock, TerminalSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ERPBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle
} from "@/components/ui/sheet";

const STEPS = [
  {
    key: "discovery",
    label: "Discovery",
    icon: Globe,
    description: "Lê documentação da API e mapeia endpoints e autenticação",
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/20",
  },
  {
    key: "mapping",
    label: "Mapping",
    icon: GitBranch,
    description: "Gera dicionário de-para entre campos ERP e modelo canônico",
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    key: "generator",
    label: "Generator",
    icon: Code2,
    description: "Produz estratégia de conector: auth, paginação, envelopes",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  {
    key: "extractor",
    label: "Extractor",
    icon: Download,
    description: "Executa extração paginada e normaliza para modelo canônico",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
];

// --- Subcomponents ---

function LiveLogsPanel({ pipelineId, open, onOpenChange }: { pipelineId: number | null, open: boolean, onOpenChange: (o: boolean) => void }) {
  const { data: logs = [] } = trpc.agents.getPipelineLogs.useQuery(
    { pipelineId: pipelineId ?? 0 },
    { enabled: open && !!pipelineId, refetchInterval: 3000 }
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col bg-slate-950 border-l border-slate-800">
        <SheetHeader>
          <SheetTitle className="text-slate-200 flex items-center gap-2">
            <TerminalSquare className="w-5 h-5" />
            Logs ao Vivo
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 mt-4 rounded-md border border-slate-800 bg-black/50 p-4 font-mono text-xs overflow-y-auto space-y-2">
          {logs.length === 0 ? (
            <p className="text-slate-500 italic">Aguardando logs...</p>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-slate-500 flex-shrink-0">
                  {new Date(l.timestamp).toLocaleTimeString("pt-BR", { hour12: false })}
                </span>
                <span className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-400" : "text-slate-300 whitespace-pre-wrap break-all"}>
                  {l.message}
                </span>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: string | Date }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = Date.now() - new Date(startedAt).getTime();
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsed(`${m}m ${s}s`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  return <span className="text-xs text-blue-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Executando há {elapsed}</span>;
}

function PipelineRow({ p, logsOpen, setLogsOpen, setRunningId }: { p: any, logsOpen: boolean, setLogsOpen: (v: boolean) => void, setRunningId: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = p.status === "running";

  const getStepStatus = (stepKey: string): "pending" | "active" | "done" | "failed" => {
    const stepOrder = ["discovery", "mapping", "generator", "extractor", "done"];
    const currentIdx = stepOrder.indexOf(p.currentStep);
    const stepIdx = stepOrder.indexOf(stepKey);

    if (p.status === "failed") {
      if (stepIdx < currentIdx) return "done";
      if (stepIdx === currentIdx) return "failed";
      return "pending";
    }
    if (stepIdx < currentIdx) return "done";
    if (stepIdx === currentIdx && isRunning) return "active";
    if (p.status === "completed") return "done";
    return "pending";
  };

  const getStepIcon = (s: "pending" | "active" | "done" | "failed") => {
    if (s === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    if (s === "active") return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
    if (s === "failed") return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    return <Circle className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  // Helper info details
  const getStepDetail = (stepKey: string) => {
    if (stepKey === "discovery" && p.discoveryResult) {
      return `Endpoint count: ${p.discoveryResult.endpoints?.length || 0}`;
    }
    if (stepKey === "generator" && p.generatorResult) {
      return `Conectores gerados: OK`;
    }
    if (stepKey === "extractor" && p.extractorResult?.byEntity) {
      const counts = p.extractorResult.byEntity;
      return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" | ");
    }
    return null;
  };

  return (
    <div className={`bg-card border rounded-xl p-4 transition-all ${isRunning ? "border-blue-500/30" : "border-border"}`}>
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        <ERPBadge erp={p.erpType} />
        <StatusBadge status={p.status} />
        <span className="text-xs text-muted-foreground font-mono flex-1 truncate">
          Step: {p.currentStep}
        </span>
        {isRunning && <ElapsedTimer startedAt={p.startedAt} />}
        <span className="text-xs text-muted-foreground">
          {new Date(p.startedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
        </span>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs border-border gap-1.5"
          onClick={(e) => { e.stopPropagation(); setRunningId(p.id); setLogsOpen(true); }}
        >
          <TerminalSquare className="w-3 h-3" /> Ver Logs
        </Button>
      </div>

      {p.errorMessage && (
        <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
          <XCircle className="w-4 h-4 text-red-400 mt-0.5" />
          <p className="text-xs text-red-400 font-mono break-all">{p.errorMessage}</p>
        </div>
      )}

      {expanded && (
        <div className="mt-4 pl-7 space-y-3 border-l-2 border-border ml-2">
          {STEPS.map((step) => {
            const st = getStepStatus(step.key);
            const detail = getStepDetail(step.key);
            return (
              <div key={step.key} className="flex flex-col gap-1 relative">
                <div className="absolute -left-[23px] top-1 bg-card">
                  {getStepIcon(st)}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${st === "active" ? "text-blue-400" : st === "failed" ? "text-red-400" : st === "done" ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {step.label}
                  </span>
                </div>
                {detail && <span className="text-[11px] text-muted-foreground font-mono bg-muted/30 px-2 py-0.5 rounded-sm inline-block w-fit">{detail}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Main Page ---

export default function Agents() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const preselectedTenantId = params.get("tenantId");

  const { data: tenants = [] } = trpc.tenants.list.useQuery();
  const [selectedTenantId, setSelectedTenantId] = useState<string>(preselectedTenantId ?? "");
  const [selectedErp, setSelectedErp] = useState<"conta_azul" | "omie">("conta_azul");
  const [runningPipelineId, setRunningPipelineId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const utils = trpc.useUtils();

  const tenantId = parseInt(selectedTenantId || "0");

  const { data: pipelines = [], refetch: refetchPipelines } = trpc.agents.getPipelines.useQuery(
    { tenantId },
    { enabled: tenantId > 0, refetchInterval: isRunning ? 2000 : false }
  );

  useEffect(() => {
    const active = pipelines.find(p => p.status === "running");
    if (active) setIsRunning(true);
    else setIsRunning(false);
  }, [pipelines]);

  const runPipelineMutation = trpc.agents.runPipeline.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Pipeline concluído com sucesso!");
      } else {
        toast.error(`Pipeline falhou: ${data.error}`);
      }
      setIsRunning(false);
      refetchPipelines();
    },
    onError: (e) => {
      toast.error(e.message);
      setIsRunning(false);
    },
  });

  const resetZombiesMutation = trpc.agents.resetZombies.useMutation({
    onSuccess: () => {
      toast.success("Execuções travadas foram limpas!");
      utils.agents.getPipelines.invalidate();
    },
  });

  const handleRun = () => {
    if (!tenantId) { toast.error("Selecione um tenant"); return; }
    setIsRunning(true);
    runPipelineMutation.mutate({ tenantId, erpType: selectedErp });
  };

  return (
    <div className="space-y-6">
      <LiveLogsPanel pipelineId={runningPipelineId} open={logsOpen} onOpenChange={setLogsOpen} />
      
      <div>
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground -ml-3" onClick={() => window.history.back()}>
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Button>
          <Button variant="outline" size="sm" className="text-red-400 border-red-500/20 hover:bg-red-500/10" onClick={() => resetZombiesMutation.mutate()} disabled={resetZombiesMutation.isPending}>
            <XCircle className="w-4 h-4 mr-1.5" />
            Limpar Travados
          </Button>
        </div>
        <h1 className="text-xl font-semibold text-foreground">Agentes de Extração</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Pipeline de IA: Discovery → Mapping → Generator → Extractor</p>
      </div>

      {/* Controls */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Configurar Execução
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Tenant</label>
            <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
              <SelectTrigger className="bg-input border-border text-foreground">
                <SelectValue placeholder="Selecione um tenant" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} className="text-foreground">
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">ERP</label>
            <Select value={selectedErp} onValueChange={(v) => setSelectedErp(v as "conta_azul" | "omie")}>
              <SelectTrigger className="bg-input border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="conta_azul" className="text-foreground">Conta Azul</SelectItem>
                <SelectItem value="omie" className="text-foreground">Omie</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              onClick={handleRun}
              disabled={!selectedTenantId || isRunning || runPipelineMutation.isPending}
              className="w-full bg-primary text-primary-foreground gap-2"
            >
              {isRunning || runPipelineMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Executando...
                </>
              ) : (
                <>
                  <Bot className="w-4 h-4" />
                  Executar Pipeline
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Histórico de Execuções</h2>
        {!tenantId ? (
          <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center text-muted-foreground">
            <Bot className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">Selecione um tenant para ver o histórico</p>
          </div>
        ) : pipelines.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center text-muted-foreground">
            <Bot className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">Nenhum pipeline executado para este tenant</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pipelines.slice(0, 15).map((p) => (
              <PipelineRow 
                key={p.id} 
                p={p} 
                logsOpen={logsOpen} 
                setLogsOpen={setLogsOpen} 
                setRunningId={setRunningPipelineId} 
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
