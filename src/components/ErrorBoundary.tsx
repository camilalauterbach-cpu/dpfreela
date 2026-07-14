import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  /** Changes to this key reset the boundary automatically (e.g. route path). */
  resetKey?: string;
  /** Callback invoked when the user hits "Voltar ao início". */
  onNavigateHome?: () => void;
}

interface State {
  error: Error | null;
  retryCount: number;
}

const MAX_AUTO_RETRIES = 2;

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    // Auto-reset when the caller signals a route/context change so a broken
    // page does not stay broken forever after the user navigates away.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, retryCount: 0 });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    // Bound retry: after MAX_AUTO_RETRIES we stop offering the same button so
    // a component that always throws does not spin forever. The user can
    // still navigate home or reload the app.
    this.setState((s) => ({
      error: null,
      retryCount: s.retryCount + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  handleHome = () => {
    if (this.props.onNavigateHome) this.props.onNavigateHome();
    else window.location.assign("/");
  };

  render() {
    const { error, retryCount } = this.state;
    if (!error) return this.props.children;

    const exhausted = retryCount >= MAX_AUTO_RETRIES;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="mb-2 rounded-full bg-destructive/10 p-3">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Algo deu errado nesta tela</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {exhausted
                ? "O problema persistiu após novas tentativas. Volte ao início e tente novamente, ou recarregue o aplicativo."
                : "Você pode tentar renderizar a página novamente. Suas alterações salvas foram preservadas."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {!exhausted && (
                <Button onClick={this.handleRetry} className="flex-1">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Tentar novamente
                </Button>
              )}
              <Button variant="outline" onClick={this.handleHome} className="flex-1">
                <Home className="mr-2 h-4 w-4" />
                Voltar ao início
              </Button>
              {exhausted && (
                <Button variant="secondary" onClick={this.handleReload} className="flex-1">
                  Recarregar app
                </Button>
              )}
            </div>
            {retryCount > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                Tentativas: {retryCount}
              </p>
            )}
            <details className="rounded-md border bg-muted/40 p-2 text-xs">
              <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                Detalhes técnicos
              </summary>
              <p className="mt-2 break-words font-mono text-[11px] text-destructive">
                {error.name}: {error.message}
              </p>
              {error.stack && (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
                  {error.stack}
                </pre>
              )}
            </details>
          </CardContent>
        </Card>
      </div>
    );
  }
}