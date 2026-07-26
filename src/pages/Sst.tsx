import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  useSstOverview,
  ExpirationStatus, DocumentStatus, ValidityStatus, SstCurrentRow,
} from "@/hooks/useSstQualifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, ShieldCheck, AlertTriangle, Clock, FileWarning, Loader2, Download, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { AddSstDialog } from "@/components/sst/AddSstDialog";
import { SstPendenciesPanel } from "@/components/sst/SstPendenciesPanel";
import { flattenWorkers, exportCsv, exportXlsx, exportPdfSummary } from "@/lib/sst/export";
import { partitionByTestData } from "@/lib/sst/test-data";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FlaskConical } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const EXP_LABEL: Record<ExpirationStatus, string> = {
  valid: "Válido",
  expiring_soon: "Vence em 30d",
  expired: "Vencido",
  no_expiry: "Sem validade",
  unknown: "Validade desconhecida",
};
const EXP_CLASS: Record<ExpirationStatus, string> = {
  valid: "bg-emerald-100 text-emerald-800 border-emerald-200",
  expiring_soon: "bg-amber-100 text-amber-800 border-amber-200",
  expired: "bg-red-100 text-red-800 border-red-200",
  no_expiry: "bg-slate-100 text-slate-700 border-slate-200",
  unknown: "bg-slate-100 text-slate-700 border-slate-200",
};
const DOC_LABEL: Record<DocumentStatus, string> = {
  pending: "Doc. pendente", ok: "Doc. ok", rejected: "Doc. rejeitado", no_document: "Sem comprovante",
};
const DOC_CLASS: Record<DocumentStatus, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-red-50 text-red-800 border-red-200",
  no_document: "bg-slate-50 text-slate-700 border-slate-200",
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
  const isAdmin = hasAnyRole(["admin", "manager"]);

  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [nr, setNr] = useState<string>(sp.get("nr") ?? "");
  const [expiration, setExpiration] = useState<"" | ExpirationStatus>((sp.get("expiration") as ExpirationStatus) || "");
  const [doc, setDoc] = useState<"" | DocumentStatus>((sp.get("doc") as DocumentStatus) || "");
  const [validity, setValidity] = useState<"" | ValidityStatus>((sp.get("validity") as ValidityStatus) || "");
  const [daysUntil, setDaysUntil] = useState<number | null>(sp.get("days") ? Number(sp.get("days")) : null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [includeTest, setIncludeTest] = useState(false);

  const filters = useMemo(
    () => ({ search, nr: nr || undefined, expiration: expiration || undefined, doc: doc || undefined, validity: validity || undefined, daysUntil }),
    [search, nr, expiration, doc, validity, daysUntil],
  );
  const overview = useSstOverview(filters);

  // Sincroniza filtros ↔ URL
  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (nr) next.set("nr", nr);
    if (expiration) next.set("expiration", expiration);
    if (doc) next.set("doc", doc);
    if (validity) next.set("validity", validity);
    if (daysUntil) next.set("days", String(daysUntil));
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, nr, expiration, doc, validity, daysUntil]);

  const clearFilters = () => {
    setSearch(""); setNr(""); setExpiration(""); setDoc(""); setValidity(""); setDaysUntil(null);
  };

  const nrOptions = useMemo(() => {
    const set = new Set<string>();
    for (const w of (overview.data?.workers || [])) {
      for (const q of w.qualifications) set.add(q.nr_code);
    }
    return Array.from(set).sort();
  }, [overview.data]);

  // Q-027: Partição canônica de fixtures E2E. Por padrão, todos os cálculos
  // (lista, painel, cards, filtros e exportação) usam apenas dados operacionais.
  // Admin/manager pode ligar o switch para incluir dados de teste.
  const partitioned = useMemo(
    () => partitionByTestData(overview.data?.workers || []),
    [overview.data],
  );
  const currentWorkers = includeTest
    ? (overview.data?.workers || [])
    : partitioned.operational;

  const derivedCounts = useMemo(() => {
    const wSet = new Set<string>();
    let expired = 0, expiring = 0, pending = 0;
    for (const w of currentWorkers) {
      wSet.add(w.worker_id);
      for (const q of w.qualifications) {
        if (q.expiration_status === "expired") expired++;
        else if (q.expiration_status === "expiring_soon") expiring++;
        if (q.document_status === "pending") pending++;
      }
    }
    return { totalWorkers: wSet.size, expired, expiring, pending };
  }, [currentWorkers]);

  const cards = [
    { label: "Trabalhadores no SST", value: derivedCounts.totalWorkers, icon: ShieldCheck, tone: "", onClick: () => clearFilters() },
    { label: "Vencendo em 30d", value: derivedCounts.expiring, icon: Clock, tone: "text-amber-700", onClick: () => { clearFilters(); setExpiration("expiring_soon"); } },
    { label: "Vencidos", value: derivedCounts.expired, icon: AlertTriangle, tone: "text-red-700", onClick: () => { clearFilters(); setExpiration("expired"); } },
    { label: "Docs pendentes", value: derivedCounts.pending, icon: FileWarning, tone: "text-amber-700", onClick: () => { clearFilters(); setDoc("pending"); } },
  ];

  const shortcuts: Array<{ label: string; onClick: () => void }> = [
    { label: "Vencidas", onClick: () => { clearFilters(); setExpiration("expired"); } },
    { label: "Vence em 7d", onClick: () => { clearFilters(); setDaysUntil(7); } },
    { label: "Vence em 15d", onClick: () => { clearFilters(); setDaysUntil(15); } },
    { label: "Vence em 30d", onClick: () => { clearFilters(); setDaysUntil(30); } },
    { label: "Vence em 60d", onClick: () => { clearFilters(); setDaysUntil(60); } },
    { label: "Pendentes", onClick: () => { clearFilters(); setDoc("pending"); } },
    { label: "Rejeitadas", onClick: () => { clearFilters(); setDoc("rejected"); } },
    { label: "Sem comprovante", onClick: () => { clearFilters(); setDoc("no_document"); } },
    { label: "Validade desconhecida", onClick: () => { clearFilters(); setValidity("unknown"); } },
  ];

  const flat = useMemo(() => flattenWorkers(currentWorkers), [currentWorkers]);

  async function runExport(kind: "csv" | "xlsx" | "pdf") {
    if (flat.length === 0) { toast.info("Nada para exportar com os filtros atuais."); return; }
    try {
      const parts = [
        nr && `nr-${nr}`, expiration && `exp-${expiration}`, doc && `doc-${doc}`,
        validity && `val-${validity}`, daysUntil && `d${daysUntil}`,
      ].filter(Boolean).join("_");
      if (kind === "csv") exportCsv(flat, parts);
      else if (kind === "xlsx") await exportXlsx(flat, parts);
      else await exportPdfSummary(currentWorkers, parts);
      toast.success("Exportação concluída.");
    } catch (e: any) {
      toast.error(String(e?.message || "Falha ao exportar."));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Controle SST</h1>
          <p className="text-sm text-muted-foreground">Acompanhamento de NRs e documentos de SST.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link to="/sst/pendencias">
              <AlertTriangle className="h-4 w-4" /> Ver pendências
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Listagem filtrada</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => runExport("xlsx")}>
                <Download className="mr-2 h-4 w-4" /> Planilha (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runExport("csv")}>
                <Download className="mr-2 h-4 w-4" /> CSV (.csv)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Conferência</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => runExport("pdf")}>
                <FileText className="mr-2 h-4 w-4" /> Resumo por trabalhador (PDF)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canWrite && (
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Adicionar ao Controle SST
            </Button>
          )}
        </div>
      </div>

      {(partitioned.test.length > 0 || isAdmin) && (
        <div className="flex flex-wrap items-center gap-2 text-xs -mt-1">
          {partitioned.test.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
              <FlaskConical className="h-3 w-3" />
              {partitioned.test.length} dado{partitioned.test.length === 1 ? "" : "s"} de teste detectado{partitioned.test.length === 1 ? "" : "s"}
            </span>
          )}
          {isAdmin && (
            <div className="ml-auto inline-flex items-center gap-2">
              <Switch
                id="sst-toggle-test-data"
                checked={includeTest}
                onCheckedChange={(v) => setIncludeTest(Boolean(v))}
                data-testid="sst-toggle-test-data"
              />
              <Label htmlFor="sst-toggle-test-data" className="text-xs">
                Incluir dados de teste
              </Label>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <button key={c.label} onClick={c.onClick} className="text-left">
            <Card className="hover:border-primary/30 hover:shadow-sm transition">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                  <c.icon className="h-3 w-3" /> {c.label}
                </CardTitle>
              </CardHeader>
              <CardContent className={`pt-0 text-2xl font-bold ${c.tone}`}>{c.value ?? "—"}</CardContent>
            </Card>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {shortcuts.map((s) => (
          <Button key={s.label} size="sm" variant="outline" onClick={s.onClick} className="h-7 text-xs">
            {s.label}
          </Button>
        ))}
        {(search || nr || expiration || doc || validity || daysUntil) && (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="h-7 text-xs">Limpar</Button>
        )}
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
            <SelectItem value="no_document">Sem comprovante</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {overview.isLoading && (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}
      {!overview.isLoading && currentWorkers.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum trabalhador no Controle SST ainda.{canWrite && " Use o botão “Adicionar ao Controle SST” para começar."}
        </CardContent></Card>
      )}

      {!overview.isLoading && currentWorkers.length > 0 && (
        <SstPendenciesPanel workers={currentWorkers} />
      )}

      <div className="space-y-2">
        {currentWorkers.map((w) => (
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