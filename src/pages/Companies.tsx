import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompanies } from "@/hooks/useCompanies";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/TablePagination";
import { Search, Plus, Loader2, Filter, X } from "lucide-react";

const UF_OPTIONS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

function formatCnpj(cnpj: string | null): string {
  if (!cnpj) return "—";
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return cnpj;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

export default function Companies() {
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const { data: result, isLoading } = useCompanies({ search, city, state }, page);
  const { hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasAnyRole(["admin", "manager"]);

  const companies = result?.data;
  const hasActiveFilters = !!city || !!state;

  const clearFilters = () => {
    setCity("");
    setState("");
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Empresas</h1>
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
                {[city, state].filter(Boolean).length}
              </span>
            )}
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => navigate("/companies/new")}>
              <Plus className="mr-1 h-4 w-4" /> Nova
            </Button>
          )}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por razão social, nome fantasia ou CNPJ..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="pl-9"
        />
      </div>

      {showFilters && (
        <div className="flex flex-col sm:flex-row gap-2 p-3 rounded-lg border bg-muted/30">
          <Input
            placeholder="Filtrar por cidade..."
            value={city}
            onChange={(e) => { setCity(e.target.value); setPage(0); }}
            className="flex-1"
          />
          <Select value={state || "all"} onValueChange={(v) => { setState(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-[120px]">
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos UFs</SelectItem>
              {UF_OPTIONS.map((uf) => (
                <SelectItem key={uf} value={uf}>{uf}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      ) : !companies?.length ? (
        <p className="py-8 text-center text-muted-foreground">
          {search || hasActiveFilters ? "Nenhuma empresa encontrada." : "Nenhuma empresa cadastrada."}
        </p>
      ) : (
        <>
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
