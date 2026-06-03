import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link, useLocation } from "wouter";
import {
  ArrowLeft, Key, Bot, Save, Eye, EyeOff, Zap, BookOpen,
  Settings2, ExternalLink, CheckCircle2, AlertCircle, RefreshCw,
  LogOut, Wifi, WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, ERPBadge } from "@/components/ui/StatusBadge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";

// ─── Credential Field ─────────────────────────────────────────────────────────

function CredentialField({
  label, value, onChange, placeholder, secret = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="bg-input border-border text-foreground font-mono text-sm pr-10"
        />
        {secret && (
          <button type="button" onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── OAuth Status Badge ───────────────────────────────────────────────────────

interface OAuthStatus {
  connected: boolean;
  expired: boolean;
  expiresAt: string | null;
  needsReauth: boolean;
}

function OAuthStatusBadge({ status, onRefresh, onDisconnect, refreshing }: {
  status: OAuthStatus;
  onRefresh: () => void;
  onDisconnect: () => void;
  refreshing: boolean;
}) {
  if (status.needsReauth || !status.connected) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <WifiOff className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs text-amber-400 font-medium">Não conectado</span>
      </div>
    );
  }
  if (status.expired) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs text-red-400 font-medium">Token expirado</span>
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 border-border text-xs"
          onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          Renovar
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <Wifi className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs text-emerald-400 font-medium">Conectado</span>
        {status.expiresAt && (
          <span className="text-xs text-muted-foreground">
            · expira {new Date(status.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <Button size="sm" variant="outline" className="h-8 gap-1.5 border-border text-xs text-muted-foreground"
        onClick={onDisconnect}>
        <LogOut className="w-3 h-3" />
        Desconectar
      </Button>
    </div>
  );
}

// ─── Conta Azul Config ────────────────────────────────────────────────────────

function ContaAzulConfig({ tenantId }: { tenantId: number }) {
  const utils = trpc.useUtils();
  const [location] = useLocation();
  const { data: configs = [] } = trpc.erpConfigs.getByTenant.useQuery({ tenantId });
  const existing = configs.find((c) => c.erpType === "conta_azul");
  const creds = (existing?.credentials as Record<string, string>) ?? {};

  const [clientId, setClientId] = useState(creds.client_id ?? "");
  const [clientSecret, setClientSecret] = useState(creds.client_secret ?? "");
  const [baseUrl, setBaseUrl] = useState(creds.base_url ?? "https://api-v2.contaazul.com");
  const [docUrl, setDocUrl] = useState((existing as Record<string, unknown> | undefined)?.docUrl as string ?? "https://developers.contaazul.com/");

  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Sync state when data loads
  useEffect(() => {
    if (existing) {
      const c = existing.credentials as Record<string, string>;
      setClientId(c.client_id ?? "");
      setClientSecret(c.client_secret ?? "");
      setBaseUrl(c.base_url ?? "https://api-v2.contaazul.com");
      setDocUrl((existing as Record<string, unknown>).docUrl as string ?? "https://developers.contaazul.com/");
    }
  }, [configs.length]);

  // Fetch OAuth status
  const fetchOAuthStatus = async () => {
    try {
      const res = await fetch(`/api/oauth/conta-azul/status?tenantId=${tenantId}`);
      if (res.ok) setOauthStatus(await res.json());
    } catch { /* silent */ }
  };

  useEffect(() => { fetchOAuthStatus(); }, [tenantId]);

  // Handle OAuth callback result from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    if (oauthResult === "success") {
      toast.success("Conta Azul conectada com sucesso via OAuth2!");
      fetchOAuthStatus();
      utils.erpConfigs.getByTenant.invalidate();
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauthResult === "error") {
      const msg = params.get("message") ?? "Erro desconhecido";
      toast.error(`Falha na autenticação OAuth2: ${decodeURIComponent(msg)}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location]);

  const saveMutation = trpc.erpConfigs.upsert.useMutation({
    onSuccess: () => {
      utils.erpConfigs.getByTenant.invalidate();
      toast.success("Credenciais Conta Azul salvas");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleConnectOAuth = async () => {
    if (!clientId || !clientSecret) {
      toast.error("Salve o Client ID e Client Secret antes de conectar via OAuth");
      return;
    }
    // Build the callback URL — must match exactly what's registered in Conta Azul Portal
    const redirectUri = `${window.location.origin}/api/oauth/conta-azul/callback?tenantId=${tenantId}&redirectUri=${encodeURIComponent(`${window.location.origin}/api/oauth/conta-azul/callback?tenantId=${tenantId}`)}`;
    // Simpler: build redirectUri without nesting
    const callbackUrl = `${window.location.origin.replace("http://", "https://")}/api/oauth/conta-azul/callback`;
    const fullRedirectUri = `${callbackUrl}?tenantId=${tenantId}&redirectUri=${encodeURIComponent(callbackUrl)}`;

    try {
      const res = await fetch(
        `/api/oauth/conta-azul/authorize?tenantId=${tenantId}&redirectUri=${encodeURIComponent(callbackUrl)}`
      );
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error ?? "Erro ao gerar URL de autorização");
        return;
      }
      const { authorizeUrl } = await res.json();
      // Redirect the browser to Conta Azul login
      window.location.href = authorizeUrl;
    } catch (e) {
      toast.error("Erro ao iniciar fluxo OAuth2");
    }
  };

  const handleRefreshToken = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/oauth/conta-azul/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (res.ok) {
        toast.success("Token renovado com sucesso");
        await fetchOAuthStatus();
      } else {
        const err = await res.json();
        toast.error(err.error ?? "Falha ao renovar token");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetch("/api/oauth/conta-azul/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (res.ok) {
        toast.success("Desconectado do Conta Azul");
        await fetchOAuthStatus();
        utils.erpConfigs.getByTenant.invalidate();
      }
    } catch {
      toast.error("Erro ao desconectar");
    }
  };

  // Callback URL to show the user
  const callbackUrl = typeof window !== "undefined"
    ? `${window.location.origin.replace("http://", "https://")}/api/oauth/conta-azul/callback`
    : "/api/oauth/conta-azul/callback";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-sky-500/5 border border-sky-500/20">
        <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
          <Key className="w-4 h-4 text-sky-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Conta Azul</p>
          <p className="text-xs text-muted-foreground">OAuth2 Authorization Code Flow</p>
        </div>
        {existing && <StatusBadge status={existing.status} />}
      </div>

      {/* OAuth Status */}
      {oauthStatus && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50">
          <span className="text-xs text-muted-foreground font-medium">Status OAuth2</span>
          <OAuthStatusBadge
            status={oauthStatus}
            onRefresh={handleRefreshToken}
            onDisconnect={handleDisconnect}
            refreshing={refreshing}
          />
        </div>
      )}

      {/* Credentials */}
      <div className="grid grid-cols-1 gap-3">
        <CredentialField label="Client ID" value={clientId} onChange={setClientId} placeholder="client_id do app no Portal do Desenvolvedor" />
        <CredentialField label="Client Secret" value={clientSecret} onChange={setClientSecret} placeholder="client_secret do app" secret />
        <CredentialField label="Base URL da API" value={baseUrl} onChange={setBaseUrl} placeholder="https://api-v2.contaazul.com" />
      </div>

      {/* Doc URL */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <BookOpen className="w-3 h-3" />
          URL da Documentação da API
          <span className="text-primary/60 font-normal">(usado pelo Agente Discovery)</span>
        </Label>
        <Input
          value={docUrl}
          onChange={(e) => setDocUrl(e.target.value)}
          placeholder="https://developers.contaazul.com/"
          className="bg-input border-border text-foreground text-sm"
        />
      </div>

      {/* Callback URL info */}
      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <p className="text-xs font-medium text-foreground">URL de Callback para o Portal do Desenvolvedor</p>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono bg-background/80 border border-border rounded px-2 py-1.5 text-primary break-all">
            {callbackUrl}
          </code>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 border-border text-xs flex-shrink-0"
            onClick={() => { navigator.clipboard.writeText(callbackUrl); toast.success("URL copiada!"); }}
          >
            Copiar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Cadastre exatamente esta URL como Redirect URI no{" "}
          <a href="https://developers-portal.contaazul.com" target="_blank" rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5">
            Portal do Desenvolvedor
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
          {" "}da Conta Azul.
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={() => saveMutation.mutate({
            tenantId, erpType: "conta_azul",
            credentials: { client_id: clientId, client_secret: clientSecret, base_url: baseUrl },
            docUrl: docUrl || undefined,
          })}
          disabled={!clientId || !clientSecret || saveMutation.isPending}
          variant="outline"
          className="flex-1 border-border gap-2"
        >
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? "Salvando..." : "Salvar Credenciais"}
        </Button>

        <Button
          onClick={handleConnectOAuth}
          disabled={!clientId || !clientSecret}
          className="flex-1 bg-sky-600 hover:bg-sky-500 text-white gap-2"
        >
          <ExternalLink className="w-4 h-4" />
          Conectar via OAuth2
        </Button>
      </div>
    </div>
  );
}

// ─── Omie Config ──────────────────────────────────────────────────────────────

function OmieConfig({ tenantId }: { tenantId: number }) {
  const utils = trpc.useUtils();
  const { data: configs = [] } = trpc.erpConfigs.getByTenant.useQuery({ tenantId });
  const existing = configs.find((c) => c.erpType === "omie");
  const creds = (existing?.credentials as Record<string, string>) ?? {};

  const [appKey, setAppKey] = useState(creds.app_key ?? "");
  const [appSecret, setAppSecret] = useState(creds.app_secret ?? "");
  const [docUrl, setDocUrl] = useState(
    (existing as Record<string, unknown> | undefined)?.docUrl as string ?? "https://developer.omie.com.br/service-list/"
  );

  useEffect(() => {
    if (existing) {
      const c = existing.credentials as Record<string, string>;
      setAppKey(c.app_key ?? "");
      setAppSecret(c.app_secret ?? "");
      setDocUrl((existing as Record<string, unknown>).docUrl as string ?? "https://developer.omie.com.br/service-list/");
    }
  }, [configs.length]);

  const saveMutation = trpc.erpConfigs.upsert.useMutation({
    onSuccess: () => { utils.erpConfigs.getByTenant.invalidate(); toast.success("Credenciais Omie salvas"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
        <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
          <Key className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Omie</p>
          <p className="text-xs text-muted-foreground">API Key (app_key + app_secret)</p>
        </div>
        {existing && <StatusBadge status={existing.status} />}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <CredentialField label="App Key" value={appKey} onChange={setAppKey} placeholder="Chave da aplicação Omie" />
        <CredentialField label="App Secret" value={appSecret} onChange={setAppSecret} placeholder="Segredo da aplicação Omie" secret />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <BookOpen className="w-3 h-3" />
          URL da Documentação da API
          <span className="text-primary/60 font-normal">(usado pelo Agente Discovery)</span>
        </Label>
        <Input
          value={docUrl}
          onChange={(e) => setDocUrl(e.target.value)}
          placeholder="https://developer.omie.com.br/service-list/"
          className="bg-input border-border text-foreground text-sm"
        />
      </div>

      <div className="p-3 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Como obter as credenciais:</p>
        <p>1. Acesse app.omie.com.br → Configurações → API</p>
        <p>2. Crie uma nova aplicação</p>
        <p>3. Copie o App Key e App Secret gerados</p>
      </div>

      <Button
        onClick={() => saveMutation.mutate({
          tenantId, erpType: "omie",
          credentials: { app_key: appKey, app_secret: appSecret },
          docUrl: docUrl || undefined,
        })}
        disabled={!appKey || !appSecret || saveMutation.isPending}
        className="w-full bg-primary text-primary-foreground gap-2"
      >
        <Save className="w-4 h-4" />
        {saveMutation.isPending ? "Salvando..." : "Salvar Credenciais"}
      </Button>
    </div>
  );
}

// ─── TenantDetail Page ────────────────────────────────────────────────────────

export default function TenantDetail() {
  const params = useParams<{ id: string }>();
  const tenantId = parseInt(params.id ?? "0");

  const { data: tenant, isLoading } = trpc.tenants.getById.useQuery({ id: tenantId });
  const { data: pipelines = [] } = trpc.agents.getPipelines.useQuery({ tenantId });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4 animate-pulse">
          <div className="h-6 bg-border rounded w-48" />
          <div className="h-32 bg-card border border-border rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!tenant) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">Tenant não encontrado</p>
          <Link href="/tenants"><Button variant="outline" className="mt-4 border-border">Voltar</Button></Link>
        </div>
      </AppLayout>
    );
  }

  const recentPipelines = pipelines.slice(0, 5);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/tenants">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
              Tenants
            </Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                {tenant.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">{tenant.name}</h1>
                <p className="text-xs text-muted-foreground font-mono">{tenant.slug}</p>
              </div>
              <StatusBadge status={tenant.status} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/model-configs?tenantId=${tenantId}`}>
              <Button variant="outline" className="gap-2 border-border text-muted-foreground hover:text-foreground">
                <Settings2 className="w-4 h-4" />
                Modelos IA
              </Button>
            </Link>
            <Link href={`/agents?tenantId=${tenantId}`}>
              <Button className="bg-primary text-primary-foreground gap-2">
                <Zap className="w-4 h-4" />
                Executar Extração
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ERP Credentials */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              Credenciais ERP
            </h2>
            <Tabs defaultValue="conta_azul">
              <TabsList className="bg-muted/30 border border-border mb-4">
                <TabsTrigger value="conta_azul" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  Conta Azul
                </TabsTrigger>
                <TabsTrigger value="omie" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  Omie
                </TabsTrigger>
              </TabsList>
              <TabsContent value="conta_azul">
                <ContaAzulConfig tenantId={tenantId} />
              </TabsContent>
              <TabsContent value="omie">
                <OmieConfig tenantId={tenantId} />
              </TabsContent>
            </Tabs>
          </div>

          {/* Pipeline History */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              Histórico de Pipelines
            </h2>
            {recentPipelines.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bot className="w-8 h-8 mb-2 opacity-20" />
                <p className="text-xs">Nenhum pipeline executado</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentPipelines.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                    <ERPBadge erp={p.erpType} />
                    <StatusBadge status={p.status} />
                    <div className="flex-1 text-xs text-muted-foreground">
                      Step: <span className="font-mono text-foreground">{p.currentStep}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">
                      {new Date(p.startedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
