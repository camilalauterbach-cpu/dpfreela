import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const CRON_SECRET = Deno.env.get("CLEANUP_CRON_SECRET") ?? "";

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Two invocation modes: (1) authenticated admin/manager/operator, (2) scheduled cron with shared secret.
    const cronHeader = req.headers.get("x-cron-secret") ?? "";
    const isCron = CRON_SECRET.length > 0 && cronHeader === CRON_SECRET;
    let callerId = "cron";
    if (!isCron) {
      const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
      if (!token) return json(401, { error: "Unauthorized" });
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData.user) return json(401, { error: "Unauthorized" });
      callerId = userData.user.id;
      const { data: canAct } = await admin.rpc("has_any_role", {
        _user_id: callerId,
        _roles: ["admin", "manager", "operator"],
      });
      if (!canAct) return json(403, { error: "Forbidden" });
    }

    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 200), 1), 500);
    const dryRun: boolean = Boolean(body?.dryRun ?? body?.dry_run ?? false);

    // The listing RPC filters by next_attempt_at <= now() and attempts < max_attempts,
    // so eligibility (backoff, retry cap) is enforced server-side. Cron calls the
    // routine via service_role which bypasses the RPC's auth.uid() guard.
    const rpcClient = isCron
      ? createClient(SUPABASE_URL, SERVICE_ROLE)
      : admin;
    const { data: jobs, error: listErr } = isCron
      ? await admin
          .from("worker_document_storage_cleanup_jobs")
          .select("*")
          .in("status", ["pending", "failed"])
          .lte("next_attempt_at", new Date().toISOString())
          .filter("attempts", "lt", "max_attempts")
          .order("next_attempt_at", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(limit)
      : await rpcClient.rpc("list_pending_storage_cleanup_jobs", { p_limit: limit });
    if (listErr) return json(500, { error: listErr.message });

    const pending = (jobs ?? []) as Array<{
      id: string;
      bucket: string;
      path: string;
      attempts?: number;
      max_attempts?: number;
      next_attempt_at?: string;
    }>;
    if (pending.length === 0) {
      return json(200, {
        dryRun,
        cron: isCron,
        requested: 0,
        completed: 0,
        failed: 0,
        jobs: [],
      });
    }

    // Group by bucket for batched removal via service_role.
    const byBucket = new Map<string, typeof pending>();
    for (const j of pending) {
      const list = byBucket.get(j.bucket) ?? [];
      list.push(j);
      byBucket.set(j.bucket, list);
    }

    // Dry-run: report what WOULD be removed without touching Storage or job status.
    if (dryRun) {
      const preview = pending.map((j) => ({
        id: j.id,
        bucket: j.bucket,
        path: j.path,
        status: "would_remove" as const,
        attempts: j.attempts ?? 0,
        max_attempts: j.max_attempts ?? null,
        next_attempt_at: j.next_attempt_at ?? null,
      }));
      const byBucketCount: Record<string, number> = {};
      for (const [bucket, list] of byBucket) byBucketCount[bucket] = list.length;
      console.log(
        JSON.stringify({
          event: "storage_cleanup_dry_run",
          caller_id: callerId,
          cron: isCron,
          requested: pending.length,
          buckets: byBucketCount,
          paths: preview.map((p) => `${p.bucket}/${p.path}`),
        }),
      );
      return json(200, {
        dryRun: true,
        cron: isCron,
        requested: pending.length,
        completed: 0,
        failed: 0,
        buckets: byBucketCount,
        jobs: preview,
      });
    }

    let completed = 0;
    let failed = 0;
    const results: Array<{
      id: string;
      status: "completed" | "failed";
      error?: string;
      attempts?: number;
      next_attempt_at?: string | null;
    }> = [];

    for (const [bucket, list] of byBucket) {
      const paths = list.map((j) => j.path);
      const { data: removed, error: rmErr } = await admin.storage.from(bucket).remove(paths);
      // Treat "not found" as effectively completed: nothing to clean.
      const removedSet = new Set((removed ?? []).map((f: any) => f.name as string));

      for (const j of list) {
        const wasRemoved = removedSet.has(j.path);
        const ok = !rmErr || wasRemoved;
        // In cron mode we cannot call the SD RPC (it requires auth.uid()); write directly
        // with service_role, replicating the backoff formula from the RPC.
        let mkErr: { message: string } | null = null;
        let nextAttempt: string | null = null;
        if (isCron) {
          const nowMs = Date.now();
          const attempts = (j.attempts ?? 0) + 1;
          const maxAttempts = j.max_attempts ?? 8;
          const shouldBackoff = !ok && attempts < maxAttempts;
          const backoffSec = Math.min(3600, 30 * Math.pow(2, (j.attempts ?? 0)));
          nextAttempt = shouldBackoff
            ? new Date(nowMs + backoffSec * 1000).toISOString()
            : (j.next_attempt_at ?? null);
          const patch: Record<string, unknown> = {
            attempts,
            status: ok ? "completed" : "failed",
            last_error: ok ? null : (rmErr?.message ?? "unknown"),
          };
          if (ok) patch.completed_at = new Date().toISOString();
          if (shouldBackoff) patch.next_attempt_at = nextAttempt;
          const { error } = await admin
            .from("worker_document_storage_cleanup_jobs")
            .update(patch)
            .eq("id", j.id);
          mkErr = error ? { message: error.message } : null;
        } else {
          const { data: markedRow, error } = await admin.rpc(
            "mark_storage_cleanup_job_status",
            {
              p_id: j.id,
              p_status: ok ? "completed" : "failed",
              p_error: ok ? null : (rmErr?.message ?? "unknown"),
            },
          );
          mkErr = error ? { message: error.message } : null;
          nextAttempt = (markedRow as any)?.next_attempt_at ?? null;
        }
        if (mkErr) {
          failed += 1;
          results.push({ id: j.id, status: "failed", error: mkErr.message });
          continue;
        }
        if (ok) {
          completed += 1;
          results.push({ id: j.id, status: "completed", attempts: (j.attempts ?? 0) + 1 });
        } else {
          failed += 1;
          results.push({
            id: j.id,
            status: "failed",
            error: rmErr?.message,
            attempts: (j.attempts ?? 0) + 1,
            next_attempt_at: nextAttempt,
          });
        }
      }
    }

    console.log(
      JSON.stringify({
        event: "storage_cleanup_run",
        caller_id: callerId,
        cron: isCron,
        requested: pending.length,
        completed,
        failed,
      }),
    );

    return json(200, {
      dryRun: false,
      cron: isCron,
      requested: pending.length,
      completed,
      failed,
      jobs: results,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});