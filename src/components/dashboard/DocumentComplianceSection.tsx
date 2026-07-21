import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  FileClock,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useDocumentComplianceSummary } from "@/hooks/useDocumentComplianceSummary";

export function DocumentComplianceSection() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch, isFetching } =
    useDocumentComplianceSummary(30);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Conformidade documental
          </CardTitle>
          {data && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Janela de alerta: {data.warning_days} dias · {data.totals.links} vínculos ativos
            </p>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => navigate("/compliance")}>
          Ver todos <ChevronRight className="ml-1 h-3 w-3" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-24 w-full" />
          </>
        ) : isError || !data ? (
          <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Não foi possível carregar a conformidade.
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("mr-2 h-3 w-3", isFetching && "animate-spin")} />
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            {/* Totais por vínculo */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard
                icon={CheckCircle2}
                label="Aptos"
                value={data.totals.aptos}
                tone="ok"
                onClick={() => navigate("/compliance?compliance=apto")}
              />
              <StatCard
                icon={AlertTriangle}
                label="Atenção"
                value={data.totals.atencao}
                tone="warn"
                onClick={() => navigate("/compliance?compliance=atencao")}
              />
              <StatCard
                icon={ShieldAlert}
                label="Bloqueados"
                value={data.totals.bloqueados}
                tone="danger"
                onClick={() => navigate("/compliance?compliance=bloqueado")}
              />
            </div>

            {/* Top pendências */}
            {data.top_pending.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <FileClock className="h-3.5 w-3.5" />
                  Top documentos com pendências
                </div>
                <ul className="divide-y rounded-md border">
                  {data.top_pending.slice(0, 5).map((d) => (
                    <li key={d.document_type_id}>
                      <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-accent transition-colors"
                        onClick={() =>
                          navigate(`/compliance?compliance=bloqueado&doc=${d.code}`)
                        }
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{d.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {d.code}
                          </p>
                        </div>
                        <span className="ml-3 shrink-0 rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                          {d.pending_count}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Conformidade por cargo */}
            {data.by_role.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Conformidade por cargo
                </div>
                <ul className="divide-y rounded-md border">
                  {data.by_role.slice(0, 5).map((r) => (
                    <li key={r.job_role_id}>
                      <button
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent transition-colors"
                        onClick={() =>
                          navigate(`/compliance?job_role_id=${r.job_role_id}`)
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {r.job_role_name}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {r.total_links} vínculo(s) · {r.bloqueados} bloqueado(s)
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {r.percent_avg.toFixed(0)}%
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: number;
  tone: "ok" | "warn" | "danger";
  onClick: () => void;
}) {
  const toneCls = {
    ok: "border-emerald-200 hover:border-emerald-300 dark:border-emerald-900",
    warn: "border-amber-200 hover:border-amber-300 dark:border-amber-900",
    danger: "border-red-200 hover:border-red-300 dark:border-red-900",
  }[tone];
  const iconCls = {
    ok: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
  }[tone];
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition-all hover:shadow-sm active:scale-[0.98]",
        toneCls,
      )}
    >
      <Icon className={cn("h-4 w-4", iconCls)} />
      <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

function DocPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "danger";
}) {
  const toneCls = {
    ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    danger: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  }[tone];
  return (
    <div className={cn("rounded-md px-2 py-1.5 text-center", toneCls)}>
      <div className="text-lg font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}