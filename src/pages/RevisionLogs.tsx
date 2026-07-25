// Diagnóstico: consulta de change_logs por worker + document_type,
// exibindo revision_id, trace_id e eventos de lock/idempotência.
// Restrito a admin/manager (RLS de change_logs).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, Copy, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { neutralizeCsvCell } from "@/lib/qualifications-export";

interface LogRow {
  id: string;
  action: string;
  record_id: string | null;
  created_at: string;
  new_data: any;
  changed_by: string | null;
}

const EVENT_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  "revision.lock_acquired": { label: "Lock adquirido", variant: "secondary" },
  "revision.lock_released": { label: "Lock liberado", variant: "outline" },
  "revision.idempotent_hit": { label: "Idempotent hit", variant: "default" },
  "revision.created": { label: "Revisão criada", variant: "default" },
  "revision.superseded": { label: "Revisão substituída", variant: "outline" },
};

export default function RevisionLogs() {
  const { hasAnyRole, loading } = useAuth();
  const { toast } = useToast();
  const [workerSearch, setWorkerSearch] = useState("");
  const [selectedWorker, setSelectedWorker] = useState<{ id: string; name: string } | null>(null);
  const [documentTypeId, setDocumentTypeId] = useState<string>("");

  const canView = hasAnyRole(["admin", "manager"]);

  const docTypesQ = useQuery({
    queryKey: ["revision-logs-doc-types"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_types")
        .select("id, code, name, category")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const workersQ = useQuery({
    queryKey: ["revision-logs-workers", workerSearch],
    enabled: canView && workerSearch.trim().length >= 2,
    queryFn: async () => {
      const term = workerSearch.trim().replace(/[(),%_\\]/g, " ");
      const { data, error } = await supabase
        .from("workers")
        .select("id, full_name, cpf")
        .is("deleted_at", null)
        .ilike("full_name", `%${term}%`)
        .order("full_name")
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const logsQ = useQuery({
    queryKey: ["revision-logs", selectedWorker?.id, documentTypeId],
    enabled: canView && !!selectedWorker?.id && !!documentTypeId,
    queryFn: async () => {
      // change_logs.new_data contém worker_id + document_type_id nas revisões.
      const { data, error } = await supabase
        .from("change_logs")
        .select("id, action, record_id, created_at, new_data, changed_by")
        .eq("table_name", "worker_documents")
        .contains("new_data", {
          worker_id: selectedWorker!.id,
          document_type_id: documentTypeId,
        })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, LogRow[]>();
    for (const row of logsQ.data ?? []) {
      const trace = row.new_data?.trace_id ?? "sem-trace";
      if (!map.has(trace)) map.set(trace, []);
      map.get(trace)!.push(row);
    }
    return Array.from(map.entries());
  }, [logsQ.data]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!canView) return <Navigate to="/" replace />;

  const copyJson = (payload: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast({ title: "Copiado", description: "Payload copiado para a área de transferência." });
  };

  const exportCsv = () => {
    if (!selectedWorker || !documentTypeId) return;
    const rows = logsQ.data ?? [];
    if (rows.length === 0) {
      toast({ title: "Sem dados", description: "Nenhum evento para exportar." });
      return;
    }

    const header = [
      "trace_id",
      "revision_id",
      "worker_id",
      "document_type_id",
      "event_count",
      "lock_acquired_at",
      "lock_released_at",
      "lock_duration_ms",
      "idempotent_hit",
      "revision_created_at",
      "revision_superseded_at",
      "actions",
    ];

    const lines: string[] = [header.join(",")];

    for (const [traceId, group] of grouped) {
      const sorted = group.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      const first = sorted[0];
      const revisionId =
        sorted.find((r) => r.new_data?.revision_id)?.new_data?.revision_id ??
        first?.record_id ??
        "";
      const lockAcq = sorted.find((r) => r.action === "revision.lock_acquired");
      const lockRel = sorted.find((r) => r.action === "revision.lock_released");
      const idem = sorted.find((r) => r.action === "revision.idempotent_hit");
      const created = sorted.find((r) => r.action === "revision.created");
      const superseded = sorted.find((r) => r.action === "revision.superseded");
      const duration = lockRel?.new_data?.duration_ms;
      const actions = sorted.map((r) => r.action).join("|");

      const fields = [
        traceId,
        String(revisionId ?? ""),
        selectedWorker.id,
        documentTypeId,
        String(sorted.length),
        lockAcq?.created_at ?? "",
        lockRel?.created_at ?? "",
        typeof duration === "number" ? String(duration) : "",
        idem ? "yes" : "no",
        created?.created_at ?? "",
        superseded?.created_at ?? "",
        actions,
      ];

      lines.push(
        fields
          .map((v) => {
            const safe = neutralizeCsvCell(v ?? "");
            return `"${String(safe).replace(/"/g, '""')}"`;
          })
          .join(","),
      );
    }

    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `revision-logs_${selectedWorker.id.slice(0, 8)}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Logs de Revisão Documental</h1>
        <p className="text-sm text-muted-foreground">
          Consulta de eventos de <code>register_worker_document_revision</code> por trabalhador e tipo de documento.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label className="text-xs">Trabalhador</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={selectedWorker ? selectedWorker.name : workerSearch}
                  onChange={(e) => {
                    setWorkerSearch(e.target.value);
                    setSelectedWorker(null);
                  }}
                  placeholder="Buscar por nome (mín. 2 letras)"
                />
              </div>
              {workerSearch.length >= 2 && !selectedWorker && (
                <div className="mt-1 border border-border rounded-md bg-background max-h-56 overflow-auto">
                  {workersQ.isLoading ? (
                    <div className="p-2 text-xs text-muted-foreground">Buscando...</div>
                  ) : (workersQ.data ?? []).length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">Nenhum resultado</div>
                  ) : (
                    (workersQ.data ?? []).map((w: any) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => {
                          setSelectedWorker({ id: w.id, name: w.full_name });
                          setWorkerSearch(w.full_name);
                        }}
                        className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        {w.full_name}
                        {w.cpf && <span className="text-xs text-muted-foreground ml-2">{w.cpf}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Tipo de documento</Label>
              <Select value={documentTypeId} onValueChange={setDocumentTypeId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {(docTypesQ.data ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} {t.code ? `· ${t.code}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {selectedWorker && documentTypeId && (
            <div className="text-xs text-muted-foreground">
              worker_id: <code>{selectedWorker.id}</code> · document_type_id: <code>{documentTypeId}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedWorker && documentTypeId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Eventos {logsQ.data ? `(${logsQ.data.length})` : ""}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={!(logsQ.data && logsQ.data.length > 0)}
              >
                <Download className="h-3 w-3 mr-1" />
                Exportar CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => logsQ.refetch()}>
                Atualizar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {logsQ.isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : logsQ.error ? (
              <p className="text-sm text-destructive">
                Erro: {(logsQ.error as any)?.message ?? String(logsQ.error)}
              </p>
            ) : (logsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento encontrado.</p>
            ) : (
              <div className="space-y-4">
                {grouped.map(([traceId, rows]) => {
                  const revisionId =
                    rows.find((r) => r.new_data?.revision_id)?.new_data?.revision_id ??
                    rows[0].record_id;
                  const lockAcq = rows.find((r) => r.action === "revision.lock_acquired");
                  const lockRel = rows.find((r) => r.action === "revision.lock_released");
                  const idem = rows.find((r) => r.action === "revision.idempotent_hit");
                  const duration = lockRel?.new_data?.duration_ms;
                  return (
                    <div key={traceId} className="rounded-md border border-border">
                      <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/30 border-b border-border">
                        <span className="text-xs text-muted-foreground">trace_id:</span>
                        <code className="text-xs">{traceId}</code>
                        <span className="text-xs text-muted-foreground ml-2">revision_id:</span>
                        <code className="text-xs">{revisionId ?? "—"}</code>
                        <div className="ml-auto flex flex-wrap gap-1">
                          {lockAcq && <Badge variant="secondary" className="text-xs">lock ✓</Badge>}
                          {lockRel && (
                            <Badge variant="outline" className="text-xs">
                              liberado{typeof duration === "number" ? ` ${duration}ms` : ""}
                            </Badge>
                          )}
                          {idem && <Badge className="text-xs">idempotent hit</Badge>}
                        </div>
                      </div>
                      <div className="divide-y divide-border">
                        {rows
                          .slice()
                          .sort((a, b) => a.created_at.localeCompare(b.created_at))
                          .map((r) => {
                            const meta = EVENT_LABELS[r.action];
                            return (
                              <div key={r.id} className="p-3 text-sm flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Badge variant={meta?.variant ?? "outline"} className="text-xs">
                                      {meta?.label ?? r.action}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(r.created_at).toLocaleString("pt-BR")}
                                    </span>
                                  </div>
                                  <pre className="mt-2 text-xs bg-muted/40 rounded p-2 overflow-auto max-h-40">
{JSON.stringify(r.new_data, null, 2)}
                                  </pre>
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 shrink-0"
                                  onClick={() => copyJson(r.new_data)}
                                  aria-label="Copiar payload"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}