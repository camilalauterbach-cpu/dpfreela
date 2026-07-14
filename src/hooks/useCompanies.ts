import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 20;

// Escape characters that carry meaning in PostgREST filter grammar (`,`, `(`, `)`)
// and in SQL LIKE patterns (`%`, `_`, `\`). Without this, a crafted search term
// can inject additional OR-conditions into a `.or()` call.
function escapePostgrestLike(term: string): string {
  return term
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/[(),]/g, " ")
    .trim();
}

interface CompanyFilters {
  search: string;
  city?: string;
  state?: string;
}

export function useCompanies(filters: CompanyFilters | string, page: number = 0) {
  const normalizedFilters: CompanyFilters = typeof filters === "string" ? { search: filters } : filters;

  return useQuery({
    queryKey: ["companies", normalizedFilters, page],
    queryFn: async () => {
      let query = supabase
        .from("companies")
        .select("id, legal_name, trade_name, cnpj, phone, email, city, state, created_at", { count: "exact" })
        .is("deleted_at", null)
        .order("legal_name");

      const { search, city, state } = normalizedFilters;

      if (search?.trim()) {
        const rawTerm = search.trim();
        const cleanTerm = rawTerm.replace(/\D/g, "");
        const term = escapePostgrestLike(rawTerm);
        if (cleanTerm.length >= 3 && /^\d+$/.test(cleanTerm)) {
          query = query.ilike("cnpj", `%${cleanTerm}%`);
        } else if (term) {
          query = query.or(`legal_name.ilike.%${term}%,trade_name.ilike.%${term}%`);
        }
      }

      if (city?.trim()) {
        query = query.ilike("city", `%${city.trim()}%`);
      }
      if (state?.trim()) {
        query = query.eq("state", state.trim());
      }

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error, count } = await query.range(from, to);
      if (error) throw error;
      return { data: data ?? [], count: count ?? 0, pageSize: PAGE_SIZE };
    },
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ["company", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", id!)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data;
    },
  });
}
