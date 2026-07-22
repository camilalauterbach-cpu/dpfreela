import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, RefreshCw, Download, ChevronDown, ChevronRight, ShieldAlert, Info } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CandidateRef { employment_link_id: string; job_role_id: string | null; role_name: string | null; status: string | null }
interface CatalogRow {
  id: string; code: string | null; name: string; is_active: boolean;
  created_at: string | null; created_by: string | null;
  origin: string; origin_evidence: Record<string, unknown> | null;
  employment_links_active: number; employment_links_historical: number;
  employment_links_vigent: number; employment_links_status_active_and_vigent: number;
  textual_unambiguous_active: number; textual_unambiguous_historical: number;
  active_usage_total: number; historical_usage_total: number;
  requirement_count: number;
}
interface DuplicateCluster {
  normalized_name: string; role_count: number;
  roles: Array<{ id: string; name: string; code: string | null; is_active: boolean; active_usage: number; historical_usage: number; requirement_count: number }>;
}
interface AmbiguousCluster {
  normalized_name: string;
  total_occurrences: number; active_occurrences: number; historical_occurrences: number;
  candidate_job_roles: Array<{ id: string; name: string }>;
}
interface GhostRow {
  source: string; normalized: string; sample_text: string;
  occurrences: number; active_occurrences: number; historical_occurrences: number;
  workers_affected: number; events_affected: number; groups_affected: number;
  first_seen: string | null; last_seen: string | null;
  best: { id: string; name: string; score: number } | null; best_score: number;
  second: { id: string; name: string; score: number } | null; second_score: number;
  score_delta: number; candidates_above_threshold: number;
  match_confidence: string;
}
interface ConflictRow { allocation_id: string; link_group_id: string | null; event_id: string | null; worker_id: string; job_role_text: string; job_function_text: string; is_active: boolean }
interface NoUseRow { id: string; name: string; code: string | null; is_active: boolean; historical_usage_total: number; requirement_count: number }
interface OriginRow { id: string; name: string; created_at: string | null; created_by: string | null; first_insert_at: string | null; first_insert_by: string | null; origin: string; origin_evidence: Record<string, unknown> | null }
interface OperationalFlags { alloc_vigent?: boolean; group_status?: string | null; group_vigent?: boolean; event_status?: string | null; event_vigent?: boolean }
interface DivergentSample extends OperationalFlags { allocation_id: string; employment_link_id: string; worker_id: string; trabalhador: string | null; event_id: string | null; evento: string | null; link_group_id: string | null; grupo: string | null; alloc_role_text: string | null; link_role_id: string | null; link_role_name: string | null; allocation_status: string | null; employment_link_status: string | null }
interface OrphanSample extends OperationalFlags { allocation_id: string; worker_id: string; trabalhador: string | null; event_id: string | null; evento: string | null; link_group_id: string | null; grupo: string | null; alloc_role_text: string | null }
interface AmbiguousSample { allocation_id: string; worker_id: string; trabalhador: string | null; event_id: string | null; evento: string | null; link_group_id: string | null; grupo: string | null; candidate_count: number; candidates: CandidateRef[]; allocation_status: string | null; alloc_vigent?: boolean }
interface MultiAllocSample { employment_link_id: string; worker_id: string | null; event_id: string | null; evento: string | null; link_role_name: string | null; active_alloc_count: number; distinct_active_roles: number; allocations: Array<{ allocation_id: string; alloc_role_text: string | null; link_group_id: string | null; group_name: string | null; active: boolean }> }
interface StatusDistEntry { total: number; not_deleted: number }
interface PairBucket { pairs_with_0: number; pairs_with_1: number; pairs_with_gt1: number }

