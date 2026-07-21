import { Badge } from "@/components/ui/badge";
import type { SstCurrentRow } from "@/hooks/useSstQualifications";

export type SstOverallStatus =
  | "expired"
  | "expiring"
  | "no_document"
  | "pending"
  | "valid";

export function resolveOverall(q: SstCurrentRow): SstOverallStatus {
  if (q.expiration_status === "expired") return "expired";
  if (q.expiration_status === "expiring_soon") return "expiring";
  if (q.document_status === "no_document") return "no_document";
  if (q.document_status === "pending" || q.document_status === "rejected") return "pending";
  return "valid";
}

// Ordenação: quem precisa de ação primeiro.
export const OVERALL_PRIORITY: Record<SstOverallStatus, number> = {
  expired: 0,
  expiring: 1,
  no_document: 2,
  pending: 3,
  valid: 4,
};

const LABEL: Record<SstOverallStatus, string> = {
  expired: "Vencida",
  expiring: "Vencendo",
  no_document: "Sem certificado",
  pending: "Pendente",
  valid: "Válida",
};

// Cores centralizadas — mesmo esquema do módulo Compliance.
const CLASSES: Record<SstOverallStatus, string> = {
  expired: "bg-destructive/10 text-destructive border-destructive/20",
  expiring: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400",
  no_document: "bg-muted text-muted-foreground border-border",
  pending: "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400",
  valid: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400",
};

export function SstStatusBadge({ status }: { status: SstOverallStatus }) {
  return (
    <Badge variant="outline" className={CLASSES[status]}>
      {LABEL[status]}
    </Badge>
  );
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T12:00:00").getTime();
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((target - now.getTime()) / 86_400_000);
}