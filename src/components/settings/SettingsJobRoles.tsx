import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Lock, Plus, Trash2, Save, ArrowUp, ArrowDown, MoreVertical, Pencil, Power, PowerOff } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useToast } from "@/hooks/use-toast";
import { invalidateComplianceCaches } from "@/lib/compliance-cache";

interface JobRole { id: string; code: string; name: string; is_active: boolean }
interface DocType { id: string; code: string; name: string; category: string | null; default_validity_days: number | null; is_active: boolean }
interface Requirement {
  document_type_id: string;
  is_mandatory: boolean;
  validity_days_override: number | null;
  display_order: number;
  required_by: string;
}

interface Props { readOnly?: boolean }

// Categorias de documentos que fazem sentido como REQUISITO DE CARGO/FUNÇÃO.
// Documentos pessoais (RG, CPF, CNH, título eleitor, carteira profissional, CREA, etc.)
// pertencem ao trabalhador e não devem entrar aqui.
const ROLE_DOC_CATEGORIES = ["sst_nr", "sst_aso", "training"] as const;
const ROLE_DOC_CATEGORY_LABELS: Record<string, string> = {
  sst_nr: "NR",
  sst_aso: "ASO / Saúde",
  training: "Treinamento",
};

export function SettingsJobRoles({ readOnly = false }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [deleteRole, setDeleteRole] = useState<JobRole | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rolesQ = useQuery({
    queryKey: ["settings-job-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("job_roles").select("id, code, name, is_active").order("name");
      if (error) throw error;
      return (data ?? []) as JobRole[];
    },
  });

  const docsQ = useQuery({
    queryKey: ["settings-document-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_types")
        .select("id, code, name, category, default_validity_days, is_active")
        .eq("is_active", true)
        .in("category", ROLE_DOC_CATEGORIES as unknown as string[])
        .order("name");
      if (error) throw error;
      return (data ?? []) as DocType[];
    },
  });

  const currentReqsQ = useQuery({
    queryKey: ["settings-job-role-reqs", selectedRoleId],
    enabled: !!selectedRoleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_role_document_requirements")
        .select("document_type_id, is_mandatory, validity_days_override, display_order, required_by")
        .eq("job_role_id", selectedRoleId!)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as Requirement[];
    },
  });

  useEffect(() => {
    if (currentReqsQ.data) {
      setReqs(currentReqsQ.data.map((r, i) => ({ ...r, display_order: r.display_order ?? i })));
      setDirty(false);
    }
  }, [currentReqsQ.data]);

  const docsById = useMemo(() => {
    const m = new Map<string, DocType>();
    (docsQ.data ?? []).forEach((d) => m.set(d.id, d));
    return m;
  }, [docsQ.data]);

  const availableToAdd = useMemo(() => {
    const used = new Set(reqs.map((r) => r.document_type_id));
    return (docsQ.data ?? []).filter((d) => !used.has(d.id));
  }, [docsQ.data, reqs]);

  const slugifyCode = (name: string) =>
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || `cargo_${Date.now()}`;

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    if (!name) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("job_roles")
      .insert({ name, code: slugifyCode(name), is_active: true })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      toast({ title: "Erro ao criar cargo", description: error.message, variant: "destructive" });
      return;
    }
    setNewRoleName("");
    toast({ title: "Cargo criado" });
    await qc.invalidateQueries({ queryKey: ["settings-job-roles"] });
    if (data?.id) setSelectedRoleId(data.id);
  };

  const handleRename = async (role: JobRole) => {
    const name = renameValue.trim();
    if (!name || name === role.name) {
      setRenamingId(null);
      return;
    }
    setBusyRoleId(role.id);
    const { error } = await supabase.from("job_roles").update({ name }).eq("id", role.id);
    setBusyRoleId(null);
    setRenamingId(null);
    if (error) {
      toast({ title: "Erro ao renomear", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cargo renomeado" });
    qc.invalidateQueries({ queryKey: ["settings-job-roles"] });
  };

  const handleToggleActive = async (role: JobRole) => {
    setBusyRoleId(role.id);
    const { error } = await supabase.from("job_roles").update({ is_active: !role.is_active }).eq("id", role.id);
    setBusyRoleId(null);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: role.is_active ? "Cargo inativado" : "Cargo ativado" });
    qc.invalidateQueries({ queryKey: ["settings-job-roles"] });
  };

  const handleDelete = async () => {
    if (!deleteRole) return;
    setDeleting(true);
    const { error } = await supabase.from("job_roles").delete().eq("id", deleteRole.id);
    setDeleting(false);
    if (error) {
      toast({
        title: "Não foi possível excluir",
        description: /foreign key|violat/i.test(error.message)
          ? "Este cargo está vinculado a trabalhadores ou requisitos. Inative-o em vez de excluir."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    if (selectedRoleId === deleteRole.id) setSelectedRoleId(null);
    setDeleteRole(null);
    toast({ title: "Cargo excluído" });
    qc.invalidateQueries({ queryKey: ["settings-job-roles"] });
  };

  const addRequirement = (docId: string) => {
    setReqs((prev) => [
      ...prev,
      { document_type_id: docId, is_mandatory: true, validity_days_override: null, display_order: prev.length, required_by: "job_role" },
    ]);
    setDirty(true);
  };
  const removeAt = (i: number) => {
    setReqs((prev) => prev.filter((_, idx) => idx !== i).map((r, idx) => ({ ...r, display_order: idx })));
    setDirty(true);
  };
  const move = (i: number, dir: -1 | 1) => {
    setReqs((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((r, idx) => ({ ...r, display_order: idx }));
    });
    setDirty(true);
  };
  const patch = (i: number, changes: Partial<Requirement>) => {
    setReqs((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...changes } : r)));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("save_job_role_requirements", {
      p_job_role_id: selectedRoleId,
      p_requirements: reqs.map((r, idx) => ({ ...r, display_order: idx })),
    });
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    const reev = (data as any)?.reevaluation;
    toast({
      title: "Requisitos salvos",
      description: reev
        ? `${reev.links_processed ?? 0} vínculos reavaliados · ${reev.transitions_recorded ?? 0} transições registradas.`
        : "Requisitos atualizados com sucesso.",
    });
    setDirty(false);
    qc.invalidateQueries({ queryKey: ["settings-job-role-reqs", selectedRoleId] });
    invalidateComplianceCaches(qc, { jobRoleId: selectedRoleId, eventSource: "job_role_change" });
  };

  if (rolesQ.isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }

  const roles = rolesQ.data ?? [];

  return (
    <div className="space-y-4">
      {readOnly && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription>Somente administradores e gerentes podem editar requisitos de cargo.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cargos</CardTitle>
            <CardDescription>Selecione, renomeie, inative ou exclua</CardDescription>
          </CardHeader>
          {!readOnly && (
            <div className="px-3 pb-2 flex gap-1">
              <Input
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="Novo cargo"
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleCreateRole()}
              />
              <Button size="sm" onClick={handleCreateRole} disabled={creating || !newRoleName.trim()} className="h-8">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          )}
          <CardContent className="p-0">
            <ul className="divide-y max-h-[520px] overflow-auto">
              {roles.map((r) => (
                <li key={r.id}>
                  <div className={`flex items-center gap-1 px-2 py-1.5 hover:bg-muted/50 ${selectedRoleId === r.id ? "bg-muted" : ""}`}>
                    {renamingId === r.id ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRename(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(r);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="h-7 text-sm"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => selectedRoleId !== r.id && (dirty ? confirm("Descartar alterações não salvas?") && setSelectedRoleId(r.id) : setSelectedRoleId(r.id))}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm ${selectedRoleId === r.id ? "font-medium" : ""} ${!r.is_active ? "text-muted-foreground line-through" : ""}`}>{r.name}</span>
                          {!r.is_active && <Badge variant="secondary" className="text-[10px]">Inativo</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{r.code}</p>
                      </button>
                    )}
                    {!readOnly && renamingId !== r.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={busyRoleId === r.id}>
                            {busyRoleId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreVertical className="h-3.5 w-3.5" />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setRenamingId(r.id); setRenameValue(r.name); }}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Renomear
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleActive(r)}>
                            {r.is_active ? <PowerOff className="h-3.5 w-3.5 mr-2" /> : <Power className="h-3.5 w-3.5 mr-2" />}
                            {r.is_active ? "Inativar" : "Ativar"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteRole(r)}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              ))}
              {!roles.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum cargo cadastrado.</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Requisitos documentais do cargo</CardTitle>
            <CardDescription>
              Somente NRs, ASO/saúde e treinamentos. Documentos pessoais (RG, CPF, CNH, título eleitor, CREA, carteira profissional) pertencem ao trabalhador e não entram aqui.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedRoleId ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Selecione um cargo para editar seus requisitos.</p>
            ) : currentReqsQ.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <ul className="space-y-2">
                  {reqs.map((r, i) => {
                    const doc = docsById.get(r.document_type_id);
                    return (
                      <li key={r.document_type_id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {doc ? `[${doc.code}] ${doc.name}` : r.document_type_id}
                          </p>
                          {doc?.category && <p className="text-xs text-muted-foreground">{doc.category}</p>}
                        </div>
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={r.is_mandatory}
                            onCheckedChange={(v) => patch(i, { is_mandatory: !!v })}
                            disabled={readOnly}
                          />
                          Obrigatório
                        </label>
                        <div className="flex items-center gap-1">
                          <Label className="text-xs whitespace-nowrap">Validade (dias)</Label>
                          <Input
                            type="number"
                            className="h-8 w-24"
                            value={r.validity_days_override ?? ""}
                            placeholder={doc?.default_validity_days ? String(doc.default_validity_days) : "—"}
                            onChange={(e) =>
                              patch(i, {
                                validity_days_override: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                            disabled={readOnly}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={readOnly || i === 0} className="h-8 w-8">
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={readOnly || i === reqs.length - 1} className="h-8 w-8">
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => removeAt(i)} disabled={readOnly} className="h-8 w-8 text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                  {!reqs.length && (
                    <li className="py-4 text-center text-sm text-muted-foreground">
                      Nenhum requisito. Adicione documentos abaixo.
                    </li>
                  )}
                </ul>

                <Separator />

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Adicionar documento</p>
                  <div className="flex flex-wrap gap-2">
                    {availableToAdd.map((d) => (
                      <Button
                        key={d.id}
                        size="sm"
                        variant="outline"
                        onClick={() => addRequirement(d.id)}
                        disabled={readOnly}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {ROLE_DOC_CATEGORY_LABELS[d.category ?? ""] ?? d.category}
                        </span>
                        {d.name}
                      </Button>
                    ))}
                    {!availableToAdd.length && (
                      <p className="text-xs text-muted-foreground">Todos os documentos disponíveis já foram adicionados.</p>
                    )}
                  </div>
                </div>

                {!readOnly && (
                  <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={!dirty || saving}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Salvar requisitos
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <DeleteConfirmDialog
        open={!!deleteRole}
        onOpenChange={(o) => !o && setDeleteRole(null)}
        title={`Excluir "${deleteRole?.name ?? ""}"?`}
        description="A exclusão é permanente e só é permitida se o cargo não estiver vinculado a nenhum trabalhador. Se estiver em uso, inative-o."
        onConfirm={handleDelete}
        isDeleting={deleting}
      />
    </div>
  );
}