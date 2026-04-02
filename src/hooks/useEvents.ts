import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 20;

interface EventFilters {
  search: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  city?: string;
}

export function useEvents(filters: EventFilters | string, statusFilterOrPage?: string | number, page: number = 0) {
  // Backwards compat: useEvents("search", "status", page)
  let normalizedFilters: EventFilters;
  let currentPage: number;

  if (typeof filters === "string") {
    normalizedFilters = {
      search: filters,
      status: typeof statusFilterOrPage === "string" ? statusFilterOrPage : undefined,
    };
    currentPage = typeof statusFilterOrPage === "number" ? statusFilterOrPage : page;
  } else {
    normalizedFilters = filters;
    currentPage = typeof statusFilterOrPage === "number" ? statusFilterOrPage : page;
  }

  return useQuery({
    queryKey: ["events", normalizedFilters, currentPage],
    queryFn: async () => {
      let query = supabase
        .from("events")
        .select("id, name, company_id, city, state, start_date, end_date, status, companies(legal_name)", { count: "exact" })
        .is("deleted_at", null)
        .order("start_date", { ascending: false, nullsFirst: false });

      const { search, status, dateFrom, dateTo, city } = normalizedFilters;

      if (search?.trim()) {
        query = query.ilike("name", `%${search.trim()}%`);
      }
      if (status && status !== "all") {
        query = query.eq("status", status);
      }
      if (dateFrom) {
        query = query.gte("start_date", dateFrom);
      }
      if (dateTo) {
        query = query.lte("end_date", dateTo);
      }
      if (city?.trim()) {
        query = query.ilike("city", `%${city.trim()}%`);
      }

      const from = currentPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error, count } = await query.range(from, to);
      if (error) throw error;
      return { data: data ?? [], count: count ?? 0, pageSize: PAGE_SIZE };
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
