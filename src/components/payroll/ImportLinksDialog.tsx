import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface Props {
  batchId: string;
  eventId: string | null;
  existingWorkerIds: string[];
  onClose: () => void;
}

export function ImportLinksDialog({ batchId, eventId, existingWorkerIds, onClose }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState("active");

  const { data: links, isLoading } = useQuery({
    queryKey: ["import-links", eventId, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("employment_links")
        .select("id, link_name, worker_id, job_role, daily_rate, fixed_salary, hire_date, end_date, status, workers(full_name, nickname, cpf)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (eventId) query = query.eq("event_id", eventId);
      if (statusFilter && statusFilter !== "all") query = query.eq("status", statusFilter);

      const { data, error } = await query.limit(300);
      if (error) throw error;
      // Filter out workers already in batch
      return (data || []).filter((l: any) => !existingWorkerIds.includes(l.worker_id));
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const selected = links?.filter((l: any) => selectedIds.has(l.id)) || [];
      const items = selected.map((l: any) => ({
        batch_id: batchId,
        worker_id: l.worker_id,
        employment_link_id: l.id,
        base_amount: Number(l.daily_rate) || Number(l.fixed_salary) || 0,
        net_amount: Number(l.daily_rate) || Number(l.fixed_salary) || 0,
      }));
      const { error } = await supabase.from("payroll_batch_items").insert(items);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-batch-items", batchId] });
      toast({ title: `${selectedIds.size} item(ns) importado(s)` });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const toggleAll = () => {
    if (selectedIds.size === (links?.length || 0)) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(links?.map((l: any) => l.id)));
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar Vínculos</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 items-end">
          <div className="space-y-1 flex-1">
            <Label className="text-xs">Status do vínculo</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="completed">Concluído</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-auto border rounded-md">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : !links?.length ? (
            <p className="text-center py-8 text-muted-foreground">Nenhum vínculo disponível para importar.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={selectedIds.size === links.length && links.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Trabalhador</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead className="text-right">Valor Ref.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell><Checkbox checked={selectedIds.has(l.id)} onCheckedChange={() => toggle(l.id)} /></TableCell>
                    <TableCell>
                      <span className="font-medium">{(l.workers as any)?.full_name}</span>
                      {(l.workers as any)?.nickname && <span className="text-xs text-muted-foreground ml-1">({(l.workers as any).nickname})</span>}
                    </TableCell>
                    <TableCell className="text-sm">{l.job_role || "—"}</TableCell>
                    <TableCell className="text-right text-sm">
                      {(Number(l.daily_rate) || Number(l.fixed_salary) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={selectedIds.size === 0 || importMutation.isPending} onClick={() => importMutation.mutate()}>
            {importMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Importar {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
