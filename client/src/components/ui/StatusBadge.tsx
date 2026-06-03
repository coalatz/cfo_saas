import { cn } from "@/lib/utils";

type Status = "pending" | "running" | "completed" | "failed" | "active" | "inactive" | "configured" | "error" | "open" | "paid" | "overdue" | "cancelled" | "success" | "partial";

const statusConfig: Record<Status, { label: string; className: string; dot: string }> = {
  pending:    { label: "Pendente",    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",    dot: "bg-amber-400" },
  running:    { label: "Executando",  className: "bg-blue-500/10 text-blue-400 border-blue-500/20",       dot: "bg-blue-400 animate-pulse" },
  completed:  { label: "Concluído",   className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  failed:     { label: "Falhou",      className: "bg-red-500/10 text-red-400 border-red-500/20",          dot: "bg-red-400" },
  active:     { label: "Ativo",       className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  inactive:   { label: "Inativo",     className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",       dot: "bg-zinc-400" },
  configured: { label: "Configurado", className: "bg-blue-500/10 text-blue-400 border-blue-500/20",       dot: "bg-blue-400" },
  error:      { label: "Erro",        className: "bg-red-500/10 text-red-400 border-red-500/20",          dot: "bg-red-400" },
  open:       { label: "Aberto",      className: "bg-blue-500/10 text-blue-400 border-blue-500/20",       dot: "bg-blue-400" },
  paid:       { label: "Pago",        className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  overdue:    { label: "Vencido",     className: "bg-red-500/10 text-red-400 border-red-500/20",          dot: "bg-red-400" },
  cancelled:  { label: "Cancelado",   className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",       dot: "bg-zinc-400" },
  success:    { label: "Sucesso",     className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  partial:    { label: "Parcial",     className: "bg-amber-500/10 text-amber-400 border-amber-500/20",    dot: "bg-amber-400" },
};

interface StatusBadgeProps {
  status: Status | string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status as Status] ?? { label: status, className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", dot: "bg-zinc-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", config.className, className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}

export function ERPBadge({ erp }: { erp: "conta_azul" | "omie" | string }) {
  if (erp === "conta_azul") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
        Conta Azul
      </span>
    );
  }
  if (erp === "omie") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
        Omie
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{erp}</span>;
}
