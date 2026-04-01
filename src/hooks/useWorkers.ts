import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useWorkers(search: string) {
  return useQuery({
    queryKey: ["workers", search],
    queryFn: async () => {
      let query = supabase
        .from("workers")
        .select("id, full_name, nickname, cpf, phone_main, city, state, created_at")
        .is("deleted_at", null)
        .order("full_name");

      if (search.trim()) {
        const term = search.trim();
        const cleanTerm = term.replace(/\D/g, "");
        
        // If search looks like digits, search CPF and phone
        if (cleanTerm.length >= 3 && /^\d+$/.test(cleanTerm)) {
          query = query.or(`cpf.ilike.%${cleanTerm}%,phone_main.ilike.%${cleanTerm}%`);
        } else {
          query = query.or(`full_name.ilike.%${term}%,nickname.ilike.%${term}%`);
        }
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data;
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
