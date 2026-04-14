import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  LinkDocumentConfig,
  OPERATIONAL_OPTIONS,
  NR_OPTIONS,
  COMPANY_DOC_OPTIONS,
} from "@/lib/link-document-config";

interface Props {
  config: LinkDocumentConfig;
  onChange: (config: LinkDocumentConfig) => void;
}

function CheckboxGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: readonly { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => onToggle(opt.value)}
              className="h-4 w-4 rounded border-input"
            />
            <span className="text-sm">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function LinkDocumentConfigForm({ config, onChange }: Props) {
  const toggle = (group: "operational" | "nrs" | "company", value: string) => {
    const current = config[group];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...config, [group]: next });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configuração documental do vínculo</CardTitle>
        <p className="text-xs text-muted-foreground">
          Marque os documentos que serão obrigatórios para este vínculo. Apenas os itens selecionados aparecerão na aba Documentos.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <CheckboxGroup
          title="A) Documentos operacionais do vínculo/evento"
          options={OPERATIONAL_OPTIONS}
          selected={config.operational}
          onToggle={(v) => toggle("operational", v)}
        />

        <div className="border-t pt-4 space-y-2">
          <CheckboxGroup
            title="B) NRs aplicáveis"
            options={NR_OPTIONS}
            selected={config.nrs}
            onToggle={(v) => toggle("nrs", v)}
          />
          <div className="pl-6">
            <Label className="text-xs">NR personalizada (complementar)</Label>
            <Input
              value={config.nr_custom || ""}
              onChange={(e) => onChange({ ...config, nr_custom: e.target.value })}
              placeholder="Ex: NR 33 — Espaços confinados"
              className="max-w-sm"
            />
          </div>
        </div>

        {/* Seção C removida: documentos da empresa/operação agora ficam no nível do evento */}
        {/* Dados legados em config.company são preservados no tipo para compatibilidade */}
      </CardContent>
    </Card>
  );
}
