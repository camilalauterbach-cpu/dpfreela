import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";

export function AppLayout() {
  const { roles } = useAuth();
  const primaryRole = roles[0];

  const roleLabels: Record<string, string> = {
    admin: "Admin",
    manager: "Gestor",
    operator: "Operador",
    viewer: "Visualizador",
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between border-b px-4 bg-background">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              {primaryRole && (
                <Badge variant="secondary" className="text-xs">
                  {roleLabels[primaryRole] || primaryRole}
                </Badge>
              )}
            </div>
          </header>
          <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
