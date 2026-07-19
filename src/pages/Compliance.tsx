import { useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLinkComplianceList } from "@/hooks/useLinkComplianceList";
import type { ComplianceOverall } from "@/hooks/useLinkCompliance";
import { OVERALL_LABEL } from "@/hooks/useLinkCompliance";
import { ComplianceBadge } from "@/components/compliance/ComplianceBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, FileSpreadsheet, Search, X, Loader2 } from "lucide-react";
import {
  exportComplianceCSV, exportComplianceXLSX,
} from "@/lib/compliance-export";

const OVERALL_OPTIONS: { value: ComplianceOverall; label: string }[] = [
  { value: "apto", label: OVERALL_LABEL.apto },
  { value: "atencao", label: OVERALL_LABEL.atencao },
  { value: "bloqueado", label: OVERALL_LABEL.bloqueado },
];

export default function Compliance() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const compliance = (params.get("compliance") as ComplianceOverall | null) || null;
  const doc = params.get("doc") || null;
  const jobRoleId = params.get("job_role_id") || null;
  const search = params.get("q") || "";

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v == null || v === "") next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  const clearAll = () => setParams({}, { replace: true });

  const { data: jobRoles } = useQuery({
    queryKey: ["job-roles-select"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_roles")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: docTypes } = useQuery({
    queryKey: ["doc-types-select"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_types")
        .select("code, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: result, isLoading, isFetching } = useLinkComplianceList({
    compliance,
    doc,
    jobRoleId,
    search,
    limit: 500,
    offset: 0,
  });

  const items = result?.items ?? [];
  const hasFilters = !!(compliance || doc || jobRoleId || search);

  const summary = useMemo(() => {
    const total = items.length;
    const bloqueados = items.filter((i) => i.overall === "bloqueado").length;
    const atencao = items.filter((i) => i.overall === "atencao").length;
    const aptos = items.filter((i) => i.overall === "apto").length;
    return { total, bloqueados, atencao, aptos };
  }, [items]);

  // Reset scroll on filter change
  useEffect(() => { window.scrollTo(0, 0); }, [compliance, doc, jobRoleId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Conformidade</h1>
          <p className="text-xs text-muted-foreground">
            {summary.total} vínculos · {summary.aptos} aptos · {summary.atencao} atenção · {summary.bloqueados} bloqueados
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm" variant="outline"
            onClick={() => exportComplianceCSV(items)}
            disabled={!items.length}
          >
            <Download className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">CSV</span>
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={() => exportComplianceXLSX(items)}
            disabled={!items.length}
          >
            <FileSpreadsheet className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Excel</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar trabalhador ou cargo…"
            value={search}
            onChange={(e) => setParam("q", e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={compliance ?? "all"} onValueChange={(v) => setParam("compliance", v === "all" ? null : v)}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Conformidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {OVERALL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={jobRoleId ?? "all"} onValueChange={(v) => setParam("job_role_id", v === "all" ? null : v)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Cargo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os cargos</SelectItem>
            {jobRoles?.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={doc ?? "all"} onValueChange={(v) => setParam("doc", v === "all" ? null : v)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Documento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os documentos</SelectItem>
            {docTypes?.map((d) => (
              <SelectItem key={d.code} value={d.code}>{d.code} — {d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="mr-1 h-3 w-3" /> Limpar
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !items.length ? (
        <p className="py-8 text-center text-muted-foreground">
          Nenhum vínculo encontrado com os filtros atuais.
        </p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trabalhador</TableHead>
                <TableHead className="hidden sm:table-cell">Cargo</TableHead>
                <TableHead className="text-center">Conformidade</TableHead>
                <TableHead className="hidden md:table-cell text-center">Docs</TableHead>
                <TableHead className="hidden lg:table-cell text-center">% Válidos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow
                  key={it.link_id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/workers/${it.worker_id}`)}
                >
                  <TableCell className="font-medium">
                    <div>
                      <p className="text-sm">{it.worker_name}</p>
                      <p className="text-xs text-muted-foreground sm:hidden">
                        {it.job_role_name ?? "—"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm">
                    {it.job_role_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    <ComplianceBadge tone={it.overall === "apto" ? "success" : it.overall === "atencao" ? "warning" : "danger"}>
                      {OVERALL_LABEL[it.overall]}
                    </ComplianceBadge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-center text-xs tabular-nums">
                    {it.score.valid}/{it.score.required}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-center text-sm font-semibold tabular-nums">
                    {it.score.percent.toFixed(0)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isFetching && !isLoading && (
        <div className="flex justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}