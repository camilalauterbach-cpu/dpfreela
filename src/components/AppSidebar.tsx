import { Users, Calendar, Building2, Link2, DollarSign, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Trabalhadores", url: "/workers", icon: Users },
  { title: "Eventos", url: "/events", icon: Calendar },
  { title: "Empresas", url: "/companies", icon: Building2 },
  { title: "Vínculos", url: "/links", icon: Link2 },
  { title: "Pagamentos", url: "/payroll", icon: DollarSign },
];

const adminItems = [
  { title: "Configurações", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, hasAnyRole, user } = useAuth();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleNavClick = (e: React.MouseEvent, url: string) => {
    if (isMobile) {
      e.preventDefault();
      setOpenMobile(false);
      // Navigate after closing to ensure clean transition
      setTimeout(() => navigate(url), 10);
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider">
              Menu principal
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end={item.url === "/"} className="hover:bg-sidebar-accent/50" onClick={(e) => handleNavClick(e, item.url)}>
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {hasAnyRole(["admin", "manager"]) && (
          <SidebarGroup>
            {!collapsed && (
              <>
                <Separator className="my-1" />
                <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider">
                  Administração
                </SidebarGroupLabel>
              </>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink to={item.url} className="hover:bg-sidebar-accent/50" onClick={(e) => handleNavClick(e, item.url)}>
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-2">
        {!collapsed && user && (
          <p className="truncate px-2 text-xs text-muted-foreground">{user.email}</p>
        )}
        <Button variant="ghost" size={collapsed ? "icon" : "sm"} onClick={signOut} className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
