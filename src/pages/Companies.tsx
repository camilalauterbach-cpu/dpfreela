import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompanies } from "@/hooks/useCompanies";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Loader2 } from "lucide-react";

function formatCnpj(cnpj: string | null): string {
  if (!cnpj) return "—";
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return cnpj;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

export default function Companies() {
  const [search, setSearch] = useState("");
  const { data: companies, isLoading } = useCompanies(search);
  const { hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasAnyRole(["admin", "manager"]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Empresas</h1>
        {canCreate && (
          <Button size="sm" onClick={() => navigate("/companies/new")}>
            <Plus className="mr-1 h-4 w-4" /> Nova
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por razão social, nome fantasia ou CNPJ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !companies?.length ? (
        <p className="py-8 text-center text-muted-foreground">
          {search ? "Nenhuma empresa encontrada." : "Nenhuma empresa cadastrada."}
        </p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Razão Social</TableHead>
                <TableHead className="hidden sm:table-cell">Nome Fantasia</TableHead>
                <TableHead className="hidden md:table-cell">CNPJ</TableHead>
                <TableHead className="hidden lg:table-cell">Cidade/UF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/companies/${c.id}`)}>
                  <TableCell className="font-medium">
                    <div>
                      <span>{c.legal_name}</span>
                      <span className="sm:hidden text-xs text-muted-foreground ml-1">
                        {c.trade_name ? `(${c.trade_name})` : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">{c.trade_name || "—"}</TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-sm">{formatCnpj(c.cnpj)}</TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {[c.city, c.state].filter(Boolean).join("/") || "—"}
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
