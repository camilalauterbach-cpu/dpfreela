import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WorkerCompletionMissing {
  document_type_id: string;
  code: string;
  name: string;
  reason: "ausente" | "vencido" | "rejeitado" | string;
  status?: string | null;
  expiry_date?: string | null;
  rejected_at?: string | null;
  last_update_at?: string | null;
  worker_document_id?: string | null;
  file_name?: string | null;
  file_path?: string | null;
}

export interface WorkerCompletionResult {
  worker_id: string;
  status: "complete" | "incomplete";
  missing: WorkerCompletionMissing[];
  evaluated_at: string;
}

/**
 * Canonical worker completion state.
 * Reads `public.evaluate_worker_registration_completion` — the single source
 * of truth. Never combine this result with hardcoded document categories.
 *
 * The shared cache key `["worker-completion", workerId]` is invalidated by
 * every mutation that changes worker_documents (upload, delete, status).
 */
export function useWorkerCompletion(workerId: string | undefined) {
  return useQuery({
    queryKey: ["worker-completion", workerId],
    enabled: !!workerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "evaluate_worker_registration_completion" as any,
        { p_worker_id: workerId } as any,
      );
      if (error) throw error;
      return data as unknown as WorkerCompletionResult;
    },
  });
}