import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

const REASON_LABELS: Record<string, string> = {
  profile_created: "Perfil criado",
  role_assigned: "Papel atribuído",
  profile_and_role_created: "Perfil + papel criados",
  profile_created_disabled_user: "Perfil criado (usuário desativado)",
};

export function AccessRepairLogs() {
  const { data, isLoading } = useQuery({
    queryKey: ["access_repair_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_repair_logs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <CardTitle>Reparos automáticos de acesso</CardTitle>
            <CardDescription>
              Cada vez que um usuário entra sem perfil ou sem papel, o sistema
              corrige e registra aqui. Use para acompanhar recorrências.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.length ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            Nenhum reparo automático registrado — ótimo sinal.
          </p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="hidden sm:table-cell">Perfil</TableHead>
                  <TableHead className="hidden sm:table-cell">Papel</TableHead>
                  <TableHead className="hidden md:table-cell">Papéis após</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(log.created_at), "dd/MM/yy HH:mm:ss")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.email || (
                        <span className="font-mono text-muted-foreground">
                          {log.user_id?.slice(0, 8)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {REASON_LABELS[log.reason] || log.reason}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {log.profile_created ? (
                        <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          criado
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {log.role_assigned ? (
                        <Badge variant="outline" className="bg-blue-500/15 text-blue-700 dark:text-blue-400">
                          atribuído
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs font-mono text-muted-foreground">
                      {Array.isArray(log.roles_after) && log.roles_after.length
                        ? log.roles_after.join(", ")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}