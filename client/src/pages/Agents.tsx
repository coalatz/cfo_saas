import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useSearch } from "wouter";
import {
  Bot,
  Search,
  Globe,
  GitBranch,
  Code2,
  Download,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  Zap,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ERPBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function StepCard({
  step,
  status,
  result,
}: {
  step: (typeof STEPS)[0];
  status: "pending" | "active" | "done" | "failed";
  result?: Record<string, unknown> | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = step.icon;

  const statusIcon =
    status === "done" ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
    ) : status === "active" ? (
      <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
    ) : status === "failed" ? (
      <XCircle className="w-4 h-4 text-red-400" />
    ) : (
      <Circle className="w-4 h-4 text-muted-foreground" />
    );

  return (
    <div
      className={`border rounded-xl p-4 transition-all duration-200 ${
        status === "active"
          ? "border-blue-500/40 bg-blue-500/5"
          : status === "done"
          ? "border-emerald-500/20 bg-emerald-500/5"
          : status === "failed"
          ? "border-red-500/20 bg-red-500/5"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${step.bg}`}>
          <Icon className={`w-4 h-4 ${step.color}`} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{step.label}</p>
          <p className="text-xs text-muted-foreground">{step.description}</p>
        </div>
        {statusIcon}
        {result && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
      </div>
      {expanded && result && (
        <div className="mt-3 p-3 rounded-lg bg-background/50 border border-border">
          <pre className="text-xs text-muted-foreground font-mono overflow-auto max-h-48 whitespace-pre-wrap">
            {result ? JSON.stringify(result, null, 2) : ""}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const preselectedTenantId = params.get("tenantId");

  const { data: tenants = [] } = trpc.tenants.list.useQuery();
  const [selectedTenantId, setSelectedTenantId] = useState<string>(preselectedTenantId ?? "");
  const [selectedErp, setSelectedErp] = useState<"conta_azul" | "omie">("conta_azul");
  const [runningPipelineId, setRunningPipelineId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const tenantId = parseInt(selectedTenantId || "0");

  const { data: pipelines = [], refetch: refetchPipelines } = trpc.agents.getPipelines.useQuery(
    { tenantId },
    { enabled: tenantId > 0, refetchInterval: isRunning ? 2000 : false }
  );

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

  const handleRun = () => {
    if (!tenantId) { toast.error("Selecione um tenant"); return; }
    setIsRunning(true);
    runPipelineMutation.mutate({ tenantId, erpType: selectedErp });
  };

  const activePipeline = runningPipelineId
    ? pipelines.find((p) => p.id === runningPipelineId)
    : pipelines.find((p) => p.status === "running") ?? pipelines[0];

  const getStepStatus = (stepKey: string): "pending" | "active" | "done" | "failed" => {
    if (!activePipeline) return "pending";
    const stepOrder = ["discovery", "mapping", "generator", "extractor", "done"];
    const currentIdx = stepOrder.indexOf(activePipeline.currentStep);
    const stepIdx = stepOrder.indexOf(stepKey);

    if (activePipeline.status === "failed") {
      if (stepIdx < currentIdx) return "done";
      if (stepIdx === currentIdx) return "failed";
      return "pending";
    }
    if (stepIdx < currentIdx) return "done";
    if (stepIdx === currentIdx && activePipeline.status === "running") return "active";
    if (activePipeline.status === "completed") return "done";
    return "pending";
  };

  const getStepResult = (stepKey: string): Record<string, unknown> | null | undefined => {
    if (!activePipeline) return undefined;
    const map: Record<string, Record<string, unknown> | null | undefined> = {
      discovery: activePipeline.discoveryResult as Record<string, unknown> | null | undefined,
      mapping: activePipeline.mappingResult as Record<string, unknown> | null | undefined,
      generator: activePipeline.generatorResult as Record<string, unknown> | null | undefined,
      extractor: activePipeline.extractorResult as Record<string, unknown> | null | undefined,
    };
    return map[stepKey];
  };

  return (
    <div className="space-y-6">
      <div>
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

        {(isRunning || runPipelineMutation.isPending) && (
          <div className="mt-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <p className="text-xs text-blue-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Pipeline em execução. Os agentes estão processando os dados do ERP...
            </p>
          </div>
        )}
      </div>

      {/* Pipeline Steps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Etapas do Pipeline</h2>
          {STEPS.map((step) => (
            <StepCard
              key={step.key}
              step={step}
              status={getStepStatus(step.key)}
              result={getStepResult(step.key)}
            />
          ))}
        </div>

        {/* Pipeline History */}
        <div className="space-y-3">
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
            <div className="space-y-2">
              {pipelines.slice(0, 10).map((p) => (
                <div
                  key={p.id}
                  onClick={() => setRunningPipelineId(p.id)}
                  className={`bg-card border rounded-xl p-4 cursor-pointer transition-all hover:border-primary/30 ${
                    activePipeline?.id === p.id ? "border-primary/40 bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <ERPBadge erp={p.erpType} />
                    <StatusBadge status={p.status} />
                    <span className="text-xs text-muted-foreground font-mono flex-1">
                      Step: {p.currentStep}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.startedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                  {p.errorMessage && (
                    <p className="mt-2 text-xs text-red-400 font-mono truncate">{p.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Architecture Info */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Modelo Canônico de Saída</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { field: "external_id", type: "string", desc: "ID único no ERP de origem" },
            { field: "customer_name", type: "string", desc: "Nome do cliente/parceiro" },
            { field: "issue_date", type: "date", desc: "Data de emissão (YYYY-MM-DD)" },
            { field: "gross_amount", type: "decimal", desc: "Valor bruto do documento" },
          ].map((f) => (
            <div key={f.field} className="p-3 rounded-lg bg-background/50 border border-border">
              <p className="text-xs font-mono font-semibold text-primary">{f.field}</p>
              <p className="text-xs text-amber-400 mt-0.5">{f.type}</p>
              <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 rounded-lg bg-muted/20 border border-border text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Envelopes suportados: </span>
          <span className="font-mono">itens · items · data · titulosEncontrados · lista direta (array)</span>
        </div>
      </div>
    </div>
  );
}
