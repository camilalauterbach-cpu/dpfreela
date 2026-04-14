import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type TableName = "workers" | "companies" | "events" | "employment_links" | "link_groups";

const dependencyChecks: Record<TableName, { table: string; column: string; label: string }[]> = {
  workers: [
    { table: "employment_links", column: "worker_id", label: "vínculos" },
  ],
  companies: [
    { table: "events", column: "company_id", label: "eventos" },
  ],
  events: [
    { table: "employment_links", column: "event_id", label: "vínculos" },
  ],
  employment_links: [
    { table: "employment_link_documents", column: "employment_link_id", label: "documentos" },
  ],
  link_groups: [
    { table: "link_group_workers", column: "link_group_id", label: "trabalhadores alocados" },
  ],
};

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
          throw new Error(
            `Não é possível excluir: existem ${count} ${check.label} vinculado(s) a este registro. Remova-os primeiro.`
          );
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
