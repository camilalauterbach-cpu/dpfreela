import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Download, CheckCircle2, Clock, XCircle, AlertCircle, RefreshCw, FileText, Info } from "lucide-react";
import {
  REQUIRED_DOC_CATEGORIES,
  CONDITIONAL_DOC_CATEGORIES,
  DOC_CATEGORY_LABELS,
  DOC_STATUS_LABELS,
} from "@/lib/worker-completeness";
import { OperationalDocsChecklist } from "@/components/events/OperationalDocsChecklist";
import { exportLinkDocsZip } from "@/lib/export-docs-zip";
import { useToast } from "@/hooks/use-toast";

interface Props {
  workerId: string;
  employmentLinkId: string;
  event: any;
  workerName: string;
  workerCpf?: string;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  uploaded: <AlertCircle className="h-3 w-3" />,
  approved: <CheckCircle2 className="h-3 w-3" />,
  rejected: <XCircle className="h-3 w-3" />,
  replace: <RefreshCw className="h-3 w-3" />,
};

const STATUS_VARIANT: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  uploaded: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  replace: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

function getEventRequiredCategories(event: any): string[] {
  const cats: string[] = [];
  if (event?.requires_epi_form) cats.push("ficha_epi");
  if (event?.requires_service_order) cats.push("ordem_servico");
  if (event?.required_nrs) {
    for (const nr of event.required_nrs) {
      cats.push(nr.toLowerCase().replace(" ", "_"));
    }
  }
  if (event?.required_nrs_other) cats.push("nr_custom");
  return cats;
}

