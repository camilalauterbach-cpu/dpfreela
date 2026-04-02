import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useEmploymentLinks } from "@/hooks/useEmploymentLinks";
import { useCompanies } from "@/hooks/useCompanies";
import { useEvents } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Search, Download, FileText, FileSpreadsheet, FolderArchive } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { exportAdmissionXlsx } from "@/lib/export-admission";
import { exportWorkerDocsZip } from "@/lib/export-docs-zip";
import { getSystemSetting } from "@/lib/system-settings";

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

const daysLabel = (link: any) => {
  if (link.work_days_mode === "specific_dates" && link.specific_work_dates?.length > 0) {
    const dates = link.specific_work_dates.map((d: string) => formatDateBR(d));
    return dates.length <= 3 ? dates.join(", ") : `${dates.slice(0, 3).join(", ")}… (+${dates.length - 3})`;
  }
  return "Contínuo";
};

export default function Links() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportConfig, setExportConfig] = useState<any>(null);

  useEffect(() => {
    getSystemSetting("links_admission_config").then((val) => setExportConfig(val));
  }, []);

  const { data: links, isLoading } = useEmploymentLinks(search, statusFilter);
  const { data: companies } = useCompanies("");
  const { data: events } = useEvents("", "all");
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);
  const navigate = useNavigate();

  // Build event→company map
  const eventCompanyMap = useMemo(() => {
    const m = new Map<string, string>();
    (events as any[])?.forEach((ev) => {
      if (ev.company_id) m.set(ev.id, ev.company_id);
    });
    return m;
  }, [events]);

  const eventNameMap = useMemo(() => {
    const m = new Map<string, string>();
    (events as any[])?.forEach((ev) => m.set(ev.id, ev.name));
    return m;
  }, [events]);

  const companyNameMap = useMemo(() => {
    const m = new Map<string, string>();
    (companies as any[])?.forEach((c) => m.set(c.id, c.trade_name || c.legal_name));
    return m;
  }, [companies]);

  const filteredLinks = useMemo(() => {
    if (!links) return [];
    let result = links as any[];

    if (companyFilter !== "all") {
      result = result.filter((l) => {
        const cid = l.event_id ? eventCompanyMap.get(l.event_id) : null;
        return cid === companyFilter;
      });
    }

    if (eventFilter !== "all") {
      result = result.filter((l) => l.event_id === eventFilter);
    }

    if (periodStart) {
      result = result.filter((l) => !l.end_date || l.end_date >= periodStart);
    }
    if (periodEnd) {
      result = result.filter((l) => !l.hire_date || l.hire_date <= periodEnd);
    }

    return result;
  }, [links, companyFilter, eventFilter, periodStart, periodEnd, eventCompanyMap]);

  const getCompanyName = (link: any) => {
    const cid = link.event_id ? eventCompanyMap.get(link.event_id) : null;
    return cid ? companyNameMap.get(cid) || "—" : "—";
  };

  const getExportRows = () =>
    filteredLinks.map((link: any) => ({
      vinculo: link.link_name || `${(link.workers as any)?.full_name || "—"} — ${(link.events as any)?.name || "—"}`,
      trabalhador: (link.workers as any)?.full_name || "—",
      empresa: getCompanyName(link),
      evento: (link.events as any)?.name || "—",
      funcao: link.job_role || "—",
      periodo: `${formatDateBR(link.hire_date)} – ${formatDateBR(link.end_date)}`,
      dias: daysLabel(link),
      status: statusLabels[link.status] || link.status,
    }));

  const exportCSV = () => {
    const rows = getExportRows();
    const headers = ["Vínculo", "Trabalhador", "Empresa", "Evento", "Função", "Período", "Dias", "Status"];
    const csvContent = [
      headers.join(";"),
      ...rows.map((r) => [r.vinculo, r.trabalhador, r.empresa, r.evento, r.funcao, r.periodo, r.dias, r.status].join(";")),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vinculos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const rows = getExportRows();
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    doc.setFontSize(14);
    doc.text("Relatório de Vínculos", 14, 15);

    const filters: string[] = [];
    if (companyFilter !== "all") filters.push(`Empresa: ${companyNameMap.get(companyFilter) || companyFilter}`);
    if (eventFilter !== "all") filters.push(`Evento: ${eventNameMap.get(eventFilter) || eventFilter}`);
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
      head: [["Vínculo", "Trabalhador", "Empresa", "Evento", "Função", "Período", "Dias", "Status"]],
      body: rows.map((r) => [r.vinculo, r.trabalhador, r.empresa, r.evento, r.funcao, r.periodo, r.dias, r.status]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [50, 50, 50] },
    });

    doc.setFontSize(8);
    const finalY = (doc as any).lastAutoTable?.finalY || 200;
    doc.text(`Total: ${rows.length} vínculo${rows.length !== 1 ? "s" : ""}`, 14, finalY + 6);

    doc.save(`vinculos_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleAdmissionExport = useCallback(async () => {
    if (!filteredLinks.length) return;
    setExporting("xlsx");
    try {
      // Fetch full worker data for filtered links
      const workerIds = [...new Set(filteredLinks.map((l: any) => l.worker_id))];
      const { data: fullLinks, error } = await supabase
        .from("employment_links")
        .select("*, workers(*), events(name)")
        .in("id", filteredLinks.map((l: any) => l.id))
        .is("deleted_at", null);
      if (error) throw error;

      exportAdmissionXlsx({
        links: fullLinks || [],
        companyNameMap,
        eventCompanyMap,
        filePrefix: exportConfig?.export_file_prefix || "admissao",
        includeEmptyColumns: exportConfig?.export_include_empty_columns !== false,
      });
      toast.success("Planilha de admissão exportada!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao exportar admissão.");
    } finally {
      setExporting(null);
    }
  }, [filteredLinks, companyNameMap, eventCompanyMap]);

  const handleDocsZip = useCallback(async () => {
    if (!filteredLinks.length) return;
    setExporting("zip");
    try {
      const workerInfoMap = new Map<string, { full_name: string; cpf: string }>();
      const workerIds: string[] = [];
      filteredLinks.forEach((l: any) => {
        const w = l.workers;
        if (w && !workerInfoMap.has(l.worker_id)) {
          workerInfoMap.set(l.worker_id, { full_name: w.full_name || "", cpf: w.cpf || "" });
          workerIds.push(l.worker_id);
        }
      });
      const count = await exportWorkerDocsZip({ workerIds, workerInfoMap });
      toast.success(`ZIP com ${count} documento(s) baixado!`);
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar ZIP.");
    } finally {
      setExporting(null);
    }
  }, [filteredLinks]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Vínculos</h1>
        <div className="flex gap-1">
          {canCreate && (
            <Button size="sm" onClick={() => navigate("/links/new")}>
              <Plus className="mr-1 h-4 w-4" /> Novo
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, evento ou vínculo" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
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
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Empresa" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas empresas</SelectItem>
              {(companies as any[])?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Evento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos eventos</SelectItem>
              {(events as any[])?.map((ev) => (
                <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" placeholder="Início" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full sm:w-[140px]" />
          <Input type="date" placeholder="Fim" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full sm:w-[140px]" />
        </div>
        <div className="flex flex-wrap gap-1 justify-end">
          <Button size="sm" variant="outline" onClick={exportCSV} disabled={!filteredLinks.length || !!exporting}>
            <Download className="mr-1 h-3 w-3" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={exportPDF} disabled={!filteredLinks.length || !!exporting}>
            <FileText className="mr-1 h-3 w-3" /> PDF
          </Button>
          <Button size="sm" variant="outline" onClick={handleAdmissionExport} disabled={!filteredLinks.length || !!exporting}>
            {exporting === "xlsx" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileSpreadsheet className="mr-1 h-3 w-3" />} Admissão
          </Button>
          <Button size="sm" variant="outline" onClick={handleDocsZip} disabled={!filteredLinks.length || !!exporting}>
            {exporting === "zip" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FolderArchive className="mr-1 h-3 w-3" />} Docs ZIP
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !filteredLinks.length ? (
        <p className="py-8 text-center text-muted-foreground">Nenhum vínculo encontrado.</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vínculo</TableHead>
                <TableHead className="hidden sm:table-cell">Trabalhador</TableHead>
                <TableHead className="hidden sm:table-cell">Evento</TableHead>
                <TableHead className="hidden md:table-cell">Função</TableHead>
                <TableHead className="hidden lg:table-cell">Dias</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLinks.map((link: any) => {
                const workerName = (link.workers as any)?.full_name || "—";
                const workerNick = (link.workers as any)?.nickname;
                const eventName = (link.events as any)?.name || "—";
                const displayName = link.link_name || `${workerName} — ${eventName}`;

                return (
                  <TableRow key={link.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/links/${link.id}`)}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{displayName}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">
                          {workerName}{workerNick ? ` (${workerNick})` : ""} · {eventName}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {workerName}{workerNick ? ` (${workerNick})` : ""}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{eventName}</TableCell>
                    <TableCell className="hidden md:table-cell">{link.job_role || "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">{daysLabel(link)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(link.status)}>
                        {statusLabels[link.status] || link.status}
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
