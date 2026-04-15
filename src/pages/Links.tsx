import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLinkGroups } from "@/hooks/useLinkGroups";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Search, Download, FileText, Filter, X } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  suspended: "Suspenso",
  completed: "Concluído",
  terminated: "Encerrado",
  cancelled: "Cancelado",
};

const statusVariant = (s: string) => {
  if (s === "active") return "default" as const;
  if (s === "completed" || s === "terminated") return "secondary" as const;
  if (s === "cancelled") return "destructive" as const;
  return "outline" as const;
};

const formatDateBR = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

export default function Links() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const { data: groups, isLoading } = useLinkGroups(search, statusFilter);
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);
  const navigate = useNavigate();

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    let result = groups as any[];

    if (periodStart) {
      result = result.filter((g) => !g.end_date || g.end_date >= periodStart);
    }
    if (periodEnd) {
      result = result.filter((g) => !g.hire_date || g.hire_date <= periodEnd);
    }

    return result;
  }, [groups, periodStart, periodEnd]);

  const hasAdvancedFilters = !!periodStart || !!periodEnd;

  const clearAdvanced = () => {
    setPeriodStart("");
    setPeriodEnd("");
  };

  const getExportRows = () =>
    filteredGroups.map((g: any) => ({
      grupo: g.group_name,
      evento: (g.events as any)?.name || "—",
      empresa: (g.companies as any)?.trade_name || (g.companies as any)?.legal_name || "—",
      trabalhadores: String(g.worker_count || 0),
      periodo: `${formatDateBR(g.hire_date)} – ${formatDateBR(g.end_date)}`,
      status: statusLabels[g.status] || g.status,
    }));

  const exportCSV = () => {
    const rows = getExportRows();
    const headers = ["Grupo", "Evento", "Empresa", "Trabalhadores", "Período", "Status"];
    const csvContent = [
      headers.join(";"),
      ...rows.map((r) => [r.grupo, r.evento, r.empresa, r.trabalhadores, r.periodo, r.status].join(";")),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grupos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const rows = getExportRows();
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(14);
    doc.text("Relatório de Grupos de Vínculos", 14, 15);

    const filters: string[] = [];
    if (statusFilter !== "all") filters.push(`Status: ${statusLabels[statusFilter] || statusFilter}`);
    if (periodStart || periodEnd) filters.push(`Período: ${periodStart ? formatDateBR(periodStart) : "…"} – ${periodEnd ? formatDateBR(periodEnd) : "…"}`);
    if (filters.length) {
      doc.setFontSize(9);
      doc.text(`Filtros: ${filters.join(" | ")}`, 14, 21);
    }
    doc.setFontSize(8);
    doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, 14, filters.length ? 26 : 21);

    autoTable(doc, {
      startY: filters.length ? 30 : 25,
      head: [["Grupo", "Evento", "Empresa", "Trabalhadores", "Período", "Status"]],
      body: rows.map((r) => [r.grupo, r.evento, r.empresa, r.trabalhadores, r.periodo, r.status]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [50, 50, 50] },
    });

    doc.save(`grupos_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Grupos de Vínculos</h1>
        <div className="flex gap-1">
          {canCreate && (
            <Button size="sm" onClick={() => navigate("/links/new")}>
              <Plus className="mr-1 h-4 w-4" /> <span className="hidden sm:inline">Novo Grupo</span><span className="sm:hidden">Novo</span>
            </Button>
          )}
        </div>
      </div>

      {/* Search + Status */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por grupo ou evento" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="draft">Rascunho</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="suspended">Suspenso</SelectItem>
              <SelectItem value="completed">Concluído</SelectItem>
              <SelectItem value="terminated">Encerrado</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={showAdvanced ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="relative shrink-0"
          >
            <Filter className="mr-1 h-4 w-4" /> <span className="hidden sm:inline">Filtros</span>
            {hasAdvancedFilters && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] text-primary-foreground flex items-center justify-center">
                {[periodStart, periodEnd].filter(Boolean).length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div className="flex flex-col sm:flex-row gap-2 p-3 rounded-lg border bg-muted/30">
          <Input type="date" placeholder="Início" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full sm:w-[150px]" />
          <Input type="date" placeholder="Fim" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full sm:w-[150px]" />
          {hasAdvancedFilters && (
            <Button variant="ghost" size="sm" onClick={clearAdvanced}>
              <X className="mr-1 h-3 w-3" /> Limpar
            </Button>
          )}
          <div className="flex gap-1 sm:ml-auto">
            <Button size="sm" variant="outline" onClick={exportCSV} disabled={!filteredGroups.length}>
              <Download className="mr-1 h-3 w-3" /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={exportPDF} disabled={!filteredGroups.length}>
              <FileText className="mr-1 h-3 w-3" /> PDF
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !filteredGroups.length ? (
        <p className="py-8 text-center text-muted-foreground">Nenhum grupo encontrado.</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto -mx-3 sm:mx-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grupo</TableHead>
                <TableHead className="hidden sm:table-cell">Evento</TableHead>
                <TableHead className="hidden md:table-cell">Empresa</TableHead>
                <TableHead className="text-center">Trab.</TableHead>
                <TableHead className="hidden lg:table-cell">Período</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGroups.map((g: any) => {
                const eventName = (g.events as any)?.name || "—";
                const companyName = (g.companies as any)?.trade_name || (g.companies as any)?.legal_name || "—";

                return (
                  <TableRow key={g.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/links/${g.id}`)}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{g.group_name}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">{eventName}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{eventName}</TableCell>
                    <TableCell className="hidden md:table-cell">{companyName}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{g.worker_count}</Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">
                      {formatDateBR(g.hire_date)} – {formatDateBR(g.end_date)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(g.status)}>
                        {statusLabels[g.status] || g.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
