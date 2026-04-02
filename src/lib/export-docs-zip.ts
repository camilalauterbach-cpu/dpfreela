import JSZip from "jszip";
import { saveAs } from "file-saver";
import { supabase } from "@/integrations/supabase/client";

const sanitize = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "_").trim();

interface WorkerDocZipParams {
  workerIds: string[];
  workerInfoMap: Map<string, { full_name: string; cpf: string }>;
}

export async function exportWorkerDocsZip({ workerIds, workerInfoMap }: WorkerDocZipParams) {
  if (!workerIds.length) throw new Error("Nenhum trabalhador para exportar.");

  // Fetch all worker_documents for these workers
  const { data: docs, error } = await supabase
    .from("worker_documents")
    .select("id, worker_id, document_type, file_path, file_name")
    .in("worker_id", workerIds)
    .is("deleted_at", null);

  if (error) throw error;
  if (!docs?.length) throw new Error("Nenhum documento encontrado para os trabalhadores filtrados.");

  const zip = new JSZip();
  let fileCount = 0;

  for (const doc of docs) {
    if (!doc.file_path) continue;

    const info = workerInfoMap.get(doc.worker_id);
    const folderName = info
      ? sanitize(`${info.full_name}_${info.cpf}`)
      : doc.worker_id;

    const ext = doc.file_name?.split(".").pop() || "pdf";
    const fileName = `${sanitize(doc.document_type)}.${ext}`;

    try {
      const { data: fileData, error: dlError } = await supabase.storage
        .from("worker-documents")
        .download(doc.file_path);

      if (dlError || !fileData) continue;

      zip.file(`${folderName}/${fileName}`, fileData);
      fileCount++;
    } catch {
      // skip failed downloads
    }
  }

  if (fileCount === 0) throw new Error("Nenhum arquivo disponível para download.");

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `documentos_trabalhadores_${new Date().toISOString().slice(0, 10)}.zip`);
  return fileCount;
}
