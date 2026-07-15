import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCcw, Users2, ShieldOff, Eye, ScrollText } from "lucide-react";
import { useDuplicateCandidates, useMarkNotSamePerson, useMergeLogs, type DuplicateCandidate } from "@/hooks/useDuplicates";
import { DuplicateCompareDialog } from "./DuplicateCompareDialog";

function fmtDateTime(v: string): string {
  try { return new Date(v).toLocaleString("pt-BR"); } catch { return v; }
}

export function SettingsDuplicates() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<DuplicateCandidate | null>(null);
  const cands = useDuplicateCandidates();
  const logs = useMergeLogs(30);
  const markNotSame = useMarkNotSamePerson();

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = cands.data ?? [];
    if (!term) return list;
    return list.filter((c) =>
      [c.a.full_name, c.b.full_name, c.a.cpf, c.b.cpf, c.a.email, c.b.email]
        .some((v) => (v ?? "").toLowerCase().includes(term))
    );
  }, [q, cands.data]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users2 className="h-4 w-4" /> Possíveis duplicidades
            </CardTitle>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Buscar por nome, CPF ou e-mail…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-8 w-[220px]"
              />
              <Button size="sm" variant="outline" onClick={() => cands.refetch()} disabled={cands.isFetching}>
                <RefreshCcw className={"h-4 w-4 " + (cands.isFetching ? "animate-spin" : "")} />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Pares detectados por CPF idêntico ou nome muito parecido com a mesma data de nascimento.
            Nenhuma mesclagem é feita automaticamente.
          </p>
        </CardHeader>
        <CardContent>
          {cands.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando candidatos…
            </div>
          ) : cands.isError ? (
            <div className="text-sm text-destructive py-4">
              Erro ao carregar: {(cands.error as Error).message}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma duplicidade em aberto.
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => {
                const key = `${c.a.id}__${c.b.id}`;
                return (
                  <li key={key} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={c.reason === "cpf_match" ? "destructive" : "secondary"}>
                          {c.reason === "cpf_match" ? "CPF idêntico" : "Nome + nasc."}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Similaridade {Math.round((c.similarity ?? 0) * 100)}%
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">{c.a.full_name}</span>
                        <span className="text-muted-foreground"> ({c.a.cpf ?? "sem CPF"})</span>
                        <span className="mx-2 text-muted-foreground">×</span>
                        <span className="font-medium">{c.b.full_name}</span>
                        <span className="text-muted-foreground"> ({c.b.cpf ?? "sem CPF"})</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => setSelected(c)}>
                        <Eye className="h-4 w-4 mr-1.5" /> Comparar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => markNotSame.mutate({ aId: c.a.id, bId: c.b.id })}
                        disabled={markNotSame.isPending}
                        title="Registrar como pessoas diferentes e ocultar deste painel"
                      >
                        <ShieldOff className="h-4 w-4 mr-1.5" /> Falso positivo
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" /> Histórico recente de merges
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (logs.data?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Nenhum registro de merge até o momento.
            </div>
          ) : (
            <ul className="divide-y text-xs">
              {logs.data!.map((l) => {
                const isConflict = l.action === "merge_conflict";
                const primary = l.new_data?.primary ?? l.new_data?.transferred?.primary;
                const transferred = l.new_data?.transferred;
                return (
                  <li key={l.id} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={isConflict ? "destructive" : "outline"}>
                          {isConflict ? "Conflito" : "Mesclado"}
                        </Badge>
                        <span className="text-muted-foreground">{fmtDateTime(l.created_at)}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground break-all">
                        secundário: <span className="font-mono">{l.record_id}</span>
                        {primary && <> · primário: <span className="font-mono">{String(primary)}</span></>}
                      </div>
                      {transferred && (
                        <div className="text-[11px] text-muted-foreground">
                          {Object.entries(transferred).map(([k, v]) => `${k}=${v}`).join(" · ")}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected && (
        <DuplicateCompareDialog
          open
          onClose={() => setSelected(null)}
          a={selected.a}
          b={selected.b}
        />
      )}
    </div>
  );
}