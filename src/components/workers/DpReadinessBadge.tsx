import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle } from "lucide-react";
import {
  computeFieldCompleteness,
  computeDocCompleteness,
  isDpReady,
  FIELD_LABELS,
  DOC_CATEGORY_LABELS,
} from "@/lib/worker-completeness";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  worker: Record<string, any>;
  docs: Array<{ category: string | null; status: string }>;
  showDetail?: boolean;
}

export function DpReadinessBadge({ worker, docs, showDetail = false }: Props) {
  const ready = isDpReady(worker, docs);
  const fields = computeFieldCompleteness(worker);
  const docStatus = computeDocCompleteness(docs);

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
              Campos: {fields.requiredFilled}/{fields.requiredTotal} • Docs: {docStatus.requiredApproved}/{docStatus.requiredTotal}
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
            <span>Documentos obrigatórios</span>
            <span>{docStatus.requiredApproved}/{docStatus.requiredTotal}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(docStatus.requiredApproved / docStatus.requiredTotal) * 100}%` }}
            />
          </div>
          {docStatus.missingRequired.length > 0 && (
            <p className="text-xs text-destructive mt-1">
              Faltam: {docStatus.missingRequired.map((c) => DOC_CATEGORY_LABELS[c] || c).join(", ")}
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
