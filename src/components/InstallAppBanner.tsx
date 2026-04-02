import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already installed / standalone
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    setIsStandalone(standalone);

    // Check if dismissed recently
    const dismissedAt = localStorage.getItem("dpfreela-install-dismissed");
    if (dismissedAt) {
      const hours = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60);
      if (hours < 24) setDismissed(true);
    }

    // Detect iOS
    const ua = navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIos(iosDevice);

    // Capture beforeinstallprompt (Chrome/Edge/Samsung)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (isStandalone || dismissed) return null;

  // Nothing to show if not iOS and no prompt captured
  if (!isIos && !deferredPrompt) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("dpfreela-install-dismissed", String(Date.now()));
  };

  return (
    <div className="relative rounded-lg border border-primary/20 bg-primary/5 p-4">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 rounded-full p-1 text-muted-foreground hover:text-foreground"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="rounded-lg bg-primary/10 p-2">
          <Download className="h-5 w-5 text-primary" />
        </div>

        <div className="flex-1 space-y-2">
          <p className="text-sm font-semibold text-foreground">
            Instale o DPfreela
          </p>

          {deferredPrompt ? (
            <>
              <p className="text-xs text-muted-foreground">
                Acesse como app direto da sua tela inicial, sem precisar do navegador.
              </p>
              <Button size="sm" onClick={handleInstall} className="mt-1">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Instalar app
              </Button>
            </>
          ) : isIos ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Para instalar no iPhone/iPad:
              </p>
              <ol className="list-inside list-decimal space-y-0.5 text-xs text-muted-foreground">
                <li className="flex items-center gap-1">
                  Toque em <Share className="inline h-3.5 w-3.5 text-primary" /> <strong>Compartilhar</strong>
                </li>
                <li>
                  Selecione <strong>"Adicionar à Tela de Início"</strong>
                </li>
              </ol>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
