import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEmploymentLinks } from "@/hooks/useEmploymentLinks";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Search } from "lucide-react";

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

export default function Links() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: links, isLoading } = useEmploymentLinks(search, statusFilter);
  const { hasAnyRole } = useAuth();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Vínculos</h1>
        {canCreate && (
          <Button size="sm" onClick={() => navigate("/links/new")}>
            <Plus className="mr-1 h-4 w-4" /> Novo
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, evento ou vínculo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
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

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !links?.length ? (
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
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(links as any[]).map((link) => {
                const workerName = (link.workers as any)?.full_name || "—";
                const workerNick = (link.workers as any)?.nickname;
                const eventName = (link.events as any)?.name || "—";
                const displayName = link.link_name || `${workerName} — ${eventName}`;

                return (
                  <TableRow
                    key={link.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/links/${link.id}`)}
                  >
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
