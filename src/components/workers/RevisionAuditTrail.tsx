// Trilha de auditoria por revisão de documento. Lê
// `worker_document_revision_events` e mostra o ciclo de vida completo:
// envio iniciado, arquivo no Storage, registro no banco, promoção para
// vigente e supersessão da revisão anterior.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, AlertCircle, Upload, Database, ShieldCheck,
  History, Repeat, XCircle, Info,
} from "lucide-react";

interface Props {
  workerId: string;
  documentTypeId?: string | null;
  revisionId?: string | null;
  limit?: number;
}

interface RevisionEvent {
  id: string;
  event: string;
  status: string;
  revision_id: string | null;
  actor_id: string | null;
  trace_id: string | null;
  idempotency_key: string | null;
  details: Record<string, unknown> | null;
  occurred_at: string;
}

const EVENT_LABEL: Record<string, string> = {
  upload_started: "Envio iniciado",
  storage_uploaded: "Arquivo recebido no Storage",
  storage_upload_failed: "Falha ao enviar arquivo",
  db_persisted: "Registro persistido",
  db_persist_failed: "Falha ao persistir registro",
  became_current: "Tornou-se a versão vigente",
  superseded: "Substituída por nova revisão",
  idempotent_hit: "Reenvio idempotente (nada mudou)",
  client_error: "Erro no cliente",
  client_note: "Nota do cliente",
};

const EVENT_ICON: Record<string, JSX.Element> = {
  upload_started: <Upload className="h-3.5 w-3.5" />,
  storage_uploaded: <CheckCircle2 className="h-3.5 w-3.5" />,
  storage_upload_failed: <XCircle className="h-3.5 w-3.5" />,
  db_persisted: <Database className="h-3.5 w-3.5" />,
  db_persist_failed: <XCircle className="h-3.5 w-3.5" />,
  became_current: <ShieldCheck className="h-3.5 w-3.5" />,
  superseded: <History className="h-3.5 w-3.5" />,
  idempotent_hit: <Repeat className="h-3.5 w-3.5" />,
  client_error: <AlertCircle className="h-3.5 w-3.5" />,
  client_note: <Info className="h-3.5 w-3.5" />,
};

function fmtTs(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function RevisionAuditTrail({ workerId, documentTypeId, revisionId, limit = 50 }: Props) {
  const q = useQuery({
    queryKey: ["worker-doc-revision-events", workerId, documentTypeId ?? null, revisionId ?? null, limit],
    enabled: !!workerId && (!!documentTypeId || !!revisionId),
    queryFn: async () => {
      let query = (supabase as any)
        .from("worker_document_revision_events")
        .select("id, event, status, revision_id, actor_id, trace_id, idempotency_key, details, occurred_at")
        .eq("worker_id", workerId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (revisionId) query = query.eq("revision_id", revisionId);
      else if (documentTypeId) query = query.eq("document_type_id", documentTypeId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as RevisionEvent[];
    },
  });

  const events = q.data ?? [];

  const groupedByTrace = useMemo(() => {
    const map = new Map<string, RevisionEvent[]>();
    for (const ev of events) {
      const key = ev.trace_id || ev.idempotency_key || ev.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return Array.from(map.values());
  }, [events]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" /> Trilha de auditoria
          <Badge variant="outline" className="text-[10px] font-normal">
            {events.length} evento(s)
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {q.isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando eventos…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum evento registrado ainda para esta revisão.
          </p>
        ) : (
          <div className="space-y-4">
            {groupedByTrace.map((group, idx) => (
              <div key={idx} className="border-l-2 border-border pl-3 space-y-1.5">
                {group.map((ev) => {
                  const label = EVENT_LABEL[ev.event] ?? ev.event;
                  const icon = EVENT_ICON[ev.event] ?? <Info className="h-3.5 w-3.5" />;
                  const isError = ev.status === "error";
                  const isWarn = ev.status === "warn";
                  const badgeClass = isError
                    ? "bg-red-50 text-red-700 border-red-200"
                    : isWarn
                    ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                    : "bg-green-50 text-green-700 border-green-200";
                  const details = ev.details ?? {};
                  const detailChips: Array<[string, string]> = [];
                  const push = (k: string, v: unknown) => {
                    if (v == null || v === "") return;
                    detailChips.push([k, String(v)]);
                  };
                  push("operação", (details as any).operation);
                  push("arquivo", (details as any).file_name);
                  push("tamanho", (details as any).file_size);
                  push("emitido", (details as any).issued_at);
                  push("vence", (details as any).expiry_date);
                  push("motivo", (details as any).error || (details as any).reason);
                  return (
                    <div key={ev.id} className="text-xs flex items-start gap-2">
                      <div className="mt-0.5 text-muted-foreground">{icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{label}</span>
                          <Badge variant="outline" className={`text-[10px] ${badgeClass}`}>
                            {ev.status}
                          </Badge>
                          <span className="text-muted-foreground">{fmtTs(ev.occurred_at)}</span>
                        </div>
                        {detailChips.length > 0 && (
                          <div className="mt-0.5 text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                            {detailChips.map(([k, v]) => (
                              <span key={k}>
                                <span className="opacity-70">{k}:</span> {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}