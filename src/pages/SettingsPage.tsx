import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, UserCircle, Building2, Palette, FileText, ShieldCheck, Users2, Mail } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { SettingsUsers } from "@/components/settings/SettingsUsers";
import { SettingsProfile } from "@/components/settings/SettingsProfile";
import { SettingsCompany } from "@/components/settings/SettingsCompany";
import { SettingsPreferences } from "@/components/settings/SettingsPreferences";
import { SettingsLinksAdmission } from "@/components/settings/SettingsLinksAdmission";
import { SettingsAudit } from "@/components/settings/SettingsAudit";
import { SettingsDuplicates } from "@/components/settings/SettingsDuplicates";
import { SettingsInvites } from "@/components/settings/SettingsInvites";

export default function SettingsPage() {
  const { hasAnyRole, hasRole } = useAuth();
  const { tab } = useParams();
  const navigate = useNavigate();
  const isAdmin = hasRole("admin");
  const canEditGlobal = hasAnyRole(["admin", "manager"]);
  const isManager = hasAnyRole(["admin", "manager"]);
  const adminOnlyTabs = ["users", "audit", "duplicates"];
  const managerTabs = ["invites"];
  const defaultTab =
    tab && (
      (isAdmin || !adminOnlyTabs.includes(tab)) &&
      (isManager || !managerTabs.includes(tab))
    ) ? tab : "profile";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>

      <Tabs
        value={defaultTab}
        onValueChange={(v) => navigate(v === "profile" ? "/settings" : `/settings/${v}`)}
        className="w-full"
      >
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
          {isAdmin && (
            <TabsTrigger value="audit" className="gap-1.5 text-xs sm:text-sm">
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Auditoria</span>
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="duplicates" className="gap-1.5 text-xs sm:text-sm">
              <Users2 className="h-4 w-4" />
              <span className="hidden sm:inline">Duplicidades</span>
            </TabsTrigger>
          )}
          {isManager && (
            <TabsTrigger value="invites" className="gap-1.5 text-xs sm:text-sm">
              <Mail className="h-4 w-4" />
              <span className="hidden sm:inline">Convites</span>
            </TabsTrigger>
          )}
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
          <SettingsCompany readOnly={!canEditGlobal} />
        </TabsContent>

        <TabsContent value="links-admission">
          <SettingsLinksAdmission readOnly={!canEditGlobal} />
        </TabsContent>

        <TabsContent value="preferences">
          <SettingsPreferences />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="audit">
            <SettingsAudit />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="duplicates">
            <SettingsDuplicates />
          </TabsContent>
        )}
        {isManager && (
          <TabsContent value="invites">
            <SettingsInvites />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
