import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSstOverview, useSstSummary, ExpirationStatus, DocumentStatus, SstCurrentRow } from "@/hooks/useSstQualifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, ShieldCheck, AlertTriangle, Clock, FileWarning, Loader2 } from "lucide-react";
import { AddSstDialog } from "@/components/sst/AddSstDialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const EXP_LABEL: Record<ExpirationStatus, string> = {
  valid: "Válido", expiring_soon: "Vence em 30d", expired: "Vencido", no_expiry: "Sem validade",
};
const EXP_CLASS: Record<ExpirationStatus, string> = {
  valid: "bg-emerald-100 text-emerald-800 border-emerald-200",
  expiring_soon: "bg-amber-100 text-amber-800 border-amber-200",
  expired: "bg-red-100 text-red-800 border-red-200",
  no_expiry: "bg-slate-100 text-slate-700 border-slate-200",
};
const DOC_LABEL: Record<DocumentStatus, string> = {
  pending: "Doc. pendente", ok: "Doc. ok", rejected: "Doc. rejeitado",
};
const DOC_CLASS: Record<DocumentStatus, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-red-50 text-red-800 border-red-200",
};

function fmt(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(d + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }); } catch { return d; }
}

function NrChip({ q }: { q: SstCurrentRow }) {
  return (
    <div className="inline-flex flex-col rounded-md border p-2 min-w-[140px] bg-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{q.nr_code}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${EXP_CLASS[q.expiration_status]}`}>
          {EXP_LABEL[q.expiration_status]}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">Val.: {fmt(q.expires_at)}</div>
      <span className={`mt-1 self-start text-[10px] px-1.5 py-0.5 rounded border ${DOC_CLASS[q.document_status]}`}>
        {DOC_LABEL[q.document_status]}
      </span>
    </div>
  );
}

export default function Sst() {
  const { hasAnyRole } = useAuth();
  const canWrite = hasAnyRole(["admin", "manager", "operator"]);

  const [search, setSearch] = useState("");
  const [nr, setNr] = useState<string>("");
  const [expiration, setExpiration] = useState<"" | ExpirationStatus>("");
  const [doc, setDoc] = useState<"" | DocumentStatus>("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filters = useMemo(() => ({ search, nr: nr || undefined, expiration: expiration || undefined, doc: doc || undefined }), [search, nr, expiration, doc]);
  const summary = useSstSummary();
  const overview = useSstOverview(filters);

  const nrOptions = useMemo(() => {
    const set = new Set<string>();
    for (const w of overview.data?.workers || []) for (const q of w.qualifications) set.add(q.nr_code);
    return Array.from(set).sort();
  }, [overview.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Controle SST</h1>
          <p className="text-sm text-muted-foreground">Acompanhamento de NRs e documentos de SST.</p>
        </div>
        {canWrite && (
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Adicionar ao Controle SST
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Trabalhadores no SST</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-bold">{summary.data?.totalWorkers ?? "—"}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Vencendo em 30d</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-bold text-amber-700">{summary.data?.expiring ?? "—"}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Vencidos</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-bold text-red-700">{summary.data?.expired ?? "—"}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><FileWarning className="h-3 w-3" /> Docs pendentes</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-bold text-amber-700">{summary.data?.pending ?? "—"}</CardContent></Card>
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou CPF" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={nr || "__all"} onValueChange={(v) => setNr(v === "__all" ? "" : v)}>
          <SelectTrigger className="md:w-40"><SelectValue placeholder="NR" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todas as NRs</SelectItem>
            {nrOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={expiration || "__all"} onValueChange={(v) => setExpiration(v === "__all" ? "" : v as ExpirationStatus)}>
          <SelectTrigger className="md:w-48"><SelectValue placeholder="Validade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todas as validades</SelectItem>
            <SelectItem value="valid">Válidos</SelectItem>
            <SelectItem value="expiring_soon">Vencendo em 30d</SelectItem>
            <SelectItem value="expired">Vencidos</SelectItem>
            <SelectItem value="no_expiry">Sem validade</SelectItem>
          </SelectContent>
        </Select>
        <Select value={doc || "__all"} onValueChange={(v) => setDoc(v === "__all" ? "" : v as DocumentStatus)}>
          <SelectTrigger className="md:w-44"><SelectValue placeholder="Documento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os documentos</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="ok">Aprovado</SelectItem>
            <SelectItem value="rejected">Rejeitado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {overview.isLoading && (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}
      {!overview.isLoading && (overview.data?.workers || []).length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum trabalhador no Controle SST ainda.{canWrite && " Use o botão “Adicionar ao Controle SST” para começar."}
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {(overview.data?.workers || []).map((w) => (
          <Card key={w.worker_id}>
            <CardContent className="py-3 flex flex-col md:flex-row md:items-center gap-3">
              <div className="min-w-[220px]">
                <div className="font-medium">{w.full_name}</div>
                <div className="text-xs text-muted-foreground">{w.cpf || "sem CPF"}</div>
                <Badge variant="outline" className="mt-1 text-[10px]">{w.qualifications.length} NR{w.qualifications.length !== 1 ? "s" : ""}</Badge>
              </div>
              <div className="flex flex-wrap gap-2 flex-1">
                {w.qualifications
                  .sort((a, b) => a.nr_code.localeCompare(b.nr_code))
                  .map((q) => <NrChip key={q.id} q={q} />)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AddSstDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}