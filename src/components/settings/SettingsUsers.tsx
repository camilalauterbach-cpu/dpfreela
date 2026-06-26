import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  manager: "Gerente",
  operator: "Operador",
  viewer: "Visualizador",
};

type UserRow = {
  user_id: string;
  full_name: string | null;
  role: string | null;
  role_id: string | null;
};

export function SettingsUsers() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    setLoading(true);
    // List ALL profiles (admins/managers can view all via RLS) so that
    // newly-signed-up collaborators without a role are visible and can
    // receive permissions.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .order("full_name", { ascending: true, nullsFirst: false });

    const { data: roles } = await supabase
      .from("user_roles")
      .select("id, user_id, role");

    const roleMap = new Map(
      (roles || []).map((r) => [r.user_id, { role: r.role as string, role_id: r.id as string }])
    );

    const merged: UserRow[] = (profiles || []).map((p) => {
      const r = roleMap.get(p.user_id);
      return {
        user_id: p.user_id,
        full_name: p.full_name,
        role: r?.role ?? null,
        role_id: r?.role_id ?? null,
      };
    });

    // Users without a role come first so admins notice them immediately.
    merged.sort((a, b) => {
      if (!a.role && b.role) return -1;
      if (a.role && !b.role) return 1;
      return (a.full_name || "").localeCompare(b.full_name || "");
    });

    setUsers(merged);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleRoleChange = async (
    user: UserRow,
    newRole: "admin" | "manager" | "operator" | "viewer"
  ) => {
    const { error } = user.role_id
      ? await supabase
          .from("user_roles")
          .update({ role: newRole as any })
          .eq("id", user.role_id)
      : await supabase
          .from("user_roles")
          .insert({ user_id: user.user_id, role: newRole as any });

    if (error) {
      toast({ title: "Erro ao alterar permissão", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: user.role_id ? "Permissão atualizada" : "Permissão concedida",
        description: `${user.full_name || "Usuário"} agora é ${roleLabels[newRole]}.`,
      });
      fetchUsers();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuários e Permissões</CardTitle>
        <CardDescription>Gerencie os papéis dos usuários do sistema.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground py-4 text-center">Carregando...</p>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center">Nenhum usuário encontrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Permissão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.user_id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-foreground">{u.full_name || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground">{u.user_id.slice(0, 8)}…</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.user_id === currentUser?.id ? (
                      <Badge variant="secondary">{u.role ? roleLabels[u.role] : "Sem permissão"}</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        {!u.role && (
                          <Badge variant="destructive" className="text-xs">Sem permissão</Badge>
                        )}
                        <Select
                          value={u.role ?? undefined}
                          onValueChange={(v) => handleRoleChange(u, v as any)}
                        >
                        <SelectTrigger className="w-[160px]">
                          <SelectValue placeholder="Atribuir…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="manager">Gerente</SelectItem>
                          <SelectItem value="operator">Operador</SelectItem>
                          <SelectItem value="viewer">Visualizador</SelectItem>
                        </SelectContent>
                        </Select>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
