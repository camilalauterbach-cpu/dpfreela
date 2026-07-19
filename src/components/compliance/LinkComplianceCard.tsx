import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  FileX,
  FileText,
  Upload,
  Eye,
  History,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useLinkCompliance,
  type ComplianceDocument,
  type ComplianceStatus,
} from "@/hooks/useLinkCompliance";
import { ComplianceBadge } from "./ComplianceBadge";

const STATUS_STYLES: Record<
  ComplianceStatus,
  { icon: typeof CheckCircle2; row: string; icon_cls: string }
> = {
  ok: {
    icon: CheckCircle2,
    row: "border-l-emerald-400",
    icon_cls: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    icon: AlertTriangle,
    row: "border-l-amber-400",
    icon_cls: "text-amber-600 dark:text-amber-400",
  },
  pending: {
    icon: Clock,
    row: "border-l-amber-400",
    icon_cls: "text-amber-600 dark:text-amber-400",
  },
  expired: {
    icon: XCircle,
    row: "border-l-red-500",
    icon_cls: "text-red-600 dark:text-red-400",
  },
  missing: {
    icon: FileX,
    row: "border-l-red-500",
    icon_cls: "text-red-600 dark:text-red-400",
  },
};

function formatDateTimeBR(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface DocumentActions {
  onUpload?: (doc: ComplianceDocument) => void;
  onView?: (doc: ComplianceDocument) => void;
  onReplace?: (doc: ComplianceDocument) => void;
  onHistory?: (doc: ComplianceDocument) => void;
}

interface Props {
  linkId: string | null | undefined;
  actions?: DocumentActions;
  className?: string;
  compact?: boolean;
}

/**
 * Único componente visual de conformidade documental.
 * Consome exclusivamente `useLinkCompliance` — nenhuma consulta paralela.
 */
export function LinkComplianceCard({ linkId, actions, className, compact = false }: Props) {
  const { data, isLoading, isError, refetch, isFetching } = useLinkCompliance(linkId);

  if (!linkId) {
    return (
      <Card className={className}>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Salve o vínculo para avaliar a conformidade documental.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) return <LoadingSkeleton className={className} />;

  if (isError || !data) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div>
            <p className="text-sm font-medium">Não foi possível avaliar a conformidade</p>
            <p className="text-xs text-muted-foreground">Verifique sua conexão e tente novamente.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("mr-2 h-3 w-3", isFetching && "animate-spin")} />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (data.error === "link_not_found") {
    return (
      <Card className={className}>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Vínculo não encontrado.
        </CardContent>
      </Card>
    );
  }

  const { overall, score, documents, evaluated_at, job_role } = data;

  return (
    <Card className={className}>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Conformidade documental
            </CardTitle>
            {job_role && (
              <p className="text-xs text-muted-foreground">
                Cargo: <span className="font-medium text-foreground">{job_role.name}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ComplianceBadge overall={overall} />
            <span className="text-sm font-semibold tabular-nums">{score.percent.toFixed(0)}%</span>
          </div>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <SummaryPill label="Obrigatórios" value={score.required} tone="neutral" />
          <SummaryPill label="Válidos" value={score.valid} tone="ok" />
          <SummaryPill label="Atenção" value={score.warning + score.pending} tone="warn" />
          <SummaryPill label="Bloqueados" value={score.expired + score.missing} tone="danger" />
          <SummaryPill label="Pendentes" value={score.pending} tone="warn" />
        </div>

        <p className="text-[11px] text-muted-foreground">
          Última avaliação: {formatDateTimeBR(evaluated_at)}
        </p>
      </CardHeader>

      <Separator />

      <CardContent className="p-0">
        {documents.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma exigência documental cadastrada para este cargo.
          </div>
        ) : (
          <ul className="divide-y">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.document_type_id}
                doc={doc}
                actions={actions}
                compact={compact}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "ok" | "warn" | "danger";
}) {
  const toneCls = {
    neutral: "bg-muted text-foreground",
    ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    danger: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  }[tone];
  return (
    <div className={cn("rounded-md px-2 py-1.5 text-center", toneCls)}>
      <div className="text-lg font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}

function DocumentRow({
  doc,
  actions,
  compact,
}: {
  doc: ComplianceDocument;
  actions?: DocumentActions;
  compact: boolean;
}) {
  const style = STATUS_STYLES[doc.status];
  const Icon = style.icon;

  const canUpload = doc.status === "missing" && actions?.onUpload;
  const canView = doc.worker_document_id && actions?.onView;
  const canReplace = doc.worker_document_id && actions?.onReplace;
  const canHistory = doc.worker_document_id && actions?.onHistory;

  return (
    <li
      className={cn(
        "flex items-start gap-3 border-l-2 px-4 py-3",
        style.row,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.icon_cls)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{doc.name}</span>
          {!doc.is_mandatory && (
            <Badge variant="outline" className="text-[10px] font-normal">
              opcional
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px] font-normal">
            {doc.status_label}
          </Badge>
        </div>
        {!compact && (
          <p className="mt-0.5 text-xs text-muted-foreground">{doc.status_reason}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canView && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Ver documento"
            onClick={() => actions!.onView!(doc)}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
        )}
        {canUpload && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Enviar documento"
            onClick={() => actions!.onUpload!(doc)}
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
        )}
        {canReplace && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Substituir documento"
            onClick={() => actions!.onReplace!(doc)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {canHistory && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Histórico"
            onClick={() => actions!.onHistory!(doc)}
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
        <Skeleton className="h-3 w-32" />
      </CardHeader>
      <Separator />
      <CardContent className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </CardContent>
    </Card>
  );
}

// Marker export so `FileText` import stays intentional for future use.
export const _icons = { FileText };