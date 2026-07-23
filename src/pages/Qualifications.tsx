import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, XCircle, Circle, MinusCircle, Loader2, Search, Filter, ExternalLink, Download, HelpCircle, AlertOctagon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useWorkerQualifications, QualStatus, QualCell, QualColumn, QualRow } from "@/hooks/useWorkerQualifications";
import { useQualificationColumnCatalog, type QualColumnCatalogRow } from "@/hooks/useQualificationColumnCatalog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { fetchAllQualificationRows, exportQualificationsCsv, exportQualificationsXlsx } from "@/lib/qualifications-export";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_META: Record<QualStatus, { label: string; tone: string; icon: any }> = {
  ok: { label: "Válido", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30", icon: CheckCircle2 },
  warning: { label: "Vence em breve", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30", icon: AlertTriangle },
  expired: { label: "Vencido", tone: "bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-500/30", icon: XCircle },
  missing: { label: "Ausente", tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300 ring-1 ring-slate-500/30", icon: Circle },
  not_applicable: { label: "Não aplicável", tone: "text-muted-foreground/40", icon: MinusCircle },
  context_unresolved: { label: "Contexto pendente", tone: "bg-amber-400/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400/40", icon: HelpCircle },
};

const STORAGE_KEY = "dpfreela.qualifications.columns.v1";

function loadStoredSelection(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((s) => typeof s === "string")) return arr;
  } catch { /* ignore */ }
  return null;
}

function saveStoredSelection(ids: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return iso;
  }
}

function StatusIcon({ status, size = 18 }: { status: QualStatus; size?: number }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  if (status === "not_applicable") {
    return <Icon size={size} className="text-muted-foreground/30" strokeWidth={1.5} />;
  }
  return (
    <span className={cn("inline-flex items-center justify-center rounded-full p-1", meta.tone)}>
      <Icon size={size - 4} strokeWidth={2.25} />
    </span>
  );
}

