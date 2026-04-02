import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/hooks/useEvents";
import { useCompanies } from "@/hooks/useCompanies";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2 } from "lucide-react";

const STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const STANDARD_NRS = ["NR 1", "NR 6", "NR 10", "NR 18", "NR 35"];

interface EventFormData {
  name: string;
  description: string;
  company_id: string;
  location: string;
  city: string;
  state: string;
  start_date: string;
  end_date: string;
  status: string;
  notes: string;
  requires_epi_form: boolean;
  requires_service_order: boolean;
  required_nrs: string[];
  required_nrs_other: string;
}

const emptyForm: EventFormData = {
  name: "", description: "", company_id: "", location: "",
  city: "", state: "", start_date: "", end_date: "",
  status: "planned", notes: "",
  requires_epi_form: false, requires_service_order: false,
  required_nrs: [], required_nrs_other: "",
};

export default function EventForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: existing, isLoading: loadingExisting } = useEvent(id);
  const { data: companies } = useCompanies("");

  const [form, setForm] = useState<EventFormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (existing) {
      const ev = existing as any;
      setForm({
        name: existing.name || "",
        description: existing.description || "",
        company_id: existing.company_id || "",
        location: existing.location || "",
        city: existing.city || "",
        state: existing.state || "",
        start_date: existing.start_date || "",
        end_date: existing.end_date || "",
        status: existing.status || "planned",
        notes: existing.notes || "",
        requires_epi_form: ev.requires_epi_form ?? false,
        requires_service_order: ev.requires_service_order ?? false,
        required_nrs: ev.required_nrs ?? [],
        required_nrs_other: ev.required_nrs_other ?? "",
      });
    }
  }, [existing]);

  const set = (field: keyof EventFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const setSelect = (field: keyof EventFormData) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const toggleNr = (nr: string) => {
    setForm((f) => ({
      ...f,
      required_nrs: f.required_nrs.includes(nr)
        ? f.required_nrs.filter((n) => n !== nr)
        : [...f.required_nrs, nr],
    }));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Nome do evento é obrigatório";
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      errs.end_date = "Data fim não pode ser anterior à data início";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        company_id: form.company_id || null,
        location: form.location.trim() || null,
        city: form.city.trim() || null,
        state: form.state || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        status: form.status,
        notes: form.notes.trim() || null,
        requires_epi_form: form.requires_epi_form,
        requires_service_order: form.requires_service_order,
        required_nrs: form.required_nrs,
        required_nrs_other: form.required_nrs_other.trim() || null,
      };

      if (isEdit) {
        const { error } = await supabase.from("events").update(payload as any).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("events").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast({ title: isEdit ? "Evento atualizado" : "Evento cadastrado" });
      navigate("/events");
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err?.message || "", variant: "destructive" });
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
        <Button variant="ghost" size="icon" onClick={() => navigate("/events")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold text-foreground">
          {isEdit ? "Editar evento" : "Novo evento"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Dados do evento</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="name">Nome do evento *</Label>
              <Input id="name" value={form.name} onChange={set("name")} maxLength={200} />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea id="description" value={form.description} onChange={set("description")} maxLength={1000} rows={2} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Empresa</Label>
              <Select value={form.company_id} onValueChange={setSelect("company_id")}>
                <SelectTrigger><SelectValue placeholder="Selecione uma empresa" /></SelectTrigger>
                <SelectContent>
                  {(companies as any)?.data?.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.legal_name}{c.trade_name ? ` (${c.trade_name})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={setSelect("status")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planejado</SelectItem>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="confirmed">Confirmado</SelectItem>
                  <SelectItem value="completed">Concluído</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Período e local</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="start_date">Data início</Label>
              <Input id="start_date" type="date" value={form.start_date} onChange={set("start_date")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end_date">Data fim</Label>
              <Input id="end_date" type="date" value={form.end_date} onChange={set("end_date")} />
              {errors.end_date && <p className="text-xs text-destructive">{errors.end_date}</p>}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="location">Local</Label>
              <Input id="location" value={form.location} onChange={set("location")} maxLength={300} />
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

        {/* Requisitos documentais */}
        <Card>
          <CardHeader><CardTitle className="text-base">Requisitos documentais</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="requires_epi_form"
                checked={form.requires_epi_form}
                onCheckedChange={(v) => setForm((f) => ({ ...f, requires_epi_form: v }))}
              />
              <Label htmlFor="requires_epi_form">Exige ficha de entrega de EPI</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="requires_service_order"
                checked={form.requires_service_order}
                onCheckedChange={(v) => setForm((f) => ({ ...f, requires_service_order: v }))}
              />
              <Label htmlFor="requires_service_order">Exige ordem de serviço</Label>
            </div>

            <div className="space-y-2">
              <Label>NRs exigidas</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {STANDARD_NRS.map((nr) => (
                  <div key={nr} className="flex items-center gap-2">
                    <Checkbox
                      id={`nr-${nr}`}
                      checked={form.required_nrs.includes(nr)}
                      onCheckedChange={() => toggleNr(nr)}
                    />
                    <Label htmlFor={`nr-${nr}`} className="font-normal">{nr}</Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="required_nrs_other">Outras exigências</Label>
              <Input
                id="required_nrs_other"
                value={form.required_nrs_other}
                onChange={set("required_nrs_other")}
                placeholder="Ex: NR 12, certificado de altura..."
                maxLength={500}
              />
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
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar alterações" : "Cadastrar"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/events")}>Cancelar</Button>
        </div>
      </form>
    </div>
  );
}