interface HygieneReport {
  generated_at: string;
  strategy: {
    match_key: string;
    current_link_criteria_used_for_classification: string;
    alternative_current_link_criteria: Record<string, string>;
    active_allocation_criteria: string;
    cardinality_rule: string;
    role_comparison_rule: string;
    operational_context_flags_available: string;
    unique_worker_event_index_present: boolean;
    similarity_threshold: number;
    safe_suggestion_rule: string;
    origin_rule: string;
    textual_usage_rule: string;
    today: string;
  };
  summary: {
    catalog_size: number; catalog_active: number; catalog_inactive: number; catalog_with_zero_active_use: number;
    duplicate_clusters: number; ambiguous_textual_clusters: number;
    ghost_texts: number; ghost_occurrences_total: number;
    allocation_conflicts_total: number; allocation_conflicts_active: number; allocation_conflicts_historical: number;
    total_allocations_distinct: number; active_allocations: number; historical_allocations: number;
    unique_matches_total: number; unique_matches_active: number; unique_matches_historical: number;
    orphan_allocations_total: number; orphan_allocations_active: number; orphan_allocations_historical: number;
    ambiguous_allocations_total: number; ambiguous_allocations_active: number; ambiguous_allocations_historical: number;
    equal_role_total: number; equal_role_active: number; equal_role_historical: number;
    divergent_role_total: number; divergent_role_active: number; divergent_role_historical: number;
    allocation_role_missing_total: number; allocation_role_missing_active: number;
    link_role_missing_total: number; link_role_missing_active: number;
    both_roles_missing_total: number; both_roles_missing_active: number;
    worker_event_pairs_with_multiple_current_links: number;
    links_with_multiple_allocations: number;
    links_with_multiple_active_allocations: number;
    links_with_distinct_allocation_roles: number;
    links_with_distinct_active_allocation_roles: number;
    employment_links_by_status: Record<string, StatusDistEntry>;
    employment_links_not_deleted_total: number;
    employment_links_vigent_total: number;
    employment_links_status_active_total: number;
    employment_links_status_active_and_vigent_total: number;
    worker_event_candidate_distribution: {
      not_deleted: PairBucket; vigent: PairBucket;
      status_active: PairBucket; status_active_and_vigent: PairBucket;
    };
    input_allocation_rows: number;
    classified_allocation_rows: number;
    cardinality_ok: boolean;
  };
  catalog: CatalogRow[];
  duplicates: DuplicateCluster[];
  ambiguous_textual_clusters: AmbiguousCluster[];
  ghost_texts: GhostRow[];
  allocation_conflicts: ConflictRow[];
  no_active_use: NoUseRow[];
  origin: OriginRow[];
  link_allocation_relationship: {
    divergent_role_samples_active: DivergentSample[];
    orphan_samples_active: OrphanSample[];
    ambiguous_samples: AmbiguousSample[];
    links_with_multiple_active_allocations_distinct_roles: MultiAllocSample[];
  };
}

