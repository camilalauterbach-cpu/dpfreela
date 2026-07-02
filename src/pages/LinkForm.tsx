import { useState, useEffect, useRef } from "react";
import { formatSupabaseError } from "@/lib/format-error";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLinkGroup, useCreateLinkGroup, useUpdateLinkGroup } from "@/hooks/useLinkGroups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Save, X, Info } from "lucide-react";
import { LinkDocumentConfigForm } from "@/components/links/LinkDocumentConfigForm";
import { LinkDocumentConfig, EMPTY_CONFIG, parseConfig } from "@/lib/link-document-config";

function useAllEvents() {
  return useQuery({
    queryKey: ["events-all-select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, name, company_id, companies(legal_name)")
        .is("deleted_at", null)
        .order("name")
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

function useAllCompanies() {
  return useQuery({
    queryKey: ["companies-all-select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, legal_name, trade_name")
        .is("deleted_at", null)
        .order("legal_name")
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

const statusOptions = [
  { value: "draft", label: "Rascunho", description: "Grupo em preparação, ainda não confirmado." },
  { value: "active", label: "Ativo", description: "Grupo confirmado e em vigor." },
  { value: "suspended", label: "Suspenso", description: "Temporariamente pausado." },
  { value: "completed", label: "Concluído", description: "Período encerrado normalmente." },
  { value: "terminated", label: "Encerrado", description: "Encerrado antes do previsto." },
  { value: "cancelled", label: "Cancelado", description: "Cancelado antes de iniciar." },
];

const contractTypeOptions = [
  { value: "clt", label: "CLT" },
  { value: "service", label: "Prestação de serviço" },
  { value: "both", label: "Ambos (CLT e Prestação)" },
];

export default function LinkForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: existing, isLoading: loadingExisting } = useLinkGroup(id);
  const { data: events } = useAllEvents();
  const { data: companies } = useAllCompanies();
  const createMutation = useCreateLinkGroup();
  const updateMutation = useUpdateLinkGroup();

  const [form, setForm] = useState<Record<string, any>>({
    group_name: "",
    event_id: "",
    company_id: "",
    status: "draft",
    hire_date: "",
    end_date: "",
    allowed_contract_types: "both",
    work_days_mode: "continuous",
    specific_work_dates: [] as string[],
    work_days_notes: "",
    supervisor_name: "",
    assembly_point: "",
    uniform_notes: "",
    transport_notes: "",
    meal_entitlement: "",
    notes: "",
  });

  const [docConfig, setDocConfig] = useState<LinkDocumentConfig>({ ...EMPTY_CONFIG });
  const [newDate, setNewDate] = useState("");
  const [highlightDates, setHighlightDates] = useState(false);
  const hireDateRef = useRef<HTMLInputElement>(null);
  const contractSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEdit && existing) {
      const e = existing as any;
      setForm({
        group_name: e.group_name || "",
        event_id: e.event_id || "",
        company_id: e.company_id || "",
        status: e.status || "draft",
        hire_date: e.hire_date || "",
        end_date: e.end_date || "",
        allowed_contract_types: e.allowed_contract_types || "both",
        work_days_mode: e.work_days_mode || "continuous",
        specific_work_dates: e.specific_work_dates || [],
        work_days_notes: e.work_days_notes || "",
        supervisor_name: e.supervisor_name || "",
        assembly_point: e.assembly_point || "",
        uniform_notes: e.uniform_notes || "",
        transport_notes: e.transport_notes || "",
        meal_entitlement: e.meal_entitlement || "",
        notes: e.notes || "",
      });
      setDocConfig(parseConfig(e.required_documents));
    }
  }, [isEdit, existing]);

  const set = (key: string, value: any) => setForm((p) => ({ ...p, [key]: value }));

  useEffect(() => {
    if (form.event_id && events) {
      const ev = events.find((e: any) => e.id === form.event_id);
      if (ev && (ev as any).company_id && !form.company_id) {
        set("company_id", (ev as any).company_id);
      }
    }
  }, [form.event_id, events]);

  const addSpecificDate = () => {
    if (!newDate) return;
    if (form.hire_date && newDate < form.hire_date) {
      toast({ title: "Data fora do período", description: "A data deve ser igual ou posterior à data de início.", variant: "destructive" });
      return;
    }
    if (form.end_date && newDate > form.end_date) {
      toast({ title: "Data fora do período", description: "A data deve ser igual ou anterior à data de fim.", variant: "destructive" });
      return;
    }
    if (form.specific_work_dates.includes(newDate)) {
      toast({ title: "Data duplicada", variant: "destructive" });
      return;
    }
    set("specific_work_dates", [...form.specific_work_dates, newDate].sort());
    setNewDate("");
  };

  const removeSpecificDate = (d: string) => {
    set("specific_work_dates", form.specific_work_dates.filter((x: string) => x !== d));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.group_name.trim()) {
      toast({ title: "Nome do grupo é obrigatório", variant: "destructive" });
      return;
    }
    if (!form.event_id) {
      toast({ title: "Selecione um evento", variant: "destructive" });
      return;
    }

    const payload: Record<string, any> = {
      group_name: form.group_name,
      event_id: form.event_id,
      company_id: form.company_id || null,
      status: form.status,
      hire_date: form.hire_date || null,
      end_date: form.end_date || null,
      allowed_contract_types: form.allowed_contract_types,
      work_days_mode: form.work_days_mode,
      specific_work_dates: form.work_days_mode === "specific_dates" ? form.specific_work_dates : [],
      work_days_notes: form.work_days_notes || null,
      supervisor_name: form.supervisor_name || null,
      assembly_point: form.assembly_point || null,
      uniform_notes: form.uniform_notes || null,
      transport_notes: form.transport_notes || null,
      meal_entitlement: form.meal_entitlement || null,
      notes: form.notes || null,
      required_documents: docConfig,
    };

    if (isEdit) {
      updateMutation.mutate({ id: id!, ...payload }, {
        onSuccess: () => {
          toast({ title: "Grupo atualizado" });
          navigate(`/links/${id}`);
        },
        onError: (err: any) => {
          toast({ title: "Erro ao salvar", description: formatSupabaseError(err), variant: "destructive" });
        },
      });
    } else {
      createMutation.mutate(payload, {
        onSuccess: (data) => {
          toast({ title: "Grupo criado" });
          navigate(`/links/${data.id}`);
        },
        onError: (err: any) => {
          toast({ title: "Erro ao salvar", description: formatSupabaseError(err), variant: "destructive" });
        },
      });
    }
  };

  if (isEdit && loadingExisting) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const formatDateBR = (d: string) => {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  };

  const currentStatusInfo = statusOptions.find((s) => s.value === form.status);
  const currentEvent = events?.find((e: any) => e.id === form.event_id);
  const currentCompany = companies?.find((c: any) => c.id === form.company_id);
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/links")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">
          {isEdit ? "Editar grupo" : "Novo grupo"}
        </h1>
      </div>

      {/* Identificação */}
      <Card>
        <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
        <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Nome do grupo *</Label>
            <Input value={form.group_name} onChange={(e) => set("group_name", e.target.value)} placeholder="Ex: Equipe Segurança — Festival 2026" required />
          </div>
          <div>
            <Label>Evento *</Label>
            <Select value={form.event_id} onValueChange={(v) => {
              set("event_id", v);
              const ev = events?.find((e: any) => e.id === v);
              if (ev && (ev as any).company_id) {
                set("company_id", (ev as any).company_id);
              }
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione">{form.event_id ? currentEvent?.name : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {events?.map((ev: any) => (
                  <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Empresa</Label>
            <Select value={form.company_id} onValueChange={(v) => set("company_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione">{form.company_id ? (currentCompany?.trade_name || currentCompany?.legal_name) : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {companies?.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Contrato */}
      <Card ref={contractSectionRef}>
        <CardHeader><CardTitle className="text-base">Contrato</CardTitle></CardHeader>
        <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue>{currentStatusInfo?.label}</SelectValue></SelectTrigger>
              <SelectContent>
                {statusOptions.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentStatusInfo && (
              <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                {currentStatusInfo.description}
              </p>
            )}
          </div>
          <div>
            <Label>Tipo de contratação</Label>
            <Select value={form.allowed_contract_types} onValueChange={(v) => set("allowed_contract_types", v)}>
              <SelectTrigger>
                <SelectValue>{contractTypeOptions.find((o) => o.value === form.allowed_contract_types)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {contractTypeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              Define os tipos de contrato permitidos para os trabalhadores deste grupo.
            </p>
          </div>
          <div>
            <Label className={highlightDates && !form.hire_date ? "text-destructive font-semibold" : ""}>
              Data início
            </Label>
            <Input ref={hireDateRef} type="date" value={form.hire_date}
              onChange={(e) => { set("hire_date", e.target.value); if (e.target.value && form.end_date) setHighlightDates(false); }}
              className={highlightDates && !form.hire_date ? "border-destructive ring-2 ring-destructive/30" : ""}
            />
          </div>
          <div>
            <Label className={highlightDates && !form.end_date ? "text-destructive font-semibold" : ""}>
              Data fim
            </Label>
            <Input type="date" value={form.end_date}
              onChange={(e) => { set("end_date", e.target.value); if (form.hire_date && e.target.value) setHighlightDates(false); }}
              className={highlightDates && !form.end_date ? "border-destructive ring-2 ring-destructive/30" : ""}
            />
          </div>
        </CardContent>
      </Card>

      {/* Dias de atuação */}
      <Card>
        <CardHeader><CardTitle className="text-base">Dias de atuação</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Modo</Label>
            <Select value={form.work_days_mode} onValueChange={(v) => {
              set("work_days_mode", v);
              if (v === "specific_dates" && (!form.hire_date || !form.end_date)) {
                setHighlightDates(true);
                setTimeout(() => {
                  contractSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  setTimeout(() => hireDateRef.current?.focus(), 400);
                }, 50);
              }
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="continuous">Contínuo (todos os dias do período)</SelectItem>
                <SelectItem value="specific_dates">Datas específicas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.work_days_mode === "specific_dates" && (
            <div className="space-y-2">
              <Label>Datas de atuação</Label>
              {!form.hire_date || !form.end_date ? (
                <button type="button" onClick={() => {
                  setHighlightDates(true);
                  contractSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  setTimeout(() => hireDateRef.current?.focus(), 400);
                }} className="flex items-center gap-2 rounded-md border border-dashed border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors w-full text-left">
                  <span>⚠️ Preencha as datas de início e fim na seção Contrato.</span>
                  <span className="underline whitespace-nowrap">Ir para lá →</span>
                </button>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} min={form.hire_date} max={form.end_date} className="flex-1" />
                    <Button type="button" size="sm" variant="outline" onClick={addSpecificDate}>Adicionar</Button>
                  </div>
                  {form.specific_work_dates.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {form.specific_work_dates.map((d: string) => (
                        <Badge key={d} variant="secondary" className="gap-1">
                          {formatDateBR(d)}
                          <button type="button" onClick={() => removeSpecificDate(d)} className="hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <Label>Observações da escala</Label>
            <Textarea value={form.work_days_notes} onChange={(e) => set("work_days_notes", e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      {/* Operacional */}
      <Card>
        <CardHeader><CardTitle className="text-base">Operacional</CardTitle></CardHeader>
        <CardContent className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div>
            <Label>Supervisor</Label>
            <Input value={form.supervisor_name} onChange={(e) => set("supervisor_name", e.target.value)} />
          </div>
          <div>
            <Label>Ponto de encontro</Label>
            <Input value={form.assembly_point} onChange={(e) => set("assembly_point", e.target.value)} />
          </div>
          <div>
            <Label>Uniforme</Label>
            <Input value={form.uniform_notes} onChange={(e) => set("uniform_notes", e.target.value)} />
          </div>
          <div>
            <Label>Transporte</Label>
            <Input value={form.transport_notes} onChange={(e) => set("transport_notes", e.target.value)} />
          </div>
          <div>
            <Label>Refeição</Label>
            <Input value={form.meal_entitlement} onChange={(e) => set("meal_entitlement", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Configuração documental */}
      <LinkDocumentConfigForm config={docConfig} onChange={setDocConfig} />

      {/* Observações */}
      <Card>
        <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
        <CardContent>
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 pb-4">
        <Button type="button" variant="outline" onClick={() => navigate("/links")}>Cancelar</Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Salvar
        </Button>
      </div>
    </form>
  );
}
