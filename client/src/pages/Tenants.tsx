import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Building2, Plus, Trash2, Settings, ArrowRight, ChevronDown, ChevronLeft } from "lucide-react";
import { StatusBadge, ERPBadge } from "@/components/ui/StatusBadge";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function CreateTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = trpc.tenants.create.useMutation({
    onSuccess: () => {
      utils.tenants.list.invalidate();
      toast.success("Tenant criado com sucesso");
      setName(""); setSlug(""); setDescription("");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const autoSlug = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Novo Tenant</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Nome da Empresa</Label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setSlug(autoSlug(e.target.value)); }}
              placeholder="Ex: Empresa ABC Ltda"
              className="bg-input border-border text-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Slug (identificador único)</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="empresa-abc"
              className="bg-input border-border text-foreground font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Descrição (opcional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição da empresa"
              className="bg-input border-border text-foreground"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border">Cancelar</Button>
          <Button
            onClick={() => createMutation.mutate({ name, slug, description })}
            disabled={!name || !slug || createMutation.isPending}
            className="bg-primary text-primary-foreground"
          >
            {createMutation.isPending ? "Criando..." : "Criar Tenant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Tenants() {
  const [showCreate, setShowCreate] = useState(false);
  const { data: tenants = [], isLoading } = trpc.tenants.list.useQuery();
  const utils = trpc.useUtils();

  const deleteMutation = trpc.tenants.delete.useMutation({
    onSuccess: () => { utils.tenants.list.invalidate(); toast.success("Tenant removido"); },
    onError: (e) => toast.error(e.message),
  });

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
          <h1 className="text-xl font-semibold text-foreground">Tenants</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Empresas cadastradas na plataforma</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" />
          Novo Tenant
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-border rounded w-3/4 mb-3" />
              <div className="h-3 bg-border rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Building2 className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-sm font-medium">Nenhum tenant cadastrado</p>
          <p className="text-xs mt-1">Crie o primeiro tenant para começar</p>
          <Button onClick={() => setShowCreate(true)} className="mt-4 bg-primary text-primary-foreground gap-2">
            <Plus className="w-4 h-4" />
            Criar Tenant
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tenants.map((tenant) => (
            <div key={tenant.id} className="bg-card border border-border rounded-xl p-5 hover:border-primary/30 transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                    {tenant.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{tenant.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{tenant.slug}</p>
                  </div>
                </div>
                <StatusBadge status={tenant.status} />
              </div>

              {tenant.description && (
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{tenant.description}</p>
              )}

              <div className="text-xs text-muted-foreground mb-4">
                Criado em {new Date(tenant.createdAt).toLocaleDateString("pt-BR")}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-border">
                <Link href={`/tenants/${tenant.id}`}>
                  <Button size="sm" variant="outline" className="gap-1.5 border-border text-xs flex-1">
                    <Settings className="w-3 h-3" />
                    Configurar
                  </Button>
                </Link>
                <Link href={`/agents?tenantId=${tenant.id}`}>
                  <Button size="sm" className="gap-1.5 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 text-xs flex-1">
                    <ArrowRight className="w-3 h-3" />
                    Extrair
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Remover tenant "${tenant.name}"?`)) {
                      deleteMutation.mutate({ id: tenant.id });
                    }
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateTenantDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
