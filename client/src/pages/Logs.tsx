import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ScrollText, CheckCircle2, XCircle, Loader2, AlertTriangle, Clock } from "lucide-react";
import { ERPBadge, StatusBadge } from "@/components/ui/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Logs() {
  const { data: tenants = [] } = trpc.tenants.list.useQuery();
  const [tenantId, setTenantId] = useState<string>("all");

  const { data: logs = [], isLoading } = trpc.logs.list.useQuery({
    tenantId: tenantId !== "all" ? parseInt(tenantId) : undefined,
  });

  const successCount = logs.filter((l) => l.status === "success").length;
  const failedCount = logs.filter((l) => l.status === "failed").length;
  const runningCount = logs.filter((l) => l.status === "running").length;
  const partialCount = logs.filter((l) => l.status === "partial").length;

  const totalRecords = logs.reduce((sum, l) => sum + (l.recordsProcessed ?? 0), 0);

  function duration(log: { startedAt: Date | string; finishedAt?: Date | string | null }) {
    if (!log.finishedAt) return "—";
    const start = new Date(log.startedAt).getTime();
    const end = new Date(log.finishedAt).getTime();
    const diff = Math.round((end - start) / 1000);
    if (diff < 60) return `${diff}s`;
    return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Logs de Extração</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Histórico de execuções dos agentes por tenant</p>
        </div>
        <Select value={tenantId} onValueChange={setTenantId}>
          <SelectTrigger className="w-48 bg-input border-border text-foreground text-sm">
            <SelectValue placeholder="Todos os tenants" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="all" className="text-foreground text-sm">Todos os tenants</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={String(t.id)} className="text-foreground text-sm">{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: logs.length, icon: ScrollText, color: "text-foreground" },
          { label: "Sucesso", value: successCount, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Falhou", value: failedCount, icon: XCircle, color: "text-red-400" },
          { label: "Parcial", value: partialCount, icon: AlertTriangle, color: "text-amber-400" },
          { label: "Registros", value: totalRecords.toLocaleString("pt-BR"), icon: Clock, color: "text-blue-400" },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <s.icon className={`w-5 h-5 ${s.color}`} />
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-semibold text-foreground">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Logs Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">ERP</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Processados</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Falhas</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Duração</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Início</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Erro</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50 animate-pulse">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-border rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                    <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">Nenhum log encontrado</p>
                    <p className="text-xs mt-1">Execute um pipeline de extração para gerar logs</p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const tenant = tenants.find((t) => t.id === log.tenantId);
                  return (
                    <tr key={log.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <ERPBadge erp={log.erpType} />
                          {tenant && <span className="text-xs text-muted-foreground">{tenant.name}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={log.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-medium text-foreground">
                          {(log.recordsProcessed ?? 0).toLocaleString("pt-BR")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-medium ${(log.recordsFailed ?? 0) > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                          {(log.recordsFailed ?? 0).toLocaleString("pt-BR")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-muted-foreground">{duration(log)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.startedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {log.errorMessage ? (
                          <span className="text-xs text-red-400 font-mono truncate block" title={log.errorMessage}>
                            {log.errorMessage}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
