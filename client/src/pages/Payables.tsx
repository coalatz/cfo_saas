import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AppLayout from "@/components/AppLayout";
import { StatusBadge, ERPBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, TrendingDown, Clock, CheckCircle, AlertTriangle, AlertCircle } from "lucide-react";

function formatCurrency(val: unknown): string {
  const n = parseFloat(String(val ?? "0"));
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(isNaN(n) ? 0 : n);
}

function formatDate(val: string | null | undefined): string {
  if (!val) return "—";
  const [y, m, d] = val.split("-");
  if (!y || !m || !d) return val;
  return `${d}/${m}/${y}`;
}

export default function Payables() {
  const [tenantFilter, setTenantFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data: tenants } = trpc.tenants.list.useQuery();

  const queryInput = useMemo(() => ({
    tenantId: tenantFilter !== "all" ? parseInt(tenantFilter) : undefined,
    source: sourceFilter !== "all" ? (sourceFilter as "conta_azul" | "omie") : undefined,
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit,
    offset: page * limit,
  }), [tenantFilter, sourceFilter, statusFilter, dateFrom, dateTo, page]);

  const { data, isLoading, error } = trpc.payables.list.useQuery(queryInput);
  const { data: stats } = trpc.payables.stats.useQuery({
    tenantId: tenantFilter !== "all" ? parseInt(tenantFilter) : undefined,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / limit);

  function reset() {
    setTenantFilter("all"); setSourceFilter("all"); setStatusFilter("all");
    setDateFrom(""); setDateTo(""); setPage(0);
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Contas a Pagar</h1>
          <p className="text-sm text-muted-foreground mt-1">Títulos a pagar normalizados pelo modelo canônico</p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
                <TrendingDown className="w-3.5 h-3.5" /> Total
              </div>
              <p className="text-2xl font-semibold text-foreground">{Number(stats.total ?? 0).toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground">{formatCurrency(stats.totalAmount)}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
                <Clock className="w-3.5 h-3.5" /> Em Aberto
              </div>
              <p className="text-2xl font-semibold text-amber-400">{Number(stats.openCount ?? 0).toLocaleString("pt-BR")}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
                <CheckCircle className="w-3.5 h-3.5" /> Pagos
              </div>
              <p className="text-2xl font-semibold text-emerald-400">{Number(stats.paidCount ?? 0).toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground">{formatCurrency(stats.paidAmount)}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
                <AlertTriangle className="w-3.5 h-3.5" /> Vencidos
              </div>
              <p className="text-2xl font-semibold text-red-400">{Number(stats.overdueCount ?? 0).toLocaleString("pt-BR")}</p>
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
                <SelectItem value="open">Em aberto</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
                <SelectItem value="overdue">Vencido</SelectItem>
                <SelectItem value="partial">Parcial</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>

            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="bg-background border-border text-sm" />
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="bg-background border-border text-sm" />

            <Button variant="outline" size="sm" onClick={reset} className="text-muted-foreground">Limpar</Button>
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
            <p className="text-sm font-medium text-foreground">{data?.total ?? 0} registros encontrados</p>
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
                  {["ID Externo", "Fornecedor", "Emissão", "Vencimento", "Valor Bruto", "Valor Pago", "Categoria", "Status", "ERP"].map((h, i) => (
                    <th key={i} className="px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider text-left">{h}</th>
                  ))}
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
                ) : data?.payables.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-16 text-center text-muted-foreground">
                      <TrendingDown className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Nenhuma conta a pagar encontrada</p>
                      <p className="text-xs mt-1 opacity-60">Execute uma extração para importar os dados</p>
                    </td>
                  </tr>
                ) : (
                  data?.payables.map((p) => (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{p.externalId}</td>
                      <td className="px-6 py-4 font-medium text-foreground max-w-[180px] truncate">{p.supplierName ?? "—"}</td>
                      <td className="px-6 py-4 text-muted-foreground">{formatDate(p.issueDate)}</td>
                      <td className="px-6 py-4 text-muted-foreground">{formatDate(p.dueDate)}</td>
                      <td className="px-6 py-4 text-right font-medium text-foreground">{formatCurrency(p.grossAmount)}</td>
                      <td className="px-6 py-4 text-right text-emerald-400">{p.paidAmount ? formatCurrency(p.paidAmount) : "—"}</td>
                      <td className="px-6 py-4 text-muted-foreground text-xs truncate max-w-[120px]">{p.category || "—"}</td>
                      <td className="px-6 py-4"><StatusBadge status={p.status} /></td>
                      <td className="px-6 py-4"><ERPBadge erp={p.source} /></td>
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