// CSV injection hardening: neutralize cells that begin with =, +, -, @, \t or \r
// after stripping ONLY leading SPACE characters (preserve and detect tab/CR).
function neutralizeCsvCell(raw: string): string {
  const trimmedStart = raw.replace(/^ +/, "");
  if (/^[=+\-@\t\r]/.test(trimmedStart)) return "'" + raw;
  return raw;
}
function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const raw = typeof v === "object" ? JSON.stringify(v) : String(v);
    const s = neutralizeCsvCell(raw);
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\n");
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const blob = new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SettingsJobRolesHygiene() {
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["job-roles-hygiene-dry-run"],
    enabled: open,
    staleTime: 0,
    queryFn: async (): Promise<HygieneReport> => {
      const { data, error } = await supabase.rpc("dry_run_job_roles_hygiene" as never);
      if (error) throw error;
      return data as unknown as HygieneReport;
    },
  });

  const report = q.data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" /> Relatório de higiene de cargos (dry-run)
            </CardTitle>
            <CardDescription>
              Somente leitura. Não cria, altera, inativa, remove ou faz merge. Base para decidir a fonte única de cargo.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {!open ? (
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <ChevronRight className="mr-1 h-4 w-4" /> Abrir relatório
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
                  {q.isFetching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                  Rodar novamente
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  <ChevronDown className="mr-1 h-4 w-4" /> Recolher
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          {q.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Gerando relatório…
            </div>
          )}
          {q.error && (
            <Alert variant="destructive">
              <AlertDescription>
                Falha ao gerar relatório: {(q.error as Error).message}
              </AlertDescription>
            </Alert>
          )}

          {report && (
            <>
              <div className="text-xs text-muted-foreground">
                Gerado em {new Date(report.generated_at).toLocaleString("pt-BR")}
              </div>

              {/* Resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-sm">
                <SummaryTile label="Cargos" value={report.summary.catalog_size} sub={`${report.summary.catalog_active} ativos`} />
                <SummaryTile label="Sem uso ativo" value={report.summary.catalog_with_zero_active_use} tone={report.summary.catalog_with_zero_active_use > 0 ? "warn" : "ok"} />
                <SummaryTile label="Clusters duplicados" value={report.summary.duplicate_clusters} tone={report.summary.duplicate_clusters > 0 ? "warn" : "ok"} />
                <SummaryTile label="Textos fantasmas" value={report.summary.ghost_texts} sub={`${report.summary.ghost_occurrences_total} ocorrências`} tone={report.summary.ghost_texts > 0 ? "warn" : "ok"} />
                <SummaryTile label="Conflitos cargo × função (ativos)" value={report.summary.allocation_conflicts_active} sub={`${report.summary.allocation_conflicts_total} totais`} tone={report.summary.allocation_conflicts_active > 0 ? "warn" : "ok"} />
                <SummaryTile label="Divergentes ativas" value={report.summary.divergent_role_active} sub={`${report.summary.divergent_role_total} totais`} tone={report.summary.divergent_role_active > 0 ? "warn" : "ok"} />
                <SummaryTile label="Alocações (distintas)" value={report.summary.total_allocations_distinct} sub={`${report.summary.active_allocations} ativas · ${report.summary.historical_allocations} hist.`} />
                <SummaryTile label="Unique match" value={report.summary.unique_matches_total} sub={`${report.summary.unique_matches_active} ativas`} />
                <SummaryTile label="Órfãs (0 candidatos)" value={report.summary.orphan_allocations_total} sub={`${report.summary.orphan_allocations_active} ativas`} tone={report.summary.orphan_allocations_active > 0 ? "warn" : "ok"} />
                <SummaryTile label="Ambíguas (>1 candidato)" value={report.summary.ambiguous_allocations_total} sub={`${report.summary.ambiguous_allocations_active} ativas`} tone={report.summary.ambiguous_allocations_active > 0 ? "warn" : "ok"} />
                <SummaryTile label="Cargo faltante (aloc/vínc/ambos)" value={`${report.summary.allocation_role_missing_active}/${report.summary.link_role_missing_active}/${report.summary.both_roles_missing_active}`} sub="ativos" />
                <SummaryTile label="Vínc. c/ múltiplas alocações ativas c/ cargos distintos" value={report.summary.links_with_distinct_active_allocation_roles} tone={report.summary.links_with_distinct_active_allocation_roles > 0 ? "warn" : "ok"} />
                <SummaryTile label="Pares (worker+event) c/ >1 vínculo corrente" value={report.summary.worker_event_pairs_with_multiple_current_links} tone={report.summary.worker_event_pairs_with_multiple_current_links > 0 ? "warn" : "ok"} />
              </div>

              {/* Estratégia de casamento */}
              <div className="rounded-md border p-3 text-xs space-y-1 bg-muted/30">
                <div className="font-medium text-sm">Estratégia de casamento e critérios</div>
                <div><span className="text-muted-foreground">Chave:</span> {report.strategy.match_key}</div>
                <div><span className="text-muted-foreground">Vínculo corrente:</span> {report.strategy.current_link_criteria}</div>
                <div><span className="text-muted-foreground">Alocação ativa:</span> {report.strategy.active_allocation_criteria}</div>
                <div><span className="text-muted-foreground">Cardinalidade:</span> {report.strategy.cardinality_rule}</div>
                <div><span className="text-muted-foreground">Comparação de cargo:</span> {report.strategy.role_comparison_rule}</div>
                <div>
                  <span className="text-muted-foreground">Índice único (worker_id, event_id) em employment_links:</span>{" "}
                  {report.strategy.unique_worker_event_index_present ? "presente" : (
                    <Badge variant="outline">ausente — não há garantia estrutural de unicidade</Badge>
                  )}
                </div>
                <div><span className="text-muted-foreground">Similaridade:</span> limiar {report.strategy.similarity_threshold}; regra segura: {report.strategy.safe_suggestion_rule}</div>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Este relatório apenas <strong>sinaliza</strong>. Nenhum cargo é criado, renomeado, inativado, excluído ou consolidado. Passos 2 a 5 (bloqueio, uso/inativação, merge, migração de <code>link_group_workers</code>) permanecem bloqueados até a fonte única de cargo (vínculo × alocação) ser decidida com base neste relatório.
                </AlertDescription>
              </Alert>

              <Accordion type="multiple" defaultValue={["catalog", "link_alloc"]} className="w-full">
                {/* Catálogo */}
                <AccordionItem value="catalog">
                  <AccordionTrigger>Catálogo oficial ({report.catalog.length})</AccordionTrigger>
                  <AccordionContent>
                    <div className="flex justify-end mb-2">
                      <Button size="sm" variant="outline" onClick={() => downloadCsv("job-roles-catalog.csv", report.catalog as unknown as Array<Record<string, unknown>>)}>
                        <Download className="mr-1 h-4 w-4" /> Exportar CSV
                      </Button>
                    </div>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Código</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Vínculos ativos</TableHead>
                            <TableHead className="text-right">Vínculos hist.</TableHead>
                            <TableHead className="text-right">Alocações ativas (role)</TableHead>
                            <TableHead className="text-right">Alocações hist. (role)</TableHead>
                            <TableHead className="text-right">Uso em função</TableHead>
                            <TableHead className="text-right">Requisitos</TableHead>
                            <TableHead>Origem</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.catalog.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-medium">{r.name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{r.code ?? "—"}</TableCell>
                              <TableCell>
                                {r.is_active ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
                              </TableCell>
                              <TableCell className="text-right">{r.employment_links_active}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{r.employment_links_historical}</TableCell>
                              <TableCell className="text-right">{r.lgw_role_active}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{r.lgw_role_historical}</TableCell>
                              <TableCell className="text-right">{r.lgw_function_active + r.employment_links_function_active}</TableCell>
                              <TableCell className="text-right">{r.requirement_count}</TableCell>
                              <TableCell className="text-xs">{r.origin}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Duplicidades */}
                <AccordionItem value="duplicates">
                  <AccordionTrigger>Duplicidades sugeridas ({report.duplicates.length})</AccordionTrigger>
                  <AccordionContent>
                    {report.duplicates.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum cluster encontrado por nome normalizado.</p>
                    ) : (
                      <div className="space-y-3">
                        {report.duplicates.map((c) => (
                          <div key={c.normalized_name} className="rounded-md border p-3">
                            <div className="text-sm font-medium mb-2">
                              “{c.normalized_name}” <span className="text-muted-foreground">— {c.role_count} variações</span>
                            </div>
                            <div className="space-y-1 text-sm">
                              {c.roles.map((r) => (
                                <div key={r.id} className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">{r.name}</span>
                                  {!r.is_active && <Badge variant="outline">Inativo</Badge>}
                                  <span className="text-xs text-muted-foreground">
                                    ativo: {r.active_usage} · hist.: {r.historical_usage} · req.: {r.requirement_count}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Fantasmas */}
                <AccordionItem value="ghosts">
                  <AccordionTrigger>Cargos fantasmas ({report.ghost_texts.length})</AccordionTrigger>
                  <AccordionContent>
                    <div className="flex justify-end mb-2">
                      <Button size="sm" variant="outline" onClick={() => downloadCsv("job-roles-ghosts.csv", report.ghost_texts.map((g) => ({
                        source: g.source, normalized: g.normalized, sample_text: g.sample_text,
                        occurrences: g.occurrences, active_occurrences: g.active_occurrences, historical_occurrences: g.historical_occurrences,
                        workers_affected: g.workers_affected, events_affected: g.events_affected, groups_affected: g.groups_affected,
                        best: g.best ? `${g.best.name} (${g.best.id})` : "",
                        best_score: g.best_score,
                        second: g.second ? `${g.second.name} (${g.second.id})` : "",
                        second_score: g.second_score,
                        score_delta: g.score_delta,
                        candidates_above_threshold: g.candidates_above_threshold,
                        match_confidence: g.match_confidence,
                      })))}>
                        <Download className="mr-1 h-4 w-4" /> Exportar CSV
                      </Button>
                    </div>
                    {report.ghost_texts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum texto livre sem correspondência.</p>
                    ) : (
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Origem</TableHead>
                              <TableHead>Texto</TableHead>
                              <TableHead className="text-right">Ocorrências</TableHead>
                              <TableHead className="text-right">Ativas</TableHead>
                              <TableHead>Melhor candidato</TableHead>
                              <TableHead className="text-right">Score 1º</TableHead>
                              <TableHead>2º candidato</TableHead>
                              <TableHead className="text-right">Score 2º</TableHead>
                              <TableHead className="text-right">Δ</TableHead>
                              <TableHead className="text-right"># ≥ limiar</TableHead>
                              <TableHead>Confiança</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.ghost_texts.map((g, i) => (
                              <TableRow key={`${g.source}-${g.normalized}-${i}`}>
                                <TableCell className="text-xs">{g.source}</TableCell>
                                <TableCell className="font-medium">{g.sample_text}</TableCell>
                                <TableCell className="text-right">{g.occurrences}</TableCell>
                                <TableCell className="text-right">{g.active_occurrences}</TableCell>
                                <TableCell className="text-xs">{g.best ? g.best.name : "—"}</TableCell>
                                <TableCell className="text-right text-xs">{g.best ? g.best_score.toFixed(2) : "—"}</TableCell>
                                <TableCell className="text-xs">{g.second ? g.second.name : "—"}</TableCell>
                                <TableCell className="text-right text-xs">{g.second ? g.second_score.toFixed(2) : "—"}</TableCell>
                                <TableCell className="text-right text-xs">{g.score_delta.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-xs">{g.candidates_above_threshold}</TableCell>
                                <TableCell className="text-xs">
                                  {g.match_confidence === "sugestao_segura" ? <Badge variant="secondary">segura</Badge>
                                    : g.match_confidence === "sugestao_ambigua" ? <Badge variant="outline">ambígua</Badge>
                                    : g.match_confidence === "sugestao_por_similaridade" ? <Badge variant="outline">similaridade</Badge>
                                    : <Badge variant="outline">sem correspondência segura</Badge>}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Conflitos cargo × função */}
                <AccordionItem value="conflicts">
                  <AccordionTrigger>Cargo × função divergentes na mesma alocação ({report.allocation_conflicts.length})</AccordionTrigger>
                  <AccordionContent>
                    <div className="flex justify-end mb-2">
                      <Button size="sm" variant="outline" onClick={() => downloadCsv("allocation-conflicts.csv", report.allocation_conflicts as unknown as Array<Record<string, unknown>>)}>
                        <Download className="mr-1 h-4 w-4" /> Exportar CSV
                      </Button>
                    </div>
                    {report.allocation_conflicts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum conflito interno na alocação.</p>
                    ) : (
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Alocação</TableHead>
                              <TableHead>Cargo (job_role)</TableHead>
                              <TableHead>Função (job_function)</TableHead>
                              <TableHead>Ativa</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.allocation_conflicts.map((c) => (
                              <TableRow key={c.allocation_id}>
                                <TableCell className="text-xs font-mono">{c.allocation_id.slice(0, 8)}…</TableCell>
                                <TableCell>{c.job_role_text}</TableCell>
                                <TableCell>{c.job_function_text}</TableCell>
                                <TableCell>{c.is_active ? <Badge variant="secondary">ativa</Badge> : <Badge variant="outline">hist.</Badge>}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Sem uso ativo */}
                <AccordionItem value="no_use">
                  <AccordionTrigger>Sem uso ativo ({report.no_active_use.length})</AccordionTrigger>
                  <AccordionContent>
                    {report.no_active_use.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Todos os cargos ativos possuem uso ativo.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Uso histórico</TableHead>
                            <TableHead className="text-right">Requisitos</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.no_active_use.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-medium">{r.name}</TableCell>
                              <TableCell>{r.is_active ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</TableCell>
                              <TableCell className="text-right">{r.historical_usage_total}</TableCell>
                              <TableCell className="text-right">{r.requirement_count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Origem */}
                <AccordionItem value="origin">
                  <AccordionTrigger>Origem dos cargos ({report.origin.length})</AccordionTrigger>
                  <AccordionContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Criado em</TableHead>
                          <TableHead>Autor</TableHead>
                          <TableHead>Origem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.origin.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell className="text-xs">{r.created_at ? new Date(r.created_at).toLocaleString("pt-BR") : "—"}</TableCell>
                            <TableCell className="text-xs font-mono">{r.created_by ? r.created_by.slice(0, 8) + "…" : "—"}</TableCell>
                            <TableCell className="text-xs">
                              {r.origin}
                              {r.origin_evidence && (
                                <span className="ml-1 text-muted-foreground">
                                  · {typeof r.origin_evidence["events"] === "number" ? `${r.origin_evidence["events"]} evento(s)` : "com evidência"}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>

                {/* Vínculo × Alocação */}
                <AccordionItem value="link_alloc">
                  <AccordionTrigger>Vínculo × alocação (amostras decisórias)</AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        Uma linha por alocação. Casos com <strong>múltiplos vínculos candidatos</strong> não são resolvidos automaticamente — aparecem como <code>ambiguous_match</code>. A comparação de cargo só se aplica quando há um único candidato.
                      </AlertDescription>
                    </Alert>

                    {/* Divergências ativas */}
                    <SampleTable
                      title={`Divergências ativas (${report.link_allocation_relationship.divergent_role_samples_active.length})`}
                      filename="link-alloc-divergent-active.csv"
                      rows={report.link_allocation_relationship.divergent_role_samples_active as unknown as Array<Record<string, unknown>>}
                      headers={["Alocação", "Trabalhador", "Evento", "Grupo", "Cargo (aloc)", "Cargo (vínc)", "Status aloc/vínc"]}
                      renderRow={(d: DivergentSample) => [
                        <span className="font-mono text-xs">{d.allocation_id.slice(0, 8)}…</span>,
                        d.trabalhador ?? d.worker_id.slice(0, 8) + "…",
                        d.evento ?? "—",
                        d.grupo ?? "—",
                        d.alloc_role_text ?? "—",
                        d.link_role_name ?? "—",
                        `${d.allocation_status ?? "—"} / ${d.employment_link_status ?? "—"}`,
                      ]}
                    />

                    {/* Órfãs ativas */}
                    <SampleTable
                      title={`Órfãs ativas (${report.link_allocation_relationship.orphan_samples_active.length})`}
                      filename="link-alloc-orphans-active.csv"
                      rows={report.link_allocation_relationship.orphan_samples_active as unknown as Array<Record<string, unknown>>}
                      headers={["Alocação", "Trabalhador", "Evento", "Grupo", "Cargo (aloc)"]}
                      renderRow={(o: OrphanSample) => [
                        <span className="font-mono text-xs">{o.allocation_id.slice(0, 8)}…</span>,
                        o.trabalhador ?? o.worker_id.slice(0, 8) + "…",
                        o.evento ?? "—",
                        o.grupo ?? "—",
                        o.alloc_role_text ?? "—",
                      ]}
                    />

                    {/* Ambíguas */}
                    <SampleTable
                      title={`Correspondências ambíguas (${report.link_allocation_relationship.ambiguous_samples.length})`}
                      filename="link-alloc-ambiguous.csv"
                      rows={report.link_allocation_relationship.ambiguous_samples.map((a) => ({
                        allocation_id: a.allocation_id, worker_id: a.worker_id, trabalhador: a.trabalhador,
                        event_id: a.event_id, evento: a.evento, candidate_count: a.candidate_count,
                        candidate_employment_link_ids: a.candidates.map((c) => c.employment_link_id).join("|"),
                        candidate_roles: a.candidates.map((c) => c.role_name ?? "—").join("|"),
                        candidate_statuses: a.candidates.map((c) => c.status ?? "—").join("|"),
                        allocation_status: a.allocation_status,
                      })) as unknown as Array<Record<string, unknown>>}
                      headers={["Alocação", "Trabalhador", "Evento", "# candidatos", "Vínculos candidatos", "Cargos", "Status"]}
                      renderRow={(a: AmbiguousSample) => [
                        <span className="font-mono text-xs">{a.allocation_id.slice(0, 8)}…</span>,
                        a.trabalhador ?? a.worker_id.slice(0, 8) + "…",
                        a.evento ?? "—",
                        a.candidate_count,
                        <span className="text-xs">{a.candidates.map((c) => c.employment_link_id.slice(0, 8) + "…").join(", ")}</span>,
                        <span className="text-xs">{a.candidates.map((c) => c.role_name ?? "—").join(" | ")}</span>,
                        <span className="text-xs">{a.candidates.map((c) => c.status ?? "—").join(" | ")}</span>,
                      ]}
                    />

                    {/* Vínculos com múltiplas alocações ativas com cargos distintos */}
                    <SampleTable
                      title={`Vínculos com múltiplas alocações ativas e cargos distintos (${report.link_allocation_relationship.links_with_multiple_active_allocations_distinct_roles.length})`}
                      filename="links-multi-active-distinct-roles.csv"
                      rows={report.link_allocation_relationship.links_with_multiple_active_allocations_distinct_roles.map((m) => ({
                        employment_link_id: m.employment_link_id,
                        worker_id: m.worker_id, event_id: m.event_id, link_role_name: m.link_role_name,
                        active_alloc_count: m.active_alloc_count, distinct_active_roles: m.distinct_active_roles,
                        allocation_ids: m.allocations.map((a) => a.allocation_id).join("|"),
                        allocation_role_texts: m.allocations.map((a) => a.alloc_role_text ?? "—").join("|"),
                        link_group_ids: m.allocations.map((a) => a.link_group_id ?? "—").join("|"),
                      })) as unknown as Array<Record<string, unknown>>}
                      headers={["Vínculo", "Cargo (vínc)", "# ativas", "# cargos distintos", "Alocações"]}
                      renderRow={(m: MultiAllocSample) => [
                        <span className="font-mono text-xs">{m.employment_link_id.slice(0, 8)}…</span>,
                        m.link_role_name ?? "—",
                        m.active_alloc_count,
                        m.distinct_active_roles,
                        <span className="text-xs">{m.allocations.map((a) => `${a.allocation_id.slice(0, 6)}… (${a.alloc_role_text ?? "—"})`).join(", ")}</span>,
                      ]}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function SummaryTile({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: "ok" | "warn" }) {
  const toneClass =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-50 dark:bg-amber-950/20"
      : tone === "ok"
      ? "border-emerald-500/30"
      : "";
  return (
    <div className={`rounded-md border p-2 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function SampleTable<T>({
  title, filename, rows, headers, renderRow,
}: {
  title: string;
  filename: string;
  rows: Array<Record<string, unknown>>;
  headers: string[];
  renderRow: (row: T) => React.ReactNode[];
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        <div className="text-sm font-medium mb-1 text-foreground">{title}</div>
        Sem registros neste grupo.
      </div>
    );
  }
  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/40">
        <div className="text-xs font-medium">{title}</div>
        <Button size="sm" variant="outline" onClick={() => downloadCsv(filename, rows)}>
          <Download className="mr-1 h-4 w-4" /> Exportar CSV
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>{headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {(rows as unknown as T[]).map((r, i) => (
            <TableRow key={i}>
              {renderRow(r).map((cell, j) => <TableCell key={j}>{cell as React.ReactNode}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}