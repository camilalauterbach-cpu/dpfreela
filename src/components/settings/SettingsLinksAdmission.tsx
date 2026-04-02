import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface LinkAdmissionConfig {
  // Tipos de remuneração habilitados
  remuneration_types: {
    daily: boolean;
    monthly: boolean;
    hourly: boolean;
    per_event: boolean;
  };
  // Benefícios padrão
  default_vt: boolean;
  default_vt_value: string;
  default_vr_va: boolean;
  default_vr_va_value: string;
  // Campos obrigatórios na admissão
  required_fields: {
    job_role: boolean;
    department: boolean;
    contract_type: boolean;
    hire_date: boolean;
    end_date: boolean;
    daily_hours: boolean;
    weekly_hours: boolean;
  };
  // Textos padrão
  default_uniform_notes: string;
  default_transport_notes: string;
  default_meal_entitlement: string;
  default_notes: string;
  // Exportação
  export_file_prefix: string;
  export_include_empty_columns: boolean;
}

const defaultConfig: LinkAdmissionConfig = {
  remuneration_types: { daily: true, monthly: true, hourly: true, per_event: true },
  default_vt: false,
  default_vt_value: "",
  default_vr_va: false,
  default_vr_va_value: "",
  required_fields: {
    job_role: true,
    department: false,
    contract_type: false,
    hire_date: true,
    end_date: true,
    daily_hours: false,
    weekly_hours: false,
  },
  default_uniform_notes: "",
  default_transport_notes: "",
  default_meal_entitlement: "",
  default_notes: "",
  export_file_prefix: "admissao",
  export_include_empty_columns: true,
};

const remunerationLabels: Record<string, string> = {
  daily: "Diarista",
  monthly: "Mensalista",
  hourly: "Horista",
  per_event: "Por evento",
};

const requiredFieldLabels: Record<string, string> = {
  job_role: "Função",
  department: "Departamento",
  contract_type: "Tipo de contrato",
  hire_date: "Data de início",
  end_date: "Data de término",
  daily_hours: "Horas diárias",
  weekly_hours: "Horas semanais",
};

