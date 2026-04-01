import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCompanies(search: string) {
  return useQuery({
    queryKey: ["companies", search],
    queryFn: async () => {
      let query = supabase
        .from("companies")
        .select("id, legal_name, trade_name, cnpj, phone, email, city, state, created_at")
        .is("deleted_at", null)
        .order("legal_name");

      if (search.trim()) {
        const term = search.trim();
        const cleanTerm = term.replace(/\D/g, "");
        if (cleanTerm.length >= 3 && /^\d+$/.test(cleanTerm)) {
          query = query.ilike("cnpj", `%${cleanTerm}%`);
        } else {
          query = query.or(`legal_name.ilike.%${term}%,trade_name.ilike.%${term}%`);
        }
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data;
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
