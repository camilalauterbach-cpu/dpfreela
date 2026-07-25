// E-SST.2.D — Lista operacional de pendências SST.
// Fonte única: useSstOverview + collectPendencies (mesma lógica do painel resumido).
// Filtros: categoria de pendência, NR, busca por trabalhador; paginação client-side.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  useSstOverview,
  type SstCurrentRow,
  type SstWorkerRow,
} from "@/hooks/useSstQualifications";
import {
  collectPendencies, groupPendenciesByWorker,
  DOC_LABEL_PT, EXP_LABEL_PT, type PendencyRow,
} from "@/lib/sst/export";
import { partitionByTestData } from "@/lib/sst/test-data";
import { exportPendenciesXlsx } from "@/lib/sst/pendencies-export";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Loader2, ExternalLink, ArrowLeft, Upload, FileSpreadsheet, AlertTriangle, FlaskConical } from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { SstCertificateDrawer, type SstDrawerMode } from "@/components/workers/sst/SstCertificateDrawer";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

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

interface AllocationInfo { event_name: string | null; job_role_name: string | null }

function useActiveAllocationsForWorkers(workerIds: string[]) {
  const key = useMemo(() => [...workerIds].sort(), [workerIds]);
  return useQuery({
    queryKey: ["sst-pendencies-allocations", key],
    enabled: key.length > 0,
    staleTime: 300_000, // 5 min — cache das alocações (E-SST.2.F)
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("link_group_workers")
        .select("worker_id, job_role_id, employment_link_id, job_roles:job_role_id(id, name, is_active), link_groups!inner(group_name, events(name))")
        .in("worker_id", key)
        .is("deleted_at", null);
      if (error) throw error;
      const byWorker = new Map<string, AllocationInfo[]>();
      for (const row of (data || []) as any[]) {
        const info: AllocationInfo = {
          event_name: row.link_groups?.events?.name ?? row.link_groups?.group_name ?? null,
          job_role_name: row.job_roles?.name ?? null,
        };
        const arr = byWorker.get(row.worker_id) || [];
        // dedupe by event+role
        if (!arr.some((a) => a.event_name === info.event_name && a.job_role_name === info.job_role_name)) {
          arr.push(info);
        }
        byWorker.set(row.worker_id, arr);
      }
      return byWorker;
    },
  });
}

// Overrides ativos por worker × document_type (para badge [Override] na lista).
function useActiveOverridesForWorkers(
  entries: Array<{ workerId: string; docTypeId: string | null }>,
) {
  const key = useMemo(() => {
    const uniq = new Set<string>();
    for (const e of entries) if (e.docTypeId) uniq.add(`${e.workerId}:${e.docTypeId}`);
    return Array.from(uniq).sort();
  }, [entries]);
  const workerIds = useMemo(
    () => Array.from(new Set(key.map((k) => k.split(":")[0]))),
    [key],
  );
  const docTypeIds = useMemo(
    () => Array.from(new Set(key.map((k) => k.split(":")[1]))),
    [key],
  );
  return useQuery({
    queryKey: ["sst-pendencies-overrides", key],
    enabled: key.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employment_link_document_overrides")
        .select("employment_link_id, document_type_id, action, employment_links!inner(worker_id)")
        .in("document_type_id", docTypeIds)
        .is("deleted_at", null);
      if (error) throw error;
      const set = new Set<string>();
      for (const row of (data || []) as any[]) {
        const wid = row.employment_links?.worker_id;
        if (wid && workerIds.includes(wid)) {
          set.add(`${wid}:${row.document_type_id}`);
        }
      }
      return set;
    },
  });
}

