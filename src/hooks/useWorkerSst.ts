// E-SST.2.A — Hooks de leitura para a experiência operacional SST no WorkerDetail.
// Consomem apenas o que já existe no backend (views/tabelas + RPCs de E-SST.1A/1B/1C).
// Não introduzem novo contrato — o backend permanece congelado.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SstCurrentRow } from "@/hooks/useSstQualifications";

// -----------------------------------------------------------------------------
// 1) Qualificações ATUAIS de um trabalhador (view canônica _current).
//    Cada linha = uma NR na sua versão vigente (chain_key).
// -----------------------------------------------------------------------------
export function useWorkerSstQualifications(workerId: string | undefined) {
  return useQuery({
    queryKey: ["worker-sst-current", workerId],
    enabled: !!workerId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("*")
        .eq("worker_id", workerId);
      if (error) throw error;
      const rows = ((data || []) as SstCurrentRow[]).sort((a, b) =>
        a.nr_code.localeCompare(b.nr_code, "pt-BR"),
      );
      return rows;
    },
  });
}

// -----------------------------------------------------------------------------
// 2) Histórico completo (revisões) de uma NR específica do trabalhador.
//    Carregado SOB DEMANDA (só quando o drawer/timeline abre).
// -----------------------------------------------------------------------------
export interface SstHistoryRow {
  id: string;
  nr_code: string;
  chain_key: string;
  revision_type: string;
  revision_reason: string | null;
  issued_at: string;
  expires_at: string | null;
  workload_hours: number | null;
  provider_name: string | null;
  instructor_name: string | null;
  document_url: string | null;
  document_status: string;
  validity_status: string;
  source_type: string;
  notes: string | null;
  is_current: boolean;
  superseded_at: string | null;
  superseded_by: string | null;
  created_at: string;
  created_by: string | null;
}

export function useSstQualificationHistory(
  workerId: string | undefined,
  nrCode: string | undefined,
  opts?: { enabled?: boolean },
) {
  const enabled = !!workerId && !!nrCode && (opts?.enabled ?? true);
  return useQuery({
    queryKey: ["worker-sst-history", workerId, nrCode],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_sst_qualifications")
        .select(
          "id, nr_code, chain_key, revision_type, revision_reason, issued_at, expires_at, workload_hours, provider_name, instructor_name, document_url, document_status, validity_status, source_type, notes, supersedes_id, superseded_at, created_at, created_by",
        )
        .eq("worker_id", workerId)
        .eq("nr_code", nrCode)
        .order("issued_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      // A tabela não possui colunas `is_current` nem `superseded_by`; derivamos
      // `is_current` a partir de `superseded_at IS NULL` e expomos
      // `superseded_by` como alias de `supersedes_id` para manter o contrato.
      return ((data || []) as any[]).map((r) => ({
        ...r,
        is_current: r.superseded_at == null,
        superseded_by: r.supersedes_id ?? null,
      })) as SstHistoryRow[];
    },
  });
}

// -----------------------------------------------------------------------------
// 3) Vínculos ativos do trabalhador que EXIGEM uma NR específica (por cargo).
//    Considera precedência: override waive/add do vínculo tem prioridade sobre
//    a exigência do cargo (job_role_document_requirements).
//    Retorna cada vínculo com dados amigáveis (evento → grupo → cargo).
// -----------------------------------------------------------------------------
export interface LinkUsingNrRow {
  link_id: string;
  event_id: string | null;
  event_name: string | null;
  link_group_id: string | null;
  link_group_name: string | null;
  job_role_id: string | null;
  job_role_name: string | null;
  required_by: "job_role" | "link_override";
  override_action: "add" | "waive" | null;
  status: string | null;
}

