// E-SST.2.D — Lista operacional de pendências SST.
// Fonte única: useSstOverview + collectPendencies (mesma lógica do painel resumido).
// Filtros: categoria de pendência, NR, busca por trabalhador; paginação client-side.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  useSstOverview,
  type SstCurrentRow,
  type SstWorkerRow,
} from "@/hooks/useSstQualifications";
import { collectPendencies, DOC_LABEL_PT, EXP_LABEL_PT } from "@/lib/sst/export";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Loader2, ExternalLink, ArrowLeft, Upload } from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { SstCertificateDrawer, type SstDrawerMode } from "@/components/workers/sst/SstCertificateDrawer";

type Category = "" | "expired" | "rejected" | "d7" | "d15" | "d30" | "pending" | "no_document" | "unknown";

const CATEGORY_LABEL: Record<Exclude<Category, "">, string> = {
  expired: "Vencidas",
  rejected: "Rejeitadas",
  d7: "Vence em 7 dias",
  d15: "Vence em 15 dias",
  d30: "Vence em 30 dias",
  pending: "Documento pendente",
  no_document: "Sem comprovante",
  unknown: "Validade desconhecida",
};

const RANK_META: Record<number, { label: string; className: string }> = {
  1: { label: "Vencida", className: "bg-red-100 text-red-800 border-red-200" },
  2: { label: "Rejeitada", className: "bg-red-100 text-red-800 border-red-200" },
  3: { label: "Vence em ≤7d", className: "bg-amber-100 text-amber-900 border-amber-300" },
  4: { label: "Vence em ≤15d", className: "bg-amber-100 text-amber-800 border-amber-200" },
  5: { label: "Vence em ≤30d", className: "bg-amber-50 text-amber-800 border-amber-200" },
  6: { label: "Doc. pendente", className: "bg-blue-50 text-blue-800 border-blue-200" },
  7: { label: "Sem comprovante", className: "bg-slate-100 text-slate-700 border-slate-200" },
  8: { label: "Validade desconhecida", className: "bg-slate-100 text-slate-700 border-slate-200" },
};

function matchesCategory(cat: Category, rank: number): boolean {
  if (!cat) return true;
  if (cat === "expired") return rank === 1;
  if (cat === "rejected") return rank === 2;
  if (cat === "d7") return rank === 3;
  if (cat === "d15") return rank <= 4 && rank >= 3;
  if (cat === "d30") return rank <= 5 && rank >= 3;
  if (cat === "pending") return rank === 6;
  if (cat === "no_document") return rank === 7;
  if (cat === "unknown") return rank === 8;
  return true;
}