export default function SstPendencies() {
  const { hasAnyRole } = useAuth();
  const canWrite = hasAnyRole(["admin", "manager", "operator"]);
  const isAdmin = hasAnyRole(["admin", "manager"]);

  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [category, setCategory] = useState<Category>((sp.get("cat") as Category) || "");
  const [nr, setNr] = useState(sp.get("nr") ?? "");
  const [page, setPage] = useState(0);
  const [includeTest, setIncludeTest] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Carrega dataset completo — filtragem/paginação client-side.
  const overview = useSstOverview({ search: "" });
  const allWorkers = overview.data?.workers || [];
  const orphans = overview.data?.orphans || [];
  const partitioned = useMemo(() => partitionByTestData(allWorkers), [allWorkers]);
  const workers = includeTest ? allWorkers : partitioned.operational;

  const allPendencies = useMemo(() => collectPendencies(workers), [workers]);

  const nrOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of allPendencies) set.add(p.q.nr_code);
    return Array.from(set).sort();
  }, [allPendencies]);

  // Filtra pendências individuais (chip a chip) — usado tanto para as linhas
  // agrupadas quanto para o contador global "M pendências".
  const filteredPendencies = useMemo<PendencyRow[]>(() => {
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

  // Uma linha por trabalhador — chips agrupados, ordenados pela pior pendência.
  const groupedRows = useMemo(
    () => groupPendenciesByWorker(filteredPendencies),
    [filteredPendencies],
  );
  const paged = groupedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const uniqueWorkerIds = useMemo(
    () => groupedRows.map((g) => g.worker.worker_id),
    [groupedRows],
  );
  const pageWorkerIds = useMemo(
    () => paged.map((g) => g.worker.worker_id),
    [paged],
  );
  const allocations = useActiveAllocationsForWorkers(pageWorkerIds);
  const overrides = useActiveOverridesForWorkers(
    useMemo(
      () => paged.flatMap((g) =>
        g.pendencies.map((p) => ({ workerId: g.worker.worker_id, docTypeId: p.q.document_type_id })),
      ),
      [paged],
    ),
  );

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

  async function handleExport() {
    setExporting(true);
    try {
      const count = await exportPendenciesXlsx({
        filters: {
          search: search || undefined,
          category: category || undefined,
          nr: nr || undefined,
          includeTestData: includeTest,
        },
        operationalWorkers: workers,
        filteredPendencies,
        testWorkers: partitioned.test,
        orphans,
      });
      toast.success(`Planilha exportada — ${count} pendência${count === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error("[SstPendencies] export failed", err);
      toast.error("Não foi possível gerar a planilha. Tente novamente em instantes.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to="/sst"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pendências SST</h1>
            <p className="text-sm text-muted-foreground">
              Uma linha por trabalhador — cada NR aparece como um chip com ação individual.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {uniqueWorkerIds.length} trabalhador{uniqueWorkerIds.length !== 1 ? "es" : ""}
          </Badge>
          <Badge variant="outline">
            {filteredPendencies.length} pendência{filteredPendencies.length !== 1 ? "s" : ""}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1"
            onClick={handleExport}
            disabled={exporting || overview.isLoading}
            data-testid="btn-export-pendencies-xlsx"
          >
            {exporting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <FileSpreadsheet className="h-4 w-4" />}
            Exportar planilha
          </Button>
        </div>
      </div>

      {(orphans.length > 0 || partitioned.test.length > 0 || isAdmin) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {orphans.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
              <AlertTriangle className="h-3 w-3" />
              {orphans.length} órfão{orphans.length === 1 ? "" : "s"} / legado{orphans.length === 1 ? "" : "s"} — auditoria via exportação
            </span>
          )}
          {partitioned.test.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
              <FlaskConical className="h-3 w-3" />
              {partitioned.test.length} dado{partitioned.test.length === 1 ? "" : "s"} de teste detectado{partitioned.test.length === 1 ? "" : "s"}
            </span>
          )}
          {isAdmin && (
            <div className="ml-auto inline-flex items-center gap-2">
              <Switch
                id="toggle-test-data"
                checked={includeTest}
                onCheckedChange={(v) => setIncludeTest(Boolean(v))}
              />
              <Label htmlFor="toggle-test-data" className="text-xs">
                Incluir dados de teste
              </Label>
            </div>
          )}
        </div>
      )}

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

      {!overview.isLoading && groupedRows.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {(search || category || nr)
            ? "Nenhuma pendência com os filtros atuais."
            : "Nenhuma pendência. Todos os certificados obrigatórios estão regularizados."}
        </CardContent></Card>
      )}

      {!overview.isLoading && paged.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {paged.map((group) => {
                const { worker, pendencies } = group;
                const allocs = allocations.data?.get(worker.worker_id) || [];
                const allocLabel = allocs.length === 0
                  ? "Sem vínculo ativo"
                  : allocs.slice(0, 2).map((a) =>
                      `${a.event_name ?? "—"} · ${a.job_role_name ?? "sem cargo"}`
                    ).join("  |  ") + (allocs.length > 2 ? ` +${allocs.length - 2}` : "");
                return (
                  <div key={worker.worker_id} className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/workers/${worker.worker_id}`}
                        className="font-medium hover:underline truncate">
                        {worker.full_name}
                      </Link>
                      <span className="text-[11px] text-muted-foreground">
                        {worker.cpf || "sem CPF"}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {pendencies.length} pendência{pendencies.length !== 1 ? "s" : ""}
                      </Badge>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild size="icon" variant="ghost" className="h-7 w-7 ml-auto">
                            <Link to={`/workers/${worker.worker_id}?tab=sst`}
                              aria-label="Abrir trabalhador">
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Abrir trabalhador</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      <span className="font-medium text-foreground/70">Vínculos: </span>
                      {allocations.isLoading ? "carregando…" : allocLabel}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {pendencies.map(({ q, rank, daysLeft }) => {
                        const meta = RANK_META[rank];
                        const isRenewable = rank <= 5;
                        const mode: SstDrawerMode =
                          q.document_status === "no_document" ? "create"
                          : isRenewable ? "renew" : "create";
                        const hasOverride = q.document_type_id
                          ? overrides.data?.has(`${worker.worker_id}:${q.document_type_id}`) ?? false
                          : false;
                        return (
                          <div key={q.id}
                            className="rounded-md border bg-card p-2 min-w-[220px] flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant="outline" className="text-[10px]">{q.nr_code}</Badge>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.className}`}>
                                {meta.label}
                              </span>
                              {hasOverride && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-purple-50 text-purple-800 border-purple-200">
                                  Override
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {daysLeft != null
                                ? `${daysLeft} dia${Math.abs(daysLeft) === 1 ? "" : "s"}${q.expires_at ? ` (${fmtBR(q.expires_at)})` : ""}`
                                : q.expires_at ? `Venc.: ${fmtBR(q.expires_at)}` : "Sem data"}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {DOC_LABEL_PT[q.document_status]} · {EXP_LABEL_PT[q.expiration_status]}
                            </div>
                            {canWrite && (
                              <Button size="sm" variant="outline"
                                className="h-7 text-[11px] gap-1 mt-1 self-start"
                                onClick={() => setDrawer({ mode, worker, current: q })}>
                                <Upload className="h-3 w-3" />
                                {mode === "create" ? "Anexar" : "Renovar"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <TablePagination
              page={page}
              totalCount={groupedRows.length}
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
    </TooltipProvider>
  );
}