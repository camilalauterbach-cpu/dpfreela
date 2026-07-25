// Dashboard: agrega telemetria de revisões canônicas de worker_documents
// (commits, lock_acquired, idempotent_hit) por dia e por document_type.
// Fonte: RPC public.get_revision_metrics_daily. Restrito a admin/manager.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface MetricRow {
  day: string;
  document_type_id: string | null;
  document_type_code: string | null;
  document_type_name: string | null;
  commits_count: number;
  lock_acquired_count: number;
  idempotent_hit_count: number;
  avg_lock_wait_ms: number | null;
  max_lock_wait_ms: number | null;
}

function toDateInput(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export default function RevisionMetrics() {
  const { hasAnyRole, loading } = useAuth();
  const canView = hasAnyRole(["admin", "manager"]);

  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInput(d);
  }, []);
  const defaultTo = useMemo(() => toDateInput(new Date()), []);

  const [from, setFrom] = useState<string>(defaultFrom);
  const [to, setTo] = useState<string>(defaultTo);
  const [documentTypeId, setDocumentTypeId] = useState<string>("");

  const docTypesQ = useQuery({
    queryKey: ["revision-metrics", "document-types"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_types")
        .select("id, code, name")
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const metricsQ = useQuery({
    queryKey: ["revision-metrics", from, to, documentTypeId],
    enabled: canView && !!from && !!to,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_revision_metrics_daily", {
        p_from: from,
        p_to: to,
        p_document_type_id: documentTypeId ? documentTypeId : null,
      });
      if (error) throw error;
      return ((data ?? []) as unknown) as MetricRow[];
    },
  });

  const totals = useMemo(() => {
    const rows = metricsQ.data ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.commits += Number(r.commits_count ?? 0);
        acc.locks += Number(r.lock_acquired_count ?? 0);
        acc.idempotent += Number(r.idempotent_hit_count ?? 0);
        if (r.max_lock_wait_ms != null) {
          acc.maxWait = Math.max(acc.maxWait, Number(r.max_lock_wait_ms));
        }
        return acc;
      },
      { commits: 0, locks: 0, idempotent: 0, maxWait: 0 }
    );
  }, [metricsQ.data]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Métricas de revisões</h1>
        <p className="text-sm text-muted-foreground">
          Contagens diárias de commits, locks adquiridos e idempotent hits por tipo de documento.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="from">De</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="to">Até</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Tipo de documento</Label>
            <Select
              value={documentTypeId || "all"}
              onValueChange={(v) => setDocumentTypeId(v === "all" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(docTypesQ.data ?? []).map((dt: any) => (
                  <SelectItem key={dt.id} value={dt.id}>
                    {dt.code} — {dt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Commits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{totals.commits}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Locks adquiridos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{totals.locks}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Idempotent hits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{totals.idempotent}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Máx. lock wait (ms)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{totals.maxWait || "—"}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Séries diárias</CardTitle>
        </CardHeader>
        <CardContent>
          {metricsQ.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : metricsQ.error ? (
            <p className="text-sm text-destructive">
              Erro ao carregar métricas: {(metricsQ.error as Error).message}
            </p>
          ) : (metricsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum evento no período selecionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Commits</TableHead>
                    <TableHead className="text-right">Locks</TableHead>
                    <TableHead className="text-right">Idempotent</TableHead>
                    <TableHead className="text-right">Avg wait (ms)</TableHead>
                    <TableHead className="text-right">Max wait (ms)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(metricsQ.data ?? []).map((row, idx) => (
                    <TableRow key={`${row.day}-${row.document_type_id ?? "null"}-${idx}`}>
                      <TableCell className="font-mono text-xs">{row.day}</TableCell>
                      <TableCell>
                        {row.document_type_code ? (
                          <div className="flex flex-col">
                            <Badge variant="secondary" className="w-fit">{row.document_type_code}</Badge>
                            <span className="text-xs text-muted-foreground">{row.document_type_name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">— sem tipo —</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{row.commits_count}</TableCell>
                      <TableCell className="text-right">{row.lock_acquired_count}</TableCell>
                      <TableCell className="text-right">{row.idempotent_hit_count}</TableCell>
                      <TableCell className="text-right">{row.avg_lock_wait_ms ?? "—"}</TableCell>
                      <TableCell className="text-right">{row.max_lock_wait_ms ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}