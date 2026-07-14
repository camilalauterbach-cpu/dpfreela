import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ArrowLeft, Loader2, PlayCircle, ShieldAlert } from "lucide-react";
import { inferNrCode, mapDocStatus, normalizeNr, type NrInferenceResult } from "@/lib/sst/nr-inference";
import { invalidateSstCaches } from "@/hooks/useSstQualifications";

type LinkDoc = {
  id: string;
  worker_id: string | null;
  document_type: string | null;
  category: string | null;
  file_name: string | null;
  notes: string | null;
  status: string | null;
  employment_link_id: string | null;
  link_group_worker_id: string | null;
  event_id: string | null;
};

type Classification =
  | "importable_initial"
  | "importable_renewal"
  | "needs_review_multiple"
  | "needs_review_none"
  | "needs_review_no_date"
  | "needs_review_no_worker"
  | "skip_same_document"
  | "skip_up_to_date";

interface RowState {
  doc: LinkDoc;
  worker: { id: string; full_name: string; cpf: string | null } | null;
  linkGroupId: string | null;
  companyId: string | null;
  inference: NrInferenceResult;
  overrideNrCode: string; // usado quando "multiple" ou "none" → admin escolhe
  issuedAt: string; // YYYY-MM-DD; vazio significa "sem data confiável"
  expiresAt: string; // YYYY-MM-DD; opcional
  validity: "has_expiry" | "no_expiry" | "unknown";
  selected: boolean;
  classification: Classification;
  existingActiveIssuedAt: string | null;
  reviewReason: string;
}

function classify(row: Omit<RowState, "classification" | "reviewReason">): { c: Classification; reason: string } {
  if (!row.worker) return { c: "needs_review_no_worker", reason: "Documento sem trabalhador vinculado." };
  const inf = row.inference;
  const chosenNr = row.overrideNrCode || (inf.status === "single" ? inf.nrCode : "");
  if (inf.status === "multiple" && !row.overrideNrCode) {
    return { c: "needs_review_multiple", reason: `Múltiplas NRs identificadas: ${inf.nrCodes.join(", ")}. Escolha uma antes de importar.` };
  }
  if (inf.status === "none" && !row.overrideNrCode) {
    return { c: "needs_review_none", reason: "NR não identificada (categoria \"Outros\"). Informe a NR manualmente." };
  }
  if (!chosenNr) return { c: "needs_review_none", reason: "NR não definida." };
  if (!row.issuedAt) {
    return { c: "needs_review_no_date", reason: "Data de emissão não informada. Informe a data manualmente antes de importar." };
  }
  // Duplicidade
  if (row.existingActiveIssuedAt) {
    if (row.existingActiveIssuedAt >= row.issuedAt) {
      return { c: "skip_up_to_date", reason: `Já coberto por versão ativa de ${row.existingActiveIssuedAt}.` };
    }
    return { c: "importable_renewal", reason: `Renovação sugerida sobre versão ativa de ${row.existingActiveIssuedAt}.` };
  }
  return { c: "importable_initial", reason: "Nova qualificação (initial)." };
}

