import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CheckCircle2, AlertTriangle, Loader2, Upload, FileX, XCircle, CalendarX } from "lucide-react";

interface Missing {
  document_type_id: string;
  code: string;
  name: string;
  reason: "ausente" | "vencido" | "rejeitado" | string;
}

interface Result {
  worker_id: string;
  status: "complete" | "incomplete";
  missing: Missing[];
  evaluated_at: string;
}

const REASON_LABEL: Record<string, string> = {
  ausente: "Não enviado",
  vencido: "Vencido",
  rejeitado: "Rejeitado",
};

const REASON_DETAIL: Record<string, string> = {
  ausente:
    "Nenhum documento válido foi enviado para este tipo. Anexe um arquivo para concluir o cadastro.",
  vencido:
    "O documento atual está fora da validade. Envie uma versão renovada para restabelecer a conformidade.",
  rejeitado:
    "O último envio foi rejeitado na análise. Corrija a pendência apontada e envie um novo arquivo.",
};

const REASON_ICON: Record<string, JSX.Element> = {
  ausente: <FileX className="h-4 w-4 text-destructive" />,
  vencido: <CalendarX className="h-4 w-4 text-destructive" />,
  rejeitado: <XCircle className="h-4 w-4 text-destructive" />,
};

export function WorkerCompletionChecklist({ workerId }: { workerId: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const q = useQuery({
    queryKey: ["worker-completion", workerId],
    enabled: !!workerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "evaluate_worker_registration_completion" as any,
        { p_worker_id: workerId } as any,
      );
      if (error) throw error;
      return data as unknown as Result;
    },
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Cadastro completo</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Avaliando obrigatórios…
        </CardContent>
      </Card>
    );
  }

  if (q.error || !q.data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Cadastro completo</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Não foi possível avaliar agora. Tente novamente em instantes.
        </CardContent>
      </Card>
    );
  }

  const complete = q.data.status === "complete";

  const openDocumentTab = (documentTypeId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "documentos");
    next.set("document_type_id", documentTypeId);
    navigate({ search: next.toString() }, { replace: false });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Cadastro completo</CardTitle>
        {complete ? (
          <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> Completo
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Incompleto
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {complete ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Todos os documentos obrigatórios estão presentes e vigentes. Ativação de vínculo liberada.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Faltam <strong>{q.data.missing.length}</strong> documento(s) obrigatório(s).
                A conclusão do cadastro e a ativação de vínculo permanecem bloqueadas.
              </AlertDescription>
            </Alert>
            <Accordion type="multiple" className="rounded-md border divide-y">
              {q.data.missing.map((m) => (
                <AccordionItem
                  key={m.document_type_id}
                  value={m.document_type_id}
                  className="border-0 px-3"
                >
                  <AccordionTrigger className="py-2 hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-2 pr-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {REASON_ICON[m.reason] ?? <AlertTriangle className="h-4 w-4 text-destructive" />}
                        <span className="text-sm font-medium truncate text-left">{m.name}</span>
                      </div>
                      <Badge variant="outline" className="border-destructive/40 text-destructive shrink-0">
                        {REASON_LABEL[m.reason] ?? m.reason}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3">
                    <div className="space-y-3 text-sm">
                      <p className="text-muted-foreground">
                        {REASON_DETAIL[m.reason] ??
                          "Regularize este documento obrigatório para desbloquear o cadastro."}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDocumentTab(m.document_type_id)}
                      >
                        <Upload className="mr-1 h-3 w-3" />
                        {m.reason === "ausente" ? "Anexar documento" : "Atualizar documento"}
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Regra: apenas documentos marcados como <strong>Obrigatório</strong> em Configurações &gt; Tipos de Documento
          entram nesta avaliação. Opcionais nunca bloqueiam.
        </p>
      </CardContent>
    </Card>
  );
}