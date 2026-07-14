import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "admin" | "manager" | "operator" | "viewer";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  hasRole: (role: AppRole) => boolean;
  hasAnyRole: (roles: AppRole[]) => boolean;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<AppRole[]>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// TTL for the access-validation cache. Below this, a TOKEN_REFRESHED / SIGNED_IN
// event for the same user reuses the cached roles instead of re-running the
// ensure_current_user_access RPC and user_roles query. Above this, we refresh
// silently in the background but keep the last known roles rendered so the UI
// never flashes back to a loading state.
const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
// Hard timeout for the RPC so a slow backend cannot freeze the app.
const ACCESS_RPC_TIMEOUT_MS = 3_000;

interface AccessCacheEntry {
  userId: string;
  roles: AppRole[];
  validatedAt: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    ),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  // Access validation cache is keyed by user.id (not access_token) so a token
  // refresh does not invalidate it. We track validatedAt for TTL, and expose
  // an explicit invalidation path via signOut / refreshAccess.
  const accessCacheRef = useRef<AccessCacheEntry | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  const fetchRolesFresh = async (userId: string): Promise<AppRole[]> => {
    try {
      const { data: ensuredAccess, error: ensureError } = await withTimeout(
        supabase.rpc("ensure_current_user_access"),
        ACCESS_RPC_TIMEOUT_MS,
        "ensure_current_user_access"
      );
      if (!ensureError && ensuredAccess?.[0]?.roles?.length) {
        return ensuredAccess[0].roles as AppRole[];
      }
    } catch (err) {
      // Timeout or network error — fall through to the direct read below,
      // which usually succeeds even when the RPC is slow.
      // eslint-disable-next-line no-console
      console.warn("[auth] ensure_current_user_access failed:", err);
    }

    try {
      const { data, error } = await withTimeout(
        supabase.from("user_roles").select("role").eq("user_id", userId),
        ACCESS_RPC_TIMEOUT_MS,
        "user_roles"
      );
      if (error) return [];
      return (data || []).map((r) => r.role as AppRole);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[auth] user_roles read failed:", err);
      return [];
    }
  };

  /**
   * Returns roles for `userId`, using the in-memory cache when it is fresh
   * and belongs to the same user. Never returns another user's cached roles.
   */
  const getRolesCached = async (userId: string): Promise<AppRole[]> => {
    const entry = accessCacheRef.current;
    const now = Date.now();
    if (
      entry &&
      entry.userId === userId &&
      now - entry.validatedAt < ACCESS_CACHE_TTL_MS
    ) {
      return entry.roles;
    }
    const fresh = await fetchRolesFresh(userId);
    // Guard against a late response from a previous user landing in the cache
    // after a fast user switch.
    if (currentUserIdRef.current !== userId) return fresh;
    accessCacheRef.current = { userId, roles: fresh, validatedAt: Date.now() };
    return fresh;
  };

  const invalidateAccessCache = () => {
    accessCacheRef.current = null;
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        const prevUserId = currentUserIdRef.current;
        const nextUserId = nextSession?.user?.id ?? null;

        // Always keep the session/user in sync — cheap and non-disruptive.
        setSession(nextSession);
        setUser(nextSession?.user ?? null);

        if (event === "SIGNED_OUT" || !nextSession?.user) {
          invalidateAccessCache();
          currentUserIdRef.current = null;
          setRoles([]);
          setLoading(false);
          return;
        }

        // Token refresh for the same user: DO NOT tear down the app, DO NOT
        // refetch roles, DO NOT toggle loading. The cache stays valid because
        // it is keyed by user.id, not access_token.
        if (event === "TOKEN_REFRESHED" && nextUserId === prevUserId) {
          return;
        }

        // Same user signing back in (e.g. returning to the tab) — reuse cache
        // if fresh, otherwise refresh silently without a loading flash.
        if (event === "SIGNED_IN" && nextUserId === prevUserId && accessCacheRef.current?.userId === nextUserId) {
          setTimeout(() => {
            getRolesCached(nextUserId).then((r) => {
              if (currentUserIdRef.current === nextUserId) setRoles(r);
            });
          }, 0);
          return;
        }

        // Real user change (or initial sign-in without a cache): invalidate
        // the old cache and go through the loading gate.
        if (nextUserId !== prevUserId) {
          invalidateAccessCache();
          currentUserIdRef.current = nextUserId;
          setRoles([]);
          setLoading(true);
          setTimeout(() => {
            getRolesCached(nextUserId).then((r) => {
              if (currentUserIdRef.current === nextUserId) {
                setRoles(r);
                setLoading(false);
              }
            });
          }, 0);
          return;
        }

        // Same user, other events — no-op.
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        currentUserIdRef.current = session.user.id;
        getRolesCached(session.user.id)
          .then((r) => {
            if (currentUserIdRef.current === session.user.id) setRoles(r);
          })
          .finally(() => setLoading(false));
        return;
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const hasRole = (role: AppRole) => roles.includes(role);
  const hasAnyRole = (r: AppRole[]) => r.some((role) => roles.includes(role));

  const signOut = async () => {
    invalidateAccessCache();
    currentUserIdRef.current = null;
    await supabase.auth.signOut();
    setRoles([]);
  };

  const refreshAccess = async () => {
    if (!user) return [];
    // Explicit refresh path — always invalidates the cache first, per spec.
    invalidateAccessCache();
    const fresh = await fetchRolesFresh(user.id);
    if (currentUserIdRef.current === user.id) {
      accessCacheRef.current = { userId: user.id, roles: fresh, validatedAt: Date.now() };
      setRoles(fresh);
    }
    return fresh;
  };

  return (
    <AuthContext.Provider value={{ session, user, roles, loading, hasRole, hasAnyRole, signOut, refreshAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
