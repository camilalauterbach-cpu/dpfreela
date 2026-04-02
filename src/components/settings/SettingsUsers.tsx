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
  email: string;
  full_name: string | null;
  role: string;
  role_id: string;
};

export function SettingsUsers() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    setLoading(true);
    // Get all roles
    const { data: roles } = await supabase.from("user_roles").select("id, user_id, role");
    if (!roles) { setLoading(false); return; }

    // Get profiles for those users
    const userIds = [...new Set(roles.map((r) => r.user_id))];
    const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds);

    const profileMap = new Map((profiles || []).map((p) => [p.user_id, p.full_name]));

    const merged: UserRow[] = roles.map((r) => ({
      user_id: r.user_id,
      email: "", // we don't have access to auth.users emails from client
      full_name: profileMap.get(r.user_id) || null,
      role: r.role,
      role_id: r.id,
    }));

    setUsers(merged);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleRoleChange = async (roleId: string, newRole: string) => {
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole as any })
      .eq("id", roleId);
    if (error) {
      toast({ title: "Erro ao alterar role", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Permissão atualizada" });
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
                <TableRow key={u.role_id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-foreground">{u.full_name || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground">{u.user_id.slice(0, 8)}…</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.user_id === currentUser?.id ? (
                      <Badge variant="secondary">{roleLabels[u.role] || u.role}</Badge>
                    ) : (
                      <Select defaultValue={u.role} onValueChange={(v) => handleRoleChange(u.role_id, v)}>
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="manager">Gerente</SelectItem>
                          <SelectItem value="operator">Operador</SelectItem>
                          <SelectItem value="viewer">Visualizador</SelectItem>
                        </SelectContent>
                      </Select>
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
