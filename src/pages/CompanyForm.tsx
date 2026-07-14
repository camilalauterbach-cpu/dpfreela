import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useMutationWithFeedback } from "@/hooks/useMutationWithFeedback";
import { useUnsavedFormGuard } from "@/hooks/useUnsavedFormGuard";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompanies";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2 } from "lucide-react";

const STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

interface CompanyFormData {
  legal_name: string;
  trade_name: string;
  cnpj: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  notes: string;
}

const emptyForm: CompanyFormData = {
  legal_name: "", trade_name: "", cnpj: "", phone: "", email: "",
  address: "", city: "", state: "", notes: "",
};

export default function CompanyForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: existing, isLoading: loadingExisting } = useCompany(id);

  const [form, setForm] = useState<CompanyFormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  useUnsavedFormGuard(isDirty, `company-form-${id ?? "new"}`);

  useEffect(() => {
    if (existing) {
      setForm({
        legal_name: existing.legal_name || "",
        trade_name: existing.trade_name || "",
        cnpj: existing.cnpj || "",
        phone: existing.phone || "",
        email: existing.email || "",
        address: existing.address || "",
        city: existing.city || "",
        state: existing.state || "",
        notes: existing.notes || "",
      });
      setIsDirty(false);
    }
  }, [existing]);

  const set = (field: keyof CompanyFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
    setIsDirty(true);
  };

  const setSelect = (field: keyof CompanyFormData) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setIsDirty(true);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.legal_name.trim()) errs.legal_name = "Razão social é obrigatória";
    if (form.cnpj) {
      const cleanCnpj = form.cnpj.replace(/\D/g, "");
      if (cleanCnpj.length !== 14) errs.cnpj = "CNPJ deve ter 14 dígitos";
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "E-mail inválido";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const mutation = useMutationWithFeedback<void, unknown, void, unknown>({
    pendingMessage: isEdit ? "Salvando alterações…" : "Cadastrando empresa…",
    successMessage: isEdit ? "Empresa atualizada" : "Empresa cadastrada",
    errorTitle: "Erro ao salvar empresa",
    mutationFn: async () => {
      const payload = {
        legal_name: form.legal_name.trim(),
        trade_name: form.trade_name.trim() || null,
        cnpj: form.cnpj.replace(/\D/g, "") || null,
        phone: form.phone.replace(/\D/g, "") || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state || null,
        notes: form.notes.trim() || null,
      };

      if (isEdit) {
        const { error } = await supabase.from("companies").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("companies").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      if (isEdit) {
        queryClient.invalidateQueries({ queryKey: ["company", id] });
        queryClient.invalidateQueries({ queryKey: ["employment-links"] });
        queryClient.invalidateQueries({ queryKey: ["events"] });
      }
      setIsDirty(false);
      navigate("/companies");
    },
    onError: (err: any) => {
      const msg = err?.message || "";
      if (msg.includes("companies_cnpj_key")) {
        setErrors({ cnpj: "Este CNPJ já está cadastrado" });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending || mutation.isLocked()) return;
    if (validate()) mutation.mutate(undefined);
  };

  if (isEdit && loadingExisting) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/companies")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold text-foreground">
          {isEdit ? "Editar empresa" : "Nova empresa"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Dados da empresa</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="legal_name">Razão social *</Label>
              <Input id="legal_name" value={form.legal_name} onChange={set("legal_name")} maxLength={200} />
              {errors.legal_name && <p className="text-xs text-destructive">{errors.legal_name}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="trade_name">Nome fantasia</Label>
              <Input id="trade_name" value={form.trade_name} onChange={set("trade_name")} maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cnpj">CNPJ</Label>
              <Input id="cnpj" value={form.cnpj} onChange={set("cnpj")} placeholder="Apenas números" maxLength={18} />
              {errors.cnpj && <p className="text-xs text-destructive">{errors.cnpj}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Contato</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" value={form.phone} onChange={set("phone")} maxLength={15} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={form.email} onChange={set("email")} maxLength={255} />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Endereço</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="address">Endereço</Label>
              <Input id="address" value={form.address} onChange={set("address")} maxLength={300} />
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
          <Button type="button" variant="outline" onClick={() => navigate("/companies")} disabled={mutation.isPending}>Cancelar</Button>
        </div>
      </form>
    </div>
  );
}
