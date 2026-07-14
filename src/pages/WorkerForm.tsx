import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useMutationWithFeedback } from "@/hooks/useMutationWithFeedback";
import { useUnsavedFormGuard } from "@/hooks/useUnsavedFormGuard";
import { supabase } from "@/integrations/supabase/client";
import { useWorker } from "@/hooks/useWorkers";
import { validateCpf, normalizeCpf } from "@/lib/validators";
import { useToast } from "@/hooks/use-toast";
import { DuplicateWorkerDialog, DuplicateDialogState } from "@/components/workers/DuplicateWorkerDialog";
import { toast as sonnerToast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Loader2, ChevronDown } from "lucide-react";

const STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const EDUCATION_LEVELS = [
  "Fundamental incompleto",
  "Fundamental completo",
  "Médio incompleto",
  "Médio completo",
  "Superior incompleto",
  "Superior completo",
  "Pós-graduação",
  "Mestrado",
  "Doutorado",
];

const PCD_TYPES = ["Física", "Visual", "Auditiva", "Mental", "Intelectual", "Múltipla"];

interface WorkerFormData {
  full_name: string;
  nickname: string;
  social_name: string;
  cpf: string;
  birth_date: string;
  gender: string;
  race_color: string;
  education_level: string;
  nationality: string;
  birth_country: string;
  birth_city: string;
  birth_state: string;
  mother_name: string;
  father_name: string;
  nis_pis: string;
  rg: string;
  rg_issuer: string;
  rg_state: string;
  rg_issue_date: string;
  ctps_number: string;
  ctps_series: string;
  ctps_state: string;
  phone_main: string;
  email: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  is_pcd: boolean;
  is_rehabilitated: boolean;
  pcd_type: string;
  pcd_notes: string;
  // operational (collapsible)
  shirt_size: string;
  shoe_size: string;
  blood_type: string;
  allergies: string;
  medical_conditions: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  notes: string;
}

const emptyForm: WorkerFormData = {
  full_name: "", nickname: "", social_name: "", cpf: "", birth_date: "", gender: "",
  race_color: "", education_level: "", nationality: "Brasileira", birth_country: "Brasil", birth_city: "", birth_state: "",
  mother_name: "", father_name: "", nis_pis: "", rg: "", rg_issuer: "", rg_state: "", rg_issue_date: "",
  ctps_number: "", ctps_series: "", ctps_state: "", phone_main: "", email: "",
  address: "", neighborhood: "", city: "", state: "", zip_code: "",
  is_pcd: false, is_rehabilitated: false, pcd_type: "", pcd_notes: "",
  shirt_size: "", shoe_size: "", blood_type: "", allergies: "", medical_conditions: "",
  emergency_contact_name: "", emergency_contact_phone: "", notes: "",
};

