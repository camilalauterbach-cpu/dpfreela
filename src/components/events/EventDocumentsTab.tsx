/**
 * DÉBITO TÉCNICO: Documentos do evento usam a tabela employment_link_documents
 * com event_id preenchido e employment_link_id nulo.
 * Futuramente, considerar tabela dedicada event_documents para separação completa.
 */
import { useState, useRef } from "react";
import { formatSupabaseError } from "@/lib/format-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText, Eye, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { validateUpload, ALLOWED_FILE_EXTENSIONS, getSafeContentType } from "@/lib/upload-validation";

interface Props {
  eventId: string;
}

const EVENT_DOC_CATEGORIES = [
  { value: "manual_credenciamento", label: "Manual de credenciamento" },
  { value: "pgr", label: "PGR" },
  { value: "ltcat", label: "LTCAT" },
  { value: "apr", label: "APR — Análise Preliminar de Riscos" },
  { value: "art", label: "ART" },
  { value: "nir", label: "NIR" },
  { value: "seguros", label: "Seguros" },
  { value: "laudos_evento", label: "Laudos do evento" },
  { value: "documentos_gerais", label: "Documentos gerais da operação" },
] as const;

export function EventDocumentsTab({ eventId }: Props) {
  const { toast } = useToast();
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(["admin", "manager", "operator"]);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCategoryRef = useRef<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["event-documents", eventId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("employment_link_documents")
        .select("*") as any)
        .eq("event_id", eventId)
        .is("employment_link_id", null)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  const uploadMutation = useMutation({
   mutationFn: async ({ file, category }: { file: File; category: string }) => {
      const validationError = validateUpload(file);
      if (validationError) throw new Error(validationError);
      const ext = file.name.split(".").pop();
      const path = `events/${eventId}/${category}_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("link-documents")
        .upload(path, file, { contentType: getSafeContentType(file) });
      if (uploadErr) throw uploadErr;

      // Validação na aplicação: event_id sempre preenchido
      const { error } = await supabase
        .from("employment_link_documents")
        .insert({
          event_id: eventId,
          employment_link_id: null,
          worker_id: "00000000-0000-0000-0000-000000000000", // placeholder — campo NOT NULL legado
          document_type: "evento",
          category,
          file_path: path,
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          status: "uploaded",
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-documents", eventId] });
      toast({ title: "Documento enviado" });
    },
    onError: (err: any) => {
      toast({ title: "Erro no upload", description: formatSupabaseError(err), variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadCategoryRef.current) {
      uploadMutation.mutate({ file, category: uploadCategoryRef.current });
    }
    e.target.value = "";
  };

  const triggerUpload = (category: string) => {
    uploadCategoryRef.current = category;
    fileInputRef.current?.click();
  };

  const handlePreview = async (filePath: string, mimeType: string | null) => {
    const { data } = await supabase.storage
      .from("link-documents")
      .createSignedUrl(filePath, 300);
    if (data?.signedUrl) {
      setPreviewUrl(data.signedUrl);
      setPreviewMime(mimeType);
    }
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("employment_link_documents")
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq("id", deleteDoc.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["event-documents", eventId] });
      toast({ title: "Documento removido" });
    } catch (err: any) {
      toast({ title: "Erro", description: formatSupabaseError(err), variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setDeleteDoc(null);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // Group docs by category
  const docsByCategory = new Map<string, any[]>();
  docs?.forEach((d: any) => {
    if (!d.category) return;
    const arr = docsByCategory.get(d.category) || [];
    arr.push(d);
    docsByCategory.set(d.category, arr);
  });

  return (
    <div className="space-y-4">
       <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={ALLOWED_FILE_EXTENSIONS}
        onChange={handleFileChange}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documentos do evento / operação</CardTitle>
          <p className="text-xs text-muted-foreground">
            Documentos da empresa e da operação associados a este evento. Eles ficam no nível do evento e não aparecem na aba de documentos individual do trabalhador.
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          {EVENT_DOC_CATEGORIES.map((cat) => {
            const catDocs = docsByCategory.get(cat.value) || [];
            return (
              <div key={cat.value} className="py-2 border-b border-border last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <p className="text-sm">{cat.label}</p>
                    {catDocs.length > 0 && (
                      <Badge variant="secondary" className="text-xs">{catDocs.length}</Badge>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => triggerUpload(cat.value)}
                      disabled={uploadMutation.isPending}
                    >
                      {uploadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                      Enviar
                    </Button>
                  )}
                </div>
                {catDocs.length > 0 && (
                  <div className="ml-6 mt-1 space-y-1">
                    {catDocs.map((doc: any) => (
                      <div key={doc.id} className="flex items-center justify-between gap-2 py-1">
                        <div className="min-w-0">
                          <p className="text-xs truncate">{doc.file_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(doc.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {doc.file_path && (
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handlePreview(doc.file_path, doc.mime_type)}>
                              <Eye className="h-3 w-3" />
                            </Button>
                          )}
                          {canManage && (
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteDoc({ id: doc.id, name: doc.file_name || "documento" })}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Preview dialog */}
       <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview do documento</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            previewMime?.startsWith("image/") ? (
              <img src={previewUrl} alt="Documento" loading="lazy" className="w-full rounded" />
            ) : (
              <iframe src={previewUrl} className="w-full h-[70vh] rounded" />
            )
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteDoc}
        onOpenChange={(open) => !open && setDeleteDoc(null)}
        title="Remover documento"
        description={`Tem certeza que deseja remover "${deleteDoc?.name}"?`}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
