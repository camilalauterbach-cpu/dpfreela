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

const RETRYABLE_STATUSES = new Set([408, 502, 503, 504]);
const MAX_ATTEMPTS = 4; // 1 initial + 3 retries
const BASE_DELAY_MS = 800;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Login() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attemptInfo, setAttemptInfo] = useState<string | null>(null);

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
    setSubmitting(true);
    setAttemptInfo(null);

    let lastError: { message: string; status?: number } | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        setAttemptInfo(`Serviço indisponível. Tentando novamente (${attempt}/${MAX_ATTEMPTS})…`);
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) {
        setAttemptInfo(null);
        setSubmitting(false);
        return;
      }
      lastError = { message: error.message, status: (error as { status?: number }).status };
      const retryable = lastError.status !== undefined && RETRYABLE_STATUSES.has(lastError.status);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      // exponential backoff with jitter: 0.8s, 1.6s, 3.2s (+/- 20%)
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const jitter = delay * (0.8 + Math.random() * 0.4);
      await wait(jitter);
    }

    if (lastError) {
      const isTimeout = lastError.status && RETRYABLE_STATUSES.has(lastError.status);
      toast({
        title: "Erro ao entrar",
        description: isTimeout
          ? `Serviço de autenticação indisponível (HTTP ${lastError.status}). Tente novamente em instantes.`
          : lastError.message,
        variant: "destructive",
      });
    }
    setAttemptInfo(null);
    setSubmitting(false);
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
            {attemptInfo && (
              <p className="text-xs text-muted-foreground text-center" role="status" aria-live="polite">
                {attemptInfo}
              </p>
            )}
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
