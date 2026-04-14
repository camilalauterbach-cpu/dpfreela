import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Queries ──

export function useLinkGroups(search: string, statusFilter?: string) {
  return useQuery({
    queryKey: ["link-groups", search, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("link_groups")
        .select("id, group_name, event_id, company_id, status, hire_date, end_date, created_at, events(name), companies(legal_name, trade_name)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;

      // Enrich with active worker count
      const groupIds = (data ?? []).map((g) => g.id);
      let workerCounts: Record<string, number> = {};

      if (groupIds.length > 0) {
        const { data: workers, error: wErr } = await supabase
          .from("link_group_workers")
          .select("link_group_id")
          .in("link_group_id", groupIds)
          .is("deleted_at", null);
        if (wErr) throw wErr;

        for (const w of workers ?? []) {
          workerCounts[w.link_group_id] = (workerCounts[w.link_group_id] || 0) + 1;
        }
      }

      let results = (data ?? []).map((g) => ({
        ...g,
        worker_count: workerCounts[g.id] || 0,
      }));

      if (search.trim()) {
        const s = search.trim().toLowerCase();
        results = results.filter((g) => {
          const groupName = g.group_name?.toLowerCase() || "";
          const eventName = (g.events as any)?.name?.toLowerCase() || "";
          return groupName.includes(s) || eventName.includes(s);
        });
      }

      return results;
    },
  });
}

export function useLinkGroup(id: string | undefined) {
  return useQuery({
    queryKey: ["link-group", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("link_groups")
        .select("*, events(id, name, requires_epi_form, requires_service_order, required_nrs, required_nrs_other), companies(legal_name, trade_name)")
        .eq("id", id!)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useLinkGroupWorkers(groupId: string | undefined) {
  return useQuery({
    queryKey: ["link-group-workers", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("link_group_workers")
        .select("*, workers(full_name, nickname, cpf, phone_main), shift_type, work_shift, work_schedule, call_time, daily_hours, weekly_hours, category_reference_rate")
        .eq("link_group_id", groupId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Sort by worker name client-side
      const sorted = (data ?? []).sort((a: any, b: any) => {
        const nameA = a.workers?.full_name?.toLowerCase() || "";
        const nameB = b.workers?.full_name?.toLowerCase() || "";
        return nameA.localeCompare(nameB, "pt-BR");
      });
      return sorted;
    },
  });
}

export function useLinkGroupsByEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ["link-groups-event", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("link_groups")
        .select("id, group_name, status, hire_date, end_date, created_at")
        .eq("event_id", eventId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const groupIds = (data ?? []).map((g) => g.id);
      let workerCounts: Record<string, number> = {};

      if (groupIds.length > 0) {
        const { data: workers, error: wErr } = await supabase
          .from("link_group_workers")
          .select("link_group_id")
          .in("link_group_id", groupIds)
          .is("deleted_at", null);
        if (wErr) throw wErr;

        for (const w of workers ?? []) {
          workerCounts[w.link_group_id] = (workerCounts[w.link_group_id] || 0) + 1;
        }
      }

      return (data ?? []).map((g) => ({
        ...g,
        worker_count: workerCounts[g.id] || 0,
      }));
    },
  });
}

// ── Mutations ──

const INVALIDATE_KEYS = ["link-groups", "link-groups-event"];

export function useCreateLinkGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { data, error } = await supabase
        .from("link_groups")
        .insert(values as any)
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      INVALIDATE_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
  });
}

export function useUpdateLinkGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string } & Record<string, any>) => {
      const { error } = await supabase
        .from("link_groups")
        .update(values as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      [...INVALIDATE_KEYS, "link-group"].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: k === "link-group" ? ["link-group", vars.id] : [k] })
      );
    },
  });
}

export function useAllocateWorker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { data, error } = await supabase
        .from("link_group_workers")
        .insert(values as any)
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["link-group-workers", vars.link_group_id] });
      queryClient.invalidateQueries({ queryKey: ["link-group", vars.link_group_id] });
      INVALIDATE_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
  });
}

export function useUpdateGroupWorker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, link_group_id, ...values }: { id: string; link_group_id: string } & Record<string, any>) => {
      const { error } = await supabase
        .from("link_group_workers")
        .update(values as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["link-group-workers", vars.link_group_id] });
      queryClient.invalidateQueries({ queryKey: ["link-group", vars.link_group_id] });
      INVALIDATE_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
  });
}

export function useRemoveGroupWorker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, link_group_id }: { id: string; link_group_id: string }) => {
      const { error } = await supabase
        .from("link_group_workers")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["link-group-workers", vars.link_group_id] });
      queryClient.invalidateQueries({ queryKey: ["link-group", vars.link_group_id] });
      INVALIDATE_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
  });
}
