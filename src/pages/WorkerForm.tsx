import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorker } from "@/hooks/useWorkers";
import { validateCpf, normalizeCpf } from "@/lib/validators";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2 } from "lucide-react";

const STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

interface WorkerFormData {
  full_name: string;
  nickname: string;
  cpf: string;
  rg: string;
  birth_date: string;
  gender: string;
  marital_status: string;
  nationality: string;
  phone_main: string;
  phone_secondary: string;
  email: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  shirt_size: string;
  shoe_size: string;
  blood_type: string;
  allergies: string;
  medical_conditions: string;
  notes: string;
}

const emptyForm: WorkerFormData = {
  full_name: "", nickname: "", cpf: "", rg: "", birth_date: "", gender: "",
  marital_status: "", nationality: "Brasileira", phone_main: "", phone_secondary: "",
  email: "", address: "", neighborhood: "", city: "", state: "", zip_code: "",
  emergency_contact_name: "", emergency_contact_phone: "", shirt_size: "",
  shoe_size: "", blood_type: "", allergies: "", medical_conditions: "", notes: "",
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

  useEffect(() => {
    if (existing) {
      setForm({
        full_name: existing.full_name || "",
        nickname: existing.nickname || "",
        cpf: existing.cpf || "",
        rg: existing.rg || "",
        birth_date: existing.birth_date || "",
        gender: existing.gender || "",
        marital_status: existing.marital_status || "",
        nationality: existing.nationality || "Brasileira",
        phone_main: existing.phone_main || "",
        phone_secondary: existing.phone_secondary || "",
        email: existing.email || "",
        address: existing.address || "",
        neighborhood: existing.neighborhood || "",
        city: existing.city || "",
        state: existing.state || "",
        zip_code: existing.zip_code || "",
        emergency_contact_name: existing.emergency_contact_name || "",
        emergency_contact_phone: existing.emergency_contact_phone || "",
        shirt_size: existing.shirt_size || "",
        shoe_size: existing.shoe_size || "",
        blood_type: existing.blood_type || "",
        allergies: existing.allergies || "",
        medical_conditions: existing.medical_conditions || "",
        notes: existing.notes || "",
      });
    }
  }, [existing]);

  const set = (field: keyof WorkerFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const setSelect = (field: keyof WorkerFormData) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.full_name.trim()) errs.full_name = "Nome é obrigatório";
    const cleanCpf = normalizeCpf(form.cpf);
    if (!cleanCpf) errs.cpf = "CPF é obrigatório";
    else if (!validateCpf(cleanCpf)) errs.cpf = "CPF inválido";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "E-mail inválido";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const cleanCpf = normalizeCpf(form.cpf);
      const payload = {
        full_name: form.full_name.trim(),
        nickname: form.nickname.trim() || null,
        cpf: cleanCpf,
        rg: form.rg.trim() || null,
        birth_date: form.birth_date || null,
        gender: form.gender || null,
        marital_status: form.marital_status || null,
        nationality: form.nationality || null,
        phone_main: form.phone_main.replace(/\D/g, "") || null,
        phone_secondary: form.phone_secondary.replace(/\D/g, "") || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        neighborhood: form.neighborhood.trim() || null,
        city: form.city.trim() || null,
        state: form.state || null,
        zip_code: form.zip_code.replace(/\D/g, "") || null,
        emergency_contact_name: form.emergency_contact_name.trim() || null,
        emergency_contact_phone: form.emergency_contact_phone.replace(/\D/g, "") || null,
        shirt_size: form.shirt_size || null,
        shoe_size: form.shoe_size || null,
        blood_type: form.blood_type || null,
        allergies: form.allergies.trim() || null,
        medical_conditions: form.medical_conditions.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (isEdit) {
        const { error } = await supabase.from("workers").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("workers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workers"] });
      toast({ title: isEdit ? "Trabalhador atualizado" : "Trabalhador cadastrado" });
      navigate("/workers");
    },
    onError: (err: any) => {
      const msg = err?.message || "";
      if (msg.includes("workers_cpf_key")) {
        setErrors({ cpf: "Este CPF já está cadastrado" });
      } else if (msg.includes("workers_cpf_check")) {
        setErrors({ cpf: "CPF deve conter exatamente 11 dígitos numéricos" });
      } else {
        toast({ title: "Erro ao salvar", description: msg, variant: "destructive" });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) mutation.mutate();
  };

  if (isEdit && loadingExisting) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

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
        {/* Identification */}
        <Card>
          <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input id="full_name" value={form.full_name} onChange={set("full_name")} maxLength={200} />
              {errors.full_name && <p className="text-xs text-destructive">{errors.full_name}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="nickname">Apelido</Label>
              <Input id="nickname" value={form.nickname} onChange={set("nickname")} maxLength={100} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cpf">CPF *</Label>
              <Input id="cpf" value={form.cpf} onChange={set("cpf")} placeholder="Apenas números" maxLength={14} />
              {errors.cpf && <p className="text-xs text-destructive">{errors.cpf}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="rg">RG</Label>
              <Input id="rg" value={form.rg} onChange={set("rg")} maxLength={20} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="birth_date">Data de nascimento</Label>
              <Input id="birth_date" type="date" value={form.birth_date} onChange={set("birth_date")} />
            </div>
            <div className="space-y-1">
              <Label>Gênero</Label>
              <Select value={form.gender} onValueChange={setSelect("gender")}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="masculino">Masculino</SelectItem>
                  <SelectItem value="feminino">Feminino</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Estado civil</Label>
              <Select value={form.marital_status} onValueChange={setSelect("marital_status")}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="solteiro">Solteiro(a)</SelectItem>
                  <SelectItem value="casado">Casado(a)</SelectItem>
                  <SelectItem value="divorciado">Divorciado(a)</SelectItem>
                  <SelectItem value="viuvo">Viúvo(a)</SelectItem>
                  <SelectItem value="uniao_estavel">União estável</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nationality">Nacionalidade</Label>
              <Input id="nationality" value={form.nationality} onChange={set("nationality")} maxLength={50} />
            </div>
          </CardContent>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader><CardTitle className="text-base">Contato</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="phone_main">Telefone principal</Label>
              <Input id="phone_main" value={form.phone_main} onChange={set("phone_main")} maxLength={15} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="phone_secondary">Telefone secundário</Label>
              <Input id="phone_secondary" value={form.phone_secondary} onChange={set("phone_secondary")} maxLength={15} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={form.email} onChange={set("email")} maxLength={255} />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Address */}
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

        {/* Emergency */}
        <Card>
          <CardHeader><CardTitle className="text-base">Contato de emergência</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="emergency_contact_name">Nome</Label>
              <Input id="emergency_contact_name" value={form.emergency_contact_name} onChange={set("emergency_contact_name")} maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="emergency_contact_phone">Telefone</Label>
              <Input id="emergency_contact_phone" value={form.emergency_contact_phone} onChange={set("emergency_contact_phone")} maxLength={15} />
            </div>
          </CardContent>
        </Card>

        {/* Additional */}
        <Card>
          <CardHeader><CardTitle className="text-base">Informações adicionais</CardTitle></CardHeader>
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
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="notes">Observações</Label>
              <Textarea id="notes" value={form.notes} onChange={set("notes")} maxLength={2000} rows={3} />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar alterações" : "Cadastrar"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/workers")}>Cancelar</Button>
        </div>
      </form>
    </div>
  );
}
