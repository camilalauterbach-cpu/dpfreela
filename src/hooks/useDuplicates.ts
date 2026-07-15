import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DupWorker {
  id: string;
  full_name: string;
  nickname: string | null;
  cpf: string | null;
  birth_date: string | null;
  email: string | null;
  created_at: string;
}

export interface DuplicateCandidate {
  a: DupWorker;
  b: DupWorker;
  reason: "cpf_match" | "name_birth";
  similarity: number;
}

export function useDuplicateCandidates() {
  return useQuery({
    queryKey: ["duplicate-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_worker_duplicate_candidates" as never);
      if (error) throw error;
      return (data as unknown as DuplicateCandidate[]) ?? [];
    },
  });
}

export interface MergePreview {
  result: "ready" | "conflict";
  primary: DupWorker;
  secondary: DupWorker;
  conflicts: Array<{ code: string; records: unknown[] }>;
  counts: Record<string, number>;
}

export function useMergePreview(primaryId: string | null, secondaryId: string | null) {
  return useQuery({
    queryKey: ["merge-preview", primaryId, secondaryId],
    enabled: !!primaryId && !!secondaryId && primaryId !== secondaryId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("merge_workers_preview" as never, {
        _primary: primaryId,
        _secondary: secondaryId,
      } as never);
      if (error) throw error;
      return data as unknown as MergePreview;
    },
  });
}

export function useMarkNotSamePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { aId: string; bId: string; reason?: string }) => {
      const { error } = await supabase.from("worker_duplicate_reviews").insert({
        worker_a_id: payload.aId,
        worker_b_id: payload.bId,
        criteria: "manual_review",
        decision: "not_same_person",
        reason: payload.reason ?? null,
        reviewed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Par marcado como falso positivo");
      qc.invalidateQueries({ queryKey: ["duplicate-candidates"] });
    },
    onError: (e: unknown) => toast.error("Não foi possível registrar: " + (e as Error).message),
  });
}

export function useExecuteMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { primaryId: string; secondaryId: string; confirmation: string }) => {
      const { data, error } = await supabase.rpc("merge_workers" as never, {
        _primary: payload.primaryId,
        _secondary: payload.secondaryId,
        _confirmation: payload.confirmation,
      } as never);
      if (error) throw error;
      return data as { result: string; conflicts?: unknown[]; transferred?: Record<string, number> };
    },
    onSuccess: (res) => {
      if (res?.result === "merged") {
        toast.success("Trabalhadores mesclados com sucesso");
        qc.invalidateQueries({ queryKey: ["duplicate-candidates"] });
        qc.invalidateQueries({ queryKey: ["merge-logs"] });
        qc.invalidateQueries({ queryKey: ["workers"] });
      } else if (res?.result === "conflict") {
        toast.error("Merge bloqueado por conflito — revise antes de tentar novamente");
      }
    },
    onError: (e: unknown) => toast.error("Falha ao mesclar: " + (e as Error).message),
  });
}

export interface MergeLogEntry {
  id: string;
  action: string;
  record_id: string;
  old_data: any;
  new_data: any;
  created_at: string;
  changed_by: string | null;
}

export function useMergeLogs(limit = 30) {
  return useQuery({
    queryKey: ["merge-logs", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("change_logs")
        .select("id, action, record_id, old_data, new_data, created_at, changed_by")
        .eq("table_name", "workers")
        .in("action", ["merge_workers_success", "merge_conflict"])
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as MergeLogEntry[];
    },
  });
}