export function useSstLinksUsingNr(
  workerId: string | undefined,
  documentTypeId: string | undefined,
  opts?: { enabled?: boolean },
) {
  const enabled = !!workerId && !!documentTypeId && (opts?.enabled ?? true);
  return useQuery({
    queryKey: ["worker-sst-links-using", workerId, documentTypeId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      // 1) vínculos ativos do trabalhador
      const { data: links, error: eLinks } = await (supabase as any)
        .from("employment_links")
        .select(
          "id, worker_id, event_id, link_group_id, job_role_id, status, deleted_at, events:event_id(id,name), link_groups:link_group_id(id,name), job_roles:job_role_id(id,name)",
        )
        .eq("worker_id", workerId)
        .is("deleted_at", null);
      if (eLinks) throw eLinks;
      const linksArr = (links || []) as any[];
      if (linksArr.length === 0) return [] as LinkUsingNrRow[];

      const linkIds = linksArr.map((l) => l.id);
      const jobRoleIds = Array.from(
        new Set(linksArr.map((l) => l.job_role_id).filter(Boolean)),
      );

      // 2) requisitos do cargo para o document_type
      const roleRequires = new Set<string>();
      if (jobRoleIds.length > 0) {
        const { data: reqs, error: eReq } = await (supabase as any)
          .from("job_role_document_requirements")
          .select("job_role_id, is_mandatory")
          .eq("document_type_id", documentTypeId)
          .in("job_role_id", jobRoleIds)
          .eq("is_mandatory", true);
        if (eReq) throw eReq;
        for (const r of (reqs || []) as any[]) roleRequires.add(r.job_role_id);
      }

      // 3) overrides ativos por vínculo para o document_type
      const overrideByLink = new Map<string, "add" | "waive">();
      const { data: ovs, error: eOv } = await (supabase as any)
        .from("employment_link_document_overrides")
        .select("employment_link_id, action")
        .in("employment_link_id", linkIds)
        .eq("document_type_id", documentTypeId)
        .is("deleted_at", null);
      if (eOv) throw eOv;
      for (const o of (ovs || []) as any[]) {
        overrideByLink.set(o.employment_link_id, o.action);
      }

      // 4) resolve precedência (waive > add > job_role)
      const out: LinkUsingNrRow[] = [];
      for (const l of linksArr) {
        const ov = overrideByLink.get(l.id) || null;
        const roleRequired = l.job_role_id ? roleRequires.has(l.job_role_id) : false;

        let required = false;
        let requiredBy: LinkUsingNrRow["required_by"] = "job_role";
        if (ov === "waive") required = false;
        else if (ov === "add") {
          required = true;
          requiredBy = "link_override";
        } else if (roleRequired) {
          required = true;
          requiredBy = "job_role";
        }

        if (!required) continue;
        out.push({
          link_id: l.id,
          event_id: l.events?.id ?? l.event_id ?? null,
          event_name: l.events?.name ?? null,
          link_group_id: l.link_groups?.id ?? l.link_group_id ?? null,
          link_group_name: l.link_groups?.name ?? null,
          job_role_id: l.job_roles?.id ?? l.job_role_id ?? null,
          job_role_name: l.job_roles?.name ?? null,
          required_by: requiredBy,
          override_action: ov,
          status: l.status ?? null,
        });
      }

      out.sort((a, b) =>
        (a.event_name || "").localeCompare(b.event_name || "", "pt-BR"),
      );
      return out;
    },
  });
}

// -----------------------------------------------------------------------------
// 4) Resumo do bloco SST do trabalhador (5 KPIs para o card superior).
//    Deriva do próprio hook de qualificações + contagem única de vínculos que
//    exigem NRs (via job_role_document_requirements + overrides).
// -----------------------------------------------------------------------------
export interface WorkerSstSummary {
  valid: number;
  expiringSoon: number;
  expired: number;
  pendingDocs: number;
  activeLinksUsingSst: number;
}

export function useWorkerSstSummary(workerId: string | undefined) {
  return useQuery({
    queryKey: ["worker-sst-summary", workerId],
    enabled: !!workerId,
    staleTime: 120_000,
    queryFn: async (): Promise<WorkerSstSummary> => {
      // qualificações atuais
      const { data: quals, error: eQ } = await (supabase as any)
        .from("worker_sst_qualifications_current")
        .select("expiration_status, document_status")
        .eq("worker_id", workerId);
      if (eQ) throw eQ;

      let valid = 0, expiringSoon = 0, expired = 0, pendingDocs = 0;
      for (const r of (quals || []) as any[]) {
        if (r.expiration_status === "expired") expired++;
        else if (r.expiration_status === "expiring_soon") expiringSoon++;
        else valid++;
        if (r.document_status !== "ok") pendingDocs++;
      }

      // vínculos ativos que envolvem alguma NR (cargo exige ou override 'add')
      const { data: links, error: eL } = await (supabase as any)
        .from("employment_links")
        .select("id, job_role_id")
        .eq("worker_id", workerId)
        .is("deleted_at", null);
      if (eL) throw eL;
      const linksArr = (links || []) as any[];
      const linkIds = linksArr.map((l) => l.id);
      const jobRoleIds = Array.from(
        new Set(linksArr.map((l) => l.job_role_id).filter(Boolean)),
      );

      const linksWithSst = new Set<string>();

      if (jobRoleIds.length > 0) {
        const { data: reqs, error: eR } = await (supabase as any)
          .from("job_role_document_requirements")
          .select("job_role_id, document_types:document_type_id(category)")
          .in("job_role_id", jobRoleIds)
          .eq("is_mandatory", true);
        if (eR) throw eR;
        const rolesWithSst = new Set<string>();
        for (const r of (reqs || []) as any[]) {
          if (r.document_types?.category === "sst_nr") rolesWithSst.add(r.job_role_id);
        }
        for (const l of linksArr) {
          if (l.job_role_id && rolesWithSst.has(l.job_role_id)) linksWithSst.add(l.id);
        }
      }

      if (linkIds.length > 0) {
        const { data: ovs, error: eO } = await (supabase as any)
          .from("employment_link_document_overrides")
          .select("employment_link_id, action, document_types:document_type_id(category)")
          .in("employment_link_id", linkIds)
          .is("deleted_at", null);
        if (eO) throw eO;
        for (const o of (ovs || []) as any[]) {
          if (o.document_types?.category !== "sst_nr") continue;
          if (o.action === "add") linksWithSst.add(o.employment_link_id);
          else if (o.action === "waive") linksWithSst.delete(o.employment_link_id);
        }
      }

      return {
        valid,
        expiringSoon,
        expired,
        pendingDocs,
        activeLinksUsingSst: linksWithSst.size,
      };
    },
  });
}