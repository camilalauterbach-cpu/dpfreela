import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Calendar, Building2, Link2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { InstallAppBanner } from "@/components/InstallAppBanner";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: counts } = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: async () => {
      const [workers, events, companies, links] = await Promise.all([
        supabase.from("workers").select("id", { count: "exact", head: true }),
        supabase.from("events").select("id", { count: "exact", head: true }),
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("employment_links").select("id", { count: "exact", head: true }),
      ]);
      return {
        workers: workers.count ?? 0,
        events: events.count ?? 0,
        companies: companies.count ?? 0,
        links: links.count ?? 0,
      };
    },
  });

  const cards = [
    { label: "Trabalhadores", value: counts?.workers ?? "—", icon: Users, href: "/workers", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
    { label: "Eventos", value: counts?.events ?? "—", icon: Calendar, href: "/events", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
    { label: "Empresas", value: counts?.companies ?? "—", icon: Building2, href: "/companies", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
    { label: "Vínculos", value: counts?.links ?? "—", icon: Link2, href: "/links", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/30" },
  ];

  return (
    <div className="space-y-6">
      <InstallAppBanner />
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do sistema</p>
      </div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card
            key={card.label}
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
              <p className="text-2xl font-bold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
