import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkers } from "@/hooks/useWorkers";
import { formatCpf, formatPhone } from "@/lib/validators";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Loader2 } from "lucide-react";

export default function Workers() {
  const [search, setSearch] = useState("");
  const { data: workers, isLoading } = useWorkers(search);
  const { hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Trabalhadores</h1>
        {canCreate && (
          <Button size="sm" onClick={() => navigate("/workers/new")}>
            <Plus className="mr-1 h-4 w-4" /> Novo
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, apelido, CPF ou telefone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !workers?.length ? (
        <p className="py-8 text-center text-muted-foreground">
          {search ? "Nenhum trabalhador encontrado." : "Nenhum trabalhador cadastrado."}
        </p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="hidden sm:table-cell">Apelido</TableHead>
                <TableHead className="hidden md:table-cell">CPF</TableHead>
                <TableHead className="hidden sm:table-cell">Telefone</TableHead>
                <TableHead className="hidden lg:table-cell">Cidade/UF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((w) => (
                <TableRow key={w.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/workers/${w.id}`)}>
                  <TableCell className="font-medium">
                    <div>
                      <span>{w.full_name}</span>
                      <span className="sm:hidden text-xs text-muted-foreground ml-1">
                        {w.nickname ? `(${w.nickname})` : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">{w.nickname || "—"}</TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-sm">{formatCpf(w.cpf)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{w.phone_main ? formatPhone(w.phone_main) : "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {[w.city, w.state].filter(Boolean).join("/") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
