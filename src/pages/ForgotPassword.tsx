import { useState } from "react";
import { Link } from "react-router-dom";
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

function getRecoveryErrorMessage(error: unknown): { title: string; description: string } {
  if (error == null) {
    return { title: "Erro", description: "Não foi possível enviar o e-mail de recuperação. Tente novamente." };
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
    description: String(anyErr.message || "Não foi possível enviar o e-mail de recuperação. Tente novamente."),
  };
}

export default function ForgotPassword() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        const { title, description } = getRecoveryErrorMessage(error);
        toast({ title, description, variant: "destructive" });
      } else {
        setSent(true);
      }
    } catch (err) {
      const { title, description } = getRecoveryErrorMessage(err);
      toast({ title, description, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Recuperar senha</CardTitle>
          <CardDescription>
            {sent ? "E-mail enviado! Verifique sua caixa de entrada." : "Digite seu e-mail para receber o link de recuperação"}
          </CardDescription>
        </CardHeader>
        {!sent && (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="seu@email.com" />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Enviar link
              </Button>
              <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">Voltar ao login</Link>
            </CardFooter>
          </form>
        )}
        {sent && (
          <CardFooter>
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground w-full text-center">Voltar ao login</Link>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
