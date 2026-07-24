// Q-024-D-UI-MULTIPLE — Seletor canônico de tipo de qualificação.
// Fonte única: useWorkerQualificationTypes (RPC list_worker_qualification_types).
// - Não permite criação inline.
// - Não aceita input livre de NR.
// - Exibe badge "Já cadastrada" para tipos já vigentes do trabalhador,
//   mas mantém o item selecionável para que o chamador ofereça Renovar/Substituir.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useWorkerQualificationTypes,
  matchesQualificationSearch,
  type WorkerQualificationType,
} from "@/hooks/useWorkerQualificationTypes";

interface Props {
  value: string | null;
  onChange: (id: string | null, type: WorkerQualificationType | null) => void;
  /** Set de document_type_id que o trabalhador já possui como vigente. */
  currentByDocumentTypeId?: Set<string>;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  sst_nr: "NR",
  sst_aso: "ASO",
  training: "Treinamento",
};

export function QualificationDocumentTypeCombobox({
  value, onChange, currentByDocumentTypeId, disabled, invalid, placeholder, className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: types, isLoading } = useWorkerQualificationTypes({ includeInactive: false });

  const selected = useMemo(
    () => (types ?? []).find((t) => t.documentTypeId === value) ?? null,
    [types, value],
  );

  const filtered = useMemo(() => {
    const list = (types ?? []).filter((t) => t.selectable && t.isActive);
    if (!search.trim()) return list;
    return list.filter((t) => matchesQualificationSearch(t, search));
  }, [types, search]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid="qualification-type-combobox"
          className={cn(
            "h-9 w-full justify-between font-normal text-sm",
            !selected && "text-muted-foreground",
            invalid && "border-destructive focus-visible:ring-destructive",
            className,
          )}
        >
          <span className="truncate flex items-center gap-2">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
              </span>
            ) : selected ? (
              <>
                <span className="font-mono text-xs text-muted-foreground">{selected.code}</span>
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              placeholder || "Selecione a NR ou certificação"
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por nome ou código…"
            className="h-9"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : (
              <>
                <CommandEmpty>
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    Nenhum tipo encontrado.
                  </div>
                </CommandEmpty>
                <CommandGroup>
                  {filtered.map((t) => {
                    const already = currentByDocumentTypeId?.has(t.documentTypeId) ?? false;
                    const isSelected = t.documentTypeId === value;
                    return (
                      <CommandItem
                        key={t.documentTypeId}
                        value={t.documentTypeId}
                        onSelect={() => {
                          onChange(t.documentTypeId, t);
                          setOpen(false);
                        }}
                        data-testid={`qualification-type-option-${t.normalizedCode}`}
                        data-already-registered={already ? "true" : "false"}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Check className={cn("h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                          <span className="font-mono text-xs text-muted-foreground shrink-0">{t.code}</span>
                          <span className="truncate">{t.name}</span>
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                            {CATEGORY_LABEL[t.category] || t.category}
                          </Badge>
                          {already && (
                            <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                              Já cadastrada
                            </Badge>
                          )}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}