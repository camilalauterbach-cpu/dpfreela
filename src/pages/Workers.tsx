import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkers } from "@/hooks/useWorkers";
import { formatCpf, formatPhone } from "@/lib/validators";
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

export default function Workers() {
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [linkStatus, setLinkStatus] = useState<"" | "available" | "linked">("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const { data: result, isLoading } = useWorkers({ search, city, state, linkStatus }, page);
  const { hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasAnyRole(["admin", "manager", "operator"]);

  const workers = result?.data;
  const hasActiveFilters = !!city || !!state || !!linkStatus;

  const clearFilters = () => {
    setCity("");
    setState("");
    setLinkStatus("");
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Trabalhadores</h1>
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
                {[city, state, linkStatus].filter(Boolean).length}
              </span>
            )}
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => navigate("/workers/new")}>
              <Plus className="mr-1 h-4 w-4" /> Novo
            </Button>
          )}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, apelido, CPF ou telefone..."
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
          <Select
            value={linkStatus || "all"}
            onValueChange={(v) => { setLinkStatus((v === "all" ? "" : v) as "" | "available" | "linked"); setPage(0); }}
          >
            <SelectTrigger className="w-full sm:w-[220px]" title="Filtro informativo — pessoa sem vínculo permanece no banco mestre">
              <SelectValue placeholder="Vínculo atual" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos (padrão)</SelectItem>
              <SelectItem value="available">Disponíveis — sem vínculo atual</SelectItem>
              <SelectItem value="linked">Com vínculo atual</SelectItem>
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
      ) : !workers?.length ? (
        <p className="py-8 text-center text-muted-foreground">
          {search || hasActiveFilters ? "Nenhum trabalhador encontrado." : "Nenhum trabalhador cadastrado."}
        </p>
      ) : (
        <>
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
