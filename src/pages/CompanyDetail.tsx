import { useParams, useNavigate } from "react-router-dom";
import { useCompany } from "@/hooks/useCompanies";
import { useEventsByCompany } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import { formatPhone } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Pencil, Loader2 } from "lucide-react";

function formatCnpj(cnpj: string | null): string {
  if (!cnpj) return "—";
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return cnpj;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

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

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: company, isLoading } = useCompany(id);
  const { data: events } = useEventsByCompany(id);
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager"]);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!company) {
    return <p className="py-8 text-center text-muted-foreground">Empresa não encontrada.</p>;
  }

  const info = (label: string, value: string | null | undefined, mono = false) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm ${mono ? "font-mono" : ""}`}>{value || "—"}</p>
    </div>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/companies")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{company.legal_name}</h1>
            {company.trade_name && <p className="text-sm text-muted-foreground">{company.trade_name}</p>}
          </div>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/companies/${id}/edit`)}>
            <Pencil className="mr-1 h-3 w-3" /> Editar
          </Button>
        )}
      </div>

      <Tabs defaultValue="dados" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="eventos">Eventos</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Razão Social", company.legal_name)}
              {info("Nome Fantasia", company.trade_name)}
              {info("CNPJ", formatCnpj(company.cnpj), true)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contato</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Telefone", company.phone ? formatPhone(company.phone) : null)}
              {info("E-mail", company.email)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Endereço</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Endereço", company.address)}
              {info("Cidade", company.city)}
              {info("UF", company.state)}
            </CardContent>
          </Card>

          {company.notes && (
            <Card>
              <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{company.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="eventos" className="mt-4">
          {!events?.length ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum evento vinculado a esta empresa.
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead className="hidden sm:table-cell">Período</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((ev) => (
                    <TableRow key={ev.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/events/${ev.id}`)}>
                      <TableCell className="font-medium">{ev.name}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {ev.start_date ? new Date(ev.start_date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                        {ev.end_date ? ` — ${new Date(ev.end_date + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(ev.status)}>{statusLabels[ev.status] || ev.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
