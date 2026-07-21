import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useJobRoles } from "@/hooks/useJobRoles";
import { Badge } from "@/components/ui/badge";

// Normaliza string removendo acentos + lowercase para busca robusta.
const norm = (s?: string) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();


interface Props {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Se true, exibe indicador de erro (borda vermelha). */
  invalid?: boolean;
  /** Se true, oculta a opção "Limpar seleção". */
  required?: boolean;
}

/**
 * Combobox único de Cargo/Função — fonte: `job_roles`.
 * - Ativos selecionáveis; inativos visíveis e desabilitados (cinza + "(Inativo)").
 * - Sem criação inline; empty state leva às Configurações → Cargos.
 */
export function JobRoleCombobox({
  value,
  onChange,
  placeholder = "Selecione o cargo",
  disabled,
  className,
  invalid,
  required,
}: Props) {
  const [open, setOpen] = useState(false);
  const { data: roles, isLoading } = useJobRoles();

  const selected = roles?.find((r) => r.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between font-normal text-sm",
            !selected && "text-muted-foreground",
            invalid && "border-destructive focus-visible:ring-destructive",
            className,
          )}
        >
          <span className="truncate">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
              </span>
            ) : selected ? (
              <>
                {selected.name}
                {!selected.is_active && (
                  <Badge variant="secondary" className="ml-2 text-[10px] py-0 px-1.5">
                    Inativo
                  </Badge>
                )}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            // Busca apenas por nome, ignorando acentos e caixa.
            return norm(itemValue).includes(norm(search)) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Buscar cargo…" className="h-9" />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : (
              <>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  O cargo desejado não está cadastrado.
                </p>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  <RouterLink to="/settings?tab=job-roles">
                    <Plus className="mr-1 h-3 w-3" /> Gerenciar cargos
                  </RouterLink>
                </Button>
              </div>
            </CommandEmpty>
            <CommandGroup>
              {!required && selected && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 opacity-0" />
                    Limpar seleção
                  </span>
                </CommandItem>
              )}
              {(roles ?? []).map((role) => {
                // Busca apenas por nome; code é interno.
                const label = role.name;
                const isSelected = role.id === value;
                return (
                  <CommandItem
                    key={role.id}
                    value={label}
                    disabled={!role.is_active}
                    onSelect={() => {
                      if (!role.is_active) return;
                      onChange(role.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-between gap-2",
                      !role.is_active && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Check
                        className={cn(
                          "h-3.5 w-3.5",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{role.name}</span>
                    </span>
                    {!role.is_active && (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                        Inativo
                      </Badge>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <div className="border-t px-2 py-1.5">
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-7 w-full justify-start text-xs"
                onClick={() => setOpen(false)}
              >
                <RouterLink to="/settings?tab=job-roles">
                  <Plus className="mr-1 h-3 w-3" /> Gerenciar cargos
                </RouterLink>
              </Button>
            </div>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}