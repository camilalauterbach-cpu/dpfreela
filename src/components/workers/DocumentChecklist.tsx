import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Upload, FileText, Image as ImageIcon, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw, Loader2, Eye, Plus, CreditCard, ExternalLink, FileDown,
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BankDataForm } from "./BankDataForm";

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
  const [previewError, setPreviewError] = useState(false);
  const [previewFileName, setPreviewFileName] = useState<string>("");
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankReplaceAction, setBankReplaceAction] = useState<"upload" | "form" | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async ({ category, file, alwaysInsert }: { category: string; file: File; alwaysInsert?: boolean }) => {
      const ext = file.name.split(".").pop();
      const path = `${workerId}/${category}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("worker-documents")
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      if (alwaysInsert) {
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
        return;
      }

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

  const softDeleteMutation = useMutation({
    mutationFn: async (docIds: string[]) => {
      for (const id of docIds) {
        const { error } = await supabase
          .from("worker_documents")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worker-documents", workerId] });
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
  const bankDocs = docs?.filter((d) => d.category === "bank_document") || [];
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

    if (mode === "replace") {
      await softDeleteMutation.mutateAsync(bankDocs.map((d) => d.id));
    }

    if (action === "upload") {
      handleFileSelect("bank_document", true);
    } else {
      setShowBankForm(true);
    }
  };

  const renderDocCard = (category: string, required: boolean) => {
    // bank_document has its own dedicated section
    if (category === "bank_document") return null;

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
    const outrosDocs = docs?.filter((d) => d.category === "outros") || [];

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
              <img src={previewUrl} alt="Documento" className="w-full rounded" />
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

      {/* Replace/Add confirmation dialog */}
      <AlertDialog open={!!bankReplaceAction} onOpenChange={() => setBankReplaceAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Já existe comprovante bancário</AlertDialogTitle>
            <AlertDialogDescription>
              Este trabalhador já possui {bankDocs.length} comprovante(s) bancário(s) ativo(s). O que deseja fazer?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="border border-input bg-background text-foreground hover:bg-accent" onClick={() => handleBankReplaceConfirm("add")}>
              Adicionar (manter existentes)
            </AlertDialogAction>
            <AlertDialogAction onClick={() => handleBankReplaceConfirm("replace")}>
              Substituir (desativar anteriores)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
