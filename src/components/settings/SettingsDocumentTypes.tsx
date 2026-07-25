import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Loader2, Lock, CheckCircle2, User, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  humanizeValidity,
  VALIDITY_PRESETS,
  VALIDITY_UNIT_OPTIONS,
  type ValidityMode,
  type ValidityUnit,
} from "@/lib/document-validity";

type Scope = "worker" | "employment_link";

interface DocType {
  id: string;
  code: string;
  name: string;
  category: string;
  is_active: boolean;
  storage_scope: Scope | null;
  validity_mode: ValidityMode | null;
  validity_value: number | null;
  validity_unit: ValidityUnit | null;
  has_expiration: boolean;
  default_validity_days: number | null;
  completion_requirement: "required" | "optional";
}

interface GateRow {
  document_type_id: string;
  suggested_scope: Scope | null;
  suggestion_reason: string | null;
  notes: string | null;
}

interface UsageRow {
  document_type_id: string;
  worker_count: number;
  link_count: number;
}

interface GateStatus {
  total: number;
  resolved: number;
  pending: number;
  ready_for_step_2: boolean;
}

interface Props { readOnly?: boolean }

const CATEGORY_LABEL: Record<string, string> = {
  sst_nr: "NR",
  sst_aso: "ASO",
  personal: "Pessoal",
  professional: "Profissional",
  training: "Treinamento",
  license: "Licença",
  other: "Outro",
};

type Filter = "pending" | "all" | "worker" | "employment_link" | "training" | "sst" | "personal" | "professional";

