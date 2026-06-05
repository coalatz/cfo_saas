import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FileText, Filter, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { ERPBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE = 50;

export default function Invoices() {
  const { data: tenants = [] } = trpc.tenants.list.useQuery();

  const [tenantId, setTenantId] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);

  const queryInput = {
    tenantId: tenantId !== "all" ? parseInt(tenantId) : undefined,
    source: source !== "all" ? (source as "conta_azul" | "omie") : undefined,
    status: status !== "all" ? (status as "open" | "paid" | "overdue" | "cancelled") : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading } = trpc.invoices.list.useQuery(queryInput);
  const { data: stats } = trpc.invoices.stats.useQuery({ tenantId: tenantId !== "all" ? parseInt(tenantId) : undefined });

  const invoices = data?.invoices ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const totalAmount = invoices.reduce((sum, inv) => sum + parseFloat(String(inv.grossAmount ?? "0")), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-2 -ml-3">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground" onClick={() => window.history.back()}>
              <ChevronLeft className="w-4 h-4" />
              Voltar
            </Button>
          </div>
          <h1 className="text-xl font-semibold text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Dados canônicos extraídos dos ERPs</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-lg px-3 py-2">
          <FileText className="w-3.5 h-3.5 text-primary" />
          <span>{total.toLocaleString("pt-BR")} registros</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Filtros</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Select value={tenantId} onValueChange={(v) => { setTenantId(v); setPage(0); }}>
            <SelectTrigger className="bg-input border-border text-foreground text-xs">
              <SelectValue placeholder="Todos os tenants" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all" className="text-foreground text-xs">Todos os tenants</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={String(t.id)} className="text-foreground text-xs">{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={source} onValueChange={(v) => { setSource(v); setPage(0); }}>
            <SelectTrigger className="bg-input border-border text-foreground text-xs">
              <SelectValue placeholder="Todos os ERPs" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all" className="text-foreground text-xs">Todos os ERPs</SelectItem>
              <SelectItem value="conta_azul" className="text-foreground text-xs">Conta Azul</SelectItem>
              <SelectItem value="omie" className="text-foreground text-xs">Omie</SelectItem>
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="bg-input border-border text-foreground text-xs">
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all" className="text-foreground text-xs">Todos os status</SelectItem>
              <SelectItem value="open" className="text-foreground text-xs">Em Aberto</SelectItem>
              <SelectItem value="paid" className="text-foreground text-xs">Pago</SelectItem>
              <SelectItem value="overdue" className="text-foreground text-xs">Vencido</SelectItem>
              <SelectItem value="cancelled" className="text-foreground text-xs">Cancelado</SelectItem>
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
            className="bg-input border-border text-foreground text-xs"
            placeholder="Data inicial"
          />

          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
            className="bg-input border-border text-foreground text-xs"
            placeholder="Data final"
          />
        </div>
      </div>

      {/* Summary row */}
      {invoices.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Registros (página)</p>
            <p className="text-lg font-semibold text-foreground">{invoices.length}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Volume (página)</p>
            <p className="text-lg font-semibold text-foreground">
              R$ {totalAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Total geral</p>
            <p className="text-lg font-semibold text-foreground">
              R$ {parseFloat(String(stats?.totalAmount ?? "0")).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">ERP</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">external_id</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">customer_name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">issue_date</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">gross_amount</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tenant</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50 animate-pulse">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-border rounded w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">Nenhuma invoice encontrada</p>
                    <p className="text-xs mt-1">Execute um pipeline de extração para popular os dados</p>
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const tenant = tenants.find((t) => t.id === inv.tenantId);
                  return (
                    <tr key={inv.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="px-4 py-3">
                        <ERPBadge erp={inv.source} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-foreground truncate max-w-32 block">{inv.externalId}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-foreground">{inv.customerName ?? "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-muted-foreground">{inv.issueDate ?? "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-medium text-foreground">
                          R$ {parseFloat(String(inv.grossAmount ?? "0")).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">{tenant?.name ?? `#${inv.tenantId}`}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Página {page + 1} de {totalPages} · {total.toLocaleString("pt-BR")} registros
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="border-border gap-1 text-xs"
              >
                <ChevronLeft className="w-3 h-3" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="border-border gap-1 text-xs"
              >
                Próxima
                <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
