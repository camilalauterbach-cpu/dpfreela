import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TablePagination } from "@/components/TablePagination";
import { Loader2, RotateCcw, Eye } from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 20;

const TABLE_OPTIONS = [
  "workers",
  "companies",
  "events",
  "employment_links",
  "link_groups",
  "link_group_workers",
  "worker_documents",
  "worker_payment_methods",
  "worker_dependents",
  "employment_link_documents",
  "payroll_batches",
  "payroll_batch_items",
  "payment_receipts",
  "system_settings",
  "user_roles",
];

const ACTION_COLORS: Record<string, string> = {
  insert: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  update: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  delete: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const ACTION_LABELS: Record<string, string> = {
  insert: "INSERT",
  update: "UPDATE",
  delete: "DELETE",
};

export function SettingsAudit() {
  const [page, setPage] = useState(0);
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["change_logs", page, tableFilter, userFilter, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from("change_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (tableFilter !== "all") query = query.eq("table_name", tableFilter);
      if (userFilter.trim()) query = query.eq("changed_by", userFilter.trim());
      if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
      if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

      const { data, count, error } = await query;
      if (error) throw error;
      return { data: data ?? [], count: count ?? 0 };
    },
  });

  // Fetch profiles to map user_id → name
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    data?.data?.forEach((l: any) => l.changed_by && ids.add(l.changed_by));
    return Array.from(ids);
  }, [data]);

  const { data: profiles } = useQuery({
    queryKey: ["audit_profiles", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return {};
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      const map: Record<string, string> = {};
      data?.forEach((p) => {
        map[p.user_id] = p.full_name || p.user_id.slice(0, 8);
      });
      return map;
    },
    enabled: userIds.length > 0,
  });

  const resetFilters = () => {
    setTableFilter("all");
    setUserFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auditoria do sistema</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Tabela</Label>
            <Select
              value={tableFilter}
              onValueChange={(v) => {
                setTableFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {TABLE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">User ID (UUID)</Label>
            <Input
              placeholder="ex: 8a2c..."
              value={userFilter}
              onChange={(e) => {
                setUserFilter(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-2">
            <RotateCcw className="h-3.5 w-3.5" /> Limpar filtros
          </Button>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.data.length ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            Nenhum registro encontrado
          </p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead className="hidden sm:table-cell">Tabela</TableHead>
                  <TableHead className="hidden md:table-cell">Usuário</TableHead>
                  <TableHead className="hidden lg:table-cell">Registro</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((log: any) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(log.created_at), "dd/MM/yy HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={ACTION_COLORS[log.action] || ""}
                      >
                        {ACTION_LABELS[log.action] || log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs font-mono">
                      {log.table_name}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs">
                      {log.changed_by
                        ? profiles?.[log.changed_by] ||
                          log.changed_by.slice(0, 8)
                        : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs font-mono text-muted-foreground">
                      {log.record_id?.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setSelectedLog(log)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <TablePagination
          page={page}
          totalCount={data?.count ?? 0}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </CardContent>

      {/* Detail dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(o) => !o && setSelectedLog(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da alteração</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Tabela</p>
                  <p className="font-mono">{selectedLog.table_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Ação</p>
                  <Badge
                    variant="outline"
                    className={ACTION_COLORS[selectedLog.action] || ""}
                  >
                    {ACTION_LABELS[selectedLog.action] || selectedLog.action}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Registro</p>
                  <p className="font-mono text-xs break-all">
                    {selectedLog.record_id}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Usuário</p>
                  <p className="font-mono text-xs break-all">
                    {selectedLog.changed_by
                      ? profiles?.[selectedLog.changed_by] || selectedLog.changed_by
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Data</p>
                  <p>
                    {format(
                      new Date(selectedLog.created_at),
                      "dd/MM/yyyy HH:mm:ss"
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">IP</p>
                  <p className="font-mono text-xs">
                    {selectedLog.ip_address || "—"}
                  </p>
                </div>
              </div>
              {selectedLog.old_data && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Dados anteriores
                  </p>
                  <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto max-h-64">
                    {JSON.stringify(selectedLog.old_data, null, 2)}
                  </pre>
                </div>
              )}
              {selectedLog.new_data && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Dados novos
                  </p>
                  <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto max-h-64">
                    {JSON.stringify(selectedLog.new_data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
