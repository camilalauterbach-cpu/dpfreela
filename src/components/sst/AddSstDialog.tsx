import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Search, UserPlus, ArrowLeft } from "lucide-react";
import { invalidateSstCaches } from "@/hooks/useSstQualifications";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Step = "pick_worker" | "new_worker" | "qualification";

interface WorkerLite { id: string; full_name: string; cpf: string | null; nickname: string | null }

export function AddSstDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("pick_worker");
  const [search, setSearch] = useState("");
  const [selectedWorker, setSelectedWorker] = useState<WorkerLite | null>(null);

  // Novo trabalhador (mínimo para ensure_worker)
  const [nwName, setNwName] = useState("");
  const [nwCpf, setNwCpf] = useState("");
  const [nwPhone, setNwPhone] = useState("");

  // Qualificação
  const [nrCode, setNrCode] = useState("");
  const [trainingType, setTrainingType] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [workload, setWorkload] = useState("");
  const [provider, setProvider] = useState("");
  const [instructor, setInstructor] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setStep("pick_worker"); setSearch(""); setSelectedWorker(null);
    setNwName(""); setNwCpf(""); setNwPhone("");
    setNrCode(""); setTrainingType(""); setIssuedAt(""); setExpiresAt("");
    setWorkload(""); setProvider(""); setInstructor(""); setNotes("");
  };

  const workersQuery = useQuery({
    queryKey: ["sst-add-search", search],
    enabled: open && step === "pick_worker" && search.trim().length >= 2,
    queryFn: async () => {
      const term = search.trim();
      const digits = term.replace(/\D/g, "");
      let query = supabase.from("workers").select("id, full_name, cpf, nickname").is("deleted_at", null).limit(15);
      if (digits.length >= 3 && /^\d+$/.test(digits)) query = query.ilike("cpf", `%${digits}%`);
      else query = query.ilike("full_name", `%${term}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as WorkerLite[];
    },
  });

  const createWorker = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("ensure_worker", {
        payload: {
          full_name: nwName.trim(),
          cpf: nwCpf.replace(/\D/g, ""),
          phone_main: nwPhone.replace(/\D/g, "") || null,
          registration_status: "incomplete",
        } as any,
        mode: "auto",
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      if (res?.result === "created" || res?.result === "existing") {
        setSelectedWorker({ id: res.workerId, full_name: nwName.trim(), cpf: nwCpf, nickname: null });
        setStep("qualification");
        if (res.result === "existing") toast.info("Trabalhador já cadastrado — reutilizando cadastro existente.");
      } else if (res?.result === "possible_duplicate") {
        toast.warning("Encontramos cadastros parecidos. Use a busca acima para localizá-los.");
        setStep("pick_worker");
      }
    },
    onError: (e: any) => {
      const msg = String(e?.message || "");
      if (msg.includes("invalid_cpf")) toast.error("CPF inválido");
      else if (msg.includes("missing_full_name")) toast.error("Nome obrigatório");
      else toast.error("Não foi possível criar o trabalhador.");
    },
  });

  const saveQualification = useMutation({
    mutationFn: async () => {
      if (!selectedWorker) throw new Error("no_worker");
      const payload = {
        worker_id: selectedWorker.id,
        nr_code: nrCode.trim().toUpperCase(),
        training_type: trainingType.trim() || null,
        issued_at: issuedAt,
        expires_at: expiresAt || null,
        workload_hours: workload ? Number(workload) : null,
        provider_name: provider.trim() || null,
        instructor_name: instructor.trim() || null,
        notes: notes.trim() || null,
      };
      const { error } = await supabase.from("worker_sst_qualifications").insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Qualificação SST registrada.");
      invalidateSstCaches(qc);
      onOpenChange(false);
      reset();
    },
    onError: (e: any) => toast.error(String(e?.message || "Falha ao salvar."))
  });

  const canSaveQual = useMemo(
    () => !!selectedWorker && nrCode.trim() && issuedAt && (!expiresAt || expiresAt > issuedAt),
    [selectedWorker, nrCode, issuedAt, expiresAt]
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar ao Controle SST</DialogTitle>
          <DialogDescription>
            {step === "pick_worker" && "Selecione um trabalhador existente ou cadastre um novo."}
            {step === "new_worker" && "Novo cadastro mínimo. O restante pode ser completado depois."}
            {step === "qualification" && `Registrar qualificação para ${selectedWorker?.full_name}.`}
          </DialogDescription>
        </DialogHeader>

        {step === "pick_worker" && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou CPF (mín. 2 caracteres)" className="pl-8" autoFocus />
            </div>
            <div className="max-h-64 overflow-y-auto border rounded-md">
              {workersQuery.isFetching && (
                <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                </div>
              )}
              {!workersQuery.isFetching && (workersQuery.data || []).map((w) => (
                <button key={w.id} className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-b-0"
                  onClick={() => { setSelectedWorker(w); setStep("qualification"); }}>
                  <div className="font-medium text-sm">{w.full_name}</div>
                  <div className="text-xs text-muted-foreground">{w.cpf || "sem CPF"}</div>
                </button>
              ))}
              {!workersQuery.isFetching && search.trim().length >= 2 && (workersQuery.data || []).length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">Nenhum trabalhador encontrado.</div>
              )}
              {search.trim().length < 2 && (
                <div className="p-3 text-sm text-muted-foreground">Digite pelo menos 2 caracteres.</div>
              )}
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={() => setStep("new_worker")}>
              <UserPlus className="h-4 w-4" /> Cadastrar novo trabalhador
            </Button>
          </div>
        )}

        {step === "new_worker" && (
          <div className="space-y-3">
            <div>
              <Label>Nome completo *</Label>
              <Input value={nwName} onChange={(e) => setNwName(e.target.value)} />
            </div>
            <div>
              <Label>CPF</Label>
              <Input value={nwCpf} onChange={(e) => setNwCpf(e.target.value)} placeholder="000.000.000-00" />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={nwPhone} onChange={(e) => setNwPhone(e.target.value)} />
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" className="gap-2" onClick={() => setStep("pick_worker")}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button onClick={() => createWorker.mutate()} disabled={!nwName.trim() || createWorker.isPending}>
                {createWorker.isPending ? "Criando…" : "Continuar"}
              </Button>
            </div>
          </div>
        )}

        {step === "qualification" && selectedWorker && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>NR *</Label>
                <Input value={nrCode} onChange={(e) => setNrCode(e.target.value)} placeholder="Ex.: NR-35" />
              </div>
              <div>
                <Label>Tipo</Label>
                <Input value={trainingType} onChange={(e) => setTrainingType(e.target.value)} placeholder="Inicial, Reciclagem…" />
              </div>
              <div>
                <Label>Emissão *</Label>
                <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
              </div>
              <div>
                <Label>Validade</Label>
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
              <div>
                <Label>Carga horária</Label>
                <Input value={workload} onChange={(e) => setWorkload(e.target.value)} placeholder="Horas" />
              </div>
              <div>
                <Label>Formador</Label>
                <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Instrutor</Label>
                <Input value={instructor} onChange={(e) => setInstructor(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Observações</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" className="gap-2" onClick={() => { setSelectedWorker(null); setStep("pick_worker"); }}>
                <ArrowLeft className="h-4 w-4" /> Trocar trabalhador
              </Button>
              <Button onClick={() => saveQualification.mutate()} disabled={!canSaveQual || saveQualification.isPending}>
                {saveQualification.isPending ? "Salvando…" : "Registrar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}