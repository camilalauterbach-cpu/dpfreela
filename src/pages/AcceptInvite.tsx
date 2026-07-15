import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-invite-accept`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"form" | "success" | "error">("form");

  useEffect(() => {
    if (!token || token.length < 16 || token.length > 512) {
      setState("error");
    }
  }, [token]);

  const stripTokenFromUrl = () => {
    // Substituir a URL sem manter histórico do token
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/login");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: "Senha muito curta", description: "Use pelo menos 8 caracteres.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "As senhas não coincidem", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(FUNCTIONS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "apikey": ANON_KEY,
        },
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok !== true) {
        setState("error");
        return;
      }
      setState("success");
      stripTokenFromUrl();
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch {
      setState("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Ativar acesso</CardTitle>
          <CardDescription>
            Defina sua senha para concluir a criação da sua conta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state === "success" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="text-sm text-muted-foreground">Cadastro concluído. Redirecionando para o login...</p>
            </div>
          )}
          {state === "error" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-muted-foreground">
                Este convite não é válido, expirou ou já foi utilizado. Solicite um novo link ao administrador.
              </p>
              <Button variant="outline" onClick={() => navigate("/login", { replace: true })}>Ir para login</Button>
            </div>
          )}
          {state === "form" && (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="pwd">Nova senha</Label>
                <Input id="pwd" type="password" autoComplete="new-password" minLength={8} required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
              </div>
              <div>
                <Label htmlFor="pwd2">Confirmar senha</Label>
                <Input id="pwd2" type="password" autoComplete="new-password" minLength={8} required
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Ativar conta
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}