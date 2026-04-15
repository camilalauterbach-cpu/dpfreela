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

// --- New: Download docs for a specific employment link ---

interface LinkDocZipParams {
  workerId: string;
  employmentLinkId: string;
  linkGroupWorkerId?: string;
  workerName: string;
  cpf: string;
  mode: "worker" | "event" | "all";
}

export async function exportLinkDocsZip({ workerId, employmentLinkId, linkGroupWorkerId, workerName, cpf, mode }: LinkDocZipParams) {
  const zip = new JSZip();
  let fileCount = 0;

  const folderBase = sanitize(`${workerName}_${cpf}`) || workerId;

  // Worker docs
  if (mode === "worker" || mode === "all") {
    const { data: wDocs } = await supabase
      .from("worker_documents")
      .select("id, document_type, category, file_path, file_name")
      .eq("worker_id", workerId)
      .is("deleted_at", null);

    const subFolder = mode === "all" ? "documentos_trabalhador" : "";

    for (const doc of wDocs || []) {
      if (!doc.file_path) continue;
      try {
        const { data: fileData, error } = await supabase.storage
          .from("worker-documents")
          .download(doc.file_path);
        if (error || !fileData) continue;

        const ext = doc.file_name?.split(".").pop() || "pdf";
        const baseName = sanitize(doc.category || doc.document_type);
        // For "outros" category, use filename to avoid collisions
        const fileName = doc.category === "outros"
          ? sanitize(doc.file_name || `outros_${doc.id}`)
          : `${baseName}.${ext}`;

        const path = subFolder ? `${subFolder}/${fileName}` : fileName;
        zip.file(path, fileData);
        fileCount++;
      } catch {
        // skip
      }
    }
  }

  // Event/link docs
  if (mode === "event" || mode === "all") {
    let eQuery = supabase
      .from("employment_link_documents")
      .select("id, document_type, category, file_path, file_name")
      .is("deleted_at", null);

    if (linkGroupWorkerId) {
      eQuery = (eQuery as any).eq("link_group_worker_id", linkGroupWorkerId);
    } else {
      eQuery = eQuery.eq("employment_link_id", employmentLinkId);
    }

    const { data: eDocs } = await eQuery;

    const subFolder = mode === "all" ? "documentos_evento" : "";

    for (const doc of eDocs || []) {
      if (!doc.file_path) continue;
      try {
        const { data: fileData, error } = await supabase.storage
          .from("link-documents")
          .download(doc.file_path);
        if (error || !fileData) continue;

        const ext = doc.file_name?.split(".").pop() || "pdf";
        const fileName = `${sanitize(doc.category || doc.document_type)}.${ext}`;

        const path = subFolder ? `${subFolder}/${fileName}` : fileName;
        zip.file(path, fileData);
        fileCount++;
      } catch {
        // skip
      }
    }
  }

  if (fileCount === 0) throw new Error("Nenhum arquivo disponível para download.");

  const dateStr = new Date().toISOString().slice(0, 10);
  const zipName = mode === "all"
    ? `documentos_${folderBase}_${dateStr}.zip`
    : mode === "worker"
      ? `docs_trabalhador_${folderBase}_${dateStr}.zip`
      : `docs_evento_${folderBase}_${dateStr}.zip`;

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, zipName);
  return fileCount;
}

// --- Export all docs for a link group, organized by worker folder ---

interface GroupDocZipWorker {
  workerId: string;
  linkGroupWorkerId: string;
  fullName: string;
  cpf: string;
}

interface GroupDocZipParams {
  groupName: string;
  workers: GroupDocZipWorker[];
}

export async function exportGroupDocsZip({ groupName, workers }: GroupDocZipParams) {
  if (!workers.length) throw new Error("Nenhum trabalhador alocado para exportar.");

  const zip = new JSZip();
  let fileCount = 0;
  const workerIds = workers.map((w) => w.workerId);
  const lgwIds = workers.map((w) => w.linkGroupWorkerId);

  // Fetch worker docs
  const { data: wDocs } = await supabase
    .from("worker_documents")
    .select("id, worker_id, document_type, category, file_path, file_name")
    .in("worker_id", workerIds)
    .is("deleted_at", null);

  // Fetch link docs by link_group_worker_id
  const { data: eDocs } = await supabase
    .from("employment_link_documents")
    .select("id, worker_id, document_type, category, file_path, file_name, link_group_worker_id")
    .in("link_group_worker_id", lgwIds)
    .is("deleted_at", null);

  // Build folder map
  const workerFolderMap = new Map<string, string>();
  const lgwToWorker = new Map<string, string>();
  for (const w of workers) {
    workerFolderMap.set(w.workerId, sanitize(`${w.fullName}_${w.cpf}`) || w.workerId);
    lgwToWorker.set(w.linkGroupWorkerId, w.workerId);
  }

  // Add worker docs
  for (const doc of wDocs || []) {
    if (!doc.file_path) continue;
    const folder = workerFolderMap.get(doc.worker_id) || doc.worker_id;
    try {
      const { data: fileData, error } = await supabase.storage.from("worker-documents").download(doc.file_path);
      if (error || !fileData) continue;
      const ext = doc.file_name?.split(".").pop() || "pdf";
      const fileName = doc.category === "outros"
        ? sanitize(doc.file_name || `outros_${doc.id}`)
        : `${sanitize(doc.category || doc.document_type)}.${ext}`;
      zip.file(`${folder}/documentos_trabalhador/${fileName}`, fileData);
      fileCount++;
    } catch { /* skip */ }
  }

  // Add event/link docs
  for (const doc of eDocs || []) {
    if (!doc.file_path || !doc.link_group_worker_id) continue;
    const wId = lgwToWorker.get(doc.link_group_worker_id) || doc.worker_id;
    const folder = workerFolderMap.get(wId) || wId;
    try {
      const { data: fileData, error } = await supabase.storage.from("link-documents").download(doc.file_path);
      if (error || !fileData) continue;
      const ext = doc.file_name?.split(".").pop() || "pdf";
      const fileName = `${sanitize(doc.category || doc.document_type)}.${ext}`;
      zip.file(`${folder}/documentos_evento/${fileName}`, fileData);
      fileCount++;
    } catch { /* skip */ }
  }

  if (fileCount === 0) throw new Error("Nenhum arquivo disponível para download.");

  const dateStr = new Date().toISOString().slice(0, 10);
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `documentos_${sanitize(groupName)}_${dateStr}.zip`);
  return fileCount;
}
