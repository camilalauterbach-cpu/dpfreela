import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type TableName = "workers" | "companies" | "events" | "employment_links" | "link_groups";

const allocationStatusLabels: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  suspended: "Suspensa",
  completed: "Concluída",
  terminated: "Encerrada",
  cancelled: "Cancelada",
};

const dependencyChecks: Record<TableName, { table: string; column: string; label: string }[]> = {
  workers: [
    { table: "link_group_workers", column: "worker_id", label: "alocações em grupos" },
  ],
  companies: [
    { table: "events", column: "company_id", label: "eventos" },
  ],
  events: [
    { table: "link_groups", column: "event_id", label: "grupos/vínculos" },
  ],
  employment_links: [
    { table: "employment_link_documents", column: "employment_link_id", label: "documentos" },
  ],
  link_groups: [
    { table: "link_group_workers", column: "link_group_id", label: "trabalhadores alocados" },
  ],
};

async function buildDependencyErrorMessage(
  tableName: TableName,
  check: { table: string; column: string; label: string },
  id: string,
  count: number,
) {
  if (tableName === "workers" && check.table === "link_group_workers") {
    const { data, error } = await supabase
      .from("link_group_workers")
      .select("id, status, link_group_id, link_groups(group_name, events(name))")
      .eq("worker_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) throw error;

    const allocations = (data ?? []) as any[];

    if (allocations.length > 0) {
      const details = allocations
        .map((allocation) => {
          const group = allocation.link_groups as any;
          const groupName = group?.group_name || "Grupo sem nome";
          const eventName = group?.events?.name;
          const status = allocationStatusLabels[allocation.status] || allocation.status || "Sem status";

          return eventName
            ? `“${groupName}” (${eventName}, status ${status})`
            : `“${groupName}” (status ${status})`;
        })
        .join(", ");

      const remainingCount = count - allocations.length;
      const remainingText = remainingCount > 0 ? ` e mais ${remainingCount}` : "";
      const intro = count === 1 ? "1 alocação em grupo" : `${count} alocações em grupos`;

      return `Não é possível excluir: este trabalhador possui ${intro} vinculada(s) a ${details}${remainingText}. Remova a alocação na aba Vínculos primeiro.`;
    }
  }

  return `Não é possível excluir: existem ${count} ${check.label} vinculado(s) a este registro. Remova-os primeiro.`;
}

export function useDeleteRecord(tableName: TableName, invalidateKeys: string[]) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Check dependencies
      const checks = dependencyChecks[tableName] || [];
      for (const check of checks) {
        const { count, error } = await supabase
          .from(check.table as any)
          .select("id", { count: "exact", head: true })
          .eq(check.column, id)
          .is("deleted_at", null);
        if (error) throw error;
        if (count && count > 0) {
          throw new Error(await buildDependencyErrorMessage(tableName, check, id, count));
        }
      }

      // Soft delete
      const { error } = await supabase
        .from(tableName)
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Registro excluído com sucesso." });
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      setIsDeleting(false);
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      setIsDeleting(false);
    },
  });

  const deleteRecord = (id: string, options?: { onSuccess?: () => void }) => {
    setIsDeleting(true);
    deleteMutation.mutate(id, {
      onSuccess: () => {
        options?.onSuccess?.();
      },
    });
  };

  return { deleteRecord, isDeleting };
}
