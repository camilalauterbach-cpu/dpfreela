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

type Scope = "worker" | "employment_link";

interface DocType {
  id: string;
  code: string;
  name: string;
  category: string;
  is_active: boolean;
  storage_scope: Scope | null;
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

  const q = useQuery({
    queryKey: ["settings-doc-types-scope"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_types")
        .select("id, code, name, category, is_active, storage_scope")
        .order("name");
      if (error) throw error;
      return (data ?? []) as DocType[];
    },
  });

  const all = q.data ?? [];
  const pendingCount = all.filter((d) => d.storage_scope == null).length;

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
  };

  const closeEdit = () => {
    setEditing(null);
    setChosenScope(null);
    setForce(false);
  };

  const save = async () => {
    if (!editing || !chosenScope) return;
    const isChange = editing.storage_scope != null && editing.storage_scope !== chosenScope;
    if (isChange && !force) {
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
        p_force: isChange,
      } as any);
      if (error) throw error;
      toast({ title: "Escopo definido", description: `${editing.name} → ${chosenScope === "worker" ? "Trabalhador" : "Vínculo"}` });
      await qc.invalidateQueries({ queryKey: ["settings-doc-types-scope"] });
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
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="w-[110px] text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      Nenhum tipo encontrado para este filtro.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((d) => {
                  const pending = d.storage_scope == null;
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
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> Pendente
                          </Badge>
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
                        <Button
                          size="sm"
                          variant={pending ? "default" : "outline"}
                          disabled={readOnly}
                          onClick={() => openEdit(d)}
                        >
                          {pending ? "Definir" : "Alterar"}
                        </Button>
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
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}