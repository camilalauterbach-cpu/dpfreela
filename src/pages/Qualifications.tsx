import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, XCircle, Circle, MinusCircle, Loader2, Search, Filter, ExternalLink } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_META: Record<QualStatus, { label: string; tone: string; icon: any }> = {
  ok: { label: "Válido", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30", icon: CheckCircle2 },
  warning: { label: "Vence em breve", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30", icon: AlertTriangle },
  expired: { label: "Vencido", tone: "bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-red-500/30", icon: XCircle },
  missing: { label: "Obrigatório e inexistente", tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300 ring-1 ring-slate-500/30", icon: Circle },
  not_applicable: { label: "Não aplicável", tone: "text-muted-foreground/40", icon: MinusCircle },
};

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
  const [onlyRelevant, setOnlyRelevant] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ row: QualRow; col: QualColumn; cell: QualCell } | null>(null);

  const { data, isLoading, error } = useWorkerQualifications({
    search,
    state,
    documentTypeIds: selectedTypes.length ? selectedTypes : null,
    onlyRelevant,
  });

  const columns = data?.columns ?? [];
  const items = data?.items ?? [];

  const groupedCols = useMemo(() => {
    const groups: Record<string, QualColumn[]> = { sst_nr: [], sst_aso: [], training: [] };
    columns.forEach((c) => {
      (groups[c.category] ||= []).push(c);
    });
    return groups;
  }, [columns]);

  const stateCounts = useMemo(() => {
    const acc = { expired: 0, warning: 0, missing: 0, ok: 0 };
    items.forEach((r) => {
      acc.expired += r.counters.expired;
      acc.warning += r.counters.warning;
      acc.missing += r.counters.missing;
      acc.ok += r.counters.ok;
    });
    return acc;
  }, [items]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Painel de Qualificações</h1>
        <p className="text-sm text-muted-foreground">
          Matriz completa de NRs, ASOs e treinamentos por trabalhador. Cada célula reflete o estado atual do documento (válido, vencendo, vencido ou ausente quando obrigatório).
        </p>
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
          </ToggleGroup>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-1" />
                Colunas {selectedTypes.length > 0 && <Badge variant="secondary" className="ml-1">{selectedTypes.length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 max-h-[70vh] overflow-y-auto">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Documentos exibidos</span>
                  {selectedTypes.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSelectedTypes([])}>
                      Limpar
                    </Button>
                  )}
                </div>
                {(["sst_nr", "sst_aso", "training"] as const).map((cat) =>
                  groupedCols[cat]?.length ? (
                    <div key={cat} className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {cat === "sst_nr" ? "NRs" : cat === "sst_aso" ? "ASO" : "Treinamentos"}
                      </p>
                      {groupedCols[cat].map((c) => (
                        <label key={c.document_type_id} className="flex items-center gap-2 py-1 cursor-pointer">
                          <Checkbox
                            checked={selectedTypes.includes(c.document_type_id)}
                            onCheckedChange={(v) => {
                              setSelectedTypes((prev) =>
                                v ? [...prev, c.document_type_id] : prev.filter((id) => id !== c.document_type_id)
                              );
                            }}
                          />
                          <span className="text-sm">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : null
                )}
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2 ml-auto">
            <Switch id="relevant" checked={onlyRelevant} onCheckedChange={setOnlyRelevant} />
            <Label htmlFor="relevant" className="text-sm cursor-pointer">
              Apenas com vínculo ativo
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><StatusIcon status="ok" size={14} /> Válido</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="warning" size={14} /> Vence em ≤ {data?.warning_days ?? 30}d</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="expired" size={14} /> Vencido</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="missing" size={14} /> Obrigatório e ausente</span>
          <span className="inline-flex items-center gap-1"><StatusIcon status="not_applicable" size={14} /> Não aplicável</span>
        </div>
      </div>

      {/* Matrix */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
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