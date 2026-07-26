import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Upload, FileText, Image as ImageIcon, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw, Loader2, Eye, Plus, CreditCard, ExternalLink, FileDown, Trash2,
} from "lucide-react";
import {
  REQUIRED_DOC_CATEGORIES,
  CONDITIONAL_DOC_CATEGORIES,
  DOC_CATEGORY_LABELS,
  DOC_STATUS_LABELS,
} from "@/lib/worker-completeness";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BankDataForm } from "./BankDataForm";
import { validateUpload, ALLOWED_FILE_EXTENSIONS, getSafeContentType } from "@/lib/upload-validation";
import { invalidateComplianceCaches } from "@/lib/compliance-cache";
import { WorkerDocumentRevisionPanel } from "./WorkerDocumentRevisionPanel";
import { formatSupabaseErrorForUser } from "@/lib/format-error";
import { registerWorkerDocumentRevision } from "@/lib/worker-document-revisions";

interface Props {
  workerId: string;
  workerName?: string;
  workerCpf?: string;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  uploaded: <AlertCircle className="h-3 w-3" />,
  approved: <CheckCircle2 className="h-3 w-3" />,
  rejected: <XCircle className="h-3 w-3" />,
  replace: <RefreshCw className="h-3 w-3" />,
};

const STATUS_VARIANT: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  uploaded: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  replace: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

