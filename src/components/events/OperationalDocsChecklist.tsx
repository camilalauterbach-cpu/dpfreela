import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, CheckCircle2, Clock, XCircle, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useRef } from "react";
import { validateUpload, ALLOWED_FILE_EXTENSIONS, getSafeContentType } from "@/lib/upload-validation";

interface RequiredDoc {
  category: string;
  label: string;
}

interface Props {
  employmentLinkId: string;
  workerId: string;
  event: any; // event with requires_epi_form, requires_service_order, required_nrs, required_nrs_other
}

const NR_LABELS: Record<string, string> = {
  "NR 1": "NR 1 — Disposições Gerais",
  "NR 6": "NR 6 — EPI",
  "NR 10": "NR 10 — Segurança em Eletricidade",
  "NR 18": "NR 18 — Construção Civil",
  "NR 35": "NR 35 — Trabalho em Altura",
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  pending: { label: "Pendente", icon: Clock, color: "text-muted-foreground" },
  uploaded: { label: "Enviado", icon: Upload, color: "text-yellow-600" },
  approved: { label: "Aprovado", icon: CheckCircle2, color: "text-green-600" },
  rejected: { label: "Rejeitado", icon: XCircle, color: "text-destructive" },
  replace: { label: "Substituir", icon: RefreshCw, color: "text-orange-500" },
};

function getRequiredDocs(event: any): RequiredDoc[] {
  const docs: RequiredDoc[] = [];
  if (event.requires_epi_form) docs.push({ category: "ficha_epi", label: "Ficha de entrega de EPI" });
  if (event.requires_service_order) docs.push({ category: "ordem_servico", label: "Ordem de serviço" });
  if (event.required_nrs) {
    for (const nr of event.required_nrs) {
      const cat = nr.toLowerCase().replace(" ", "_");
      docs.push({ category: cat, label: NR_LABELS[nr] || nr });
    }
  }
  if (event.required_nrs_other) {
    docs.push({ category: "nr_custom", label: event.required_nrs_other });
  }
  return docs;
}

export function OperationalDocsChecklist({ employmentLinkId, workerId, event }: Props) {
  const { hasAnyRole } = useAuth();
  const canManage = hasAnyRole(["admin", "manager", "operator"]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCategoryRef = useRef<string>("");

  const requiredDocs = getRequiredDocs(event);

  const { data: existingDocs, isLoading } = useQuery({
    queryKey: ["link-docs", employmentLinkId],
    enabled: !!employmentLinkId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employment_link_documents")
        .select("*")
        .eq("employment_link_id", employmentLinkId)
        .eq("document_type", "operacional_evento")
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
      const path = `${workerId}/${employmentLinkId}/${category}_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("link-documents")
        .upload(path, file, { contentType: getSafeContentType(file) });
      if (uploadErr) throw uploadErr;

      // Check if doc already exists for this category
      const existing = existingDocs?.find((d: any) => d.category === category);
      if (existing) {
        const { error } = await supabase
          .from("employment_link_documents")
          .update({
            file_path: path,
            file_name: file.name,
            mime_type: file.type,
            file_size: file.size,
            status: "uploaded",
          } as any)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("employment_link_documents")
          .insert({
            employment_link_id: employmentLinkId,
            worker_id: workerId,
            document_type: "operacional_evento",
            category,
            file_path: path,
            file_name: file.name,
            mime_type: file.type,
            file_size: file.size,
            status: "uploaded",
          } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["link-docs", employmentLinkId] });
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
      queryClient.invalidateQueries({ queryKey: ["link-docs", employmentLinkId] });
    },
  });

  if (requiredDocs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          O evento vinculado não exige documentos operacionais (EPI, OS ou NRs).
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  // Build status map
  const docMap = new Map<string, any>();
  existingDocs?.forEach((d: any) => docMap.set(d.category, d));

  const total = requiredDocs.length;
  const approved = requiredDocs.filter((r) => docMap.get(r.category)?.status === "approved").length;
  const pending = requiredDocs.filter((r) => !docMap.has(r.category) || docMap.get(r.category)?.status === "pending").length;
  const isComplete = approved === total;

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Documentos operacionais do evento</CardTitle>
          <Badge variant={isComplete ? "default" : "secondary"}>
            {isComplete ? "Completo" : "Incompleto"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {approved}/{total} aprovados · {pending} pendente{pending !== 1 ? "s" : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
       <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={ALLOWED_FILE_EXTENSIONS}
          onChange={handleFileChange}
        />

        {requiredDocs.map((req) => {
          const doc = docMap.get(req.category);
          const status = doc?.status || "pending";
          const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
          const Icon = cfg.icon;

          return (
            <div key={req.category} className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
                <div className="min-w-0">
                  <p className="text-sm truncate">{req.label}</p>
                  {doc?.file_name && <p className="text-xs text-muted-foreground truncate">{doc.file_name}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
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
                {canManage && (!doc || status === "pending" || status === "rejected" || status === "replace") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => triggerUpload(req.category)}
                    disabled={uploadMutation.isPending}
                  >
                    {uploadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
