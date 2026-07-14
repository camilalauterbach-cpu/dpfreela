import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function AppLayout() {
  const { roles } = useAuth();
  const primaryRole = roles[0];
  const location = useLocation();
  const navigate = useNavigate();

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
          <header className="h-12 flex items-center justify-between border-b px-4 bg-[hsl(220,33%,14%)] sm:bg-background">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="sm:hidden h-9 w-auto px-2 gap-1.5 text-white hover:bg-white/10 hover:text-white">
                <span className="text-sm font-medium">Menu</span>
              </SidebarTrigger>
              <SidebarTrigger className="hidden sm:inline-flex" />
              <span className="sm:hidden text-sm font-bold tracking-tight">
                <span className="text-white">DP</span>
                <span className="text-blue-400">freela</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {primaryRole && (
                <Badge variant="secondary" className="text-xs">
                  {roleLabels[primaryRole] || primaryRole}
                </Badge>
              )}
            </div>
          </header>
          <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto">
            {/* Keying the boundary on pathname lets the user recover by
                navigating to another page after a component crash. */}
            <ErrorBoundary resetKey={location.pathname} onNavigateHome={() => navigate("/")}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