export default function WorkerForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: existing, isLoading: loadingExisting } = useWorker(id);

  const [form, setForm] = useState<WorkerFormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [operationalOpen, setOperationalOpen] = useState(false);
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  const [dupDialog, setDupDialog] = useState<DuplicateDialogState>(null);
  const [forcePending, setForcePending] = useState(false);
  useUnsavedFormGuard(isDirty, `worker-form-${id ?? "new"}`);

  // Reset form when switching between workers or from edit to new
  useEffect(() => {
    if (!isEdit) {
      setForm(emptyForm);
      setErrors({});
      setLoadedId(undefined);
      setIsDirty(false);
    }
  }, [isEdit, id]);

  useEffect(() => {
    if (existing && existing.id !== loadedId) {
      setForm({
        full_name: existing.full_name || "",
        nickname: existing.nickname || "",
        social_name: (existing as any).social_name || "",
        cpf: existing.cpf || "",
        birth_date: existing.birth_date || "",
        gender: existing.gender || "",
        race_color: (existing as any).race_color || "",
        education_level: (existing as any).education_level || "",
        nationality: existing.nationality || "Brasileira",
        birth_country: (existing as any).birth_country || "Brasil",
        birth_city: (existing as any).birth_city || "",
        birth_state: (existing as any).birth_state || "",
        mother_name: (existing as any).mother_name || "",
        father_name: (existing as any).father_name || "",
        nis_pis: (existing as any).nis_pis || "",
        rg: existing.rg || "",
        rg_issuer: (existing as any).rg_issuer || "",
        rg_state: (existing as any).rg_state || "",
        rg_issue_date: (existing as any).rg_issue_date || "",
        ctps_number: (existing as any).ctps_number || "",
        ctps_series: (existing as any).ctps_series || "",
        ctps_state: (existing as any).ctps_state || "",
        phone_main: existing.phone_main || "",
        email: existing.email || "",
        address: existing.address || "",
        neighborhood: existing.neighborhood || "",
        city: existing.city || "",
        state: existing.state || "",
        zip_code: existing.zip_code || "",
        is_pcd: (existing as any).is_pcd || false,
        is_rehabilitated: (existing as any).is_rehabilitated || false,
        pcd_type: (existing as any).pcd_type || "",
        pcd_notes: (existing as any).pcd_notes || "",
        shirt_size: existing.shirt_size || "",
        shoe_size: existing.shoe_size || "",
        blood_type: existing.blood_type || "",
        allergies: existing.allergies || "",
        medical_conditions: existing.medical_conditions || "",
        emergency_contact_name: existing.emergency_contact_name || "",
        emergency_contact_phone: existing.emergency_contact_phone || "",
        notes: existing.notes || "",
      });
      setLoadedId(existing.id);
      setErrors({});
      setIsDirty(false);
    }
  }, [existing, loadedId]);

  const set = (field: keyof WorkerFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
    setIsDirty(true);
  };

  const setSelect = (field: keyof WorkerFormData) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
    setIsDirty(true);
  };

  const setSwitch = (field: keyof WorkerFormData) => (checked: boolean) => {
    setForm((f) => ({ ...f, [field]: checked }));
    setIsDirty(true);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.full_name.trim()) errs.full_name = "Nome é obrigatório";
    if (!form.nickname.trim()) errs.nickname = "Apelido é obrigatório";
    const cleanCpf = normalizeCpf(form.cpf);
    if (!cleanCpf) errs.cpf = "CPF é obrigatório";
    else if (!validateCpf(cleanCpf)) errs.cpf = "CPF inválido";
    if (!form.birth_date) errs.birth_date = "Data de nascimento é obrigatória";
    if (!form.gender) errs.gender = "Sexo é obrigatório";
    if (!form.race_color) errs.race_color = "Raça/Cor é obrigatório";
    if (!form.mother_name.trim()) errs.mother_name = "Nome da mãe é obrigatório";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "E-mail inválido";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const buildPayload = () => {
      const cleanCpf = normalizeCpf(form.cpf);
      return {
        full_name: form.full_name.trim(),
        nickname: form.nickname.trim() || null,
        social_name: form.social_name.trim() || null,
        cpf: cleanCpf,
        birth_date: form.birth_date || null,
        gender: form.gender || null,
        race_color: form.race_color || null,
        education_level: form.education_level || null,
        nationality: form.nationality || null,
        birth_country: form.birth_country || null,
        birth_city: form.birth_city.trim() || null,
        birth_state: form.birth_state || null,
        mother_name: form.mother_name.trim() || null,
        father_name: form.father_name.trim() || null,
        nis_pis: form.nis_pis.trim() || null,
        rg: form.rg.trim() || null,
        rg_issuer: form.rg_issuer.trim() || null,
        rg_state: form.rg_state || null,
        rg_issue_date: form.rg_issue_date || null,
        ctps_number: form.ctps_number.trim() || null,
        ctps_series: form.ctps_series.trim() || null,
        ctps_state: form.ctps_state || null,
        phone_main: form.phone_main.replace(/\D/g, "") || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        neighborhood: form.neighborhood.trim() || null,
        city: form.city.trim() || null,
        state: form.state || null,
        zip_code: form.zip_code.replace(/\D/g, "") || null,
        is_pcd: form.is_pcd,
        is_rehabilitated: form.is_rehabilitated,
        pcd_type: form.is_pcd ? form.pcd_type || null : null,
        pcd_notes: form.is_pcd ? form.pcd_notes.trim() || null : null,
        shirt_size: form.shirt_size || null,
        shoe_size: form.shoe_size || null,
        blood_type: form.blood_type || null,
        allergies: form.allergies.trim() || null,
        medical_conditions: form.medical_conditions.trim() || null,
        emergency_contact_name: form.emergency_contact_name.trim() || null,
        emergency_contact_phone: form.emergency_contact_phone.replace(/\D/g, "") || null,
        notes: form.notes.trim() || null,
      } as Record<string, any>;
  };

  // Traduz códigos técnicos da RPC ensure_worker para mensagens amigáveis.
  const translateEnsureError = (msg: string): { field?: keyof WorkerFormData; message: string } => {
    if (msg.includes("invalid_cpf")) return { field: "cpf", message: "CPF inválido" };
    if (msg.includes("missing_full_name")) return { field: "full_name", message: "Nome é obrigatório" };
    if (msg.includes("incomplete_worker_data")) return { message: "Dados obrigatórios ausentes para cadastro completo." };
    if (msg.includes("forbidden_force_create")) return { message: "Somente administrador ou gestor pode confirmar criação como nova pessoa." };
    if (msg.includes("forbidden_role")) return { message: "Você não tem permissão para cadastrar trabalhadores." };
    if (msg.includes("not_authenticated")) return { message: "Sessão expirada. Faça login novamente." };
    if (msg.includes("workers_cpf_key") || msg.includes("duplicate key")) return { field: "cpf", message: "Este CPF já está cadastrado." };
    return { message: "Não foi possível concluir o cadastro. Tente novamente." };
  };

  const runEnsure = async (mode: "auto" | "force_create") => {
    const payload = buildPayload();
    const { data, error } = await supabase.rpc("ensure_worker", { payload: payload as any, mode });
    if (error) throw error;
    return data as { result: "existing" | "possible_duplicate" | "created"; workerId?: string; matches?: any[] };
  };

  const mutation = useMutationWithFeedback<
    { kind: "edit" } | { kind: "created"; workerId: string } | { kind: "existing"; workerId: string } | { kind: "possible_duplicate"; matches: any[] },
    unknown,
    void,
    unknown
  >({
    pendingMessage: isEdit ? "Salvando alterações…" : "Verificando cadastro…",
    successMessage: null,
    errorTitle: "Erro ao salvar trabalhador",
    mutationFn: async () => {
      if (isEdit) {
        const payload = buildPayload();
        const { error } = await supabase.from("workers").update(payload as any).eq("id", id);
        if (error) throw error;
        return { kind: "edit" };
      }
      const res = await runEnsure("auto");
      if (res.result === "created" && res.workerId) return { kind: "created", workerId: res.workerId };
      if (res.result === "existing" && res.workerId) return { kind: "existing", workerId: res.workerId };
      if (res.result === "possible_duplicate") return { kind: "possible_duplicate", matches: res.matches || [] };
      throw new Error("unexpected_ensure_result");
    },
    onSuccess: (result) => {
      if (result.kind === "edit") {
        queryClient.invalidateQueries({ queryKey: ["workers"] });
        queryClient.invalidateQueries({ queryKey: ["worker", id] });
        sonnerToast.success("Trabalhador atualizado");
        setIsDirty(false);
        navigate("/workers");
        return;
      }
      if (result.kind === "created") {
        queryClient.invalidateQueries({ queryKey: ["workers"] });
        sonnerToast.success("Trabalhador cadastrado");
        setIsDirty(false);
        navigate("/workers");
        return;
      }
      if (result.kind === "existing") {
        setDupDialog({ kind: "existing", workerId: result.workerId });
        return;
      }
      if (result.kind === "possible_duplicate") {
        setDupDialog({ kind: "possible_duplicate", matches: result.matches as any });
        return;
      }
    },
    onError: (err: any) => {
      const msg = err?.message || "";
      const t = translateEnsureError(msg);
      if (t.field) setErrors({ [t.field]: t.message });
      sonnerToast.error(t.message);
    },
  });

  const handleForceCreate = async () => {
    if (forcePending) return;
    setForcePending(true);
    try {
      const res = await runEnsure("force_create");
      if (res.result === "created" && res.workerId) {
        queryClient.invalidateQueries({ queryKey: ["workers"] });
        sonnerToast.success("Trabalhador cadastrado");
        setDupDialog(null);
        setIsDirty(false);
        navigate("/workers");
      } else if (res.result === "existing" && res.workerId) {
        setDupDialog({ kind: "existing", workerId: res.workerId });
      } else {
        sonnerToast.error("Não foi possível concluir o cadastro.");
      }
    } catch (err: any) {
      const t = translateEnsureError(err?.message || "");
      sonnerToast.error(t.message);
    } finally {
      setForcePending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending || mutation.isLocked()) return;
    if (validate()) mutation.mutate(undefined);
  };

  if (isEdit && loadingExisting) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const fieldErr = (f: string) => errors[f] ? <p className="text-xs text-destructive">{errors[f]}</p> : null;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/workers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold text-foreground">
          {isEdit ? "Editar trabalhador" : "Novo trabalhador"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identificação eSocial */}
        <Card>
          <CardHeader><CardTitle className="text-base">Identificação eSocial</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input id="full_name" value={form.full_name} onChange={set("full_name")} maxLength={200} />
              {fieldErr("full_name")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="nickname">Apelido operacional *</Label>
              <Input id="nickname" value={form.nickname} onChange={set("nickname")} maxLength={100} />
              {fieldErr("nickname")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="social_name">Nome social</Label>
              <Input id="social_name" value={form.social_name} onChange={set("social_name")} maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cpf">CPF *</Label>
              <Input id="cpf" value={form.cpf} onChange={set("cpf")} placeholder="Apenas números" maxLength={14} />
              {fieldErr("cpf")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="birth_date">Data de nascimento *</Label>
              <Input id="birth_date" type="date" value={form.birth_date} onChange={set("birth_date")} />
              {fieldErr("birth_date")}
            </div>
            <div className="space-y-1">
              <Label>Sexo *</Label>
              <Select value={form.gender} onValueChange={setSelect("gender")}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Masculino">Masculino</SelectItem>
                  <SelectItem value="Feminino">Feminino</SelectItem>
                </SelectContent>
              </Select>
              {fieldErr("gender")}
            </div>
            <div className="space-y-1">
              <Label>Raça/Cor *</Label>
              <Select value={form.race_color} onValueChange={setSelect("race_color")}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Branca">Branca</SelectItem>
                  <SelectItem value="Preta">Preta</SelectItem>
                  <SelectItem value="Parda">Parda</SelectItem>
                  <SelectItem value="Amarela">Amarela</SelectItem>
                  <SelectItem value="Indígena">Indígena</SelectItem>
                </SelectContent>
              </Select>
              {fieldErr("race_color")}
            </div>
            <div className="space-y-1">
              <Label>Grau de instrução</Label>
              <Select value={form.education_level} onValueChange={setSelect("education_level")}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {EDUCATION_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nationality">Nacionalidade</Label>
              <Input id="nationality" value={form.nationality} onChange={set("nationality")} maxLength={50} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="birth_city">Naturalidade</Label>
              <Input id="birth_city" value={form.birth_city} onChange={set("birth_city")} maxLength={100} placeholder="Cidade de nascimento" />
            </div>
            <div className="space-y-1">
              <Label>UF da naturalidade</Label>
              <Select value={form.birth_state} onValueChange={setSelect("birth_state")}>
                <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>
                  {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="birth_country">País de nascimento</Label>
              <Input id="birth_country" value={form.birth_country} onChange={set("birth_country")} maxLength={50} />
            </div>
          </CardContent>
        </Card>

        {/* Filiação */}
        <Card>
          <CardHeader><CardTitle className="text-base">Filiação</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mother_name">Nome da mãe *</Label>
              <Input id="mother_name" value={form.mother_name} onChange={set("mother_name")} maxLength={200} />
              {fieldErr("mother_name")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="father_name">Nome do pai</Label>
              <Input id="father_name" value={form.father_name} onChange={set("father_name")} maxLength={200} />
            </div>
          </CardContent>
        </Card>

        {/* Documentos numéricos */}
        <Card>
          <CardHeader><CardTitle className="text-base">Documentos numéricos</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="rg">RG</Label>
              <Input id="rg" value={form.rg} onChange={set("rg")} maxLength={20} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rg_issuer">Órgão emissor</Label>
              <Input id="rg_issuer" value={form.rg_issuer} onChange={set("rg_issuer")} maxLength={20} />
            </div>
            <div className="space-y-1">
              <Label>UF do RG</Label>
              <Select value={form.rg_state} onValueChange={setSelect("rg_state")}>
                <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>
                  {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rg_issue_date">Data de emissão do RG</Label>
              <Input id="rg_issue_date" type="date" value={form.rg_issue_date} onChange={set("rg_issue_date")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nis_pis">NIS/PIS/PASEP</Label>
              <Input id="nis_pis" value={form.nis_pis} onChange={set("nis_pis")} maxLength={20} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ctps_number">CTPS número</Label>
              <Input id="ctps_number" value={form.ctps_number} onChange={set("ctps_number")} maxLength={20} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ctps_series">CTPS série</Label>
              <Input id="ctps_series" value={form.ctps_series} onChange={set("ctps_series")} maxLength={10} />
            </div>
            <div className="space-y-1">
              <Label>CTPS UF</Label>
              <Select value={form.ctps_state} onValueChange={setSelect("ctps_state")}>
                <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>
                  {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* PCD / Reabilitado */}
        <Card>
          <CardHeader><CardTitle className="text-base">PCD / Reabilitado</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <Switch id="is_pcd" checked={form.is_pcd} onCheckedChange={setSwitch("is_pcd")} />
              <Label htmlFor="is_pcd">Pessoa com deficiência (PCD)</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="is_rehabilitated" checked={form.is_rehabilitated} onCheckedChange={setSwitch("is_rehabilitated")} />
              <Label htmlFor="is_rehabilitated">Reabilitado</Label>
            </div>
            {form.is_pcd && (
              <>
                <div className="space-y-1">
                  <Label>Tipo de deficiência</Label>
                  <Select value={form.pcd_type} onValueChange={setSelect("pcd_type")}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {PCD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="pcd_notes">Observações PCD</Label>
                  <Textarea id="pcd_notes" value={form.pcd_notes} onChange={set("pcd_notes")} maxLength={500} rows={2} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Contato */}
        <Card>
          <CardHeader><CardTitle className="text-base">Contato</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="phone_main">Telefone principal</Label>
              <Input id="phone_main" value={form.phone_main} onChange={set("phone_main")} maxLength={15} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={form.email} onChange={set("email")} maxLength={255} />
              {fieldErr("email")}
            </div>
          </CardContent>
        </Card>

        {/* Endereço */}
        <Card>
          <CardHeader><CardTitle className="text-base">Endereço</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="zip_code">CEP</Label>
              <Input id="zip_code" value={form.zip_code} onChange={set("zip_code")} maxLength={9} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="address">Endereço</Label>
              <Input id="address" value={form.address} onChange={set("address")} maxLength={300} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="neighborhood">Bairro</Label>
              <Input id="neighborhood" value={form.neighborhood} onChange={set("neighborhood")} maxLength={100} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" value={form.city} onChange={set("city")} maxLength={100} />
            </div>
            <div className="space-y-1">
              <Label>UF</Label>
              <Select value={form.state} onValueChange={setSelect("state")}>
                <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>
                  {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Informações operacionais (colapsável) */}
        <Collapsible open={operationalOpen} onOpenChange={setOperationalOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer">
                <CardTitle className="text-base flex items-center justify-between">
                  Informações operacionais
                  <ChevronDown className={`h-4 w-4 transition-transform ${operationalOpen ? "rotate-180" : ""}`} />
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Camiseta</Label>
                  <Select value={form.shirt_size} onValueChange={setSelect("shirt_size")}>
                    <SelectTrigger><SelectValue placeholder="Tam." /></SelectTrigger>
                    <SelectContent>
                      {["PP","P","M","G","GG","XGG"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="shoe_size">Calçado</Label>
                  <Input id="shoe_size" value={form.shoe_size} onChange={set("shoe_size")} maxLength={5} />
                </div>
                <div className="space-y-1">
                  <Label>Tipo sanguíneo</Label>
                  <Select value={form.blood_type} onValueChange={setSelect("blood_type")}>
                    <SelectTrigger><SelectValue placeholder="Sel." /></SelectTrigger>
                    <SelectContent>
                      {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-3">
                  <Label htmlFor="allergies">Alergias</Label>
                  <Input id="allergies" value={form.allergies} onChange={set("allergies")} maxLength={500} />
                </div>
                <div className="space-y-1 sm:col-span-3">
                  <Label htmlFor="medical_conditions">Condições médicas</Label>
                  <Input id="medical_conditions" value={form.medical_conditions} onChange={set("medical_conditions")} maxLength={500} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="emergency_contact_name">Contato de emergência</Label>
                  <Input id="emergency_contact_name" value={form.emergency_contact_name} onChange={set("emergency_contact_name")} maxLength={200} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="emergency_contact_phone">Telefone emergência</Label>
                  <Input id="emergency_contact_phone" value={form.emergency_contact_phone} onChange={set("emergency_contact_phone")} maxLength={15} />
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Observações */}
        <Card>
          <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
          <CardContent>
            <Textarea id="notes" value={form.notes} onChange={set("notes")} maxLength={2000} rows={3} />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mutation.isPending
              ? (isEdit ? "Salvando…" : "Cadastrando…")
              : (isEdit ? "Salvar alterações" : "Cadastrar")}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/workers")} disabled={mutation.isPending}>Cancelar</Button>
        </div>
      </form>
      <DuplicateWorkerDialog
        state={dupDialog}
        onClose={() => setDupDialog(null)}
        onForceCreate={handleForceCreate}
        forcePending={forcePending}
      />
    </div>
  );
}
