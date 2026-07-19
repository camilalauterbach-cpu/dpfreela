import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  History,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  FileX,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useComplianceTimeline,
  type ComplianceTimelineItem,
} from "@/hooks/useComplianceTimeline";

interface Props {
  linkId: string | null | undefined;
  className?: string;
}

const DOC_STATUS: Record<string, { icon: any; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: "text-emerald-600", label: "Válido" },
  warning: { icon: AlertTriangle, cls: "text-amber-600", label: "Vencimento próximo" },
  pending: { icon: Clock, cls: "text-amber-600", label: "Pendente" },
  expired: { icon: XCircle, cls: "text-red-600", label: "Vencido" },
  missing: { icon: FileX, cls: "text-red-600", label: "Ausente" },
};

const OVERALL_STATUS: Record<string, { icon: any; cls: string; label: string; dot: string }> = {
  apto: { icon: ShieldCheck, cls: "text-emerald-600", label: "APTO", dot: "🟢" },
  atencao: { icon: ShieldAlert, cls: "text-amber-600", label: "ATENÇÃO", dot: "🟡" },
  bloqueado: { icon: ShieldX, cls: "text-red-600", label: "BLOQUEADO", dot: "🔴" },
};

const SOURCE_LABEL: Record<string, string> = {
  upload: "Upload de documento",
  expiration: "Vencimento automático",
  admin_update: "Alteração administrativa",
  job_role_change: "Alteração de requisitos do cargo",
  migration: "Migração",
  system: "Sistema",
  manual: "Manual",
  reevaluate: "Reavaliação",
};

function formatDateBR(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTimeBR(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupByDay(items: ComplianceTimelineItem[]) {
  const map = new Map<string, ComplianceTimelineItem[]>();
  for (const it of items) {
    const key = it.created_at.slice(0, 10); // YYYY-MM-DD
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return Array.from(map.entries()).sort(([a], [b]) => (a > b ? -1 : 1));
}

export function ComplianceTimeline({ linkId, className }: Props) {
  const { data, isLoading, isError } = useComplianceTimeline(linkId);

  if (!linkId) {
    return (
      <Card className={className}>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Salve o vínculo para visualizar o histórico.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm">
          <AlertCircle className="h-6 w-6 text-destructive" />
          Não foi possível carregar o histórico.
        </CardContent>
      </Card>
    );
  }

  const items = data.items ?? [];
  const groups = groupByDay(items);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-primary" />
          Histórico de conformidade
        </CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma transição registrada ainda.
          </div>
        ) : (
          <ul className="divide-y">
            {groups.map(([day, events]) => (
              <li key={day} className="px-4 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {formatDateBR(day + "T00:00:00")}
                </div>
                <ul className="space-y-2">
                  {events.map((ev) => (
                    <TimelineRow key={ev.id} event={ev} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineRow({ event }: { event: ComplianceTimelineItem }) {
  const isOverall = event.entity_type === "overall";
  const meta = isOverall
    ? OVERALL_STATUS[event.current_status]
    : DOC_STATUS[event.current_status];
  const prevMeta = isOverall
    ? OVERALL_STATUS[event.previous_status ?? ""]
    : DOC_STATUS[event.previous_status ?? ""];
  const Icon = meta?.icon ?? History;

  const title = isOverall
    ? `Trabalhador ${OVERALL_STATUS[event.current_status]?.label ?? event.current_status}`
    : `${event.document_code ? `[${event.document_code}] ` : ""}${event.document_name ?? "Documento"}`;

  return (
    <li className="flex items-start gap-3 rounded-md border p-2">
      <div className={cn("mt-0.5", meta?.cls)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {event.previous_status && (
            <span className="text-xs text-muted-foreground">
              {prevMeta?.label ?? event.previous_status}{" "}
              <span className="mx-1">→</span>{" "}
              <span className={cn("font-medium", meta?.cls)}>
                {meta?.label ?? event.current_status}
              </span>
            </span>
          )}
          {!event.previous_status && (
            <Badge variant="secondary" className="text-[10px]">
              {meta?.label ?? event.current_status}
            </Badge>
          )}
        </div>
        {event.reason && (
          <p className="mt-0.5 text-xs text-muted-foreground">{event.reason}</p>
        )}
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatTimeBR(event.created_at)} · {SOURCE_LABEL[event.event_source] ?? event.event_source}
          {event.changed_by_name ? ` · por ${event.changed_by_name}` : ""}
        </p>
      </div>
    </li>
  );
}