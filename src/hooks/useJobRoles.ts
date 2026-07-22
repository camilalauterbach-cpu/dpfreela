import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface JobRoleOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface UseJobRolesOptions {
  /**
   * Quando true, retorna também cargos inativos (uso administrativo).
   * Padrão: false — seletores operacionais nunca devem exibir inativos.
   */
  includeInactive?: boolean;
}

/**
 * Fonte única de cargos para todo o app.
 *
 * - `includeInactive=false` (padrão) → somente `is_active=true`, ordenados por nome.
 *   Cache: ["job-roles-catalog","active"].
 * - `includeInactive=true` → todos, ordenados por is_active desc, nome.
 *   Cache: ["job-roles-catalog","all"].
 *
 * Os dois caches são independentes; ao criar/ativar/inativar um cargo,
 * invalide ambas as chaves.
 */
export function useJobRoles(options: UseJobRolesOptions = {}) {
  const includeInactive = options.includeInactive === true;
  const scope = includeInactive ? "all" : "active";
  return useQuery({
    queryKey: ["job-roles-catalog", scope],
    staleTime: 120_000,
    queryFn: async (): Promise<JobRoleOption[]> => {
      let q = supabase.from("job_roles").select("id, code, name, is_active");
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = includeInactive
        ? await q.order("is_active", { ascending: false }).order("name")
        : await q.order("name");
      if (error) throw error;
      return (data ?? []) as JobRoleOption[];
    },
  });
}

export const JOB_ROLES_CATALOG_KEYS = {
  active: ["job-roles-catalog", "active"] as const,
  all: ["job-roles-catalog", "all"] as const,
};