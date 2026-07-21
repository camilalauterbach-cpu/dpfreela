import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface JobRoleOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

/**
 * Fonte única de cargos para todo o app.
 * Retorna ativos + inativos; a UI mostra inativos como desabilitados.
 */
export function useJobRoles() {
  return useQuery({
    queryKey: ["job-roles-catalog"],
    staleTime: 120_000,
    queryFn: async (): Promise<JobRoleOption[]> => {
      const { data, error } = await supabase
        .from("job_roles")
        .select("id, code, name, is_active")
        .order("is_active", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as JobRoleOption[];
    },
  });
}