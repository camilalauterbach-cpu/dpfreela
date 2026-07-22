// Fonte independente de colunas disponíveis para o Painel de Qualificações.
// Nunca depende de selectedColumnIds — sempre traz todos os document_types
// ativos das categorias sst_nr, sst_aso e training.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface QualColumnCatalogRow {
  document_type_id: string;
  code: string | null;
  name: string;
  category: "sst_nr" | "sst_aso" | "training";
  display_order: number;
}

export function useQualificationColumnCatalog() {
  return useQuery({
    queryKey: ["qualification-column-catalog"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<QualColumnCatalogRow[]> => {
      const { data, error } = await supabase
        .from("document_types")
        .select("id, code, name, category, display_order, is_active")
        .eq("is_active", true)
        .in("category", ["sst_nr", "sst_aso", "training"] as any)
        .order("display_order", { ascending: true })
        .order("code", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        document_type_id: r.id,
        code: r.code,
        name: r.name,
        category: r.category,
        display_order: r.display_order ?? 0,
      }));
    },
  });
}