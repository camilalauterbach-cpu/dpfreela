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
import { Loader2, Lock, Plus, Trash2, Save, ArrowUp, ArrowDown } from "lucide-react";
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

export function SettingsJobRoles({ readOnly = false }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

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
      const { data, error } = await supabase.from("document_types").select("id, code, name, category, default_validity_days, is_active").eq("is_active", true).order("name");
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
            <CardDescription>Selecione um cargo</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y max-h-[520px] overflow-auto">
              {roles.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => selectedRoleId !== r.id && (dirty ? confirm("Descartar alterações não salvas?") && setSelectedRoleId(r.id) : setSelectedRoleId(r.id))}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${selectedRoleId === r.id ? "bg-muted font-medium" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{r.name}</span>
                      {!r.is_active && <Badge variant="secondary" className="text-[10px]">Inativo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{r.code}</p>
                  </button>
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
              A única forma de alterar requisitos. Salvar reavalia todos os vínculos do cargo em uma única transação.
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
                        [{d.code}] {d.name}
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
    </div>
  );
}