import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface CompanySettings {
  company_name: string;
  trade_name: string;
  cnpj: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  notes: string;
}

const empty: CompanySettings = {
  company_name: "", trade_name: "", cnpj: "", address: "",
  city: "", state: "", phone: "", email: "", notes: "",
};

export function SettingsCompany() {
  const { toast } = useToast();
  const [data, setData] = useState<CompanySettings>(empty);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [filterId, setFilterId] = useState<string | null>(null);

  useEffect(() => {
    // Use saved_filters as key-value store for system settings
    supabase
      .from("saved_filters")
      .select("*")
      .eq("table_name", "__system_settings")
      .eq("filter_name", "company_info")
      .maybeSingle()
      .then(({ data: row }) => {
        if (row) {
          setData(row.filter_config as unknown as CompanySettings);
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
        .update({ filter_config: data as any, updated_at: new Date().toISOString() })
        .eq("id", filterId);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Dados da empresa salvos" });
      }
    } else {
      const { data: inserted, error } = await supabase
        .from("saved_filters")
        .insert({
          table_name: "__system_settings",
          filter_name: "company_info",
          filter_config: data as any,
          user_id: userId,
        })
        .select()
        .single();
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      } else {
        setFilterId(inserted.id);
        toast({ title: "Dados da empresa salvos" });
      }
    }
    setLoading(false);
  };

  const update = (key: keyof CompanySettings, value: string) =>
    setData((prev) => ({ ...prev, [key]: value }));

  if (fetching) return <div className="py-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da Empresa</CardTitle>
        <CardDescription>Informações da empresa que opera o sistema DPfreela.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Razão Social</Label>
            <Input value={data.company_name} onChange={(e) => update("company_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Nome Fantasia</Label>
            <Input value={data.trade_name} onChange={(e) => update("trade_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>CNPJ</Label>
            <Input value={data.cnpj} onChange={(e) => update("cnpj", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Telefone</Label>
            <Input value={data.phone} onChange={(e) => update("phone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input value={data.email} onChange={(e) => update("email", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Cidade</Label>
            <Input value={data.city} onChange={(e) => update("city", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>UF</Label>
            <Input value={data.state} onChange={(e) => update("state", e.target.value)} maxLength={2} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Endereço</Label>
          <Input value={data.address} onChange={(e) => update("address", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Observações</Label>
          <Textarea value={data.notes} onChange={(e) => update("notes", e.target.value)} rows={3} />
        </div>
        <Button onClick={handleSave} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </CardContent>
    </Card>
  );
}