export function SettingsDocumentTypes({ readOnly = false }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<DocType | null>(null);
  const [chosenScope, setChosenScope] = useState<Scope | null>(null);
  const [force, setForce] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");

  // Validade padrão
  const [validityEditing, setValidityEditing] = useState<DocType | null>(null);
  const [vMode, setVMode] = useState<ValidityMode>("no_expiry");
  const [vValue, setVValue] = useState<string>("");
  const [vUnit, setVUnit] = useState<ValidityUnit>("year");
  const [vPreset, setVPreset] = useState<string>("none");
  const [vError, setVError] = useState<string | null>(null);
  const [vSaving, setVSaving] = useState(false);

  // Obrigatoriedade para conclusão do cadastro
  const [reqEditing, setReqEditing] = useState<DocType | null>(null);
  const [reqValue, setReqValue] = useState<"required" | "optional">("optional");
  const [reqSaving, setReqSaving] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["settings-doc-types-scope"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_types")
        .select(
          "id, code, name, category, is_active, storage_scope, validity_mode, validity_value, validity_unit, has_expiration, default_validity_days, completion_requirement",
        )
        .order("name");
      if (error) throw error;
      return (data ?? []) as DocType[];
    },
  });

  const gateQ = useQuery({
    queryKey: ["settings-doc-types-gate-rows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_type_scope_backfill_unmatched")
        .select("document_type_id, suggested_scope, suggestion_reason, notes");
      if (error) throw error;
      return (data ?? []) as GateRow[];
    },
  });

  const usageQ = useQuery({
    queryKey: ["settings-doc-types-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("document_type_usage_counts" as any);
      if (error) throw error;
      return (data ?? []) as UsageRow[];
    },
  });

  const statusQ = useQuery({
    queryKey: ["settings-doc-types-gate-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("document_type_scope_gate_status" as any);
      if (error) throw error;
      return data as unknown as GateStatus;
    },
  });

  const gateByType = useMemo(() => {
    const m = new Map<string, GateRow>();
    (gateQ.data ?? []).forEach((r) => m.set(r.document_type_id, r));
    return m;
  }, [gateQ.data]);

  const usageByType = useMemo(() => {
    const m = new Map<string, UsageRow>();
    (usageQ.data ?? []).forEach((r) => m.set(r.document_type_id, r));
    return m;
  }, [usageQ.data]);

  const all = q.data ?? [];
  const pendingCount = statusQ.data?.pending ?? all.filter((d) => d.storage_scope == null).length;
  const readyForStep2 = statusQ.data?.ready_for_step_2 ?? pendingCount === 0;

  const filtered = useMemo(() => {
    const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const term = norm(search.trim());
    return all.filter((d) => {
      if (filter === "pending" && d.storage_scope != null) return false;
      if (filter === "worker" && d.storage_scope !== "worker") return false;
      if (filter === "employment_link" && d.storage_scope !== "employment_link") return false;
      if (filter === "training" && d.category !== "training") return false;
      if (filter === "sst" && !(d.category === "sst_nr" || d.category === "sst_aso")) return false;
      if (filter === "personal" && d.category !== "personal") return false;
      if (filter === "professional" && d.category !== "professional") return false;
      if (term && !(norm(d.name).includes(term) || norm(d.code).includes(term))) return false;
      return true;
    });
  }, [all, filter, search]);

  const openEdit = (d: DocType) => {
    if (readOnly) return;
    setEditing(d);
    setChosenScope(d.storage_scope ?? null);
    setForce(false);
    setNotes(gateByType.get(d.id)?.notes ?? "");
  };

  const closeEdit = () => {
    setEditing(null);
    setChosenScope(null);
    setForce(false);
    setNotes("");
  };

  const openValidity = (d: DocType) => {
    if (readOnly) return;
    setValidityEditing(d);
    setVError(null);
    const mode: ValidityMode = (d.validity_mode ?? (d.has_expiration ? "fixed_duration" : "no_expiry")) as ValidityMode;
    setVMode(mode === "explicit_date" ? "fixed_duration" : mode);
    if (mode === "fixed_duration") {
      const val = d.validity_value ?? d.default_validity_days ?? null;
      const unit: ValidityUnit = (d.validity_unit as ValidityUnit) ?? "day";
      setVValue(val != null ? String(val) : "");
      setVUnit(unit);
      // Auto-detect preset
      if (val === 1 && unit === "year") setVPreset("1y");
      else if (val === 2 && unit === "year") setVPreset("2y");
      else setVPreset("custom");
    } else {
      setVValue("");
      setVUnit("year");
      setVPreset("none");
    }
  };

  const closeValidity = () => {
    setValidityEditing(null);
    setVError(null);
    setVSaving(false);
  };

  const openRequirement = (d: DocType) => {
    if (readOnly) return;
    setReqEditing(d);
    setReqValue(d.completion_requirement ?? "optional");
    setReqError(null);
  };
  const closeRequirement = () => {
    setReqEditing(null);
    setReqError(null);
    setReqSaving(false);
  };
  const saveRequirement = async () => {
    if (!reqEditing) return;
    if (reqEditing.completion_requirement === reqValue) {
      closeRequirement();
      return;
    }
    setReqSaving(true);
    setReqError(null);
    try {
      const { error } = await supabase.rpc(
        "set_document_type_completion_requirement" as any,
        { p_document_type_id: reqEditing.id, p_requirement: reqValue } as any,
      );
      if (error) throw error;
      toast({
        title: "Obrigatoriedade atualizada",
        description: `${reqEditing.name} — agora ${reqValue === "required" ? "obrigatório" : "opcional"}. Cadastros afetados foram recalculados.`,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["settings-doc-types-scope"] }),
        qc.invalidateQueries({ queryKey: ["worker-completion"] }),
        qc.invalidateQueries({ queryKey: ["workers"] }),
      ]);
      closeRequirement();
    } catch (err: any) {
      const raw = String(err?.message ?? "");
      if (raw.includes("not_authorized")) setReqError("Apenas admin/manager podem alterar esta configuração.");
      else if (raw.includes("requirement_invalid")) setReqError("Opção inválida.");
      else if (raw.includes("document_type_not_found")) setReqError("Tipo documental não encontrado.");
      else setReqError("Não foi possível salvar. Tente novamente.");
    } finally {
      setReqSaving(false);
    }
  };

  const applyPreset = (key: string) => {
    setVPreset(key);
    const preset = VALIDITY_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setVMode(preset.mode === "explicit_date" ? "fixed_duration" : preset.mode);
    if (preset.mode === "no_expiry") {
      setVValue("");
      setVUnit("year");
    } else if (preset.value != null && preset.unit != null) {
      setVValue(String(preset.value));
      setVUnit(preset.unit);
    } else {
      // custom — mantém o que já estiver preenchido
    }
  };

  const humanizeRpcError = (raw: string): string => {
    if (raw.includes("validity_value_must_be_positive")) return "Informe uma duração positiva antes de salvar.";
    if (raw.includes("validity_unit_invalid")) return "Selecione dias, meses ou anos.";
    if (raw.includes("validity_mode_invalid")) return "Escolha entre Sem vencimento e Com vencimento.";
    if (raw.includes("not_authorized")) return "Somente administradores/gestores podem configurar a validade.";
    if (raw.includes("document_type_not_found")) return "Tipo documental não encontrado.";
    return "Não foi possível salvar a validade. Verifique os dados e tente novamente.";
  };

  const saveValidity = async () => {
    if (!validityEditing) return;
    setVError(null);
    let payloadValue: number | null = null;
    if (vMode === "fixed_duration") {
      const parsed = Number(vValue);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
        setVError("Informe uma duração inteira positiva (maior que zero).");
        return;
      }
      payloadValue = parsed;
    }
    setVSaving(true);
    try {
      const { error } = await supabase.rpc("set_document_type_validity" as any, {
        p_document_type_id: validityEditing.id,
        p_mode: vMode,
        p_value: payloadValue,
        p_unit: vMode === "fixed_duration" ? vUnit : null,
      } as any);
      if (error) throw error;
      toast({
        title: "Validade padrão atualizada",
        description: `${validityEditing.name} — passa a valer para novos documentos.`,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["settings-doc-types-scope"] }),
        qc.invalidateQueries({ queryKey: ["worker-qualification-types"] }),
        qc.invalidateQueries({ queryKey: ["qualification-column-catalog"] }),
        qc.invalidateQueries({ queryKey: ["document_types"] }),
      ]);
      closeValidity();
    } catch (err: any) {
      const raw = String(err?.message ?? "");
      setVError(humanizeRpcError(raw));
    } finally {
      setVSaving(false);
    }
  };

  const save = async () => {
    if (!editing || !chosenScope) return;
    const scopeChanged = editing.storage_scope !== chosenScope;
    const notesChanged = (gateByType.get(editing.id)?.notes ?? "") !== notes;
    if (!scopeChanged && !notesChanged) {
      closeEdit();
      return;
    }
    const isForcedChange = editing.storage_scope != null && scopeChanged;
    if (isForcedChange && !force) {
      toast({
        title: "Alteração bloqueada",
        description: "O escopo já foi definido. Marque 'forçar alteração' para prosseguir.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("resolve_document_type_scope", {
        p_document_type_id: editing.id,
        p_scope: chosenScope,
        p_notes: notes.trim() ? notes.trim() : null,
        p_force: isForcedChange,
      } as any);
      if (error) throw error;
      toast({ title: "Escopo definido", description: `${editing.name} → ${chosenScope === "worker" ? "Trabalhador" : "Vínculo"}` });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["settings-doc-types-scope"] }),
        qc.invalidateQueries({ queryKey: ["settings-doc-types-gate-rows"] }),
        qc.invalidateQueries({ queryKey: ["settings-doc-types-gate-status"] }),
      ]);
      closeEdit();
    } catch (err: any) {
      toast({ title: "Erro", description: err?.message ?? "Falha ao salvar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const FilterChip = ({ value, label, count }: { value: Filter; label: string; count?: number }) => (
    <Button
      size="sm"
      variant={filter === value ? "default" : "outline"}
      onClick={() => setFilter(value)}
      className="h-8"
    >
      {label}
      {typeof count === "number" && <span className="ml-1.5 text-xs opacity-80">({count})</span>}
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tipos de Documento</CardTitle>
        <CardDescription>
          Cada tipo precisa ter um <strong>escopo de armazenamento</strong> definido: pertence ao
          <em> trabalhador</em> (compartilhado entre vínculos) ou é específico do <em>vínculo</em>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnly && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              Apenas administradores podem definir o escopo. Você pode consultar as pendências.
            </AlertDescription>
          </Alert>
        )}

        {pendingCount > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Existem <strong>{pendingCount}</strong> tipos pendentes de definição de escopo.
              A migração para a fonte única de documentos só pode avançar quando todos estiverem classificados.
            </AlertDescription>
          </Alert>
        )}

        {pendingCount === 0 && readyForStep2 && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Todos os tipos possuem escopo definido. O sistema está pronto para o Passo 2 da E-DOC.2.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <FilterChip value="pending" label="Pendentes" count={pendingCount} />
          <FilterChip value="all" label="Todos" count={all.length} />
          <FilterChip value="worker" label="Trabalhador" />
          <FilterChip value="employment_link" label="Vínculo" />
          <FilterChip value="training" label="Treinamento" />
          <FilterChip value="sst" label="SST" />
          <FilterChip value="personal" label="Pessoal" />
          <FilterChip value="professional" label="Profissional" />
        </div>

        <Input
          placeholder="Buscar por nome ou código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />

        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden sm:table-cell">Categoria</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead className="hidden md:table-cell">Obrigatoriedade</TableHead>
                  <TableHead className="hidden lg:table-cell">Validade padrão</TableHead>
                  <TableHead className="hidden md:table-cell">Utilizado por</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="w-[180px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      Nenhum tipo encontrado para este filtro.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((d) => {
                  const pending = d.storage_scope == null;
                  const usage = usageByType.get(d.id);
                  return (
                    <TableRow key={d.id} className={pending ? "bg-yellow-50 dark:bg-yellow-950/20" : undefined}>
                      <TableCell className="font-mono text-xs">{d.code}</TableCell>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {CATEGORY_LABEL[d.category] ?? d.category}
                      </TableCell>
                      <TableCell>
                        {d.storage_scope === "worker" ? (
                          <Badge variant="secondary" className="gap-1">
                            <User className="h-3 w-3" /> Trabalhador
                          </Badge>
                        ) : d.storage_scope === "employment_link" ? (
                          <Badge variant="secondary" className="gap-1">
                            <Link2 className="h-3 w-3" /> Vínculo
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="gap-1 border-yellow-500 bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200"
                          >
                            <AlertTriangle className="h-3 w-3" /> Pendente
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {d.completion_requirement === "required" ? (
                          <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">Obrigatório</Badge>
                        ) : (
                          <Badge variant="outline">Opcional</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm">
                        {humanizeValidity({
                          mode: d.validity_mode,
                          value: d.validity_value,
                          unit: d.validity_unit,
                          defaultValidityDays: d.default_validity_days,
                          hasExpiration: d.has_expiration,
                        })}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {usage ? (
                          <div className="space-y-0.5 leading-tight">
                            <div><span className="font-medium text-foreground">{usage.worker_count}</span> trabalhadores</div>
                            <div><span className="font-medium text-foreground">{usage.link_count}</span> vínculos</div>
                          </div>
                        ) : (
                          <span className="opacity-60">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {d.is_active ? (
                          <Badge variant="outline" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Ativo
                          </Badge>
                        ) : (
                          <Badge variant="outline">Inativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant={pending ? "default" : "outline"}
                            disabled={readOnly}
                            onClick={() => openEdit(d)}
                          >
                            {pending ? "Definir escopo" : "Escopo"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={readOnly}
                            onClick={() => openValidity(d)}
                          >
                            Validade
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={readOnly}
                            onClick={() => openRequirement(d)}
                          >
                            Obrigatoriedade
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && closeEdit()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Definir escopo — {editing?.name}</DialogTitle>
            <DialogDescription>
              Escolha onde este tipo de documento é armazenado. A decisão é praticamente imutável.
            </DialogDescription>
          </DialogHeader>

          {editing && gateByType.get(editing.id)?.suggestion_reason && (
            <Alert>
              <AlertDescription className="text-sm">
                <span className="font-medium">Sugestão do sistema: </span>
                {gateByType.get(editing.id)?.suggested_scope === "worker" ? "Trabalhador" : gateByType.get(editing.id)?.suggested_scope === "employment_link" ? "Vínculo" : "—"}
                {" — "}
                <span className="text-muted-foreground">{gateByType.get(editing.id)?.suggestion_reason}</span>
              </AlertDescription>
            </Alert>
          )}

          {editing && (() => {
            const u = usageByType.get(editing.id);
            if (!u || (u.worker_count === 0 && u.link_count === 0)) return null;
            return (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="font-medium mb-1">Impacto atual</div>
                <div className="text-muted-foreground">
                  {u.worker_count} trabalhador(es) e {u.link_count} vínculo(s) já possuem documentos deste tipo.
                </div>
              </div>
            );
          })()}

          <RadioGroup
            value={chosenScope ?? undefined}
            onValueChange={(v) => setChosenScope(v as Scope)}
            className="space-y-3"
          >
            <label
              htmlFor="scope-worker"
              className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${chosenScope === "worker" ? "border-primary bg-primary/5" : ""}`}
            >
              <RadioGroupItem value="worker" id="scope-worker" className="mt-1" />
              <div className="space-y-1">
                <div className="font-medium flex items-center gap-2">
                  <User className="h-4 w-4" /> Trabalhador
                </div>
                <ul className="text-sm text-muted-foreground space-y-0.5">
                  <li>✔ Documento acompanha o trabalhador</li>
                  <li>✔ Compartilhado entre todos os vínculos</li>
                  <li>✔ Upload apenas na ficha do trabalhador</li>
                </ul>
              </div>
            </label>

            <label
              htmlFor="scope-link"
              className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${chosenScope === "employment_link" ? "border-primary bg-primary/5" : ""}`}
            >
              <RadioGroupItem value="employment_link" id="scope-link" className="mt-1" />
              <div className="space-y-1">
                <div className="font-medium flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> Vínculo
                </div>
                <ul className="text-sm text-muted-foreground space-y-0.5">
                  <li>✔ Documento específico do projeto</li>
                  <li>✔ Cada vínculo possui sua própria versão</li>
                  <li>✔ Upload realizado no vínculo</li>
                </ul>
              </div>
            </label>
          </RadioGroup>

          <div className="space-y-1.5">
            <Label htmlFor="scope-notes" className="text-sm">Notas (opcional)</Label>
            <Textarea
              id="scope-notes"
              placeholder="Justificativa ou observações sobre esta decisão..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {editing?.storage_scope != null && chosenScope && editing.storage_scope !== chosenScope && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p>
                    Este tipo já está classificado como
                    <strong> {editing.storage_scope === "worker" ? "Trabalhador" : "Vínculo"}</strong>.
                    Alterar o escopo pode invalidar documentos existentes.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                    />
                    Confirmo que desejo forçar a alteração
                  </label>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeEdit} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !chosenScope}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing?.storage_scope == null ? "Definir escopo" : (editing.storage_scope !== chosenScope ? "Alterar escopo" : "Salvar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo — Validade padrão */}
      <Dialog open={!!validityEditing} onOpenChange={(o) => !o && closeValidity()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Validade padrão — {validityEditing?.name}</DialogTitle>
            <DialogDescription>
              Define a regra usada para calcular automaticamente o vencimento de novos documentos
              deste tipo, a partir da data de emissão/realização informada pelo usuário.
            </DialogDescription>
          </DialogHeader>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Esta alteração vale apenas para <strong>novos registros</strong>. Documentos já
              cadastrados preservam a data de vencimento atual — nada é reescrito.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <Label className="text-sm">Regra</Label>
            <RadioGroup
              value={vMode}
              onValueChange={(v) => {
                setVMode(v as ValidityMode);
                setVPreset(v === "no_expiry" ? "none" : "custom");
              }}
              className="space-y-2"
            >
              <label
                htmlFor="v-none"
                className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${vMode === "no_expiry" ? "border-primary bg-primary/5" : ""}`}
              >
                <RadioGroupItem value="no_expiry" id="v-none" className="mt-1" />
                <div className="space-y-0.5">
                  <div className="font-medium">Sem vencimento</div>
                  <div className="text-sm text-muted-foreground">
                    O sistema não calcula nem exige data final. Ex.: CPF, CTPS.
                  </div>
                </div>
              </label>
              <label
                htmlFor="v-fixed"
                className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${vMode === "fixed_duration" ? "border-primary bg-primary/5" : ""}`}
              >
                <RadioGroupItem value="fixed_duration" id="v-fixed" className="mt-1" />
                <div className="space-y-0.5 w-full">
                  <div className="font-medium">Com vencimento</div>
                  <div className="text-sm text-muted-foreground">
                    O vencimento é calculado a partir da data do fato + duração configurada.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {vMode === "fixed_duration" && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Presets</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {VALIDITY_PRESETS.filter((p) => p.key !== "none").map((p) => (
                    <Button
                      key={p.key}
                      type="button"
                      size="sm"
                      variant={vPreset === p.key ? "default" : "outline"}
                      onClick={() => applyPreset(p.key)}
                      className="h-8"
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="v-value" className="text-sm">
                    Duração <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="v-value"
                    type="number"
                    min={1}
                    step={1}
                    value={vValue}
                    onChange={(e) => {
                      setVValue(e.target.value);
                      setVPreset("custom");
                    }}
                    placeholder="Ex.: 1"
                    aria-invalid={
                      vValue !== "" && (Number(vValue) <= 0 || !Number.isInteger(Number(vValue)))
                    }
                  />
                  {vValue !== "" && (Number(vValue) <= 0 || !Number.isInteger(Number(vValue))) && (
                    <p className="text-xs text-destructive mt-1">Informe um número inteiro maior que zero.</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="v-unit" className="text-sm">Unidade <span className="text-destructive">*</span></Label>
                  <Select value={vUnit} onValueChange={(v) => { setVUnit(v as ValidityUnit); setVPreset("custom"); }}>
                    <SelectTrigger id="v-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VALIDITY_UNIT_OPTIONS.map((u) => (
                        <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {vError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{vError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeValidity} disabled={vSaving}>Cancelar</Button>
            <Button
              onClick={saveValidity}
              disabled={
                vSaving ||
                (vMode === "fixed_duration" &&
                  (vValue === "" || Number(vValue) <= 0 || !Number.isInteger(Number(vValue))))
              }
            >
              {vSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar validade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo — Obrigatoriedade para conclusão do cadastro */}
      <Dialog open={!!reqEditing} onOpenChange={(o) => !o && closeRequirement()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Obrigatoriedade — {reqEditing?.name}</DialogTitle>
            <DialogDescription>
              Define se este tipo é exigido para <strong>concluir o cadastro</strong> do trabalhador
              e <strong>liberar a ativação de vínculo</strong>.
            </DialogDescription>
          </DialogHeader>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Alterar esta configuração recalcula automaticamente <strong>todos</strong> os trabalhadores.
              Nenhum documento existente é apagado.
            </AlertDescription>
          </Alert>

          <RadioGroup
            value={reqValue}
            onValueChange={(v) => setReqValue(v as "required" | "optional")}
            className="space-y-2"
          >
            <label
              htmlFor="req-required"
              className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${reqValue === "required" ? "border-primary bg-primary/5" : ""}`}
            >
              <RadioGroupItem value="required" id="req-required" className="mt-1" />
              <div className="space-y-0.5">
                <div className="font-medium">Obrigatório para concluir o cadastro</div>
                <div className="text-sm text-muted-foreground">
                  A ausência, rejeição ou vencimento (se houver controle de validade) mantém o cadastro
                  incompleto e bloqueia a ativação de vínculos.
                </div>
              </div>
            </label>
            <label
              htmlFor="req-optional"
              className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${reqValue === "optional" ? "border-primary bg-primary/5" : ""}`}
            >
              <RadioGroupItem value="optional" id="req-optional" className="mt-1" />
              <div className="space-y-0.5">
                <div className="font-medium">Opcional</div>
                <div className="text-sm text-muted-foreground">
                  Pode ser enviado e consultado, mas <strong>não</strong> altera a completude nem entra
                  em métricas executivas de pendência ou vencidos.
                </div>
              </div>
            </label>
          </RadioGroup>

          {reqError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{reqError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeRequirement} disabled={reqSaving}>Cancelar</Button>
            <Button onClick={saveRequirement} disabled={reqSaving}>
              {reqSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}