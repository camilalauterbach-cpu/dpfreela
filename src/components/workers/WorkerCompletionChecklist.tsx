import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

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

export function WorkerCompletionChecklist({ workerId }: { workerId: string }) {
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
            <ul className="divide-y rounded-md border">
              {q.data.missing.map((m) => (
                <li key={m.document_type_id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-medium">{m.name}</span>
                  <Badge variant="outline" className="border-destructive/40 text-destructive">
                    {REASON_LABEL[m.reason] ?? m.reason}
                  </Badge>
                </li>
              ))}
            </ul>
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