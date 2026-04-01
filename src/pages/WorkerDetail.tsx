import { useParams, useNavigate } from "react-router-dom";
import { useWorker, useWorkerPaymentMethods } from "@/hooks/useWorkers";
import { useAuth } from "@/contexts/AuthContext";
import { formatCpf, formatPhone } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Pencil, Loader2 } from "lucide-react";
import { PaymentMethodsList } from "@/components/workers/PaymentMethodsList";

export default function WorkerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: worker, isLoading } = useWorker(id);
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!worker) {
    return <p className="py-8 text-center text-muted-foreground">Trabalhador não encontrado.</p>;
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
          <Button variant="ghost" size="icon" onClick={() => navigate("/workers")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{worker.full_name}</h1>
            {worker.nickname && <p className="text-sm text-muted-foreground">{worker.nickname}</p>}
          </div>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/workers/${id}/edit`)}>
            <Pencil className="mr-1 h-3 w-3" /> Editar
          </Button>
        )}
      </div>

      <Tabs defaultValue="dados" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="pagamento">Pagamento</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="vinculos">Vínculos</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2 sm:grid-cols-3">
              {info("CPF", formatCpf(worker.cpf), true)}
              {info("RG", worker.rg)}
              {info("Data de nascimento", worker.birth_date ? new Date(worker.birth_date + "T12:00:00").toLocaleDateString("pt-BR") : null)}
              {info("Gênero", worker.gender)}
              {info("Estado civil", worker.marital_status)}
              {info("Nacionalidade", worker.nationality)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contato</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Telefone principal", worker.phone_main ? formatPhone(worker.phone_main) : null)}
              {info("Telefone secundário", worker.phone_secondary ? formatPhone(worker.phone_secondary) : null)}
              {info("E-mail", worker.email)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Endereço</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Endereço", worker.address)}
              {info("Bairro", worker.neighborhood)}
              {info("Cidade", worker.city)}
              {info("UF", worker.state)}
              {info("CEP", worker.zip_code)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Emergência</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Contato", worker.emergency_contact_name)}
              {info("Telefone", worker.emergency_contact_phone ? formatPhone(worker.emergency_contact_phone) : null)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Informações adicionais</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-3">
              {info("Camiseta", worker.shirt_size)}
              {info("Calçado", worker.shoe_size)}
              {info("Tipo sanguíneo", worker.blood_type)}
              <div className="col-span-3">{info("Alergias", worker.allergies)}</div>
              <div className="col-span-3">{info("Condições médicas", worker.medical_conditions)}</div>
              <div className="col-span-3">{info("Observações", worker.notes)}</div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pagamento" className="mt-4">
          <PaymentMethodsList workerId={worker.id} />
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Módulo de documentos — disponível na próxima fase.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vinculos" className="mt-4">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Módulo de vínculos — disponível na próxima fase.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
