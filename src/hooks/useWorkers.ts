import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 20;

interface WorkerFilters {
  search: string;
  city?: string;
  state?: string;
}

export function useWorkers(filters: WorkerFilters | string, page: number = 0) {
  const normalizedFilters: WorkerFilters = typeof filters === "string" ? { search: filters } : filters;

  return useQuery({
    queryKey: ["workers", normalizedFilters, page],
    queryFn: async () => {
      let query = supabase
        .from("workers")
        .select("id, full_name, nickname, cpf, phone_main, city, state, created_at", { count: "exact" })
        .is("deleted_at", null)
        .order("full_name");

      const { search, city, state } = normalizedFilters;

      if (search?.trim()) {
        const term = search.trim();
        const cleanTerm = term.replace(/\D/g, "");
        if (cleanTerm.length >= 3 && /^\d+$/.test(cleanTerm)) {
          query = query.or(`cpf.ilike.%${cleanTerm}%,phone_main.ilike.%${cleanTerm}%`);
        } else {
          query = query.or(`full_name.ilike.%${term}%,nickname.ilike.%${term}%`);
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

export function useWorker(id: string | undefined) {
  return useQuery({
    queryKey: ["worker", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workers")
        .select("*")
        .eq("id", id!)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useWorkerPaymentMethods(workerId: string | undefined) {
  return useQuery({
    queryKey: ["worker-payment-methods", workerId],
    enabled: !!workerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_payment_methods")
        .select("*")
        .eq("worker_id", workerId!)
        .is("deleted_at", null)
        .order("is_preferred", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
