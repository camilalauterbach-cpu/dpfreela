import type { QueryClient } from "@tanstack/react-query";

/**
 * Fonte única de invalidação para cache de conformidade documental.
 * Deve ser chamada após qualquer mutação que afete os documentos do
 * trabalhador ou os requisitos por cargo: upload, exclusão, alteração
 * de validade, aprovação/rejeição, alteração de requisitos.
 */
export function invalidateComplianceCaches(
  queryClient: QueryClient,
  opts: { workerId?: string; linkId?: string } = {},
) {
  // Avaliação por vínculo
  queryClient.invalidateQueries({ queryKey: ["link-compliance"] });
  // Agregado do Dashboard
  queryClient.invalidateQueries({ queryKey: ["document-compliance-summary"] });
  // Listagem geral de conformidade
  queryClient.invalidateQueries({ queryKey: ["link-compliance-list"] });

  if (opts.workerId) {
    queryClient.invalidateQueries({ queryKey: ["worker-documents", opts.workerId] });
  }
  if (opts.linkId) {
    queryClient.invalidateQueries({ queryKey: ["link-compliance", opts.linkId] });
  }
}