import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { InstallAppBanner } from "@/components/InstallAppBanner";

function getLoginErrorMessage(error: unknown): { title: string; description: string } {
  if (error == null) {
    return { title: "Erro ao entrar", description: "Não foi possível concluir o login. Tente novamente." };
  }

  const anyErr = error as Record<string, unknown>;
  const message = String(anyErr.message || "").toLowerCase();
  const status =
    (anyErr.status as number | undefined) ??
    (anyErr.statusCode as number | undefined);

  if (status === 504 || status === 503 || status === 502) {
    return {
      title: "Serviço temporariamente indisponível",
      description: "Nossos servidores estão demorando para responder. Aguarde um momento e tente novamente.",
    };
  }

  if (message.includes("invalid login credentials") || message.includes("invalid credentials")) {
    return {
      title: "Credenciais inválidas",
      description: "Verifique se o e-mail e a senha estão corretos.",
    };
  }

  if (message.includes("email not confirmed") || message.includes("not confirmed")) {
    return {
      title: "E-mail não confirmado",
      description: "Confirme seu e-mail antes de fazer login. Verifique sua caixa de entrada.",
    };
  }

  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return {
      title: "Muitas tentativas",
      description: "Você tentou entrar várias vezes em pouco tempo. Aguarde alguns minutos e tente novamente.",
    };
  }

  return {
    title: "Erro ao entrar",
    description: String(anyErr.message || "Não foi possível concluir o login. Tente novamente."),
  };
}

export default function Login() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        const { title, description } = getLoginErrorMessage(error);
        toast({ title, description, variant: "destructive" });
      }
    } catch (err) {
      const { title, description } = getLoginErrorMessage(err);
      toast({ title, description, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <InstallAppBanner />
        <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Entrar no sistema</CardTitle>
          <CardDescription>Use seu e-mail e senha para acessar</CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="seu@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Entrar
            </Button>
            <div className="flex w-full justify-between text-sm">
              <Link to="/signup" className="text-muted-foreground hover:text-foreground">Criar conta</Link>
              <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground">Esqueci a senha</Link>
            </div>
          </CardFooter>
        </form>
        </Card>
      </div>
    </div>
  );
}
