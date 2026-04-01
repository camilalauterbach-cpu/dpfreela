import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Calendar, Building2, Link2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export default function Dashboard() {
  const { user } = useAuth();

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
    { label: "Trabalhadores", value: counts?.workers ?? "—", icon: Users },
    { label: "Eventos", value: counts?.events ?? "—", icon: Calendar },
    { label: "Empresas", value: counts?.companies ?? "—", icon: Building2 },
    { label: "Vínculos", value: counts?.links ?? "—", icon: Link2 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do sistema</p>
      </div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
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