export function SettingsLinksAdmission() {
  const { toast } = useToast();
  const [config, setConfig] = useState<LinkAdmissionConfig>(defaultConfig);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [filterId, setFilterId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("saved_filters")
      .select("*")
      .eq("table_name", "__system_settings")
      .eq("filter_name", "links_admission_config")
      .maybeSingle()
      .then(({ data: row }) => {
        if (row) {
          setConfig({ ...defaultConfig, ...(row.filter_config as unknown as LinkAdmissionConfig) });
          setFilterId(row.id);
        }
        setFetching(false);
      });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) { setLoading(false); return; }

    if (filterId) {
      const { error } = await supabase
        .from("saved_filters")
        .update({ filter_config: config as any, updated_at: new Date().toISOString() })
        .eq("id", filterId);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Configurações salvas" });
      }
    } else {
      const { data: inserted, error } = await supabase
        .from("saved_filters")
        .insert({
          table_name: "__system_settings",
          filter_name: "links_admission_config",
          filter_config: config as any,
          user_id: userId,
        })
        .select()
        .single();
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      } else {
        setFilterId(inserted.id);
        toast({ title: "Configurações salvas" });
      }
    }
    setLoading(false);
  };

  const toggleRemType = (key: keyof LinkAdmissionConfig["remuneration_types"]) => {
    setConfig((prev) => ({
      ...prev,
      remuneration_types: { ...prev.remuneration_types, [key]: !prev.remuneration_types[key] },
    }));
  };

  const toggleRequiredField = (key: keyof LinkAdmissionConfig["required_fields"]) => {
    setConfig((prev) => ({
      ...prev,
      required_fields: { ...prev.required_fields, [key]: !prev.required_fields[key] },
    }));
  };

  if (fetching) return <div className="py-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      {/* Tipos de Remuneração */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tipos de Remuneração</CardTitle>
          <CardDescription>Defina quais tipos de remuneração estão habilitados para novos vínculos.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(config.remuneration_types) as Array<keyof typeof config.remuneration_types>).map((key) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={config.remuneration_types[key]}
                  onCheckedChange={() => toggleRemType(key)}
                />
                <span className="text-sm">{remunerationLabels[key]}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Benefícios Padrão */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Benefícios Padrão</CardTitle>
          <CardDescription>Valores pré-preenchidos ao criar novos vínculos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={config.default_vt}
                onCheckedChange={(v) => setConfig((prev) => ({ ...prev, default_vt: !!v }))}
              />
              <span className="text-sm font-medium">Vale-transporte (VT)</span>
            </label>
            {config.default_vt && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">Valor padrão R$</Label>
                <Input
                  className="w-28"
                  value={config.default_vt_value}
                  onChange={(e) => setConfig((prev) => ({ ...prev, default_vt_value: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={config.default_vr_va}
                onCheckedChange={(v) => setConfig((prev) => ({ ...prev, default_vr_va: !!v }))}
              />
              <span className="text-sm font-medium">Vale-refeição/alimentação (VR/VA)</span>
            </label>
            {config.default_vr_va && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">Valor padrão R$</Label>
                <Input
                  className="w-28"
                  value={config.default_vr_va_value}
                  onChange={(e) => setConfig((prev) => ({ ...prev, default_vr_va_value: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Campos Obrigatórios */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Campos Obrigatórios</CardTitle>
          <CardDescription>Defina quais campos são obrigatórios ao criar/editar vínculos.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(config.required_fields) as Array<keyof typeof config.required_fields>).map((key) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={config.required_fields[key]}
                  onCheckedChange={() => toggleRequiredField(key)}
                />
                <span className="text-sm">{requiredFieldLabels[key]}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Textos Padrão */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Textos e Observações Padrão</CardTitle>
          <CardDescription>Textos pré-preenchidos ao criar novos vínculos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Uniforme (obs. padrão)</Label>
            <Textarea
              value={config.default_uniform_notes}
              onChange={(e) => setConfig((prev) => ({ ...prev, default_uniform_notes: e.target.value }))}
              rows={2}
              placeholder="Ex: Camiseta preta, calça jeans..."
            />
          </div>
          <div className="space-y-2">
            <Label>Transporte (obs. padrão)</Label>
            <Textarea
              value={config.default_transport_notes}
              onChange={(e) => setConfig((prev) => ({ ...prev, default_transport_notes: e.target.value }))}
              rows={2}
              placeholder="Ex: Uber corporativo..."
            />
          </div>
          <div className="space-y-2">
            <Label>Alimentação (obs. padrão)</Label>
            <Textarea
              value={config.default_meal_entitlement}
              onChange={(e) => setConfig((prev) => ({ ...prev, default_meal_entitlement: e.target.value }))}
              rows={2}
              placeholder="Ex: Refeição no local..."
            />
          </div>
          <div className="space-y-2">
            <Label>Observações gerais (padrão)</Label>
            <Textarea
              value={config.default_notes}
              onChange={(e) => setConfig((prev) => ({ ...prev, default_notes: e.target.value }))}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Exportação */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configurações de Exportação</CardTitle>
          <CardDescription>Defina o padrão de nome e colunas dos arquivos exportados.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Prefixo do nome do arquivo</Label>
            <div className="flex items-center gap-2">
              <Input
                className="w-48"
                value={config.export_file_prefix}
                onChange={(e) => setConfig((prev) => ({ ...prev, export_file_prefix: e.target.value }))}
              />
              <span className="text-xs text-muted-foreground">_AAAA-MM-DD.xlsx</span>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={config.export_include_empty_columns}
              onCheckedChange={(v) => setConfig((prev) => ({ ...prev, export_include_empty_columns: !!v }))}
            />
            <span className="text-sm">Incluir colunas vazias na exportação</span>
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end pb-4">
        <Button onClick={handleSave} disabled={loading} size="lg">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar Configurações de Vínculos
        </Button>
      </div>
    </div>
  );
}
