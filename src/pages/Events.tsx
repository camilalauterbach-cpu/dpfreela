import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEvents } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TablePagination } from "@/components/TablePagination";
import { Search, Plus, Loader2, Filter, X } from "lucide-react";

const statusLabels: Record<string, string> = {
  planned: "Planejado",
  active: "Ativo",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const statusVariant = (s: string) => {
  if (s === "active") return "default" as const;
  if (s === "confirmed") return "default" as const;
  if (s === "completed") return "secondary" as const;
  if (s === "cancelled") return "destructive" as const;
  return "outline" as const;
};

export default function Events() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [city, setCity] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);

  const { data: result, isLoading } = useEvents(
    { search, status: statusFilter, dateFrom, dateTo, city },
    page
  );
  const { hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasAnyRole(["admin", "manager"]);

  const events = result?.data;
  const hasActiveFilters = !!dateFrom || !!dateTo || !!city;

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setCity("");
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Eventos</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="relative"
          >
            <Filter className="mr-1 h-4 w-4" /> Filtros
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] text-primary-foreground flex items-center justify-center">
                {[dateFrom, dateTo, city].filter(Boolean).length}
              </span>
            )}
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => navigate("/events/new")}>
              <Plus className="mr-1 h-4 w-4" /> Novo
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome do evento..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="planned">Planejado</SelectItem>
            <SelectItem value="active">Ativo</SelectItem>
            <SelectItem value="confirmed">Confirmado</SelectItem>
            <SelectItem value="completed">Concluído</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {showFilters && (
        <div className="flex flex-col sm:flex-row gap-2 p-3 rounded-lg border bg-muted/30">
          <Input
            placeholder="Filtrar por cidade..."
            value={city}
            onChange={(e) => { setCity(e.target.value); setPage(0); }}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Input
              type="date"
              placeholder="Data início"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
              className="w-full sm:w-[150px]"
            />
            <Input
              type="date"
              placeholder="Data fim"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
              className="w-full sm:w-[150px]"
            />
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 h-3 w-3" /> Limpar
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !events?.length ? (
        <p className="py-8 text-center text-muted-foreground">
          {search || statusFilter !== "all" || hasActiveFilters ? "Nenhum evento encontrado." : "Nenhum evento cadastrado."}
        </p>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden sm:table-cell">Empresa</TableHead>
                  <TableHead className="hidden md:table-cell">Período</TableHead>
                  <TableHead className="hidden lg:table-cell">Cidade/UF</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/events/${ev.id}`)}>
                    <TableCell className="font-medium">{ev.name}</TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {(ev.companies as any)?.legal_name || "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {ev.start_date ? new Date(ev.start_date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                      {ev.end_date ? ` — ${new Date(ev.end_date + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {[ev.city, ev.state].filter(Boolean).join("/") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(ev.status)}>{statusLabels[ev.status] || ev.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {result && (
            <TablePagination
              page={page}
              totalCount={result.count}
              pageSize={result.pageSize}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
