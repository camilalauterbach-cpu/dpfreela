import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePayrollReceipts } from "@/hooks/usePayroll";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Download, Trash2, Loader2, FileText } from "lucide-react";
import { validateUpload, ALLOWED_FILE_EXTENSIONS, getSafeContentType } from "@/lib/upload-validation";

interface Props {
  batchId: string;
  canUpload: boolean;
}

export function ReceiptsList({ batchId, canUpload }: Props) {
  const { data: receipts, isLoading } = usePayrollReceipts(batchId);
  const { hasAnyRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const canDelete = hasAnyRole(["admin"]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const validationError = validateUpload(file);
      if (validationError) throw new Error(validationError);
      const path = `${batchId}/${Date.now()}_${file.name}`;
      const { error: storageError } = await supabase.storage
        .from("payment-receipts")
        .upload(path, file);
      if (storageError) throw storageError;

      const { error } = await supabase.from("payment_receipts").insert({
        batch_id: batchId,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-receipts", batchId] });
      toast({ title: "Comprovante anexado" });
    },
    onError: (e: any) => toast({ title: "Erro no upload", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payment_receipts").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-receipts", batchId] });
      toast({ title: "Comprovante removido" });
    },
  });

  const handleDownload = async (filePath: string, fileName: string) => {
    const { data, error } = await supabase.storage
      .from("payment-receipts")
      .createSignedUrl(filePath, 60, { download: fileName });
    if (error || !data?.signedUrl) {
      toast({ title: "Erro no download", variant: "destructive" });
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = fileName;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Comprovantes do Lote</CardTitle>
        {canUpload && (
          <>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />}
              Anexar
            </Button>
            <input ref={fileRef} type="file" accept={ALLOWED_FILE_EXTENSIONS} className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadMutation.mutate(e.target.files[0]); e.target.value = ""; }} />
          </>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : !receipts?.length ? (
          <p className="text-center py-4 text-sm text-muted-foreground">Nenhum comprovante anexado.</p>
        ) : (
          <div className="space-y-2">
            {receipts.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm truncate">{r.file_name || "Comprovante"}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  {r.file_path && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDownload(r.file_path, r.file_name || "comprovante")}>
                      <Download className="h-3 w-3" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(r.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
