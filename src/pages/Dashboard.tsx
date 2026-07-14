import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Calendar, Building2, Link2, Eye, AlertCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { InstallAppBanner } from "@/components/InstallAppBanner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const isViewerOnly = hasAnyRole(["viewer"]) && !hasAnyRole(["admin", "manager", "operator"]);

  const { data: counts, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: async () => {
      const [workers, events, companies, links] = await Promise.all([
        supabase.from("workers").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("events").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("companies").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("link_groups").select("id", { count: "exact", head: true }).is("deleted_at", null),
      ]);
      const firstError =
        workers.error || events.error || companies.error || links.error;
      if (firstError) throw firstError;
      return {
        workers: workers.count ?? 0,
        events: events.count ?? 0,
        companies: companies.count ?? 0,
        links: links.count ?? 0,
      };
    },
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const cards = [
    { key: "workers", label: "Trabalhadores", value: counts?.workers, icon: Users, href: "/workers", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
    { key: "events", label: "Eventos", value: counts?.events, icon: Calendar, href: "/events", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
    { key: "companies", label: "Empresas", value: counts?.companies, icon: Building2, href: "/companies", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
    { key: "links", label: "Vínculos", value: counts?.links, icon: Link2, href: "/links", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/30" },
  ];

  return (
    <div className="space-y-6">
      <InstallAppBanner />
      {isViewerOnly && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>Acesso de visualização.</strong> Este perfil permite consultar
            os dados, mas não realizar alterações.
          </div>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do sistema</p>
      </div>
      {isError && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Não foi possível carregar os indicadores.
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-2 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Tentar novamente
          </Button>
        </div>
      )}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card
            key={card.key}
            className="cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] hover:border-primary/30"
            onClick={() => navigate(card.href)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
              <div className={`p-1.5 rounded-lg ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading || (card.value === undefined && !isError) ? (
                <Skeleton className="h-8 w-16" />
              ) : isError ? (
                <p className="text-2xl font-bold text-muted-foreground">—</p>
              ) : (
                <p className="text-2xl font-bold">{card.value ?? 0}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
