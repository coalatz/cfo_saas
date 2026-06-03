import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  Building2,
  FileText,
  TrendingUp,
  TrendingDown,
  Bot,
  ArrowRight,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  Users,
} from "lucide-react";
import { ERPBadge, StatusBadge } from "@/components/ui/StatusBadge";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import AppLayout from "@/components/AppLayout";

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = "blue",
  href,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color?: "blue" | "emerald" | "amber" | "violet" | "rose" | "sky";
  href?: string;
}) {
  const colorMap = {
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    rose: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    sky: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  };

  const card = (
    <div className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-all duration-200 cursor-pointer group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className={`p-2.5 rounded-lg border ${colorMap[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );

  return href ? <Link href={href}>{card}</Link> : card;
}

function formatCurrency(val: unknown): string {
  const n = parseFloat(String(val ?? "0"));
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(isNaN(n) ? 0 : n);
}

export default function Home() {
  const { data: tenants = [] } = trpc.tenants.list.useQuery();
  const { data: invoiceStats } = trpc.invoices.globalStats.useQuery();
  const { data: receivableStats } = trpc.receivables.globalStats.useQuery();
  const { data: payableStats } = trpc.payables.globalStats.useQuery();
  const { data: customerStats } = trpc.customers.globalStats.useQuery();
  const { data: logs = [] } = trpc.logs.list.useQuery({});

  const activeTenants = tenants.filter((t) => t.status === "active").length;
  const totalInvoices = Number(invoiceStats?.total ?? 0);
  const paidCount = Number(invoiceStats?.paidCount ?? 0);
  const openCount = Number(invoiceStats?.openCount ?? 0);
  const overdueCount = Number(invoiceStats?.overdueCount ?? 0);
  const contaAzulCount = Number(invoiceStats?.contaAzulCount ?? 0);
  const omieCount = Number(invoiceStats?.omieCount ?? 0);

  const totalReceivables = Number(receivableStats?.total ?? 0);
  const totalPayables = Number(payableStats?.total ?? 0);
  const totalCustomers = Number(customerStats?.total ?? 0);

  const receivableAmount = Number(receivableStats?.totalAmount ?? 0);
  const payableAmount = Number(payableStats?.totalAmount ?? 0);
  const netPosition = receivableAmount - payableAmount;

  const pieData = [
    { name: "Conta Azul", value: contaAzulCount, color: "#38bdf8" },
    { name: "Omie", value: omieCount, color: "#a78bfa" },
  ].filter((d) => d.value > 0);

  const recentLogs = logs.slice(0, 5);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Visão consolidada da plataforma de extração</p>
          </div>
          <Link href="/agents">
            <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              <Zap className="w-4 h-4" />
              Executar Pipeline
            </button>
          </Link>
        </div>

        {/* Primary Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Tenants Ativos" value={activeTenants} subtitle={`${tenants.length} total`} icon={Building2} color="blue" href="/tenants" />
          <MetricCard title="Invoices" value={totalInvoices.toLocaleString("pt-BR")} subtitle={`${paidCount} pagas`} icon={FileText} color="emerald" href="/invoices" />
          <MetricCard title="A Receber" value={totalReceivables.toLocaleString("pt-BR")} subtitle={formatCurrency(receivableAmount)} icon={TrendingUp} color="sky" href="/receivables" />
          <MetricCard title="A Pagar" value={totalPayables.toLocaleString("pt-BR")} subtitle={formatCurrency(payableAmount)} icon={TrendingDown} color="amber" href="/payables" />
        </div>

        {/* Secondary Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Clientes" value={totalCustomers.toLocaleString("pt-BR")} subtitle={`${Number(customerStats?.activeCount ?? 0)} ativos`} icon={Users} color="violet" href="/customers" />
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Posição Líquida</p>
            <p className={`text-2xl font-semibold mt-1 ${netPosition >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {formatCurrency(netPosition)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Receber − Pagar</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vencidos</p>
            <p className="text-2xl font-semibold text-red-400 mt-1">{overdueCount.toLocaleString("pt-BR")}</p>
            <p className="text-xs text-muted-foreground mt-1">invoices vencidas</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Em Aberto</p>
            <p className="text-2xl font-semibold text-blue-400 mt-1">{openCount.toLocaleString("pt-BR")}</p>
            <p className="text-xs text-muted-foreground mt-1">invoices abertas</p>
          </div>
        </div>

        {/* Charts + Tenants */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Distribution by ERP */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-medium text-foreground mb-4">Distribuição por ERP</h3>
            {pieData.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" strokeWidth={0}>
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                      <span className="text-xs text-muted-foreground">{d.name}</span>
                      <span className="text-xs font-medium text-foreground ml-auto">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-28 text-muted-foreground">
                <Bot className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs">Nenhum dado extraído</p>
              </div>
            )}
          </div>

          {/* Canonical model summary */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-medium text-foreground mb-4">Modelo Canônico</h3>
            <div className="space-y-3">
              {[
                { label: "Invoices", count: totalInvoices, icon: FileText, color: "text-emerald-400", href: "/invoices" },
                { label: "A Receber", count: totalReceivables, icon: TrendingUp, color: "text-sky-400", href: "/receivables" },
                { label: "A Pagar", count: totalPayables, icon: TrendingDown, color: "text-amber-400", href: "/payables" },
                { label: "Clientes", count: totalCustomers, icon: Users, color: "text-violet-400", href: "/customers" },
              ].map((item) => (
                <Link key={item.label} href={item.href}>
                  <div className="flex items-center gap-3 cursor-pointer hover:bg-accent/50 rounded-lg px-1 py-0.5 transition-colors">
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                    <span className="text-sm text-muted-foreground flex-1">{item.label}</span>
                    <span className="text-sm font-medium text-foreground">{item.count.toLocaleString("pt-BR")}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Tenants list */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground">Tenants</h3>
              <Link href="/tenants">
                <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                  Ver todos <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
            </div>
            <div className="space-y-2">
              {tenants.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-20 text-muted-foreground">
                  <Building2 className="w-6 h-6 mb-1 opacity-30" />
                  <p className="text-xs">Nenhum tenant cadastrado</p>
                </div>
              ) : (
                tenants.slice(0, 4).map((t) => (
                  <Link key={t.id} href={`/tenants/${t.id}`}>
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent cursor-pointer transition-colors">
                      <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                        {t.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.slug}</p>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Recent Logs */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-foreground">Execuções Recentes</h3>
            <Link href="/logs">
              <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                Ver todos <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
          {recentLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-20 text-muted-foreground">
              <Bot className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">Nenhuma extração executada ainda</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-4 p-3 rounded-lg bg-background/50 border border-border/50">
                  <ERPBadge erp={log.erpType} />
                  <StatusBadge status={log.status} />
                  <span className="text-xs text-muted-foreground flex-1">
                    {log.recordsProcessed} registros · {(log as any).entityType ?? "invoices"}
                    {log.recordsFailed ? ` · ${log.recordsFailed} falhas` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {new Date(log.startedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
