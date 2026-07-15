import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, RotateCcw, XCircle, Loader2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Invite = {
  id: string;
  email_normalized: string;
  role: "viewer" | "operator" | "admin" | "manager";
  linked_worker_id: string | null;
  status: "pending" | "processing" | "accepted" | "expired" | "revoked";
  expires_at: string;
  attempt_count: number;
  last_error_code: string | null;
  created_at: string;
};

const statusLabels: Record<Invite["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "secondary" },
  processing: { label: "Em uso", variant: "outline" },
  accepted: { label: "Aceito", variant: "default" },
  expired: { label: "Expirado", variant: "destructive" },
  revoked: { label: "Revogado", variant: "destructive" },
};

const roleLabels: Record<string, string> = {
  viewer: "Visualizador",
  operator: "Operador",
  admin: "Administrador",
  manager: "Gerente",
};

export function SettingsInvites() {
  const { toast } = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [emailFilter, setEmailFilter] = useState("");

  // Formulário de criação
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "operator">("viewer");
  const [ttl, setTtl] = useState<number>(72);
  const [creating, setCreating] = useState(false);

  // Link temporário exibido apenas 1x
  const [issuedLink, setIssuedLink] = useState<{ email: string; link: string } | null>(null);

  const fetchInvites = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invites")
      .select("id, email_normalized, role, linked_worker_id, status, expires_at, attempt_count, last_error_code, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar convites", description: error.message, variant: "destructive" });
      setInvites([]);
    } else {
      setInvites((data ?? []) as Invite[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchInvites(); }, []);

  const filtered = useMemo(() => {
    return invites.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (emailFilter.trim() && !i.email_normalized.includes(emailFilter.trim().toLowerCase())) return false;
      return true;
    });
  }, [invites, statusFilter, emailFilter]);

  const handleCreate = async () => {
    if (!email.trim()) {
      toast({ title: "Informe o e-mail", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("invite-create", {
      body: { email: email.trim(), role, ttl_hours: ttl },
    });
    setCreating(false);
    if (error || !data?.ok) {
      const code = (data as any)?.error ?? error?.message ?? "invalid_request";
      toast({ title: "Não foi possível criar o convite", description: code, variant: "destructive" });
      return;
    }
    setIssuedLink({ email: email.trim(), link: data.link as string });
    setEmail("");
    setRole("viewer");
    setTtl(72);
    fetchInvites();
  };

  const handleRevoke = async (id: string) => {
    setPending(id);
    const { data, error } = await supabase.functions.invoke("invite-revoke", { body: { invite_id: id } });
    setPending(null);
    if (error || !data?.ok) {
      toast({ title: "Erro ao revogar", description: (data as any)?.error ?? error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Convite revogado" });
    fetchInvites();
  };

  const handleResend = async (id: string, currentEmail: string) => {
    setPending(id);
    const { data, error } = await supabase.functions.invoke("invite-resend", {
      body: { invite_id: id, ttl_hours: 72 },
    });
    setPending(null);
    if (error || !data?.ok) {
      toast({ title: "Erro ao reenviar", description: (data as any)?.error ?? error?.message, variant: "destructive" });
      return;
    }
    setIssuedLink({ email: currentEmail, link: data.link as string });
    fetchInvites();
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copiado" });
    } catch {
      toast({ title: "Copie manualmente", description: link });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Criar convite</CardTitle>
          <CardDescription>
            O link é único, exibido apenas uma vez e não pode ser recuperado depois. Reenviar gera um novo link e invalida o anterior.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <Label htmlFor="inv-email">E-mail</Label>
              <Input id="inv-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@exemplo.com" />
            </div>
            <div>
              <Label htmlFor="inv-role">Papel</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "viewer" | "operator")}>
                <SelectTrigger id="inv-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Visualizador</SelectItem>
                  <SelectItem value="operator">Operador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="inv-ttl">Validade (horas)</Label>
              <Input id="inv-ttl" type="number" min={1} max={168} value={ttl}
                onChange={(e) => setTtl(Math.max(1, Math.min(168, Number(e.target.value) || 72)))} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Gerar link do convite
            </Button>
          </div>

          {issuedLink && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
              <p className="text-sm font-medium text-foreground">Link para {issuedLink.email}</p>
              <p className="text-xs text-muted-foreground">Este link só será exibido agora. Copie e envie por um canal seguro. Ao reenviar, um novo link é gerado e este é invalidado.</p>
              <div className="flex gap-2">
                <Input readOnly value={issuedLink.link} className="font-mono text-xs" />
                <Button variant="secondary" onClick={() => copyLink(issuedLink.link)}>
                  <Copy className="h-4 w-4 mr-1" /> Copiar
                </Button>
                <Button variant="ghost" onClick={() => setIssuedLink(null)}>Fechar</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Convites</CardTitle>
          <CardDescription>Gerenciamento de convites ativos e histórico.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="Filtrar por e-mail" value={emailFilter} onChange={(e) => setEmailFilter(e.target.value)} />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="processing">Em uso</SelectItem>
                <SelectItem value="accepted">Aceito</SelectItem>
                <SelectItem value="expired">Expirado</SelectItem>
                <SelectItem value="revoked">Revogado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p className="text-muted-foreground py-4 text-center">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center">Nenhum convite encontrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Expira</TableHead>
                    <TableHead className="hidden sm:table-cell">Tentativas</TableHead>
                    <TableHead className="w-[200px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => {
                    const canManage = inv.status === "pending" || inv.status === "processing";
                    const s = statusLabels[inv.status];
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">{inv.email_normalized}</TableCell>
                        <TableCell>{roleLabels[inv.role] ?? inv.role}</TableCell>
                        <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                          {new Date(inv.expires_at).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                          {inv.attempt_count}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" disabled={!canManage || pending === inv.id}
                              onClick={() => handleResend(inv.id, inv.email_normalized)}
                              title={canManage ? "Reenviar (gera novo link e invalida o anterior)" : "Não é possível reenviar"}>
                              {pending === inv.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="sm" disabled={!canManage || pending === inv.id}
                              onClick={() => handleRevoke(inv.id)}
                              title={canManage ? "Revogar" : "Não é possível revogar"}>
                              <XCircle className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}