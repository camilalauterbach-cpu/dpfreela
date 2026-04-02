import { supabase } from "@/integrations/supabase/client";

/**
 * Read a global system setting by key.
 */
export async function getSystemSetting<T = unknown>(key: string): Promise<T | null> {
  const { data } = await supabase
    .from("system_settings" as any)
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  return data ? (data as any).setting_value as T : null;
}

/**
 * Upsert a global system setting (admin/manager only).
 */
export async function saveSystemSetting(key: string, value: unknown): Promise<{ error: any }> {
  const userId = (await supabase.auth.getUser()).data.user?.id;

  // Try update first
  const { data: existing } = await supabase
    .from("system_settings" as any)
    .select("id")
    .eq("setting_key", key)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("system_settings" as any)
      .update({ setting_value: value, updated_by: userId } as any)
      .eq("setting_key", key);
    return { error };
  } else {
    const { error } = await supabase
      .from("system_settings" as any)
      .insert({ setting_key: key, setting_value: value, updated_by: userId } as any);
    return { error };
  }
}