const CLASS_LABEL: Record<Classification, string> = {
  importable_initial: "Importar (initial)",
  importable_renewal: "Importar (renovação)",
  needs_review_multiple: "Revisão — múltiplas NRs",
  needs_review_none: "Revisão — NR não identificada",
  needs_review_no_date: "Revisão — sem data de emissão",
  needs_review_no_worker: "Revisão — sem trabalhador",
  skip_same_document: "Já importado",
  skip_up_to_date: "Já coberto",
};
const CLASS_TONE: Record<Classification, string> = {
  importable_initial: "bg-emerald-100 text-emerald-800 border-emerald-200",
  importable_renewal: "bg-blue-100 text-blue-800 border-blue-200",
  needs_review_multiple: "bg-amber-100 text-amber-800 border-amber-200",
  needs_review_none: "bg-amber-100 text-amber-800 border-amber-200",
  needs_review_no_date: "bg-amber-100 text-amber-800 border-amber-200",
  needs_review_no_worker: "bg-red-100 text-red-800 border-red-200",
  skip_same_document: "bg-slate-100 text-slate-700 border-slate-200",
  skip_up_to_date: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function SstImport() {
  const qc = useQueryClient();
  const [eventId, setEventId] = useState<string>("");
  const [rows, setRows] = useState<RowState[]>([]);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<{
    imported: number; renewals: number; skipped: number; errors: Array<{ docId: string; msg: string }>; manual: number;
  } | null>(null);
  const [schemaNotes, setSchemaNotes] = useState<string[]>([]);

  // Eventos "Rock in Rio"
  const eventsQ = useQuery({
    queryKey: ["sst-import-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, start_date")
        .ilike("name", "%rock in rio%")
        .is("deleted_at", null)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function runDryRun() {
    if (!eventId) return;
    setDryRunLoading(true);
    setReport(null);
    const notes: string[] = [];
    try {
      // 1) Coletar link_group_worker_ids e employment_link_ids do evento
      const [{ data: lgs, error: e1 }, { data: els, error: e2 }] = await Promise.all([
        supabase.from("link_groups").select("id, company_id").eq("event_id", eventId).is("deleted_at", null),
        (supabase as any).from("employment_links").select("id, company_id").eq("event_id", eventId).is("deleted_at", null),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const lgIds = (lgs ?? []).map((g: any) => g.id);
      const lgCompany = new Map<string, string | null>((lgs ?? []).map((g: any) => [g.id, g.company_id ?? null]));
      const elIds = (els ?? []).map((l: any) => l.id);
      const elCompany = new Map<string, string | null>((els ?? []).map((l: any) => [l.id, l.company_id ?? null]));

      let lgwList: Array<{ id: string; link_group_id: string; worker_id: string | null }> = [];
      if (lgIds.length) {
        const { data, error } = await supabase
          .from("link_group_workers")
          .select("id, link_group_id, worker_id")
          .in("link_group_id", lgIds)
          .is("deleted_at", null);
        if (error) throw error;
        lgwList = (data ?? []) as any;
      }
      const lgwById = new Map(lgwList.map((r) => [r.id, r]));
      const lgwIds = lgwList.map((r) => r.id);

      // 2) Coletar documentos por três caminhos
      const orClauses: string[] = [`event_id.eq.${eventId}`];
      if (lgwIds.length) orClauses.push(`link_group_worker_id.in.(${lgwIds.join(",")})`);
      if (elIds.length) orClauses.push(`employment_link_id.in.(${elIds.join(",")})`);
      const { data: docs, error: dErr } = await (supabase as any)
        .from("employment_link_documents")
        .select("id, worker_id, document_type, category, file_name, notes, status, employment_link_id, link_group_worker_id, event_id")
        .is("deleted_at", null)
        .or(orClauses.join(","));
      if (dErr) throw dErr;
      const docList = (docs ?? []) as LinkDoc[];

      if (docList.length === 0) {
        setRows([]);
        setSchemaNotes(["Nenhum documento operacional encontrado para o evento selecionado."]);
        return;
      }

      // 3) Trabalhadores
      const workerIds = Array.from(new Set(docList.map((d) => d.worker_id).filter(Boolean))) as string[];
      const { data: workers, error: wErr } = await supabase
        .from("workers")
        .select("id, full_name, cpf")
        .in("id", workerIds)
        .is("deleted_at", null);
      if (wErr) throw wErr;
      const workerMap = new Map((workers ?? []).map((w) => [w.id, w]));

      // 4) Qualificações já importadas pelo mesmo employment_link_document_id
      const { data: alreadyImp, error: aErr } = await (supabase as any)
        .from("worker_sst_qualifications")
        .select("id, employment_link_document_id")
        .in("employment_link_document_id", docList.map((d) => d.id))
        .is("deleted_at", null);
      if (aErr) throw aErr;
      const importedDocIds = new Set<string>((alreadyImp ?? []).map((r: any) => r.employment_link_document_id));

      // 5) Qualificações ativas por (worker_id, nr_code) — para detecção de duplicidade
      const { data: activeQuals, error: qErr } = await (supabase as any)
        .from("worker_sst_qualifications")
        .select("worker_id, nr_code, issued_at")
        .in("worker_id", workerIds.length ? workerIds : ["00000000-0000-0000-0000-000000000000"])
        .is("deleted_at", null)
        .is("superseded_at", null);
      if (qErr) throw qErr;
      const activeByWorkerNr = new Map<string, string>();
      for (const q of (activeQuals ?? []) as any[]) {
        const k = `${q.worker_id}|${(q.nr_code || "").toUpperCase()}`;
        const prev = activeByWorkerNr.get(k);
        if (!prev || q.issued_at > prev) activeByWorkerNr.set(k, q.issued_at);
      }

      // 6) Montar linhas
      const built: RowState[] = docList.map((d) => {
        const inf = inferNrCode({
          document_type: d.document_type,
          category: d.category,
          file_name: d.file_name,
          notes: d.notes,
        });
        const worker = d.worker_id ? (workerMap.get(d.worker_id) ?? null) : null;
        const lgw = d.link_group_worker_id ? lgwById.get(d.link_group_worker_id) ?? null : null;
        const linkGroupId = lgw?.link_group_id ?? null;
        const companyId = linkGroupId
          ? (lgCompany.get(linkGroupId) ?? null)
          : (d.employment_link_id ? (elCompany.get(d.employment_link_id) ?? null) : null);
        const alreadyImported = importedDocIds.has(d.id);

        const base: Omit<RowState, "classification" | "reviewReason"> = {
          doc: d,
          worker: worker ? { id: worker.id, full_name: worker.full_name, cpf: worker.cpf } : null,
          linkGroupId,
          companyId,
          inference: inf,
          overrideNrCode: inf.status === "single" ? inf.nrCode : "",
          issuedAt: "", // schema não possui issued_at/document_date/expires_at — admin informa
          expiresAt: "",
          validity: "unknown",
          selected: false,
          existingActiveIssuedAt: null,
        };
        // preencher existingActiveIssuedAt e classificar
        const chosenNr = base.overrideNrCode;
        if (worker && chosenNr) {
          base.existingActiveIssuedAt = activeByWorkerNr.get(`${worker.id}|${chosenNr}`) ?? null;
        }
        let cls: Classification;
        let reason: string;
        if (alreadyImported) {
          cls = "skip_same_document";
          reason = "Documento já foi importado anteriormente.";
        } else {
          const r = classify(base);
          cls = r.c; reason = r.reason;
        }
        return { ...base, classification: cls, reviewReason: reason };
      });

      notes.push(
        "Schema: employment_link_documents NÃO possui as colunas issued_at, document_date, expires_at nem uploaded_at.",
        "Regra aplicada: sem data confiável no schema → issued_at deve ser informado manualmente pelo admin por linha; caso contrário a linha permanece como \"revisão manual\".",
        "Categorias identificadas como NR: nr_XX; documentos com document_type/category/file_name/notes contendo múltiplas NRs vão para revisão manual.",
      );
      setSchemaNotes(notes);
      setRows(built);
    } catch (err: any) {
      toast.error(err?.message || "Falha no dry-run");
    } finally {
      setDryRunLoading(false);
    }
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => {
      if (r.doc.id !== id) return r;
      const merged = { ...r, ...patch } as RowState;
      // Reclassificar (se não for skip_same_document que é definitivo)
      if (r.classification !== "skip_same_document") {
        // recalcular existingActiveIssuedAt não é necessário aqui (mudança de NR usa cache local)
        const c = classify({
          doc: merged.doc, worker: merged.worker, linkGroupId: merged.linkGroupId, companyId: merged.companyId,
          inference: merged.inference, overrideNrCode: merged.overrideNrCode,
          issuedAt: merged.issuedAt, expiresAt: merged.expiresAt, validity: merged.validity,
          selected: merged.selected, existingActiveIssuedAt: merged.existingActiveIssuedAt,
        });
        merged.classification = c.c;
        merged.reviewReason = c.reason;
        if (!merged.classification.startsWith("importable")) merged.selected = false;
      }
      // Derivar validity_status se validity manual não foi tocada
      if (patch.expiresAt !== undefined) {
        if (merged.expiresAt) merged.validity = "has_expiry";
        else if (merged.validity === "has_expiry") merged.validity = "unknown";
      }
      return merged;
    }));
  }

  const totals = useMemo(() => {
    const t = {
      total: rows.length,
      importable: 0,
      manualReview: 0,
      skipped: 0,
    };
    for (const r of rows) {
      if (r.classification.startsWith("importable")) t.importable++;
      else if (r.classification.startsWith("needs_review")) t.manualReview++;
      else t.skipped++;
    }
    return t;
  }, [rows]);

  const selectedRows = rows.filter((r) => r.selected && r.classification.startsWith("importable"));

  function selectAllImportable() {
    setRows((prev) => prev.map((r) => r.classification.startsWith("importable") ? { ...r, selected: true } : r));
  }
  function clearSelection() {
    setRows((prev) => prev.map((r) => ({ ...r, selected: false })));
  }

  async function executeImport() {
    if (!selectedRows.length) return;
    setExecuting(true);
    setProgress({ done: 0, total: selectedRows.length });
    const errors: Array<{ docId: string; msg: string }> = [];
    let imported = 0, renewals = 0;
    for (let i = 0; i < selectedRows.length; i++) {
      const r = selectedRows[i];
      const op = r.classification === "importable_renewal" ? "renewal" : "initial";
      const nr = normalizeNr(r.overrideNrCode);
      const payload: Record<string, any> = {
        worker_id: r.worker!.id,
        nr_code: nr,
        operation: op,
        issued_at: r.issuedAt,
        expires_at: r.expiresAt || null,
        validity_status: r.validity,
        source_type: "import",
        document_status: mapDocStatus(r.doc.status),
        employment_link_document_id: r.doc.id,
        link_group_worker_id: r.doc.link_group_worker_id,
        link_group_id: r.linkGroupId,
        event_id: eventId,
        company_id: r.companyId,
      };
      const { error } = await (supabase as any).rpc("register_sst_revision", { payload });
      if (error) errors.push({ docId: r.doc.id, msg: error.message });
      else if (op === "renewal") renewals++;
      else imported++;
      setProgress({ done: i + 1, total: selectedRows.length });
    }
    const skipped = rows.filter((r) => r.classification.startsWith("skip")).length;
    const manual = rows.filter((r) => r.classification.startsWith("needs_review")).length;
    setReport({ imported, renewals, skipped, errors, manual });
    invalidateSstCaches(qc);
    setExecuting(false);
    setConfirmOpen(false);
    setConfirmText("");
    if (errors.length === 0) toast.success(`Importação concluída: ${imported + renewals} qualificações`);
    else toast.warning(`Importação com ${errors.length} erro(s). Ver relatório.`);
    // Recarregar para refletir novos "já importados"
    await runDryRun();
  }

  function exportReportCsv() {
    const header = ["doc_id", "worker", "nr", "classification", "reason", "issued_at", "expires_at", "validity"];
    const lines = [header.join(";")];
    for (const r of rows) {
      lines.push([
        r.doc.id, r.worker?.full_name || "", r.overrideNrCode,
        CLASS_LABEL[r.classification], r.reviewReason.replace(/[;\n]/g, " "),
        r.issuedAt, r.expiresAt, r.validity,
      ].join(";"));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sst-import-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (eventsQ.data && eventsQ.data.length === 1 && !eventId) setEventId(eventsQ.data[0].id);
  }, [eventsQ.data, eventId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Importação assistida — NRs</h1>
          <p className="text-sm text-muted-foreground">Dry-run e importação de qualificações SST a partir dos documentos operacionais do evento Rock in Rio.</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/sst"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">1. Selecione o evento</CardTitle></CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1">
            <Label>Evento (nome contendo "Rock in Rio")</Label>
            <Select value={eventId} onValueChange={setEventId} disabled={eventsQ.isLoading}>
              <SelectTrigger><SelectValue placeholder="Selecione o evento" /></SelectTrigger>
              <SelectContent>
                {(eventsQ.data ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name} — {e.start_date}</SelectItem>
                ))}
                {(!eventsQ.data || eventsQ.data.length === 0) && (
                  <SelectItem value="__none" disabled>Nenhum evento encontrado</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runDryRun} disabled={!eventId || dryRunLoading} className="gap-2">
            {dryRunLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Executar dry-run
          </Button>
        </CardContent>
      </Card>

      {schemaNotes.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-amber-900"><ShieldAlert className="h-4 w-4" /> Notas do schema</CardTitle></CardHeader>
          <CardContent className="text-xs text-amber-900 space-y-1">
            {schemaNotes.map((n, i) => <div key={i}>• {n}</div>)}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total analisado" value={totals.total} />
            <StatCard label="Importáveis" value={totals.importable} tone="text-emerald-700" />
            <StatCard label="Revisão manual" value={totals.manualReview} tone="text-amber-700" />
            <StatCard label="Ignorados / já importados" value={totals.skipped} tone="text-slate-600" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={selectAllImportable}>Selecionar importáveis</Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Limpar seleção</Button>
            <Button size="sm" variant="outline" onClick={exportReportCsv}>Exportar CSV</Button>
            <div className="ml-auto">
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={selectedRows.length === 0 || executing}
                className="gap-2"
              >
                Confirmar importação ({selectedRows.length})
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="p-2 w-8"></th>
                      <th className="p-2">Trabalhador</th>
                      <th className="p-2">Documento</th>
                      <th className="p-2">NR</th>
                      <th className="p-2">Emissão *</th>
                      <th className="p-2">Vencimento</th>
                      <th className="p-2">Validade</th>
                      <th className="p-2">Doc.</th>
                      <th className="p-2">Classificação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.doc.id} className="border-t align-top">
                        <td className="p-2">
                          <Checkbox
                            checked={r.selected}
                            disabled={!r.classification.startsWith("importable")}
                            onCheckedChange={(v) => updateRow(r.doc.id, { selected: !!v })}
                          />
                        </td>
                        <td className="p-2">
                          <div className="font-medium">{r.worker?.full_name || "—"}</div>
                          <div className="text-muted-foreground">{r.worker?.cpf || ""}</div>
                        </td>
                        <td className="p-2 min-w-[180px]">
                          <div className="truncate max-w-[220px]" title={r.doc.file_name || ""}>{r.doc.file_name || "(sem nome)"}</div>
                          <div className="text-muted-foreground">categoria: {r.doc.category || "—"}</div>
                        </td>
                        <td className="p-2">
                          {r.inference.status === "multiple" ? (
                            <Select value={r.overrideNrCode || ""} onValueChange={(v) => updateRow(r.doc.id, { overrideNrCode: v })}>
                              <SelectTrigger className="h-7 w-24 text-xs"><SelectValue placeholder="Escolher" /></SelectTrigger>
                              <SelectContent>
                                {r.inference.nrCodes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : r.inference.status === "none" ? (
                            <Input
                              className="h-7 w-24 text-xs"
                              placeholder="NR-XX"
                              value={r.overrideNrCode}
                              onChange={(e) => updateRow(r.doc.id, { overrideNrCode: normalizeNr(e.target.value) || e.target.value.toUpperCase() })}
                            />
                          ) : (
                            <Badge variant="outline">{r.overrideNrCode}</Badge>
                          )}
                        </td>
                        <td className="p-2">
                          <Input type="date" className="h-7 w-32 text-xs" value={r.issuedAt} onChange={(e) => updateRow(r.doc.id, { issuedAt: e.target.value })} />
                        </td>
                        <td className="p-2">
                          <Input type="date" className="h-7 w-32 text-xs" value={r.expiresAt} onChange={(e) => updateRow(r.doc.id, { expiresAt: e.target.value })} />
                        </td>
                        <td className="p-2">
                          <Select value={r.validity} onValueChange={(v) => updateRow(r.doc.id, { validity: v as any })}>
                            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="has_expiry">Com vencimento</SelectItem>
                              <SelectItem value="no_expiry">Sem vencimento</SelectItem>
                              <SelectItem value="unknown">Desconhecida</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className={r.doc.status === "rejected" ? "bg-red-50 text-red-700 border-red-200" : ""}>
                            {r.doc.status || "—"}
                          </Badge>
                        </td>
                        <td className="p-2 min-w-[220px]">
                          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${CLASS_TONE[r.classification]}`}>
                            {CLASS_LABEL[r.classification]}
                          </span>
                          <div className="mt-1 text-[11px] text-muted-foreground">{r.reviewReason}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground">
            * O schema atual dos documentos operacionais não armazena data de emissão. Informe manualmente a data comprovada da NR. Documentos com <code>status=rejected</code> serão importados como <strong>rejeitados</strong> e não serão considerados regulares.
          </p>
        </>
      )}

      {report && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Relatório final</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Importados (initial): <strong>{report.imported}</strong></div>
            <div>Renovações: <strong>{report.renewals}</strong></div>
            <div>Ignorados / já cobertos: <strong>{report.skipped}</strong></div>
            <div>Pendentes de revisão manual: <strong>{report.manual}</strong></div>
            <div className="text-red-700">Erros: <strong>{report.errors.length}</strong></div>
            {report.errors.length > 0 && (
              <ul className="mt-2 text-xs list-disc pl-5">
                {report.errors.map((e) => <li key={e.docId}>{e.docId}: {e.msg}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar importação</AlertDialogTitle>
            <AlertDialogDescription>
              Serão criadas <strong>{selectedRows.length}</strong> qualificações SST via <code>register_sst_revision</code>.
              Digite <strong>CONFIRMAR</strong> para prosseguir.
              {progress && executing && <div className="mt-2">Progresso: {progress.done}/{progress.total}</div>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="CONFIRMAR" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={executing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={confirmText.trim().toUpperCase() !== "CONFIRMAR" || executing} onClick={executeImport}>
              {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Executar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className={`pt-0 text-2xl font-bold ${tone ?? ""}`}>{value}</CardContent>
    </Card>
  );
}