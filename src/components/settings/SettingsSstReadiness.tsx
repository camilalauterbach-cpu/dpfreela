// Fase 0A · Diagnóstico read-only de SST + Vínculos.
// Consome public.dry_run_sst_link_readiness(). Nenhuma mutação.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, ChevronDown, ChevronUp, Download, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Report = {
  schema_version: number;
  generated_at: string;
  summary: Record<string, number>;
  blockers: Array<{ code: string; severity: string; count: number; description: string; sample_ids: string[] }>;
  preservation_baseline: {
    group_worker_counts: Array<{ link_group_id: string; event_id: string; group_name: string; event_name: string; total: number; not_deleted: number; status_active: number; vigent: number }>;
    expected_rock_in_rio: number;
    expected_shakira: number;
    worker_sst_qualifications_total: number;
    worker_sst_qualifications_current: number;
  } & Record<string, number | unknown>;
  [key: string]: unknown;
};

export function SettingsSstReadiness() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("dry_run_sst_link_readiness" as never);
      if (error) throw error;
      setReport(data as Report);
      toast.success("Diagnóstico gerado (somente leitura).");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar diagnóstico.");
    } finally {
      setLoading(false);
    }
  }

  function exportJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sst-link-readiness-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Diagnóstico SST e vínculos</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Diagnóstico somente leitura. Nenhum certificado, vínculo ou requisito foi alterado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={run} disabled={loading} size="sm" className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Rodar diagnóstico
          </Button>
          <Button onClick={() => setCollapsed((v) => !v)} variant="outline" size="sm" disabled={!report} className="gap-2">
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            {collapsed ? "Expandir" : "Recolher"}
          </Button>
          <Button onClick={exportJson} variant="outline" size="sm" disabled={!report} className="gap-2">
            <Download className="h-4 w-4" /> Exportar JSON
          </Button>
        </div>
      </CardHeader>
      {report && !collapsed && (
        <CardContent className="space-y-4">
          <section>
            <h3 className="text-sm font-semibold">Resumo</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(report.summary).map(([k, v]) => (
                <div key={k} className="rounded border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">{k.replace(/_/g, " ")}</div>
                  <div className="text-lg font-semibold">{String(v)}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4" /> Blockers ({report.blockers.length})
            </h3>
            {report.blockers.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Sem bloqueadores.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {report.blockers.map((b, i) => (
                  <li key={i} className="rounded border p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant={b.severity === "critical" ? "destructive" : "secondary"}>{b.severity}</Badge>
                      <span className="font-mono">{b.code}</span>
                      <span className="text-muted-foreground">· {b.count}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{b.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold">Baseline de preservação</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-2">Evento</th>
                    <th className="py-1 pr-2">Grupo</th>
                    <th className="py-1 pr-2 text-right">Total</th>
                    <th className="py-1 pr-2 text-right">Ativos</th>
                    <th className="py-1 pr-2 text-right">Vigentes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.preservation_baseline.group_worker_counts.map((g) => (
                    <tr key={g.link_group_id} className="border-b">
                      <td className="py-1 pr-2">{g.event_name ?? "—"}</td>
                      <td className="py-1 pr-2">{g.group_name}</td>
                      <td className="py-1 pr-2 text-right">{g.total}</td>
                      <td className="py-1 pr-2 text-right">{g.status_active}</td>
                      <td className="py-1 pr-2 text-right">{g.vigent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Esperado: Rock in Rio = {report.preservation_baseline.expected_rock_in_rio} · Shakira = {report.preservation_baseline.expected_shakira}
            </p>
          </section>

          <details className="rounded border p-2 text-xs">
            <summary className="cursor-pointer font-medium">JSON integral</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap">{JSON.stringify(report, null, 2)}</pre>
          </details>

          <p className="text-[11px] text-muted-foreground">
            Gerado em {new Date(report.generated_at).toLocaleString("pt-BR")} · schema_version {report.schema_version}
          </p>
        </CardContent>
      )}
    </Card>
  );
}