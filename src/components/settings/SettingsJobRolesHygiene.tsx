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

interface CatalogRow {
  id: string;
  code: string | null;
  name: string;
  is_active: boolean;
  created_at: string | null;
  created_by: string | null;
  origin_hint: string;
  employment_links_active: number;
  employment_links_historical: number;
  lgw_role_active: number;
  lgw_role_historical: number;
  lgw_function_active: number;
  lgw_function_historical: number;
  employment_links_function_active: number;
  employment_links_function_historical: number;
  active_usage_total: number;
  historical_usage_total: number;
  requirement_count: number;
}
interface DuplicateCluster {
  normalized_name: string;
  role_count: number;
  roles: Array<{ id: string; name: string; code: string | null; is_active: boolean; active_usage: number; historical_usage: number; requirement_count: number }>;
}
interface GhostRow {
  source: string;
  normalized: string;
  sample_text: string;
  occurrences: number;
  active_occurrences: number;
  historical_occurrences: number;
  workers_affected: number;
  events_affected: number;
  groups_affected: number;
  first_seen: string | null;
  last_seen: string | null;
  suggestion: { id: string; name: string } | null;
  match_confidence: string;
}
interface ConflictRow {
  allocation_id: string;
  link_group_id: string | null;
  event_id: string | null;
  worker_id: string;
  job_role_text: string;
  job_function_text: string;
  is_active: boolean;
}
interface NoUseRow {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  historical_usage_total: number;
  requirement_count: number;
}
interface OriginRow {
  id: string;
  name: string;
  created_at: string | null;
  created_by: string | null;
  origin_hint: string;
}
interface LinkAllocReport {
  summary: {
    total_allocations: number;
    matched_to_link: number;
    orphan_allocations: number;
    divergent_role: number;
    consistent_role: number;
    distinct_worker_event_pairs: number;
  };
  links_with_multiple_allocations: Array<{ employment_link_id: string; allocation_count: number }>;
  links_with_divergent_allocation_roles: Array<{ employment_link_id: string }>;
  orphan_allocations: Array<{ allocation_id: string; worker_id: string; event_id: string | null; link_group_id: string | null; alloc_role_text: string; active: boolean }>;
  divergent_role_samples: Array<{ allocation_id: string; employment_link_id: string; worker_id: string; event_id: string | null; alloc_role_text: string; link_role_name: string; active: boolean }>;
}
interface HygieneReport {
  generated_at: string;
  summary: {
    catalog_size: number;
    catalog_active: number;
    catalog_inactive: number;
    catalog_with_zero_active_use: number;
    duplicate_clusters: number;
    ghost_texts: number;
    ghost_occurrences_total: number;
    allocation_conflicts: number;
    link_allocation: LinkAllocReport["summary"];
    links_with_multiple_allocations: number;
    links_with_divergent_allocation_roles: number;
  };
  catalog: CatalogRow[];
  duplicates: DuplicateCluster[];
  ghost_texts: GhostRow[];
  allocation_conflicts: ConflictRow[];
  no_active_use: NoUseRow[];
  origin: OriginRow[];
  link_allocation_relationship: LinkAllocReport;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
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
                <SummaryTile label="Conflitos cargo × função" value={report.summary.allocation_conflicts} tone={report.summary.allocation_conflicts > 0 ? "warn" : "ok"} />
                <SummaryTile label="Alocações divergentes do vínculo" value={report.summary.link_allocation?.divergent_role ?? 0} tone={(report.summary.link_allocation?.divergent_role ?? 0) > 0 ? "warn" : "ok"} />
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
                              <TableCell className="text-xs">{r.origin_hint}</TableCell>
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
                      <Button size="sm" variant="outline" onClick={() => downloadCsv("job-roles-ghosts.csv", report.ghost_texts.map((g) => ({ ...g, suggestion: g.suggestion ? `${g.suggestion.name} (${g.suggestion.id})` : "" })))}>
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
                              <TableHead className="text-right">Hist.</TableHead>
                              <TableHead className="text-right">Trab.</TableHead>
                              <TableHead className="text-right">Eventos</TableHead>
                              <TableHead>Sugestão</TableHead>
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
                                <TableCell className="text-right text-muted-foreground">{g.historical_occurrences}</TableCell>
                                <TableCell className="text-right">{g.workers_affected}</TableCell>
                                <TableCell className="text-right">{g.events_affected}</TableCell>
                                <TableCell className="text-xs">{g.suggestion ? g.suggestion.name : "—"}</TableCell>
                                <TableCell className="text-xs">
                                  {g.match_confidence === "sugestao_por_similaridade"
                                    ? <Badge variant="secondary">sugestão</Badge>
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
                            <TableCell className="text-xs">{r.origin_hint}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>

                {/* Vínculo × Alocação */}
                <AccordionItem value="link_alloc">
                  <AccordionTrigger>Relação vínculo × alocação</AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-sm mb-4">
                      <SummaryTile label="Alocações totais" value={report.link_allocation_relationship.summary.total_allocations} />
                      <SummaryTile label="Casadas com vínculo" value={report.link_allocation_relationship.summary.matched_to_link} />
                      <SummaryTile label="Órfãs (sem vínculo)" value={report.link_allocation_relationship.summary.orphan_allocations} tone={report.link_allocation_relationship.summary.orphan_allocations > 0 ? "warn" : "ok"} />
                      <SummaryTile label="Consistentes com vínculo" value={report.link_allocation_relationship.summary.consistent_role} />
                      <SummaryTile label="Divergentes do vínculo" value={report.link_allocation_relationship.summary.divergent_role} tone={report.link_allocation_relationship.summary.divergent_role > 0 ? "warn" : "ok"} />
                      <SummaryTile label="Vínculos c/ múltiplas alocações" value={report.summary.links_with_multiple_allocations} />
                    </div>

                    <p className="text-sm text-muted-foreground mb-2">
                      Decisão arquitetural pendente: se toda alocação herda o cargo do vínculo → fonte única é <code>employment_links.job_role_id</code>. Se um mesmo vínculo tem alocações com cargos diferentes → <code>link_group_workers</code> precisa de <code>job_role_id</code> próprio e o vínculo assume papel contratual.
                    </p>

                    {report.link_allocation_relationship.divergent_role_samples.length > 0 && (
                      <div className="rounded-md border overflow-x-auto mb-3">
                        <div className="px-3 py-2 text-xs font-medium bg-muted/40">Amostras de divergência (alocação × vínculo)</div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Alocação</TableHead>
                              <TableHead>Cargo na alocação (texto)</TableHead>
                              <TableHead>Cargo no vínculo</TableHead>
                              <TableHead>Ativa</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.link_allocation_relationship.divergent_role_samples.slice(0, 50).map((d) => (
                              <TableRow key={d.allocation_id}>
                                <TableCell className="text-xs font-mono">{d.allocation_id.slice(0, 8)}…</TableCell>
                                <TableCell>{d.alloc_role_text}</TableCell>
                                <TableCell>{d.link_role_name}</TableCell>
                                <TableCell>{d.active ? <Badge variant="secondary">ativa</Badge> : <Badge variant="outline">hist.</Badge>}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {report.link_allocation_relationship.orphan_allocations.length > 0 && (
                      <div className="rounded-md border overflow-x-auto">
                        <div className="px-3 py-2 text-xs font-medium bg-muted/40">Alocações órfãs (sem vínculo correspondente no mesmo evento)</div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Alocação</TableHead>
                              <TableHead>Cargo (texto)</TableHead>
                              <TableHead>Ativa</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.link_allocation_relationship.orphan_allocations.slice(0, 50).map((o) => (
                              <TableRow key={o.allocation_id}>
                                <TableCell className="text-xs font-mono">{o.allocation_id.slice(0, 8)}…</TableCell>
                                <TableCell>{o.alloc_role_text}</TableCell>
                                <TableCell>{o.active ? <Badge variant="secondary">ativa</Badge> : <Badge variant="outline">hist.</Badge>}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
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