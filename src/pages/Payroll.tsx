import { useState } from "react";
import { Link } from "react-router-dom";
import { usePayrollBatches } from "@/hooks/usePayroll";
import { useEvents } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Loader2 } from "lucide-react";

const statusLabel: Record<string, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
  paid: "Pago",
  cancelled: "Cancelado",
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  approved: "secondary",
  paid: "default",
  cancelled: "destructive",
};

export default function Payroll() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const { data: batches, isLoading } = usePayrollBatches(search, statusFilter, eventFilter);
  const { data: events } = useEvents("", "all");
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);

  const fmt = (v: number | null) =>
    v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold text-foreground">Pagamentos</h1>
        {canCreate && (
          <Button asChild size="sm">
            <Link to="/payroll/new"><Plus className="mr-1 h-4 w-4" /> Novo Lote</Link>
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar lote…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="approved">Aprovado</SelectItem>
            <SelectItem value="paid">Pago</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={eventFilter} onValueChange={setEventFilter}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Evento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os eventos</SelectItem>
            {events?.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !batches?.length ? (
        <div className="text-center py-12 text-muted-foreground">Nenhum lote encontrado.</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="hidden sm:table-cell">Evento</TableHead>
                <TableHead className="hidden md:table-cell">Mês Ref.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden sm:table-cell">Pago em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link to={`/payroll/${b.id}`} className="font-medium text-primary hover:underline">
                      {b.batch_name}
                    </Link>
                    <p className="sm:hidden text-xs text-muted-foreground">{(b.events as any)?.name || ""}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{(b.events as any)?.name || "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{b.reference_month || "—"}</TableCell>
                  <TableCell><Badge variant={statusVariant[b.status] || "outline"}>{statusLabel[b.status] || b.status}</Badge></TableCell>
                  <TableCell className="text-right">{fmt(b.total_amount)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{b.paid_at ? new Date(b.paid_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
