import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Upload, FileText, Image as ImageIcon, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw, Loader2, Eye,
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

interface Props {
  workerId: string;
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

export function DocumentChecklist({ workerId }: Props) {
  const { hasAnyRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = hasAnyRole(["admin", "manager", "operator"]);

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

  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async ({ category, file }: { category: string; file: File }) => {
      const ext = file.name.split(".").pop();
      const path = `${workerId}/${category}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("worker-documents")
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      // Check if there's already a doc for this category
      const existing = docs?.find((d) => d.category === category);
      if (existing) {
        const { error } = await supabase
          .from("worker_documents")
          .update({
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            status: "uploaded",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("worker_documents")
          .insert({
            worker_id: workerId,
            document_type: category,
            category,
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            status: "uploaded",
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-documents", workerId] });
      setUploadingCategory(null);
      toast({ title: "Documento enviado" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
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
      toast({ title: "Status atualizado" });
    },
  });

  const handleFileSelect = (category: string) => {
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
        uploadMutation.mutate({ category, file });
        setUploadingCategory(category);
      }
    };
    input.click();
  };

  const handlePreview = async (doc: any) => {
    if (!doc.file_path) return;
    const { data } = await supabase.storage
      .from("worker-documents")
      .createSignedUrl(doc.file_path, 300);
    if (data?.signedUrl) {
      setPreviewUrl(data.signedUrl);
      setPreviewMime(doc.mime_type);
    }
  };

  const renderDocCard = (category: string, required: boolean) => {
    const doc = docs?.find((d) => d.category === category);
    const status = doc?.status || "pending";

    return (
      <Card key={category} className="overflow-hidden">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {doc?.mime_type?.startsWith("image/") ? (
                <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-medium truncate">{DOC_CATEGORY_LABELS[category]}</span>
              {required && <span className="text-destructive text-xs">*</span>}
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
                  {doc ? "Substituir" : "Enviar"}
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
              </>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Documentos obrigatórios</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {REQUIRED_DOC_CATEGORIES.map((c) => renderDocCard(c, true))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Documentos condicionais</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {CONDITIONAL_DOC_CATEGORIES.map((c) => renderDocCard(c, false))}
        </div>
      </div>

      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview do documento</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            previewMime?.startsWith("image/") ? (
              <img src={previewUrl} alt="Documento" className="w-full rounded" />
            ) : (
              <iframe src={previewUrl} className="w-full h-[70vh] rounded" />
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
