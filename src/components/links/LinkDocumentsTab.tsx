import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download, CheckCircle2, Clock, XCircle, RefreshCw, FileText, Info, Upload, AlertCircle, Eye, ExternalLink, FileDown } from "lucide-react";
import {
  REQUIRED_DOC_CATEGORIES,
  CONDITIONAL_DOC_CATEGORIES,
  DOC_CATEGORY_LABELS,
  DOC_STATUS_LABELS,
} from "@/lib/worker-completeness";
import { LinkDocumentConfig, parseConfig, getConfiguredDocs, getCategoryLabel } from "@/lib/link-document-config";
import { exportLinkDocsZip } from "@/lib/export-docs-zip";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  workerId: string;
  employmentLinkId: string;
  linkGroupWorkerId?: string;
  event: any;
  workerName: string;
  workerCpf?: string;
  requiredDocuments?: any;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  uploaded: <AlertCircle className="h-3 w-3" />,
  approved: <CheckCircle2 className="h-3 w-3" />,
  rejected: <XCircle className="h-3 w-3" />,
  replace: <RefreshCw className="h-3 w-3" />,
};

const STATUS_VARIANT: Record<string, string> = {
  pending: "bg-destructive/10 text-destructive border-destructive/30",
  uploaded: "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  replace: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

export function LinkDocumentsTab({ workerId, employmentLinkId, linkGroupWorkerId, event, workerName, workerCpf, requiredDocuments }: Props) {
  const useNewModel = !!linkGroupWorkerId;
  const docOwnerId = useNewModel ? linkGroupWorkerId : employmentLinkId;
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(["admin", "manager", "operator"]);
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewFileName, setPreviewFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCategoryRef = useRef<string>("");

  const config = parseConfig(requiredDocuments);
  const configuredDocs = getConfiguredDocs(config);

  const { data: workerDocs, isLoading: loadingWorkerDocs } = useQuery({
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

  const { data: linkDocs, isLoading: loadingLinkDocs } = useQuery({
    queryKey: ["link-docs", docOwnerId],
    enabled: !!docOwnerId,
    queryFn: async () => {
      const filterCol = useNewModel ? "link_group_worker_id" : "employment_link_id";
      const filterVal = useNewModel ? linkGroupWorkerId! : employmentLinkId;

      const { data, error } = await (supabase
        .from("employment_link_documents")
        .select("*") as any)
        .eq(filterCol, filterVal)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, category }: { file: File; category: string }) => {
      const ext = file.name.split(".").pop();
      const storagePath = useNewModel
        ? `${workerId}/${linkGroupWorkerId}/${category}_${Date.now()}.${ext}`
        : `${workerId}/${employmentLinkId}/${category}_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("link-documents")
        .upload(storagePath, file);
      if (uploadErr) throw uploadErr;

      const existing = linkDocs?.find((d: any) => d.category === category);
      if (existing) {
        const { error } = await supabase
          .from("employment_link_documents")
          .update({
            file_path: storagePath,
            file_name: file.name,
            mime_type: file.type,
            file_size: file.size,
            status: "uploaded",
          } as any)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const insertPayload: Record<string, any> = {
          worker_id: workerId,
          document_type: "operacional_vinculo",
          category,
          file_path: storagePath,
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          status: "uploaded",
        };
        if (useNewModel) {
          insertPayload.link_group_worker_id = linkGroupWorkerId;
        } else {
          insertPayload.employment_link_id = employmentLinkId;
        }
        const { error } = await supabase
          .from("employment_link_documents")
          .insert(insertPayload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["link-docs", docOwnerId] });
      toast({ title: "Documento enviado" });
    },
    onError: (err: any) => {
      toast({ title: "Erro no upload", description: err?.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ docId, status }: { docId: string; status: string }) => {
      const { error } = await supabase
        .from("employment_link_documents")
        .update({ status } as any)
        .eq("id", docId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["link-docs", docOwnerId] });
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

  const handlePreview = async (filePath: string, mimeType: string | null, bucket: string, fileName?: string) => {
    const resolvedName = fileName || filePath.split("/").pop() || "documento";
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(filePath, 300);
      if (error || !data?.signedUrl) throw new Error("Falha ao gerar URL");
      setPreviewUrl(data.signedUrl);
      setPreviewMime(mimeType);
      setPreviewFileName(resolvedName);
      setPreviewError(false);
    } catch {
      setPreviewError(true);
      setPreviewFileName(resolvedName);
      // store a placeholder so dialog opens
      setPreviewUrl("error");
      toast({ title: "Erro no preview", description: "Não foi possível carregar o preview deste documento.", variant: "destructive" });
    }
  };

  const handleDownload = async (mode: "worker" | "event" | "all") => {
    setDownloading(mode);
    try {
      const count = await exportLinkDocsZip({
        workerId,
        employmentLinkId: useNewModel ? "" : employmentLinkId,
        linkGroupWorkerId: useNewModel ? linkGroupWorkerId : undefined,
        workerName,
        cpf: workerCpf || "",
        mode,
      });
      toast({ title: `${count} arquivo(s) baixado(s)` });
    } catch (err: any) {
      toast({ title: "Erro no download", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  if (loadingWorkerDocs || loadingLinkDocs) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // Worker doc map (most recent per category, except "outros")
  const workerDocMap = new Map<string, any>();
  const outrosDocs: any[] = [];
  workerDocs?.forEach((d) => {
    if (d.category === "outros") {
      outrosDocs.push(d);
    } else if (d.category) {
      const existing = workerDocMap.get(d.category);
      if (!existing || new Date(d.created_at) > new Date(existing.created_at)) {
        workerDocMap.set(d.category, d);
      }
    }
  });

  // Link doc map
  const linkDocMap = new Map<string, any>();
  linkDocs?.forEach((d: any) => {
    if (d.category) linkDocMap.set(d.category, d);
  });

  const allWorkerCategories = [...REQUIRED_DOC_CATEGORIES, ...CONDITIONAL_DOC_CATEGORIES.filter(c => c !== "outros")];

  // Group configured docs
  const operationalDocs = configuredDocs.filter((d) => d.group === "operational");
  const nrDocs = configuredDocs.filter((d) => d.group === "nrs");
  const companyDocs = configuredDocs.filter((d) => d.group === "company");
  const hasConfiguredDocs = configuredDocs.length > 0;

  const renderLinkDocRow = (category: string, label: string) => {
    const doc = linkDocMap.get(category);
    const status = doc?.status || "pending";

    return (
      <div key={category} className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm truncate">{label}</p>
            {doc?.file_name && <p className="text-xs text-muted-foreground truncate">{doc.file_name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="outline" className={`text-xs ${STATUS_VARIANT[status]}`}>
            {STATUS_ICON[status]}
            <span className="ml-1">{DOC_STATUS_LABELS[status] || status}</span>
          </Badge>
          {doc?.file_path && (
             <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlePreview(doc.file_path, doc.mime_type, "link-documents", doc.file_name)}>
               <Eye className="h-3 w-3" />
             </Button>
          )}
          {canManage && doc && (
            <Select value={status} onValueChange={(v) => statusMutation.mutate({ docId: doc.id, status: v })}>
              <SelectTrigger className="h-7 w-[110px] text-xs">
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
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => triggerUpload(category)}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              <span className="ml-1">{doc ? "Substituir" : "Enviar"}</span>
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        onChange={handleFileChange}
      />

      {/* Download buttons */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => handleDownload("worker")} disabled={!!downloading}>
          {downloading === "worker" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
          Baixar docs do trabalhador
        </Button>
        {hasConfiguredDocs && (
          <Button size="sm" variant="outline" onClick={() => handleDownload("event")} disabled={!!downloading}>
            {downloading === "event" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
            Baixar docs do vínculo
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => handleDownload("all")} disabled={!!downloading}>
          {downloading === "all" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
          Baixar todos
        </Button>
      </div>

      {/* Section A: Worker documents (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documentos do trabalhador</CardTitle>
          <div className="flex items-start gap-2 mt-2 p-3 rounded-md bg-muted/50 border border-border">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Estes documentos são globais do trabalhador (somente leitura).{" "}
              <button
                className="text-primary underline underline-offset-2 hover:text-primary/80"
                onClick={() => navigate(`/workers/${workerId}?tab=documentos`)}
              >
                Para incluir ou alterar, acesse o cadastro do trabalhador na aba Documentos
              </button>.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {allWorkerCategories.map((cat) => {
            const doc = workerDocMap.get(cat);
            const status = doc?.status || "pending";
            const isRequired = (REQUIRED_DOC_CATEGORIES as readonly string[]).includes(cat);

            return (
              <div key={cat} className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="text-sm truncate">{DOC_CATEGORY_LABELS[cat] || cat}</p>
                      {isRequired && <span className="text-destructive text-xs">*</span>}
                    </div>
                    {doc?.file_name && <p className="text-xs text-muted-foreground truncate">{doc.file_name}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className={`text-xs ${STATUS_VARIANT[status]}`}>
                    {STATUS_ICON[status]}
                    <span className="ml-1">{DOC_STATUS_LABELS[status] || status}</span>
                  </Badge>
                  {doc?.file_path && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlePreview(doc.file_path, doc.mime_type, "worker-documents", doc.file_name)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {outrosDocs.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Outros (complementares)</p>
              {outrosDocs.map((doc) => {
                const status = doc.status || "pending";
                return (
                  <div key={doc.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm truncate">{doc.file_name || "Arquivo"}</p>
                        <p className="text-xs text-muted-foreground">{new Date(doc.created_at).toLocaleDateString("pt-BR")}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className={`text-xs ${STATUS_VARIANT[status]}`}>
                        {STATUS_ICON[status]}
                        <span className="ml-1">{DOC_STATUS_LABELS[status] || status}</span>
                      </Badge>
                      {doc.file_path && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlePreview(doc.file_path, doc.mime_type, "worker-documents", doc.file_name)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section B: Configured link/event documents */}
      {hasConfiguredDocs ? (
        <div className="space-y-4">
          {operationalDocs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Documentos operacionais do vínculo/evento</CardTitle>
              </CardHeader>
              <CardContent>
                {operationalDocs.map((d) => renderLinkDocRow(d.category, d.label))}
              </CardContent>
            </Card>
          )}

          {nrDocs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">NRs aplicáveis</CardTitle>
              </CardHeader>
              <CardContent>
                {nrDocs.map((d) => renderLinkDocRow(d.category, d.label))}
              </CardContent>
            </Card>
          )}

          {/* Seção legado: documentos de empresa configurados antes da separação */}
          {companyDocs.length > 0 && (() => {
            const legacyDocs = companyDocs.filter((d) => linkDocMap.has(d.category));
            if (legacyDocs.length === 0 && companyDocs.length > 0) {
              // Config exists but no docs uploaded — show muted note
              return (
                <Card className="border-dashed opacity-60">
                  <CardContent className="py-4">
                    <p className="text-xs text-muted-foreground">
                      ⚠️ Este vínculo possuía configurações de documentos da empresa (legado). Novos documentos da empresa devem ser enviados na aba Documentos do evento.
                    </p>
                  </CardContent>
                </Card>
              );
            }
            if (legacyDocs.length === 0) return null;
            return (
              <Card className="border-dashed opacity-70">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">Documentos da empresa (legado)</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Estes documentos foram configurados antes da separação. Novos documentos da empresa devem ser enviados na aba Documentos do evento.
                  </p>
                </CardHeader>
                <CardContent>
                  {legacyDocs.map((d) => {
                    const doc = linkDocMap.get(d.category);
                    const status = doc?.status || "pending";
                    return (
                      <div key={d.category} className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm truncate">{d.label}</p>
                            {doc?.file_name && <p className="text-xs text-muted-foreground truncate">{doc.file_name}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className={`text-xs ${STATUS_VARIANT[status]}`}>
                            {STATUS_ICON[status]}
                            <span className="ml-1">{DOC_STATUS_LABELS[status] || status}</span>
                          </Badge>
                          {doc?.file_path && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handlePreview(doc.file_path, doc.mime_type, "link-documents", doc.file_name)}>
                              <Eye className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })()}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhum documento operacional foi configurado para este vínculo. Para definir documentos obrigatórios, edite o vínculo.
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