export function DocumentChecklist({ workerId, workerName, workerCpf }: Props) {
  const { hasAnyRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedDocumentTypeId = searchParams.get("document_type_id");

  const clearFocusedDocType = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("document_type_id");
    setSearchParams(next, { replace: true });
  };

  // Canonical map: legacy category code (lowercased) → document_types row.
  // Identity for uploads travels via document_type_id; the textual `category`
  // column is kept only for legacy read paths still in transition.
  const { data: typesByCategory } = useQuery({
    queryKey: ["worker-doc-types-by-category"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_types")
        .select("id, code, category, storage_scope, is_active, completion_requirement, validity_mode");
      if (error) throw error;
      const map = new Map<string, { id: string; code: string; category: string | null; storage_scope: string | null; completion_requirement: string | null; validity_mode: string | null }>();
      for (const r of data ?? []) {
        const key = (r as any).code?.toLowerCase();
        if (key && !map.has(key)) map.set(key, r as any);
      }
      return map;
    },
  });

  const resolveTypeForCategory = (category: string) => {
    return typesByCategory?.get(category.toLowerCase()) ?? null;
  };

  // Reverse lookup: focused document_type_id → category (used to scroll,
  // highlight and auto-open the file picker for the correct card).
  const focusedCategory = useMemo(() => {
    if (!focusedDocumentTypeId || !typesByCategory) return null;
    for (const [code, row] of typesByCategory.entries()) {
      if (row.id === focusedDocumentTypeId) return code;
    }
    return null;
  }, [focusedDocumentTypeId, typesByCategory]);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const focusHandledRef = useRef<string | null>(null);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["worker-documents", workerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_documents")
        .select("*")
        .eq("worker_id", workerId)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  // Extra files attached to a worker document (e.g. RG front + back within a
  // single canonical `rg` row). Keyed by worker_document_id → files[].
  const sortDocsByCurrentRevision = (rows: any[] = []) => {
    return [...rows].sort((a, b) => {
      const aCurrent = a.revision_managed && a.is_current ? 1 : 0;
      const bCurrent = b.revision_managed && b.is_current ? 1 : 0;
      if (aCurrent !== bCurrent) return bCurrent - aCurrent;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
  };

  const getDocForCategory = (category: string) => {
    const docType = resolveTypeForCategory(category);
    const candidates = sortDocsByCurrentRevision(docs ?? []).filter((d: any) => {
      if (docType?.id && d.document_type_id === docType.id) return true;
      return d.category === category || d.document_type === category;
    });
    return candidates[0] ?? null;
  };

  const getDocsForCategory = (category: string) => {
    const docType = resolveTypeForCategory(category);
    return sortDocsByCurrentRevision(docs ?? []).filter((d: any) => {
      if (docType?.id && d.document_type_id === docType.id) return true;
      return d.category === category || d.document_type === category;
    });
  };

  const getCurrentManagedDocForCategory = (category: string) => {
    const docType = resolveTypeForCategory(category);
    if (!docType?.id) return null;
    return sortDocsByCurrentRevision(docs ?? []).find((d: any) =>
      d.document_type_id === docType.id && d.revision_managed && d.is_current,
    ) ?? null;
  };

  const rgDoc = getDocForCategory("rg");
  const { data: rgFiles } = useQuery({
    enabled: !!rgDoc?.id,
    queryKey: ["worker-document-files", rgDoc?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("worker_document_files")
        .select("*")
        .eq("worker_document_id", rgDoc!.id)
        .is("deleted_at", null)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as Array<{ id: string; file_path: string; file_name: string | null; mime_type: string | null; position: number }>;
    },
  });

  const addRgAttachment = async (file: File) => {
    if (!rgDoc) {
      toast({ title: "Envie primeiro o arquivo principal do RG", variant: "destructive" });
      return;
    }
    const validationError = validateUpload(file);
    if (validationError) { toast({ title: "Arquivo inválido", description: validationError, variant: "destructive" }); return; }
    const ext = file.name.split(".").pop();
    const path = `${workerId}/rg/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("worker-documents")
      .upload(path, file, { contentType: getSafeContentType(file) });
    if (upErr) { toast({ title: "Erro no upload", description: upErr.message, variant: "destructive" }); return; }
    const nextPos = ((rgFiles?.length ?? 0) + 1);
    const { error } = await (supabase as any).from("worker_document_files").insert({
      worker_document_id: rgDoc.id,
      file_path: path,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      position: nextPos,
      origin: "attachment",
    });
    if (error) {
      await supabase.storage.from("worker-documents").remove([path]).catch(() => {});
      toast({ title: "Erro ao anexar", description: formatSupabaseErrorForUser(error), variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["worker-document-files", rgDoc.id] });
    toast({ title: "Arquivo anexado ao RG" });
  };

  const removeRgAttachment = async (fileRow: { id: string; file_path: string }) => {
    const { error } = await (supabase as any)
      .from("worker_document_files")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", fileRow.id);
    if (error) { toast({ title: "Erro ao remover", description: error.message, variant: "destructive" }); return; }
    await supabase.storage.from("worker-documents").remove([fileRow.file_path]).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["worker-document-files", rgDoc?.id] });
    toast({ title: "Arquivo removido" });
  };

  const previewAttachment = async (fileRow: { file_path: string; file_name: string | null; mime_type: string | null }) => {
    try {
      const { data, error } = await supabase.storage
        .from("worker-documents")
        .createSignedUrl(fileRow.file_path, 300);
      if (error || !data?.signedUrl) throw new Error("Falha ao gerar URL");
      setPreviewUrl(data.signedUrl);
      setPreviewMime(fileRow.mime_type);
      setPreviewFileName(fileRow.file_name || "documento");
      setPreviewError(false);
    } catch {
      setPreviewError(true);
      setPreviewUrl("error");
    }
  };

  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewFileName, setPreviewFileName] = useState<string>("");
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankReplaceAction, setBankReplaceAction] = useState<"upload" | "form" | null>(null);
  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState<any | null>(null);
  const [pendingDatedUpload, setPendingDatedUpload] = useState<{
    category: string;
    file: File;
    alwaysInsert?: boolean;
    requiresExplicitExpiry: boolean;
  } | null>(null);
  const [pendingIssuedAt, setPendingIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [pendingExplicitExpiresAt, setPendingExplicitExpiresAt] = useState("");

  // When arriving with ?document_type_id=…, scroll to the card, ring-highlight
  // it and open the file picker so the user reaches the action in one click.
  useEffect(() => {
    if (!focusedDocumentTypeId || !focusedCategory) return;
    if (focusHandledRef.current === focusedDocumentTypeId) return;
    focusHandledRef.current = focusedDocumentTypeId;

    const el = cardRefs.current[focusedCategory];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "ring-offset-2");
      window.setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "ring-offset-2");
      }, 2500);
    }

    if (canEdit && focusedCategory !== "bank_document") {
      // Small delay so the scroll animation is visible before the OS picker opens.
      window.setTimeout(() => handleFileSelect(focusedCategory), 350);
    }

    // Consume the query param once acted upon.
    const next = new URLSearchParams(searchParams);
    next.delete("document_type_id");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedDocumentTypeId, focusedCategory, canEdit]);

  const uploadMutation = useMutation({
   mutationFn: async ({
      category,
      file,
      alwaysInsert,
      issuedAt,
      explicitExpiresAt,
    }: {
      category: string;
      file: File;
      alwaysInsert?: boolean;
      issuedAt?: string | null;
      explicitExpiresAt?: string | null;
    }) => {
      const validationError = validateUpload(file);
      if (validationError) throw new Error(validationError);
      const ext = file.name.split(".").pop();
      const path = `${workerId}/${category}/${Date.now()}.${ext}`;

      const docType = resolveTypeForCategory(category);
      const documentTypeId = docType?.id ?? null;

      // Worker-scoped canonical types go through register_worker_document_revision.
      // The RPC locks (worker_id + document_type_id), invalidates the previous
      // current revision, inserts the new current row and emits audit.
      const useCanonicalRpc = !!docType && docType.storage_scope === "worker" && !!documentTypeId;

      const { error: uploadErr } = await supabase.storage
        .from("worker-documents")
        .upload(path, file, { upsert: !useCanonicalRpc, contentType: getSafeContentType(file) });
      if (uploadErr) throw uploadErr;

      if (useCanonicalRpc) {
        const currentDoc = getCurrentManagedDocForCategory(category);
        try {
          await registerWorkerDocumentRevision(supabase as any, {
            workerId,
            documentTypeId,
            currentDocumentId: currentDoc?.id ?? null,
            filePath: path,
            fileName: file.name,
            fileSize: file.size,
            mimeType: getSafeContentType(file),
            status: "uploaded",
            issuedAt: issuedAt ?? null,
            explicitExpiresAt: explicitExpiresAt ?? null,
          });
        } catch (rpcErr) {
          await supabase.storage.from("worker-documents").remove([path]).catch(() => {});
          throw rpcErr;
        }
        return;
      }

      // Compensable write: if the DB row fails to persist, remove the just-
      // uploaded storage object. The PREVIOUS storage object (if any) is
      // preserved — we only commit removal via soft-delete flows elsewhere.
      const cleanupOnFail = async () => {
        await supabase.storage.from("worker-documents").remove([path]).catch(() => {});
      };

      if (alwaysInsert) {
        const { error } = await supabase
          .from("worker_documents")
          .insert({
            worker_id: workerId,
            document_type: category,
            category,
            document_type_id: documentTypeId,
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            status: "uploaded",
          });
        if (error) { await cleanupOnFail(); throw error; }
        return;
      }

      const existing = getDocForCategory(category);
      if (existing) {
        const { error } = await supabase
          .from("worker_documents")
          .update({
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            status: "uploaded",
            document_type_id: documentTypeId ?? existing.document_type_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) { await cleanupOnFail(); throw error; }
      } else {
        const { error } = await supabase
          .from("worker_documents")
          .insert({
            worker_id: workerId,
            document_type: category,
            category,
            document_type_id: documentTypeId,
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            status: "uploaded",
          });
        if (error) { await cleanupOnFail(); throw error; }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-documents", workerId] });
      queryClient.invalidateQueries({ queryKey: ["worker-doc-revisions", workerId] });
      queryClient.invalidateQueries({ queryKey: ["worker-qualifications-unified-docs", workerId] });
      // Canonical completion cache — badge, checklist and link-activation
      // gates all subscribe to this key.
      queryClient.invalidateQueries({ queryKey: ["worker-completion", workerId] });
      invalidateComplianceCaches(queryClient, { workerId, eventSource: "upload" });
      setUploadingCategory(null);
      toast({ title: "Documento enviado" });
    },
    onError: (err: any) => {
      setUploadingCategory(null);
      toast({ title: "Erro ao enviar", description: formatSupabaseErrorForUser(err), variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ docId, status }: { docId: string; status: string }) => {
      const { error } = await supabase
        .from("worker_documents")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", docId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-documents", workerId] });
      queryClient.invalidateQueries({ queryKey: ["worker-completion", workerId] });
      invalidateComplianceCaches(queryClient, { workerId, eventSource: "admin_update" });
      toast({ title: "Status atualizado" });
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: async (docs: Array<{ id: string; file_path?: string | null }>) => {
      for (const d of docs) {
        const { error } = await supabase
          .from("worker_documents")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", d.id);
        if (error) throw error;
        if (d.file_path) {
          // best-effort storage cleanup; ignore failures so the DB soft-delete stands
          await supabase.storage.from("worker-documents").remove([d.file_path]).catch(() => {});
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-documents", workerId] });
      queryClient.invalidateQueries({ queryKey: ["worker-completion", workerId] });
      invalidateComplianceCaches(queryClient, { workerId, eventSource: "admin_update" });
    },
  });

  const handleFileSelect = (category: string, alwaysInsert = false) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        if (file.size > 10 * 1024 * 1024) {
          toast({ title: "Arquivo muito grande", description: "Máximo 10MB", variant: "destructive" });
          return;
        }
        const docType = resolveTypeForCategory(category);
        const requiresIssuedAt = docType?.storage_scope === "worker"
          && (docType.validity_mode === "fixed_duration" || docType.validity_mode === "explicit_date");
        if (requiresIssuedAt) {
          setPendingIssuedAt(new Date().toISOString().slice(0, 10));
          setPendingExplicitExpiresAt("");
          setPendingDatedUpload({
            category,
            file,
            alwaysInsert,
            requiresExplicitExpiry: docType?.validity_mode === "explicit_date",
          });
          return;
        }
        uploadMutation.mutate({ category, file, alwaysInsert });
        setUploadingCategory(category);
      }
    };
    input.click();
  };

  const handlePreview = async (doc: any) => {
    if (!doc.file_path) return;
    const resolvedName = doc.file_name || doc.file_path.split("/").pop() || "documento";
    try {
      const { data, error } = await supabase.storage
        .from("worker-documents")
        .createSignedUrl(doc.file_path, 300);
      if (error || !data?.signedUrl) throw new Error("Falha ao gerar URL");
      setPreviewUrl(data.signedUrl);
      setPreviewMime(doc.mime_type);
      setPreviewFileName(resolvedName);
      setPreviewError(false);
    } catch {
      setPreviewError(true);
      setPreviewFileName(resolvedName);
      setPreviewUrl("error");
      toast({ title: "Erro no preview", description: "Não foi possível carregar o preview deste documento.", variant: "destructive" });
    }
  };

  // Bank document actions with coexistence/replace dialog
  const bankDocs = getDocsForCategory("bank_document");
  const hasBankDocs = bankDocs.length > 0;

  const handleBankUpload = () => {
    if (hasBankDocs) {
      setBankReplaceAction("upload");
    } else {
      handleFileSelect("bank_document", true);
    }
  };

  const handleBankForm = () => {
    if (hasBankDocs) {
      setBankReplaceAction("form");
    } else {
      setShowBankForm(true);
    }
  };

  const handleBankReplaceConfirm = async (mode: "add" | "replace") => {
    const action = bankReplaceAction;
    setBankReplaceAction(null);

    // Não desativa o comprovante anterior antes do novo registro existir.
    // Upload manual e formulário bancário passam por RPCs canônicas que promovem
    // a nova revisão de forma atômica; se falharem, o documento vigente segue intacto.
    if (action === "upload") {
      handleFileSelect("bank_document", true);
    } else {
      setShowBankForm(true);
    }
  };

  const renderDocCard = (category: string, _legacyRequiredFlag: boolean) => {
    // bank_document has its own dedicated section
    if (category === "bank_document") return null;

    const doc = getDocForCategory(category);
    const status = doc?.status || "pending";
    const isRg = category === "rg";
    const attachments = isRg ? (rgFiles ?? []) : [];
    // Canonical required = document_types.completion_requirement === 'required'.
    // Fall back to false while types are loading so we never mislabel optional
    // documents (PIS, reservista, CNH…) with a mandatory asterisk.
    const docType = resolveTypeForCategory(category);
    const required = docType?.completion_requirement === "required";
    const optional = docType?.completion_requirement === "optional";

    return (
      <Card
        key={category}
        ref={(el) => { cardRefs.current[category] = el as unknown as HTMLDivElement | null; }}
        data-category={category}
        className="overflow-hidden transition-shadow"
      >
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {doc?.mime_type?.startsWith("image/") ? (
                <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-medium truncate">{DOC_CATEGORY_LABELS[category]}</span>
              {required && <span className="text-destructive text-xs" aria-label="Obrigatório">*</span>}
              {optional && (
                <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 text-muted-foreground border-muted">
                  Opcional
                </Badge>
              )}
            </div>
            <Badge variant="outline" className={`text-xs shrink-0 ${STATUS_VARIANT[status]}`}>
              {STATUS_ICON[status]}
              <span className="ml-1">{DOC_STATUS_LABELS[status]}</span>
            </Badge>
          </div>

          {doc?.file_name && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p className="truncate">{doc.file_name}</p>
              <p>{new Date(doc.updated_at).toLocaleDateString("pt-BR")}</p>
            </div>
          )}

          <div className="flex gap-1 flex-wrap">
            {doc?.file_path && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlePreview(doc)}>
                <Eye className="mr-1 h-3 w-3" /> Ver
              </Button>
            )}
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleFileSelect(category)}
                  disabled={uploadMutation.isPending && uploadingCategory === category}
                >
                  {uploadMutation.isPending && uploadingCategory === category ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-3 w-3" />
                  )}
                  {doc ? "Atualizar" : "Anexar"}
                </Button>
                {doc && status !== "approved" && (
                  <Select
                    value={status}
                    onValueChange={(v) => statusMutation.mutate({ docId: doc.id, status: v })}
                  >
                    <SelectTrigger className="h-7 text-xs w-auto min-w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="uploaded">Enviado</SelectItem>
                      <SelectItem value="approved">Aprovado</SelectItem>
                      <SelectItem value="rejected">Rejeitado</SelectItem>
                      <SelectItem value="replace">Substituir</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {doc && status === "approved" && canEdit && (
                  <Select
                    value={status}
                    onValueChange={(v) => statusMutation.mutate({ docId: doc.id, status: v })}
                  >
                    <SelectTrigger className="h-7 text-xs w-auto min-w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approved">Aprovado</SelectItem>
                      <SelectItem value="replace">Substituir</SelectItem>
                      <SelectItem value="rejected">Rejeitado</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {doc && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirmDoc(doc)}
                    aria-label="Excluir documento"
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Excluir
                  </Button>
                )}
              </>
            )}
          </div>

          {isRg && doc && (
            <div className="pt-2 border-t border-border space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Arquivos anexados ({attachments.length})
                </span>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*,.pdf";
                      input.onchange = (e) => {
                        const f = (e.target as HTMLInputElement).files?.[0];
                        if (f) addRgAttachment(f);
                      };
                      input.click();
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" /> Adicionar arquivo
                  </Button>
                )}
              </div>
              {attachments.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum anexo adicional.</p>
              )}
              {attachments.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate flex items-center gap-1 min-w-0">
                    {f.mime_type?.startsWith("image/")
                      ? <ImageIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                      : <FileText className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <span className="truncate">{f.file_name || `Anexo ${f.position}`}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => previewAttachment(f)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeRgAttachment({ id: f.id, file_path: f.file_path })}
                        aria-label="Remover anexo"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Bank document dedicated section
  const renderBankDocumentSection = () => {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{DOC_CATEGORY_LABELS["bank_document"]}</span>
              <span className="text-destructive text-xs">*</span>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleBankUpload}
                  disabled={uploadMutation.isPending && uploadingCategory === "bank_document"}
                >
                  {uploadMutation.isPending && uploadingCategory === "bank_document" ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-3 w-3" />
                  )}
                  Enviar comprovante
                </Button>
                {workerName && workerCpf && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleBankForm}
                  >
                    <CreditCard className="mr-1 h-3 w-3" />
                    Preencher dados bancários
                  </Button>
                )}
              </div>
            )}
          </div>

          {bankDocs.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum comprovante bancário enviado.</p>
          )}

          {bankDocs.map((doc) => {
            const status = doc.status || "pending";
            const isAutoGenerated = doc.notes === "auto_generated";
            return (
              <div key={doc.id} className="flex items-center justify-between gap-2 py-2 border-t border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm truncate">{doc.file_name || "Arquivo"}</p>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${isAutoGenerated ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-muted text-muted-foreground"}`}>
                        {isAutoGenerated ? "Gerado pelo sistema" : "Upload manual"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{new Date(doc.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className={`text-xs ${STATUS_VARIANT[status]}`}>
                    {STATUS_ICON[status]}
                    <span className="ml-1">{DOC_STATUS_LABELS[status]}</span>
                  </Badge>
                  {doc.file_path && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlePreview(doc)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                  )}
                  {canEdit && (
                    <Select
                      value={status}
                      onValueChange={(v) => statusMutation.mutate({ docId: doc.id, status: v })}
                    >
                      <SelectTrigger className="h-7 text-xs w-auto min-w-[90px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pendente</SelectItem>
                        <SelectItem value="uploaded">Enviado</SelectItem>
                        <SelectItem value="approved">Aprovado</SelectItem>
                        <SelectItem value="rejected">Rejeitado</SelectItem>
                        <SelectItem value="replace">Substituir</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteConfirmDoc(doc)}
                      aria-label="Excluir documento"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  };

  // Render "Outros" section with multiple files
  const renderOutrosSection = () => {
    const outrosDocs = getDocsForCategory("outros");

    return (
      <Card className="overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{DOC_CATEGORY_LABELS["outros"]}</span>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => handleFileSelect("outros", true)}
                disabled={uploadMutation.isPending && uploadingCategory === "outros"}
              >
                {uploadMutation.isPending && uploadingCategory === "outros" ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-3 w-3" />
                )}
                Adicionar documento
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground italic">
            Documentos de filhos, declaração racial, comprovantes complementares, etc.
          </p>

          {outrosDocs.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum documento complementar enviado.</p>
          )}

          {outrosDocs.map((doc) => {
            const status = doc.status || "pending";
            return (
              <div key={doc.id} className="flex items-center justify-between gap-2 py-2 border-t border-border">
                <div className="flex items-center gap-2 min-w-0">
                  {doc.mime_type?.startsWith("image/") ? (
                    <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm truncate">{doc.file_name || "Arquivo"}</p>
                    <p className="text-xs text-muted-foreground">{new Date(doc.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className={`text-xs ${STATUS_VARIANT[status]}`}>
                    {STATUS_ICON[status]}
                    <span className="ml-1">{DOC_STATUS_LABELS[status]}</span>
                  </Badge>
                  {doc.file_path && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlePreview(doc)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                  )}
                  {canEdit && (
                    <Select
                      value={status}
                      onValueChange={(v) => statusMutation.mutate({ docId: doc.id, status: v })}
                    >
                      <SelectTrigger className="h-7 text-xs w-auto min-w-[90px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pendente</SelectItem>
                        <SelectItem value="uploaded">Enviado</SelectItem>
                        <SelectItem value="approved">Aprovado</SelectItem>
                        <SelectItem value="rejected">Rejeitado</SelectItem>
                        <SelectItem value="replace">Substituir</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteConfirmDoc(doc)}
                      aria-label="Excluir documento"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const requiredWithoutBank = REQUIRED_DOC_CATEGORIES.filter((c) => c !== "bank_document");
  const conditionalWithoutOutros = CONDITIONAL_DOC_CATEGORIES.filter((c) => c !== "outros");

  return (
    <div className="space-y-6">
      {focusedDocumentTypeId && !focusedCategory && (
        <WorkerDocumentRevisionPanel
          workerId={workerId}
          documentTypeId={focusedDocumentTypeId}
          onClose={clearFocusedDocType}
        />
      )}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Documentos obrigatórios</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {requiredWithoutBank.map((c) => renderDocCard(c, true))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Documento bancário</h3>
        {renderBankDocumentSection()}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Documentos condicionais</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {conditionalWithoutOutros.map((c) => renderDocCard(c, false))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Outros documentos</h3>
        {renderOutrosSection()}
      </div>

      {/* Preview dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => { setPreviewUrl(null); setPreviewError(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview do documento</DialogTitle>
          </DialogHeader>
          {previewFileName && (
            <p className="text-sm text-muted-foreground truncate -mt-2">{previewFileName}</p>
          )}
          {previewUrl && (
            previewError ? (
              <div className="flex flex-col items-center gap-4 py-8 px-4 rounded-md border border-dashed border-border bg-muted/30">
                <AlertCircle className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  Não foi possível carregar o preview deste documento.
                </p>
              </div>
            ) : previewMime?.startsWith("video/") ? (
              <video src={previewUrl} controls preload="metadata" className="w-full rounded max-h-[70vh]"
                onError={(e) => {
                  (e.target as HTMLVideoElement).style.display = "none";
                  setPreviewError(true);
                }}
              />
            ) : previewMime?.startsWith("image/") ? (
              <img src={previewUrl} alt="Documento" loading="lazy" className="w-full rounded" />
            ) : previewMime?.includes("pdf") ? (
              <iframe src={previewUrl} className="w-full h-[70vh] rounded" />
            ) : (
              <div className="flex flex-col items-center gap-4 py-8 px-4 rounded-md border border-dashed border-border bg-muted/30">
                <AlertCircle className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  Este tipo de arquivo não suporta preview inline.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => window.open(previewUrl!, "_blank")}>
                    <ExternalLink className="mr-1 h-3 w-3" /> Abrir em nova aba
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { const a = document.createElement("a"); a.href = previewUrl!; a.download = previewFileName; a.click(); }}>
                    <FileDown className="mr-1 h-3 w-3" /> Baixar arquivo
                  </Button>
                </div>
              </div>
            )
          )}
          {/* Fallback buttons always visible when not error */}
          {previewUrl && previewUrl !== "error" && !previewError && (
            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              <Button size="sm" variant="outline" onClick={() => window.open(previewUrl!, "_blank")}>
                <ExternalLink className="mr-1 h-3 w-3" /> Abrir em nova aba
              </Button>
              <Button size="sm" variant="outline" onClick={() => { const a = document.createElement("a"); a.href = previewUrl!; a.download = previewFileName; a.click(); }}>
                <FileDown className="mr-1 h-3 w-3" /> Baixar arquivo
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bank data form dialog */}
      {workerName && workerCpf && (
        <Dialog open={showBankForm} onOpenChange={setShowBankForm}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Dados bancários</DialogTitle>
            </DialogHeader>
            <BankDataForm
              workerId={workerId}
              workerName={workerName}
              workerCpf={workerCpf}
              onSuccess={() => setShowBankForm(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={!!pendingDatedUpload} onOpenChange={(open) => !open && setPendingDatedUpload(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Data do documento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="doc-issued-at">Emissão / realização</Label>
              <Input
                id="doc-issued-at"
                type="date"
                value={pendingIssuedAt}
                onChange={(e) => setPendingIssuedAt(e.target.value)}
              />
            </div>
            {pendingDatedUpload?.requiresExplicitExpiry && (
              <div className="space-y-1.5">
                <Label htmlFor="doc-explicit-expires-at">Validade</Label>
                <Input
                  id="doc-explicit-expires-at"
                  type="date"
                  value={pendingExplicitExpiresAt}
                  onChange={(e) => setPendingExplicitExpiresAt(e.target.value)}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPendingDatedUpload(null)}>
                Cancelar
              </Button>
              <Button
                disabled={!pendingIssuedAt || (pendingDatedUpload?.requiresExplicitExpiry && !pendingExplicitExpiresAt)}
                onClick={() => {
                  if (!pendingDatedUpload) return;
                  uploadMutation.mutate({
                    category: pendingDatedUpload.category,
                    file: pendingDatedUpload.file,
                    alwaysInsert: pendingDatedUpload.alwaysInsert,
                    issuedAt: pendingIssuedAt,
                    explicitExpiresAt: pendingDatedUpload.requiresExplicitExpiry ? pendingExplicitExpiresAt : null,
                  });
                  setUploadingCategory(pendingDatedUpload.category);
                  setPendingDatedUpload(null);
                }}
              >
                Continuar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Replace/Add confirmation dialog */}
      <AlertDialog open={!!bankReplaceAction} onOpenChange={() => setBankReplaceAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Já existe comprovante bancário</AlertDialogTitle>
            <AlertDialogDescription>
              Este trabalhador já possui {bankDocs.length} comprovante(s) bancário(s) ativo(s). O novo envio só assume como vigente depois que arquivo e banco forem salvos com sucesso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="border border-input bg-background text-foreground hover:bg-accent" onClick={() => handleBankReplaceConfirm("add")}>
              Adicionar (manter existentes)
            </AlertDialogAction>
            <AlertDialogAction onClick={() => handleBankReplaceConfirm("replace")}>
              Substituir com segurança
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirmDoc} onOpenChange={(open) => !open && setDeleteConfirmDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo <strong>{deleteConfirmDoc?.file_name || "selecionado"}</strong> deixará de aparecer no cadastro do trabalhador. Esta ação não pode ser desfeita pela interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const doc = deleteConfirmDoc;
                setDeleteConfirmDoc(null);
                if (!doc) return;
                try {
                  await softDeleteMutation.mutateAsync([{ id: doc.id, file_path: doc.file_path }]);
                  toast({ title: "Documento excluído" });
                } catch (err: any) {
                  toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
                }
              }}
            >
              Excluir documento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
