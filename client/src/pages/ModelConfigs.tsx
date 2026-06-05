import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useSearch } from "wouter";
import { Settings2, Plus, Trash2, Bot, Save, ChevronDown, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const AGENT_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  discovery: { label: "Discovery", desc: "Lê documentação e mapeia endpoints", color: "text-sky-400" },
  mapping: { label: "Mapping", desc: "Gera dicionário de-para de campos", color: "text-violet-400" },
  generator: { label: "Generator", desc: "Define estratégia de extração", color: "text-amber-400" },
  extractor: { label: "Extractor", desc: "Executa extração paginada HTTP", color: "text-emerald-400" },
};

const PROVIDER_LABELS: Record<string, string> = {
  manus: "Manus",
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
  gemini: "Google Gemini",
};

type AgentName = "discovery" | "mapping" | "generator" | "extractor";
type Provider = "manus" | "openai" | "anthropic" | "groq" | "gemini";

function AddConfigForm({
  tenantId,
  onSuccess,
}: {
  tenantId: number;
  onSuccess: () => void;
}) {
  const [agentName, setAgentName] = useState<AgentName>("discovery");
  const [provider, setProvider] = useState<Provider>("openai");
  const [modelId, setModelId] = useState("gpt-4o");
  const [temperature, setTemperature] = useState("0.1");
  const [maxTokens, setMaxTokens] = useState("2048");
  const [apiKey, setApiKey] = useState("");

  const utils = trpc.useUtils();
  const saveMutation = trpc.modelConfigs.save.useMutation({
    onSuccess: () => {
      utils.modelConfigs.list.invalidate();
      toast.success("Configuração salva com sucesso");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="bg-muted/30 border border-border rounded-xl p-5 space-y-5 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Nova Configuração</h3>
        <Button variant="ghost" size="sm" onClick={onSuccess} className="h-8">Cancelar</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Agente</Label>
          <Select value={agentName} onValueChange={(v) => setAgentName(v as AgentName)}>
            <SelectTrigger className="bg-input border-border text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(AGENT_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  <span className={v.color}>{v.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Provedor LLM</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
            <SelectTrigger className="bg-input border-border text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Modelo</Label>
          <Input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="Ex: gpt-4o, claude-3-opus-20240229"
            className="bg-input border-border text-sm"
          />
        </div>

        <div className="space-y-1.5 flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Temperatura</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className="bg-input border-border text-sm"
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max Tokens</Label>
            <Input
              type="number"
              step="256"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="bg-input border-border text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs text-muted-foreground">API Key (opcional, se não houver ENV global)</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="bg-input border-border text-sm font-mono"
          />
        </div>
      </div>

      <Button
        onClick={() =>
          saveMutation.mutate({
            tenantId,
            agentName,
            provider,
            modelId,
            temperature: parseFloat(temperature),
            maxTokens: parseInt(maxTokens),
            apiKey: apiKey || undefined,
          })
        }
        disabled={saveMutation.isPending || !modelId}
        className="w-full bg-primary text-primary-foreground gap-2"
      >
        <Save className="w-4 h-4" />
        {saveMutation.isPending ? "Salvando..." : "Salvar Configuração"}
      </Button>
    </div>
  );
}

export default function ModelConfigs() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const tenantIdParam = params.get("tenantId");
  const [selectedTenantId, setSelectedTenantId] = useState<number>(
    tenantIdParam ? parseInt(tenantIdParam) : 0
  );

  const { data: tenants = [] } = trpc.tenants.list.useQuery();
  const utils = trpc.useUtils();

  const { data: configs = [], isLoading } = trpc.modelConfigs.list.useQuery(
    { tenantId: selectedTenantId },
    { enabled: selectedTenantId > 0 }
  );

  const deleteMutation = trpc.modelConfigs.delete.useMutation({
    onSuccess: () => {
      utils.modelConfigs.list.invalidate();
      toast.success("Configuração removida");
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId);
  const [isAdding, setIsAdding] = useState(false);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <div className="mb-2 -ml-3">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground" onClick={() => window.history.back()}>
              <ChevronLeft className="w-4 h-4" />
              Voltar
            </Button>
          </div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-3">
            <Settings2 className="w-6 h-6 text-primary" />
            Configuração de Modelos IA
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Defina qual modelo LLM cada agente utiliza, por tenant. Sem configuração, o modelo padrão da plataforma é usado.
          </p>
        </div>

        {/* Tenant Selector */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <Label className="text-xs text-muted-foreground">Tenant</Label>
          <Select
            value={selectedTenantId > 0 ? String(selectedTenantId) : ""}
            onValueChange={(v) => setSelectedTenantId(parseInt(v))}
          >
            <SelectTrigger className="bg-input border-border text-sm max-w-xs">
              <SelectValue placeholder="Selecione um tenant..." />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedTenant && (
            <p className="text-xs text-muted-foreground font-mono">{selectedTenant.slug}</p>
          )}
        </div>

        {selectedTenantId > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Current Configs */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                Configurações Ativas
              </h2>

              {isLoading ? (
                <div className="space-y-2 animate-pulse">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-card border border-border rounded-xl" />
                  ))}
                </div>
              ) : configs.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center justify-center text-muted-foreground">
                  <Bot className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs text-center">
                    Nenhuma configuração personalizada.<br />
                    Todos os agentes usam o modelo padrão da plataforma.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {configs.map((cfg) => {
                    const agentInfo = AGENT_LABELS[cfg.agentName] ?? { label: cfg.agentName, color: "text-foreground", desc: "" };
                    return (
                      <div
                        key={cfg.id}
                        className="bg-card border border-border rounded-xl p-4 flex items-start gap-3"
                      >
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold ${agentInfo.color}`}>
                              {agentInfo.label}
                            </span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">{PROVIDER_LABELS[cfg.provider] ?? cfg.provider}</span>
                          </div>
                          <p className="text-sm font-mono text-foreground">{cfg.modelId}</p>
                          <p className="text-xs text-muted-foreground">
                            temp: {cfg.temperature} · max_tokens: {cfg.maxTokens}
                            {cfg.apiKey ? " · API key personalizada" : ""}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate({ id: cfg.id })}
                          disabled={deleteMutation.isPending}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Legend */}
              <div className="bg-muted/20 border border-border/50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Agentes do pipeline:</p>
                {Object.entries(AGENT_LABELS).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2">
                    <span className={`text-xs font-semibold w-20 shrink-0 ${v.color}`}>{v.label}</span>
                    <span className="text-xs text-muted-foreground">{v.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Add Config Form */}
            <AddConfigForm
              tenantId={selectedTenantId}
              onSuccess={() => utils.modelConfigs.list.invalidate()}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