function fmtBR(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const PAGE_SIZE = 20;

export default function SstPendencies() {
  const { hasAnyRole } = useAuth();
  const canWrite = hasAnyRole(["admin", "manager", "operator"]);

  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [category, setCategory] = useState<Category>((sp.get("cat") as Category) || "");
  const [nr, setNr] = useState(sp.get("nr") ?? "");
  const [page, setPage] = useState(0);

  // Carrega dataset completo — filtragem/paginação client-side.
  const overview = useSstOverview({ search: "" });
  const workers = overview.data?.workers || [];

  const allPendencies = useMemo(() => collectPendencies(workers), [workers]);

  const nrOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of allPendencies) set.add(p.q.nr_code);
    return Array.from(set).sort();
  }, [allPendencies]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return allPendencies.filter(({ worker, q, rank }) => {
      if (!matchesCategory(category, rank)) return false;
      if (nr && q.nr_code !== nr) return false;
      if (term) {
        const hitName = worker.full_name.toLowerCase().includes(term)
          || (worker.nickname || "").toLowerCase().includes(term);
        const hitCpf = digits && (worker.cpf || "").replace(/\D/g, "").includes(digits);
        if (!hitName && !hitCpf) return false;
      }
      return true;
    });
  }, [allPendencies, category, nr, search]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page + sync URL on filter change
  useEffect(() => {
    setPage(0);
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (category) next.set("cat", category);
    if (nr) next.set("nr", nr);
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, nr]);

  const totalsByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of allPendencies) {
      if (p.rank === 1) m.expired = (m.expired || 0) + 1;
      else if (p.rank === 2) m.rejected = (m.rejected || 0) + 1;
      else if (p.rank === 3) m.d7 = (m.d7 || 0) + 1;
      else if (p.rank === 4) m.d15 = (m.d15 || 0) + 1;
      else if (p.rank === 5) m.d30 = (m.d30 || 0) + 1;
      else if (p.rank === 6) m.pending = (m.pending || 0) + 1;
      else if (p.rank === 7) m.no_document = (m.no_document || 0) + 1;
      else if (p.rank === 8) m.unknown = (m.unknown || 0) + 1;
    }
    return m;
  }, [allPendencies]);

  const [drawer, setDrawer] = useState<{
    mode: SstDrawerMode; worker: SstWorkerRow; current: SstCurrentRow;
  } | null>(null);

  const clear = () => { setSearch(""); setCategory(""); setNr(""); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to="/sst"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pendências SST</h1>
            <p className="text-sm text-muted-foreground">
              Lista operacional de pendências por prioridade.
            </p>
          </div>
        </div>
        <Badge variant="outline">{filtered.length} pendência{filtered.length !== 1 ? "s" : ""}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(CATEGORY_LABEL) as Array<Exclude<Category, "">>).map((k) => {
          const active = category === k;
          const count = totalsByCategory[k] || 0;
          return (
            <Button
              key={k}
              size="sm"
              variant={active ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setCategory(active ? "" : k)}
            >
              {CATEGORY_LABEL[k]} <span className="ml-1 opacity-70">({count})</span>
            </Button>
          );
        })}
        {(search || category || nr) && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clear}>Limpar</Button>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, apelido ou CPF"
            value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={nr || "__all"} onValueChange={(v) => setNr(v === "__all" ? "" : v)}>
          <SelectTrigger className="md:w-48"><SelectValue placeholder="NR" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todas as NRs</SelectItem>
            {nrOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {overview.isLoading && (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {!overview.isLoading && filtered.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma pendência com os filtros atuais.
        </CardContent></Card>
      )}

      {!overview.isLoading && paged.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {paged.map(({ worker, q, rank, daysLeft }) => {
                const meta = RANK_META[rank];
                const isRenewable = rank <= 5; // vencidas/rejeitadas/vencendo → renew
                const mode: SstDrawerMode = q.document_status === "no_document" ? "create"
                  : isRenewable ? "renew" : "create";
                return (
                  <div key={q.id} className="p-3 flex flex-wrap items-center gap-3">
                    <div className="min-w-[220px] flex-1">
                      <div className="flex items-center gap-2">
                        <Link to={`/workers/${worker.worker_id}`}
                          className="font-medium hover:underline truncate">
                          {worker.full_name}
                        </Link>
                        <Badge variant="outline" className="text-[10px]">{q.nr_code}</Badge>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.className}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {worker.cpf || "sem CPF"} • Venc.: {fmtBR(q.expires_at)}
                        {daysLeft != null && ` • ${daysLeft}d`}
                        {" • "}{DOC_LABEL_PT[q.document_status]}
                        {" • "}{EXP_LABEL_PT[q.expiration_status]}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {canWrite && (
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
                          onClick={() => setDrawer({ mode, worker, current: q })}>
                          <Upload className="h-3.5 w-3.5" />
                          {mode === "create" ? "Anexar" : "Renovar"}
                        </Button>
                      )}
                      <Button asChild size="sm" variant="ghost" className="h-8 text-xs gap-1">
                        <Link to={`/workers/${worker.worker_id}?tab=sst`}>
                          Abrir <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <TablePagination
              page={page}
              totalCount={filtered.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </CardContent>
        </Card>
      )}

      {drawer && (
        <SstCertificateDrawer
          open={!!drawer}
          onOpenChange={(v) => !v && setDrawer(null)}
          mode={drawer.mode}
          workerId={drawer.worker.worker_id}
          workerName={drawer.worker.full_name}
          current={drawer.current}
          presetNrCode={drawer.current.nr_code}
        />
      )}
    </div>
  );
}