export default function Qualifications() {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<QualStatus | null>(null);
  const [onlyActiveContexts, setOnlyActiveContexts] = useState(true);
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>([]);
  const [selectionReady, setSelectionReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<{ row: QualRow; col: QualColumn; cell: QualCell } | null>(null);

  const catalog = useQualificationColumnCatalog();
  const availableColumns: QualColumnCatalogRow[] = catalog.data ?? [];

  // Preset inicial: ASO + todas as NRs ativas. Treinamentos entram só se o
  // usuário marcar explicitamente. Se houver seleção persistida, respeita-a.
  useEffect(() => {
    if (selectionReady || catalog.isLoading || !catalog.data) return;
    const stored = loadStoredSelection();
    if (stored) {
      const valid = new Set(catalog.data.map((c) => c.document_type_id));
      setSelectedColumnIds(stored.filter((id) => valid.has(id)));
    } else {
      const preset = catalog.data
        .filter((c) => c.category === "sst_aso" || c.category === "sst_nr")
        .map((c) => c.document_type_id);
      setSelectedColumnIds(preset);
    }
    setSelectionReady(true);
  }, [catalog.isLoading, catalog.data, selectionReady]);

  // Persiste seleção sempre que muda (após preset inicial).
  useEffect(() => {
    if (selectionReady) saveStoredSelection(selectedColumnIds);
  }, [selectedColumnIds, selectionReady]);

  const { data, isLoading, error } = useWorkerQualifications({
    search,
    state,
    // Passa exatamente a seleção do usuário (array vazio desabilita a consulta).
    documentTypeIds: selectionReady ? selectedColumnIds : null,
    onlyActiveContexts,
  });

  const columns = data?.columns ?? [];
  const items = data?.items ?? [];

  // Agrupa o CATÁLOGO (não os columns filtrados) — assim marcar uma coluna
  // nunca remove as demais opções do seletor.
  const groupedCatalog = useMemo(() => {
    const groups: Record<string, QualColumnCatalogRow[]> = { sst_nr: [], sst_aso: [], training: [] };
    availableColumns.forEach((c) => { (groups[c.category] ||= []).push(c); });
    return groups;
  }, [availableColumns]);

  const totalCatalog = availableColumns.length;
  const selectedCount = selectedColumnIds.length;

  const toggleColumn = (id: string, checked: boolean) => {
    setSelectedColumnIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  };
  const selectAll = () => setSelectedColumnIds(availableColumns.map((c) => c.document_type_id));
  const clearAll = () => setSelectedColumnIds([]);

  const stateCounts = useMemo(() => {
    const acc = { expired: 0, warning: 0, missing: 0, ok: 0, context_unresolved: 0 };
    items.forEach((r) => {
      acc.expired += r.counters.expired;
      acc.warning += r.counters.warning;
      acc.missing += r.counters.missing;
      acc.ok += r.counters.ok;
      acc.context_unresolved += r.counters.context_unresolved ?? 0;
    });
    return acc;
  }, [items]);

  const totals = data?.totals;
  const totalCtxUnresolved = totals?.total_context_unresolved ?? 0;

  async function runExport(kind: "csv" | "xlsx") {
    if (selectedColumnIds.length === 0) {
      toast.info("Selecione ao menos uma coluna antes de exportar.");
      return;
    }
    setExporting(true);
    try {
      const matrix = await fetchAllQualificationRows({
        search,
        state,
        onlyRelevant: onlyActiveContexts,
        documentTypeIds: selectedColumnIds,
      });
      if (kind === "csv") await exportQualificationsCsv(matrix);
      else await exportQualificationsXlsx(matrix);
      toast.success(`Exportação concluída — ${matrix.items.length} trabalhador${matrix.items.length === 1 ? "" : "es"}.`);
    } catch (e: any) {
      toast.error(String(e?.message || "Falha ao exportar."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Painel de Qualificações</h1>
          <p className="text-sm text-muted-foreground">
            Matriz de NRs, ASOs e treinamentos por trabalhador. O certificado pertence ao trabalhador;
            o cargo/vínculo apenas define quando ele é exigido.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" disabled={exporting || selectedColumnIds.length === 0}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => runExport("xlsx")} disabled={exporting}>Planilha (.xlsx)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => runExport("csv")} disabled={exporting}>CSV (.csv)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Filters */}
      <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar trabalhador por nome ou CPF"
              className="pl-9"
            />
          </div>

          <ToggleGroup
            type="single"
            value={state ?? ""}
            onValueChange={(v) => setState((v as QualStatus) || null)}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="expired" className="data-[state=on]:bg-red-500/15 data-[state=on]:text-red-700">
              Vencidos {stateCounts.expired > 0 && <Badge variant="secondary" className="ml-1">{stateCounts.expired}</Badge>}
            </ToggleGroupItem>
            <ToggleGroupItem value="missing" className="data-[state=on]:bg-slate-500/15">
              Ausentes {stateCounts.missing > 0 && <Badge variant="secondary" className="ml-1">{stateCounts.missing}</Badge>}
            </ToggleGroupItem>
            <ToggleGroupItem value="warning" className="data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-700">
              Vencendo
            </ToggleGroupItem>
            <ToggleGroupItem value="ok" className="data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700">
              Válidos
            </ToggleGroupItem>
            <ToggleGroupItem value="context_unresolved" className="data-[state=on]:bg-amber-400/15 data-[state=on]:text-amber-700">
              Contexto pendente {stateCounts.context_unresolved > 0 && <Badge variant="secondary" className="ml-1">{stateCounts.context_unresolved}</Badge>}
            </ToggleGroupItem>
          </ToggleGroup>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-1" />
                Colunas <Badge variant="secondary" className="ml-1">{selectedCount} de {totalCatalog}</Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 max-h-[70vh] overflow-y-auto">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Documentos exibidos</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={selectAll}>Selecionar todas</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearAll}>Limpar seleção</Button>
                  </div>
                </div>
                {catalog.isLoading ? (
                  <div className="py-4 flex justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (["sst_aso", "sst_nr", "training"] as const).map((cat) =>
                  groupedCatalog[cat]?.length ? (
                    <div key={cat} className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {cat === "sst_nr" ? "NRs" : cat === "sst_aso" ? "ASO" : "Treinamentos"}
                      </p>
                      {groupedCatalog[cat].map((c) => (
                        <label key={c.document_type_id} className="flex items-center gap-2 py-1 cursor-pointer">
                          <Checkbox
                            checked={selectedColumnIds.includes(c.document_type_id)}
                            onCheckedChange={(v) => toggleColumn(c.document_type_id, !!v)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="text-sm">{c.name}</span>
                          {c.code && <span className="text-[10px] text-muted-foreground ml-auto">{c.code}</span>}
                        </label>
                      ))}
                    </div>
                  ) : null
                )}
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2 ml-auto">
            <Switch id="active-ctx" checked={onlyActiveContexts} onCheckedChange={setOnlyActiveContexts} />
            <Label htmlFor="active-ctx" className="text-sm cursor-pointer">
              Apenas trabalhadores com vínculo operacional ativo
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><StatusIcon status="ok" size={14} /> Válido</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="warning" size={14} /> Vence em ≤ {data?.warning_days ?? 30}d</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="expired" size={14} /> Vencido</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="missing" size={14} /> Ausente (exigido)</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="context_unresolved" size={14} /> Contexto pendente</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="not_applicable" size={14} /> Não aplicável</span>
        </div>
      </div>

      {totalCtxUnresolved > 0 && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 flex items-start gap-2 text-sm">
          <AlertOctagon className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              {totalCtxUnresolved} exigência{totalCtxUnresolved === 1 ? "" : "s"} com contexto pendente
            </p>
            <p className="text-xs text-muted-foreground">
              Existem trabalhadores com cargo/vínculo legado ainda não reconciliado. As exigências dessas pessoas <b>não podem ser classificadas como não aplicáveis</b> — reconcilie o cargo em Configurações → Higiene de cargos ou promova o vínculo formal.
            </p>
          </div>
        </div>
      )}

      {/* Matrix */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {selectionReady && selectedColumnIds.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Selecione pelo menos uma coluna para visualizar as qualificações.
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-destructive">
            Erro ao carregar qualificações: {(error as Error).message}
          </div>
        ) : columns.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum tipo de documento SST/treinamento configurado.
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum trabalhador encontrado com os filtros atuais.
          </div>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <table className="min-w-full text-sm border-separate border-spacing-0">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="sticky left-0 z-20 bg-card px-3 py-2 text-left font-medium border-b min-w-[220px]">
                    Trabalhador
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.document_type_id}
                      className="px-2 py-2 border-b text-[11px] font-medium text-muted-foreground align-bottom whitespace-nowrap"
                      style={{ minWidth: 56 }}
                      title={c.name}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="max-w-[80px] truncate">{c.code || c.name}</span>
                        <span className="text-[9px] uppercase tracking-wide opacity-60">
                          {c.category === "sst_nr" ? "NR" : c.category === "sst_aso" ? "ASO" : "TR"}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.worker_id} className="hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-card group-hover:bg-muted/30 px-3 py-2 border-b">
                      <Link
                        to={`/workers/${row.worker_id}`}
                        className="font-medium hover:underline flex items-center gap-1.5"
                      >
                        {row.worker_name}
                      </Link>
                      <div className="flex gap-1 mt-0.5 text-[10px] text-muted-foreground">
                        {row.counters.expired > 0 && <span className="text-red-600">{row.counters.expired} vencidos</span>}
                        {row.counters.warning > 0 && <span className="text-amber-600">{row.counters.warning} vencendo</span>}
                        {row.counters.missing > 0 && <span className="text-slate-600">{row.counters.missing} ausentes</span>}
                      </div>
                    </td>
                    {row.cells.map((cell) => {
                      const col = columns.find((c) => c.document_type_id === cell.document_type_id)!;
                      return (
                        <td key={cell.document_type_id} className="border-b text-center p-1">
                          <button
                            type="button"
                            className="inline-flex items-center justify-center hover:scale-110 transition-transform"
                            onClick={() => setDetail({ row, col, cell })}
                            aria-label={`${col.name}: ${STATUS_META[cell.status].label}`}
                          >
                            <StatusIcon status={cell.status} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && (
        <p className="text-xs text-muted-foreground text-right">
          {items.length} de {data.total} trabalhadores · {columns.length} documentos
        </p>
      )}

      {/* Cell detail */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <StatusIcon status={detail.cell.status} />
                  {detail.col.name}
                </SheetTitle>
                <SheetDescription>
                  <Link to={`/workers/${detail.row.worker_id}`} className="hover:underline font-medium text-foreground">
                    {detail.row.worker_name}
                  </Link>
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Estado:</span>{" "}
                  <span className="font-medium">{STATUS_META[detail.cell.status].label}</span>
                </div>
                {detail.cell.issue_date && (
                  <div>
                    <span className="text-muted-foreground">Emissão:</span>{" "}
                    <span>{formatDate(detail.cell.issue_date)}</span>
                  </div>
                )}
                {detail.cell.expiry_date && (
                  <div>
                    <span className="text-muted-foreground">Validade:</span>{" "}
                    <span>{formatDate(detail.cell.expiry_date)}</span>
                  </div>
                )}
                {detail.cell.issuer && (
                  <div>
                    <span className="text-muted-foreground">Emissor:</span>{" "}
                    <span>{detail.cell.issuer}</span>
                  </div>
                )}
                {!detail.cell.is_relevant && detail.cell.status === "not_applicable" && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Este documento não é exigido pelo cargo/vínculo atual do trabalhador.
                  </p>
                )}
                <div className="pt-3 border-t flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/workers/${detail.row.worker_id}`}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      Abrir trabalhador
                    </Link>
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}