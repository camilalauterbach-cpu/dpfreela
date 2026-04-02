import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorker } from "@/hooks/useWorkers";
import { useAuth } from "@/contexts/AuthContext";
import { formatCpf, formatPhone } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Pencil, Loader2 } from "lucide-react";
import { PaymentMethodsList } from "@/components/workers/PaymentMethodsList";
import { DocumentChecklist } from "@/components/workers/DocumentChecklist";
import { DpReadinessBadge } from "@/components/workers/DpReadinessBadge";

export default function WorkerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: worker, isLoading } = useWorker(id);
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);

  const { data: docs } = useQuery({
    queryKey: ["worker-documents", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_documents")
        .select("*")
        .eq("worker_id", id!)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!worker) {
    return <p className="py-8 text-center text-muted-foreground">Trabalhador não encontrado.</p>;
  }

  const w = worker as any;

  const info = (label: string, value: string | null | undefined, mono = false) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm ${mono ? "font-mono" : ""}`}>{value || "—"}</p>
    </div>
  );

  const boolInfo = (label: string, value: boolean) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value ? "Sim" : "Não"}</p>
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
        <div className="flex items-center gap-2">
          <DpReadinessBadge worker={w} docs={docs || []} />
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/workers/${id}/edit`)}>
              <Pencil className="mr-1 h-3 w-3" /> Editar
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="dados" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="pagamento">Pagamento</TabsTrigger>
          <TabsTrigger value="vinculos">Vínculos</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 mt-4">
          {/* DP Readiness detail */}
          <Card>
            <CardHeader><CardTitle className="text-base">Completude para DP</CardTitle></CardHeader>
            <CardContent>
              <DpReadinessBadge worker={w} docs={docs || []} showDetail />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Identificação eSocial</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2 sm:grid-cols-3">
              {info("CPF", formatCpf(worker.cpf), true)}
              {info("Data de nascimento", worker.birth_date ? new Date(worker.birth_date + "T12:00:00").toLocaleDateString("pt-BR") : null)}
              {info("Sexo", worker.gender)}
              {info("Raça/Cor", w.race_color)}
              {info("Grau de instrução", w.education_level)}
              {info("Nome social", w.social_name)}
              {info("Nacionalidade", worker.nationality)}
              {info("Naturalidade", w.birth_city)}
              {info("UF da naturalidade", w.birth_state)}
              {info("País de nascimento", w.birth_country)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Filiação</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Nome da mãe", w.mother_name)}
              {info("Nome do pai", w.father_name)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Documentos numéricos</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2 sm:grid-cols-3">
              {info("RG", worker.rg)}
              {info("Órgão emissor", w.rg_issuer)}
              {info("UF do RG", w.rg_state)}
              {info("NIS/PIS/PASEP", w.nis_pis)}
              {info("CTPS número", w.ctps_number)}
              {info("CTPS série", w.ctps_series)}
              {info("CTPS UF", w.ctps_state)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">PCD / Reabilitado</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {boolInfo("PCD", w.is_pcd)}
              {boolInfo("Reabilitado", w.is_rehabilitated)}
              {w.is_pcd && info("Tipo de deficiência", w.pcd_type)}
              {w.is_pcd && info("Observações PCD", w.pcd_notes)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contato</CardTitle></CardHeader>
            <CardContent className="grid gap-4 grid-cols-2">
              {info("Telefone principal", worker.phone_main ? formatPhone(worker.phone_main) : null)}
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

          {(worker.shirt_size || worker.shoe_size || worker.blood_type || worker.allergies || worker.medical_conditions || worker.emergency_contact_name) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Informações operacionais</CardTitle></CardHeader>
              <CardContent className="grid gap-4 grid-cols-3">
                {info("Camiseta", worker.shirt_size)}
                {info("Calçado", worker.shoe_size)}
                {info("Tipo sanguíneo", worker.blood_type)}
                <div className="col-span-3">{info("Alergias", worker.allergies)}</div>
                <div className="col-span-3">{info("Condições médicas", worker.medical_conditions)}</div>
                {info("Contato emergência", worker.emergency_contact_name)}
                {info("Tel. emergência", worker.emergency_contact_phone ? formatPhone(worker.emergency_contact_phone) : null)}
              </CardContent>
            </Card>
          )}

          {worker.notes && (
            <Card>
              <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
              <CardContent>{info("", worker.notes)}</CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <DocumentChecklist workerId={worker.id} />
        </TabsContent>

        <TabsContent value="pagamento" className="mt-4">
          <PaymentMethodsList workerId={worker.id} />
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
