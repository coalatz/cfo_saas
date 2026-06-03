import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Building2,
  Bot,
  FileText,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  Zap,
  Activity,
  TrendingUp,
  TrendingDown,
  Users,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard", description: "Visão geral" },
  { href: "/tenants", icon: Building2, label: "Tenants", description: "Empresas" },
  { href: "/agents", icon: Bot, label: "Agentes", description: "Pipeline IA" },
  { href: "/invoices", icon: FileText, label: "Invoices", description: "Notas fiscais" },
  { href: "/receivables", icon: TrendingUp, label: "A Receber", description: "Contas a receber" },
  { href: "/payables", icon: TrendingDown, label: "A Pagar", description: "Contas a pagar" },
  { href: "/customers", icon: Users, label: "Clientes", description: "Cadastro" },
  { href: "/logs", icon: ScrollText, label: "Logs", description: "Histórico" },
  { href: "/model-configs", icon: Settings2, label: "Modelos IA", description: "Config. de LLMs" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [location] = useLocation();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border transition-all duration-300 ease-in-out",
          "bg-sidebar",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {/* Logo */}
        <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-sidebar-border", collapsed && "justify-center px-2")}>
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          {!collapsed && (
            <div>
              <p className="text-sm font-semibold text-sidebar-foreground leading-none">CFO SaaS</p>
              <p className="text-xs text-muted-foreground mt-0.5">Extraction Platform</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 cursor-pointer group",
                    collapsed && "justify-center px-2",
                    isActive
                      ? "bg-primary/15 text-primary border border-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className={cn("flex-shrink-0 w-4 h-4", isActive && "text-primary")} />
                  {!collapsed && (
                    <div>
                      <p className="text-sm font-medium leading-none">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Status indicator */}
        {!collapsed && (
          <div className="px-4 py-3 border-t border-sidebar-border">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Sistema operacional</span>
            </div>
          </div>
        )}

        {/* Collapse button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center p-3 border-t border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              {navItems.find((n) => n.href === location || (n.href !== "/" && location.startsWith(n.href)))?.label ?? "Dashboard"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground font-mono">
              {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
