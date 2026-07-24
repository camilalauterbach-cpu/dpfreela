// Q-024.A — Canonical single source of worker qualification types.
// Backed by RPC `list_worker_qualification_types`. This hook is the ONLY
// source of eligibility for:
//   - Configurações → Cargos (requisitos documentais)
//   - Ficha do trabalhador (qualificações)
//   - SstCertificateDrawer (Q-024.D — TODO)
//   - Painel de Qualificações (Q-024.D+ — TODO)
//
// Never filter this catalog by:
//   - is_mandatory / required_by / job-role membership
//   - existência de documento no trabalhador
//   - vínculo atual do trabalhador
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WorkerQualificationCategory = "sst_nr" | "sst_aso" | "training";
export type WorkerQualificationStorageFlow =
  | "worker_sst_qualifications"
  | "worker_documents"
  | "unresolved";

export interface WorkerQualificationType {
  documentTypeId: string;
  code: string;
  normalizedCode: string;
  name: string;
  category: WorkerQualificationCategory;
  isActive: boolean;
  storageScope: string | null;
  storageFlow: WorkerQualificationStorageFlow;
  displayOrder: number;
  hasExpiration: boolean;
  defaultValidityDays: number | null;
  validityMode: string | null;
  validityValue: number | null;
  validityUnit: string | null;
  selectable: boolean;
  searchText: string;
}

interface RawRow {
  document_type_id: string;
  code: string;
  normalized_code: string;
  name: string;
  category: WorkerQualificationCategory;
  is_active: boolean;
  storage_scope: string | null;
  storage_flow: WorkerQualificationStorageFlow;
  display_order: number | null;
  has_expiration: boolean | null;
  default_validity_days: number | null;
  validity_mode: string | null;
  validity_value: number | null;
  validity_unit: string | null;
  selectable: boolean;
  search_text: string;
}

function mapRow(r: RawRow): WorkerQualificationType {
  return {
    documentTypeId: r.document_type_id,
    code: r.code,
    normalizedCode: r.normalized_code,
    name: r.name,
    category: r.category,
    isActive: r.is_active,
    storageScope: r.storage_scope,
    storageFlow: r.storage_flow,
    displayOrder: r.display_order ?? 0,
    hasExpiration: !!r.has_expiration,
    defaultValidityDays: r.default_validity_days,
    validityMode: r.validity_mode,
    validityValue: r.validity_value,
    validityUnit: r.validity_unit,
    selectable: r.selectable,
    searchText: r.search_text,
  };
}

/**
 * Normalize a user-typed search term for accent/case/hyphen-insensitive
 * matching against `WorkerQualificationType.searchText`.
 */
export function normalizeQualificationSearchTerm(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\-_]+/g, " ")
    .trim();
}

export function matchesQualificationSearch(
  type: Pick<WorkerQualificationType, "searchText" | "normalizedCode">,
  rawTerm: string,
): boolean {
  const term = normalizeQualificationSearchTerm(rawTerm);
  if (!term) return true;
  const compact = term.replace(/\s+/g, "");
  return (
    type.searchText.includes(term) ||
    type.normalizedCode.includes(compact)
  );
}

export const WORKER_QUALIFICATION_TYPES_KEY = ["worker-qualification-types"] as const;

export interface UseWorkerQualificationTypesOptions {
  includeInactive?: boolean;
  enabled?: boolean;
}

export function useWorkerQualificationTypes(
  opts: UseWorkerQualificationTypesOptions = {},
) {
  const includeInactive = !!opts.includeInactive;
  return useQuery({
    queryKey: [...WORKER_QUALIFICATION_TYPES_KEY, includeInactive ? "all" : "active"] as const,
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<WorkerQualificationType[]> => {
      const { data, error } = await supabase.rpc(
        "list_worker_qualification_types" as never,
        { p_include_inactive: includeInactive } as never,
      );
      if (error) throw error;
      return ((data ?? []) as RawRow[]).map(mapRow);
    },
  });
}