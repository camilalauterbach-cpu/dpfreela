import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { getSystemSetting, saveSystemSetting } from "@/lib/system-settings";
import { Loader2, Lock } from "lucide-react";

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

interface Props {
  readOnly?: boolean;
}

export function SettingsCompany({ readOnly = false }: Props) {
  const { toast } = useToast();
  const [data, setData] = useState<CompanySettings>(empty);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    getSystemSetting<CompanySettings>("company_info").then((val) => {
      if (val) setData({ ...empty, ...val });
      setFetching(false);
    });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    const { error } = await saveSystemSetting("company_info", data);
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Dados da empresa salvos" });
    }
  };

  const update = (key: keyof CompanySettings, value: string) =>
    setData((prev) => ({ ...prev, [key]: value }));

  if (fetching) return <div className="py-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da Empresa</CardTitle>
        <CardDescription>Informações da empresa que opera o sistema DPfreela. Configuração global — visível para todos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnly && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>Somente administradores e gerentes podem editar estas configurações.</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Razão Social</Label>
            <Input value={data.company_name} onChange={(e) => update("company_name", e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Nome Fantasia</Label>
            <Input value={data.trade_name} onChange={(e) => update("trade_name", e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>CNPJ</Label>
            <Input value={data.cnpj} onChange={(e) => update("cnpj", e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Telefone</Label>
            <Input value={data.phone} onChange={(e) => update("phone", e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input value={data.email} onChange={(e) => update("email", e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Cidade</Label>
            <Input value={data.city} onChange={(e) => update("city", e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>UF</Label>
            <Input value={data.state} onChange={(e) => update("state", e.target.value)} maxLength={2} disabled={readOnly} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Endereço</Label>
          <Input value={data.address} onChange={(e) => update("address", e.target.value)} disabled={readOnly} />
        </div>
        <div className="space-y-2">
          <Label>Observações</Label>
          <Textarea value={data.notes} onChange={(e) => update("notes", e.target.value)} rows={3} disabled={readOnly} />
        </div>
        {!readOnly && (
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
