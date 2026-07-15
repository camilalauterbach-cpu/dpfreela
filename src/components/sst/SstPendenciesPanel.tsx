import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import { collectPendencies, EXP_LABEL_PT, DOC_LABEL_PT } from "@/lib/sst/export";
import type { SstWorkerRow, SstCurrentRow } from "@/hooks/useSstQualifications";
import { SstRenewDialog } from "./SstRenewDialog";
import { useAuth } from "@/contexts/AuthContext";

interface Props { workers: SstWorkerRow[] }

const RANK_LABEL: Record<number, { label: string; className: string }> = {
  1: { label: "Vencido", className: "bg-red-100 text-red-800 border-red-200" },
  2: { label: "Rejeitado", className: "bg-red-100 text-red-800 border-red-200" },
  3: { label: "Vence ≤7d", className: "bg-amber-100 text-amber-900 border-amber-300" },
  4: { label: "Vence ≤15d", className: "bg-amber-100 text-amber-800 border-amber-200" },
  5: { label: "Vence ≤30d", className: "bg-amber-50 text-amber-800 border-amber-200" },
  6: { label: "Pendente", className: "bg-amber-50 text-amber-800 border-amber-200" },
  7: { label: "Sem comprovante", className: "bg-slate-100 text-slate-700 border-slate-200" },
  8: { label: "Validade desconhecida", className: "bg-slate-100 text-slate-700 border-slate-200" },
};

export function SstPendenciesPanel({ workers }: Props) {
  const { hasAnyRole } = useAuth();
  const canWrite = hasAnyRole(["admin", "manager", "operator"]);
  const [open, setOpen] = useState(true);
  const [renew, setRenew] = useState<{ w: SstWorkerRow; q: SstCurrentRow } | null>(null);
  const items = useMemo(() => collectPendencies(workers), [workers]);
  const top = items.slice(0, 25);

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          Pendências por prioridade
          <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} className="h-7 gap-1">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {open ? "Recolher" : "Expandir"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          <div className="divide-y">
            {top.map(({ worker, q, rank, daysLeft }) => {
              const meta = RANK_LABEL[rank];
              return (
                <div key={q.id} className="py-2 flex flex-wrap items-center gap-2">
                  <span className="min-w-[200px] text-sm font-medium truncate">{worker.full_name}</span>
                  <Badge variant="outline" className="text-[10px]">{q.nr_code}</Badge>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.className}`}>{meta.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {q.expires_at ? `Venc.: ${q.expires_at.split("-").reverse().join("/")}` : "Sem data"}
                    {daysLeft != null ? ` • ${daysLeft}d` : ""}
                    {" • "}{DOC_LABEL_PT[q.document_status]}
                    {" • "}{EXP_LABEL_PT[q.expiration_status]}
                  </span>
                  {canWrite && (
                    <Button size="sm" variant="outline" className="h-7 text-xs ml-auto"
                      onClick={() => setRenew({ w: worker, q })}>
                      Registrar renovação
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {items.length > top.length && (
            <div className="pt-2 text-xs text-muted-foreground">
              Exibindo as {top.length} pendências mais urgentes de {items.length}. Use filtros para reduzir o volume.
            </div>
          )}
        </CardContent>
      )}
      {renew && (
        <SstRenewDialog
          open={!!renew}
          onOpenChange={(v) => !v && setRenew(null)}
          workerId={renew.w.worker_id}
          workerName={renew.w.full_name}
          current={renew.q}
        />
      )}
    </Card>
  );
}