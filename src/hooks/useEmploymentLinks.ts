import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useEmploymentLinks(search: string, statusFilter?: string) {
  return useQuery({
    queryKey: ["employment-links", search, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("employment_links")
        .select("id, link_name, worker_id, event_id, job_role, status, hire_date, end_date, work_days_mode, specific_work_dates, workers(full_name, nickname, cpf), events(name)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;

      if (search.trim()) {
        const s = search.trim().toLowerCase();
        return (data as any[]).filter((l) => {
          const workerName = (l.workers as any)?.full_name?.toLowerCase() || "";
          const eventName = (l.events as any)?.name?.toLowerCase() || "";
          const linkName = l.link_name?.toLowerCase() || "";
          return workerName.includes(s) || eventName.includes(s) || linkName.includes(s);
        });
      }

      return data;
    },
  });
}

export function useEmploymentLink(id: string | undefined) {
  return useQuery({
    queryKey: ["employment-link", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employment_links")
        .select("*, workers(full_name, nickname, cpf), events(id, name, requires_epi_form, requires_service_order, required_nrs, required_nrs_other)")
        .eq("id", id!)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useEmploymentLinksByWorker(workerId: string | undefined) {
  return useQuery({
    queryKey: ["employment-links-worker", workerId],
    enabled: !!workerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employment_links")
        .select("id, link_name, event_id, job_role, status, hire_date, end_date, events(name)")
        .eq("worker_id", workerId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useEmploymentLinksByEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ["employment-links-event", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employment_links")
        .select("id, link_name, worker_id, job_role, status, hire_date, end_date, workers(full_name, nickname, cpf)")
        .eq("event_id", eventId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
