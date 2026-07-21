import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function usePayrollBatches(search: string, statusFilter?: string, eventFilter?: string) {
  return useQuery({
    queryKey: ["payroll-batches", search, statusFilter, eventFilter],
    queryFn: async () => {
      let query = supabase
        .from("payroll_batches")
        .select("id, batch_name, event_id, reference_month, status, total_amount, paid_at, created_at, events(name)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (eventFilter && eventFilter !== "all") {
        query = query.eq("event_id", eventFilter);
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;

      if (search.trim()) {
        const s = search.trim().toLowerCase();
        return (data as any[]).filter((b) => {
          const name = b.batch_name?.toLowerCase() || "";
          const evName = (b.events as any)?.name?.toLowerCase() || "";
          return name.includes(s) || evName.includes(s);
        });
      }
      return data;
    },
  });
}

export function usePayrollBatch(id: string | undefined) {
  return useQuery({
    queryKey: ["payroll-batch", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_batches")
        .select("*, events(id, name)")
        .eq("id", id!)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function usePayrollBatchItems(batchId: string | undefined) {
  return useQuery({
    queryKey: ["payroll-batch-items", batchId],
    enabled: !!batchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_batch_items")
        .select("*, workers(full_name, nickname, cpf), employment_links(link_name, job_role, job_role_id, daily_rate, fixed_salary, job_roles:job_role_id(id, name, is_active))")
        .eq("batch_id", batchId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function usePayrollReceipts(batchId: string | undefined) {
  return useQuery({
    queryKey: ["payroll-receipts", batchId],
    enabled: !!batchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_receipts")
        .select("*")
        .eq("batch_id", batchId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function usePayrollItemReceipts(itemIds: string[]) {
  return useQuery({
    queryKey: ["payroll-item-receipts", itemIds],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_receipts")
        .select("*")
        .in("item_id", itemIds)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });
}
