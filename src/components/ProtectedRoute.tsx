import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ShieldAlert, RefreshCw, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: ("admin" | "manager" | "operator" | "viewer")[];
}

export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, loading, hasAnyRole, roles, signOut, refreshAccess } = useAuth();
  const [repairing, setRepairing] = useState(false);
  const queryClient = useQueryClient();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Block empty-screen limbo: user is authenticated but has zero roles.
  // Never render children (which would trigger data queries) in this state.
  if (roles.length === 0) {
    const handleRepair = async () => {
      setRepairing(true);
      try {
        const nextRoles = await refreshAccess();
        if (!nextRoles.length) {
          toast.error("Ainda sem papel de acesso", {
            description:
              "Sua conta pode estar desativada. Peça a um administrador para liberar em Configurações → Usuários.",
          });
          return;
        }
        // Discard any stale cached queries from the empty-state period so the
        // next screen fetches fresh data with the new permissions.
        await queryClient.invalidateQueries();
        toast.success("Acesso reparado", {
          description: `Papel atribuído: ${nextRoles.join(", ")}`,
        });
      } catch (err: any) {
        toast.error("Não foi possível reparar o acesso", {
          description: err?.message ?? "Tente sair e entrar novamente.",
        });
      } finally {
        setRepairing(false);
      }
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="mb-2 rounded-full bg-amber-100 p-3 dark:bg-amber-950/40">
              <ShieldAlert className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle>Acesso ainda não liberado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sua conta foi criada, mas nenhum papel de acesso foi atribuído.
              Sem isso o sistema ficaria em branco — por isso bloqueamos a tela
              e trouxemos você até aqui.
            </p>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="mb-2 font-medium">O que fazer agora:</p>
              <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                <li>Clique em <strong>Reparar acesso</strong> abaixo.</li>
                <li>Se não resolver, clique em <strong>Sair</strong> e entre novamente.</li>
                <li>Se persistir, peça a um administrador para liberar seu papel em Configurações → Usuários.</li>
              </ol>
            </div>
            <p className="text-xs text-muted-foreground">
              Conta: <span className="font-mono">{user.email}</span>
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={handleRepair} disabled={repairing} className="flex-1">
                {repairing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Reparar acesso
              </Button>
              <Button variant="outline" onClick={signOut} disabled={repairing} className="flex-1">
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (requiredRoles && requiredRoles.length > 0 && !hasAnyRole(requiredRoles)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Acesso negado</h1>
        <p className="text-muted-foreground">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return <>{children}</>;
}
