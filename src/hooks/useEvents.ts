import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useEvents(search: string, statusFilter?: string) {
  return useQuery({
    queryKey: ["events", search, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("events")
        .select("id, name, company_id, city, state, start_date, end_date, status, companies(legal_name)")
        .is("deleted_at", null)
        .order("start_date", { ascending: false, nullsFirst: false });

      if (search.trim()) {
        query = query.ilike("name", `%${search.trim()}%`);
      }

      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ["event", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*, companies(legal_name, trade_name)")
        .eq("id", id!)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useEventsByCompany(companyId: string | undefined) {
  return useQuery({
    queryKey: ["events-by-company", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, start_date, end_date, status, city, state")
        .eq("company_id", companyId!)
        .is("deleted_at", null)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
