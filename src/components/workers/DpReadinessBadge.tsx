import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  computeFieldCompleteness,
  FIELD_LABELS,
} from "@/lib/worker-completeness";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkerCompletion } from "@/hooks/useWorkerCompletion";

interface Props {
  worker: Record<string, any> & { id: string };
  /** Legacy prop; ignored. Kept so existing call sites keep compiling. */
  docs?: unknown;
  showDetail?: boolean;
}

export function DpReadinessBadge({ worker, showDetail = false }: Props) {
  const fields = computeFieldCompleteness(worker);
  const completion = useWorkerCompletion(worker.id);
  const docsReady = completion.data?.status === "complete";
  const missing = completion.data?.missing ?? [];
  const requiredDocsTotal = (missing.length + (docsReady ? 0 : 0)); // total unknown from RPC; use progress fallback below
  const missingCount = missing.length;
  const ready = fields.missingRequired.length === 0 && docsReady && !completion.isError;

  if (completion.isLoading) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Avaliando…
      </Badge>
    );
  }

  const badge = ready ? (
    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
      <CheckCircle2 className="mr-1 h-3 w-3" /> Pronto para DP
    </Badge>
  ) : (
    <Badge variant="outline" className="bg-yellow-50 text-yellow-800 border-yellow-300">
      <AlertCircle className="mr-1 h-3 w-3" /> Cadastro incompleto
    </Badge>
  );

  if (!showDetail) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="text-xs">
              Campos: {fields.requiredFilled}/{fields.requiredTotal} •{" "}
              Docs obrigatórios: {missingCount === 0 ? "OK" : `${missingCount} pendente(s)`}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="space-y-3">
      {badge}
      <div className="space-y-2 mt-2">
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Campos obrigatórios</span>
            <span>{fields.requiredFilled}/{fields.requiredTotal}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(fields.requiredFilled / fields.requiredTotal) * 100}%` }}
            />
          </div>
          {fields.missingRequired.length > 0 && (
            <p className="text-xs text-destructive mt-1">
              Faltam: {fields.missingRequired.map((f) => FIELD_LABELS[f] || f).join(", ")}
            </p>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Documentos obrigatórios (fonte canônica)</span>
            <span>{docsReady ? "OK" : `${missingCount} pendente(s)`}</span>
          </div>
          {!docsReady && missing.length > 0 && (
            <p className="text-xs text-destructive mt-1">
              Faltam: {missing.map((m) => `${m.name} (${m.reason})`).join(", ")}
            </p>
          )}
          {completion.isError && (
            <p className="text-xs text-muted-foreground mt-1">
              Não foi possível avaliar os documentos agora.
            </p>
          )}
        </div>
        {fields.missingRecommended.length > 0 && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-2">
            <p className="text-xs text-yellow-800">
              <strong>Recomendáveis pendentes:</strong>{" "}
              {fields.missingRecommended.map((f) => FIELD_LABELS[f] || f).join(", ")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
