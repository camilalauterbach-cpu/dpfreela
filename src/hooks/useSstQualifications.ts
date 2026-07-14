import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ExpirationStatus = "valid" | "expiring_soon" | "expired" | "no_expiry";
export type DocumentStatus = "pending" | "ok" | "rejected";

export interface SstCurrentRow {
  id: string;
  worker_id: string;
  nr_code: string;
  training_type: string | null;
  issued_at: string;
  expires_at: string | null;
  workload_hours: number | null;
  provider_name: string | null;
  instructor_name: string | null;
  document_url: string | null;
  document_status: DocumentStatus;
  notes: string | null;
  expiration_status: ExpirationStatus;
}

export interface SstWorkerRow {
  worker_id: string;
  full_name: string;
  nickname: string | null;
  cpf: string | null;
  qualifications: SstCurrentRow[];
}

interface Filters {
  search: string;
  nr?: string;
  expiration?: "" | ExpirationStatus;
  doc?: "" | DocumentStatus;
}

export function useSstOverview(filters: Filters) {
  return useQuery({
    queryKey: ["sst-overview", filters],
    queryFn: async () => {
      const { data: quals, error } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("*");
      if (error) throw error;
      const rows = (quals || []) as SstCurrentRow[];

      const workerIds = Array.from(new Set(rows.map((r) => r.worker_id)));
      if (workerIds.length === 0) return { workers: [] as SstWorkerRow[] };

      const { data: workers, error: wErr } = await supabase
        .from("workers")
        .select("id, full_name, nickname, cpf")
        .in("id", workerIds)
        .is("deleted_at", null);
      if (wErr) throw wErr;

      const byWorker = new Map<string, SstWorkerRow>();
      for (const w of workers || []) {
        byWorker.set(w.id, {
          worker_id: w.id,
          full_name: w.full_name,
          nickname: w.nickname,
          cpf: w.cpf,
          qualifications: [],
        });
      }
      for (const r of rows) {
        const w = byWorker.get(r.worker_id);
        if (w) w.qualifications.push(r);
      }

      let list = Array.from(byWorker.values());

      const term = filters.search.trim().toLowerCase();
      if (term) {
        const digits = term.replace(/\D/g, "");
        list = list.filter((w) =>
          w.full_name.toLowerCase().includes(term) ||
          (w.nickname || "").toLowerCase().includes(term) ||
          (digits && (w.cpf || "").replace(/\D/g, "").includes(digits))
        );
      }
      if (filters.nr) {
        const nr = filters.nr.toUpperCase();
        list = list.filter((w) => w.qualifications.some((q) => q.nr_code === nr));
      }
      if (filters.expiration) {
        list = list.filter((w) =>
          w.qualifications.some((q) => q.expiration_status === filters.expiration)
        );
      }
      if (filters.doc) {
        list = list.filter((w) =>
          w.qualifications.some((q) => q.document_status === filters.doc)
        );
      }

      list.sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"));
      return { workers: list };
    },
    staleTime: 60_000,
  });
}

export function useSstSummary() {
  return useQuery({
    queryKey: ["sst-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("worker_id, expiration_status, document_status");
      if (error) throw error;
      const rows = (data || []) as Array<Pick<SstCurrentRow, "worker_id" | "expiration_status" | "document_status">>;
      const workers = new Set(rows.map((r) => r.worker_id));
      let expired = 0, expiring = 0, valid = 0, pending = 0;
      for (const r of rows) {
        if (r.expiration_status === "expired") expired++;
        else if (r.expiration_status === "expiring_soon") expiring++;
        else valid++;
        if (r.document_status === "pending") pending++;
      }
      return {
        totalWorkers: workers.size,
        totalQualifications: rows.length,
        expired,
        expiring,
        valid,
        pending,
      };
    },
    staleTime: 60_000,
  });
}