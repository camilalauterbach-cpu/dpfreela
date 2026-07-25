import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

function isTimeoutError(error: unknown): boolean {
  if (error == null) return false;
  const anyErr = error as Record<string, unknown>;
  const status =
    (anyErr.status as number | undefined) ??
    (anyErr.statusCode as number | undefined);
  const message = String(anyErr.message || "").toLowerCase();
  return (
    status === 504 ||
    status === 503 ||
    status === 502 ||
    status === 408 ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("upstream request timeout") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror")
  );
}

function getResetErrorMessage(error: unknown): { title: string; description: string } {
  if (error == null) {
    return { title: "Erro", description: "Não foi possível redefinir a senha. Tente novamente." };
  }

  if (isTimeoutError(error)) {
    return {
      title: "Serviço temporariamente indisponível",
      description:
        "O banco de dados está temporariamente saturado e não respondeu a tempo (erro 504/timeout). " +
        "Aguarde 2–3 minutos para que a fila de processamento se normalize e tente novamente. " +
        "Se o erro persistir após 10 minutos, contate o administrador do sistema.",
    };
  }

  const anyErr = error as Record<string, unknown>;
  return {
    title: "Erro",
    description: String(anyErr.message || "Não foi possível redefinir a senha. Tente novamente."),
  };
}

export default function ResetPassword() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setValid(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        const { title, description } = getResetErrorMessage(error);
        toast({ title, description, variant: "destructive" });
      } else {
        toast({ title: "Senha atualizada", description: "Sua senha foi redefinida com sucesso." });
        navigate("/");
      }
    } catch (err) {
      const { title, description } = getResetErrorMessage(err);
      toast({ title, description, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle>Link inválido</CardTitle>
            <CardDescription>Este link de recuperação é inválido ou expirou.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Nova senha</CardTitle>
          <CardDescription>Digite sua nova senha</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="Mínimo 6 caracteres" />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Redefinir senha
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
