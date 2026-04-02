import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, UserCircle, Building2, Palette, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { SettingsUsers } from "@/components/settings/SettingsUsers";
import { SettingsProfile } from "@/components/settings/SettingsProfile";
import { SettingsCompany } from "@/components/settings/SettingsCompany";
import { SettingsPreferences } from "@/components/settings/SettingsPreferences";
import { SettingsLinksAdmission } from "@/components/settings/SettingsLinksAdmission";

export default function SettingsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="profile" className="gap-1.5 text-xs sm:text-sm">
            <UserCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Perfil</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users" className="gap-1.5 text-xs sm:text-sm">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Usuários</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="company" className="gap-1.5 text-xs sm:text-sm">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Empresa</span>
          </TabsTrigger>
          <TabsTrigger value="links-admission" className="gap-1.5 text-xs sm:text-sm">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Vínculos</span>
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-1.5 text-xs sm:text-sm">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">Preferências</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <SettingsProfile />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="users">
            <SettingsUsers />
          </TabsContent>
        )}

        <TabsContent value="company">
          <SettingsCompany />
        </TabsContent>

        <TabsContent value="links-admission">
          <SettingsLinksAdmission />
        </TabsContent>

        <TabsContent value="preferences">
          <SettingsPreferences />
        </TabsContent>
      </Tabs>
    </div>
  );
}
