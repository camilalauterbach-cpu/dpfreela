import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import type { ComplianceOverall } from "@/hooks/useLinkCompliance";
import { OVERALL_LABEL } from "@/hooks/useLinkCompliance";
import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<ComplianceOverall, string> = {
  apto:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  atencao:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  bloqueado:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
};

const ICONS: Record<ComplianceOverall, typeof CheckCircle2> = {
  apto: CheckCircle2,
  atencao: AlertTriangle,
  bloqueado: ShieldAlert,
};

interface Props {
  overall: ComplianceOverall;
  className?: string;
  showIcon?: boolean;
}

export function ComplianceBadge({ overall, className, showIcon = true }: Props) {
  const Icon = ICONS[overall];
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium", TONE_CLASSES[overall], className)}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {OVERALL_LABEL[overall]}
    </Badge>
  );
}