export function LinkDocumentsTab({ workerId, employmentLinkId, event, workerName, workerCpf }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: workerDocs, isLoading: loadingWorkerDocs } = useQuery({
    queryKey: ["worker-documents", workerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_documents")
        .select("*")
        .eq("worker_id", workerId)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  const { data: linkDocs, isLoading: loadingLinkDocs } = useQuery({
    queryKey: ["link-docs", employmentLinkId],
    enabled: !!employmentLinkId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employment_link_documents")
        .select("*")
        .eq("employment_link_id", employmentLinkId)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  const handleDownload = async (mode: "worker" | "event" | "all") => {
    setDownloading(mode);
    try {
      const count = await exportLinkDocsZip({
        workerId,
        employmentLinkId,
        workerName,
        cpf: workerCpf || "",
        mode,
      });
      toast({ title: `${count} arquivo(s) baixado(s)` });
    } catch (err: any) {
      toast({ title: "Erro no download", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  if (loadingWorkerDocs || loadingLinkDocs) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const workerDocMap = new Map<string, any>();
  const outrosDocs: any[] = [];
  workerDocs?.forEach((d) => {
    if (d.category === "outros") {
      outrosDocs.push(d);
    } else if (d.category) {
      const existing = workerDocMap.get(d.category);
      if (!existing || new Date(d.created_at) > new Date(existing.created_at)) {
        workerDocMap.set(d.category, d);
      }
    }
  });

  const linkDocMap = new Map<string, any>();
  linkDocs?.forEach((d: any) => {
    if (d.category) linkDocMap.set(d.category, d);
  });

  const eventCategories = getEventRequiredCategories(event);

  const workerPendencies = REQUIRED_DOC_CATEGORIES.filter((cat) => {
    const doc = workerDocMap.get(cat);
    return !doc || doc.status !== "approved";
  });

  const eventPendencies = eventCategories.filter((cat) => {
    const doc = linkDocMap.get(cat);
    return !doc || doc.status !== "approved";
  });

  const allCategories = [...REQUIRED_DOC_CATEGORIES, ...CONDITIONAL_DOC_CATEGORIES.filter(c => c !== "outros")];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleDownload("worker")}
          disabled={!!downloading}
        >
          {downloading === "worker" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
          Baixar docs do trabalhador
        </Button>
        {eventCategories.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDownload("event")}
            disabled={!!downloading}
          >
            {downloading === "event" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
            Baixar docs do evento
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleDownload("all")}
          disabled={!!downloading}
        >
          {downloading === "all" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
          Baixar todos
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documentos do trabalhador</CardTitle>
          <div className="flex items-start gap-2 mt-2 p-3 rounded-md bg-muted/50 border border-border">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Estes documentos são globais do trabalhador (somente leitura).{" "}
              <button
                className="text-primary underline underline-offset-2 hover:text-primary/80"
                onClick={() => navigate(`/workers/${workerId}?tab=documentos`)}
              >
                Para incluir ou alterar, acesse o cadastro do trabalhador na aba Documentos
              </button>.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {allCategories.map((cat) => {
            const doc = workerDocMap.get(cat);
            const status = doc?.status || "pending";
            const isRequired = (REQUIRED_DOC_CATEGORIES as readonly string[]).includes(cat);

            return (
              <div key={cat} className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="text-sm truncate">{DOC_CATEGORY_LABELS[cat] || cat}</p>
                      {isRequired && <span className="text-destructive text-xs">*</span>}
                    </div>
                    {doc?.file_name && <p className="text-xs text-muted-foreground truncate">{doc.file_name}</p>}
                  </div>
                </div>
                <Badge variant="outline" className={`text-xs shrink-0 ${STATUS_VARIANT[status]}`}>
                  {STATUS_ICON[status]}
                  <span className="ml-1">{DOC_STATUS_LABELS[status] || status}</span>
                </Badge>
              </div>
            );
          })}

          {outrosDocs.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Outros (complementares)</p>
              {outrosDocs.map((doc) => {
                const status = doc.status || "pending";
                return (
                  <div key={doc.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm truncate">{doc.file_name || "Arquivo"}</p>
                        <p className="text-xs text-muted-foreground">{new Date(doc.created_at).toLocaleDateString("pt-BR")}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-xs shrink-0 ${STATUS_VARIANT[status]}`}>
                      {STATUS_ICON[status]}
                      <span className="ml-1">{DOC_STATUS_LABELS[status] || status}</span>
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {event ? (
        <OperationalDocsChecklist employmentLinkId={employmentLinkId} workerId={workerId} event={event} />
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhum evento vinculado — documentos operacionais não aplicáveis.
          </CardContent>
        </Card>
      )}

      {(workerPendencies.length > 0 || eventPendencies.length > 0) && (
        <div className="space-y-4">
          {workerPendencies.length > 0 && (
            <Card className="border-yellow-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-yellow-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Pendências do trabalhador
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {workerPendencies.map((cat) => {
                    const doc = workerDocMap.get(cat);
                    const status = doc?.status || "pending";
                    return (
                      <li key={cat} className="flex items-center justify-between text-sm py-1">
                        <span>{DOC_CATEGORY_LABELS[cat] || cat}</span>
                        <Badge variant="outline" className={`text-xs ${STATUS_VARIANT[status]}`}>
                          {STATUS_ICON[status]}
                          <span className="ml-1">{doc ? DOC_STATUS_LABELS[status] : "Faltante"}</span>
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {eventPendencies.length > 0 && (
            <Card className="border-yellow-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-yellow-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Pendências do evento
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {eventPendencies.map((cat) => {
                    const doc = linkDocMap.get(cat);
                    const status = doc?.status || "pending";
                    const NR_LABELS: Record<string, string> = {
                      ficha_epi: "Ficha de entrega de EPI",
                      ordem_servico: "Ordem de serviço",
                      nr_custom: event?.required_nrs_other || "NR personalizada",
                    };
                    const label = NR_LABELS[cat] || cat.replace("_", " ").toUpperCase();
                    return (
                      <li key={cat} className="flex items-center justify-between text-sm py-1">
                        <span>{label}</span>
                        <Badge variant="outline" className={`text-xs ${STATUS_VARIANT[status]}`}>
                          {STATUS_ICON[status]}
                          <span className="ml-1">{doc ? DOC_STATUS_LABELS[status] : "Faltante"}</span>
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
