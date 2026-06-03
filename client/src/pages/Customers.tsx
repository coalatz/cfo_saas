import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AppLayout from "@/components/AppLayout";
import { StatusBadge, ERPBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Users, Building2, User, Search, AlertCircle } from "lucide-react";



function formatDocument(doc: string | null | undefined, type: string | null | undefined): string {
  if (!doc) return "—";
  const digits = doc.replace(/\D/g, "");
  if (type === "cnpj" || digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  if (type === "cpf" || digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return doc;
}

export default function Customers() {
  const [tenantFilter, setTenantFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data: tenants } = trpc.tenants.list.useQuery();

  const queryInput = useMemo(() => ({
    tenantId: tenantFilter !== "all" ? parseInt(tenantFilter) : undefined,
    source: sourceFilter !== "all" ? (sourceFilter as "conta_azul" | "omie") : undefined,
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    documentType: docTypeFilter !== "all" ? (docTypeFilter as any) : undefined,
    search: search.trim() || undefined,
    limit,
    offset: page * limit,
  }), [tenantFilter, sourceFilter, statusFilter, docTypeFilter, search, page]);

  const { data, isLoading, error } = trpc.customers.list.useQuery(queryInput);
  const { data: stats } = trpc.customers.stats.useQuery({
    tenantId: tenantFilter !== "all" ? parseInt(tenantFilter) : undefined,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / limit);

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-1">Cadastro de clientes extraídos e normalizados pelo modelo canônico</p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
                <Users className="w-3.5 h-3.5" /> Total
              </div>
              <p className="text-2xl font-semibold text-foreground">{Number(stats.total ?? 0).toLocaleString("pt-BR")}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
                <Users className="w-3.5 h-3.5" /> Ativos
              </div>
              <p className="text-2xl font-semibold text-emerald-400">{Number(stats.activeCount ?? 0).toLocaleString("pt-BR")}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
                <Building2 className="w-3.5 h-3.5" /> PJ (CNPJ)
              </div>
              <p className="text-2xl font-semibold text-blue-400">{Number(stats.cnpjCount ?? 0).toLocaleString("pt-BR")}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
                <User className="w-3.5 h-3.5" /> PF (CPF)
              </div>
              <p className="text-2xl font-semibold text-violet-400">{Number(stats.cpfCount ?? 0).toLocaleString("pt-BR")}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Select value={tenantFilter} onValueChange={(v) => { setTenantFilter(v); setPage(0); }}>
              <SelectTrigger className="bg-background border-border text-sm">
                <SelectValue placeholder="Tenant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tenants</SelectItem>
                {tenants?.map((t) => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(0); }}>
              <SelectTrigger className="bg-background border-border text-sm">
                <SelectValue placeholder="ERP" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os ERPs</SelectItem>
                <SelectItem value="conta_azul">Conta Azul</SelectItem>
                <SelectItem value="omie">Omie</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="bg-background border-border text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="inactive">Inativo</SelectItem>
                <SelectItem value="blocked">Bloqueado</SelectItem>
              </SelectContent>
            </Select>

            <Select value={docTypeFilter} onValueChange={(v) => { setDocTypeFilter(v); setPage(0); }}>
              <SelectTrigger className="bg-background border-border text-sm">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">PJ e PF</SelectItem>
                <SelectItem value="cnpj">CNPJ (PJ)</SelectItem>
                <SelectItem value="cpf">CPF (PF)</SelectItem>
              </SelectContent>
            </Select>

            <div className="col-span-2 flex gap-2">
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(0); } }}
                placeholder="Buscar por nome..."
                className="bg-background border-border text-sm"
              />
              <Button variant="outline" size="icon" onClick={() => { setSearch(searchInput); setPage(0); }}>
                <Search className="w-4 h-4" />
              </Button>
            </div>

            <Button variant="outline" size="sm" onClick={() => { setTenantFilter("all"); setSourceFilter("all"); setStatusFilter("all"); setDocTypeFilter("all"); setSearch(""); setSearchInput(""); setPage(0); }} className="text-muted-foreground">
              Limpar
            </Button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">Erro ao carregar dados: {error.message}</p>
          </div>
        )}

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <p className="text-sm font-medium text-foreground">{data?.total ?? 0} clientes encontrados</p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span>Página {page + 1} de {totalPages}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">ID Externo</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Nome</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Nome Fantasia</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Documento</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tipo</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">E-mail</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Cidade/UF</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">ERP</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className="px-6 py-4"><div className="h-4 bg-muted/50 rounded animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : data?.customers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-16 text-center text-muted-foreground">
                      <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Nenhum cliente encontrado</p>
                      <p className="text-xs mt-1 opacity-60">Execute uma extração para importar o cadastro de clientes</p>
                    </td>
                  </tr>
                ) : (
                  data?.customers.map((c) => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{c.externalId}</td>
                      <td className="px-6 py-4 font-medium text-foreground max-w-[160px] truncate">{c.name}</td>
                      <td className="px-6 py-4 text-muted-foreground max-w-[140px] truncate">{c.tradeName ?? "—"}</td>
                      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{formatDocument(c.document, c.documentType)}</td>
                      <td className="px-6 py-4">
                        {c.documentType === "cnpj" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Building2 className="w-3 h-3" /> PJ
                          </span>
                        ) : c.documentType === "cpf" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20">
                            <User className="w-3 h-3" /> PF
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-xs truncate max-w-[160px]">{c.email ?? "—"}</td>
                      <td className="px-6 py-4 text-muted-foreground text-xs">
                        {c.city && c.state ? `${c.city}/${c.state}` : c.city ?? c.state ?? "—"}
                      </td>
                      <td className="px-6 py-4"><StatusBadge status={c.status} /></td>
                      <td className="px-6 py-4"><ERPBadge erp={c.source} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
