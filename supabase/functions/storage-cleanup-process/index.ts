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

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json(401, { error: "Unauthorized" });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(401, { error: "Unauthorized" });
    const callerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: canAct } = await admin.rpc("has_any_role", {
      _user_id: callerId,
      _roles: ["admin", "manager", "operator"],
    });
    if (!canAct) return json(403, { error: "Forbidden" });

    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 200), 1), 500);
    const dryRun: boolean = Boolean(body?.dryRun ?? body?.dry_run ?? false);

    const { data: jobs, error: listErr } = await admin.rpc(
      "list_pending_storage_cleanup_jobs",
      { p_limit: limit },
    );
    if (listErr) return json(500, { error: listErr.message });

    const pending = (jobs ?? []) as Array<{
      id: string;
      bucket: string;
      path: string;
    }>;
    if (pending.length === 0) {
      return json(200, { dryRun, requested: 0, completed: 0, failed: 0, jobs: [] });
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
      }));
      const byBucketCount: Record<string, number> = {};
      for (const [bucket, list] of byBucket) byBucketCount[bucket] = list.length;
      console.log(
        JSON.stringify({
          event: "storage_cleanup_dry_run",
          caller_id: callerId,
          requested: pending.length,
          buckets: byBucketCount,
          paths: preview.map((p) => `${p.bucket}/${p.path}`),
        }),
      );
      return json(200, {
        dryRun: true,
        requested: pending.length,
        completed: 0,
        failed: 0,
        buckets: byBucketCount,
        jobs: preview,
      });
    }

    let completed = 0;
    let failed = 0;
    const results: Array<{ id: string; status: "completed" | "failed"; error?: string }> = [];

    for (const [bucket, list] of byBucket) {
      const paths = list.map((j) => j.path);
      const { data: removed, error: rmErr } = await admin.storage.from(bucket).remove(paths);
      // Treat "not found" as effectively completed: nothing to clean.
      const removedSet = new Set((removed ?? []).map((f: any) => f.name as string));

      for (const j of list) {
        const wasRemoved = removedSet.has(j.path);
        const ok = !rmErr || wasRemoved;
        const { error: mkErr } = await admin.rpc("mark_storage_cleanup_job_status", {
          p_id: j.id,
          p_status: ok ? "completed" : "failed",
          p_error: ok ? null : (rmErr?.message ?? "unknown"),
        });
        if (mkErr) {
          failed += 1;
          results.push({ id: j.id, status: "failed", error: mkErr.message });
          continue;
        }
        if (ok) {
          completed += 1;
          results.push({ id: j.id, status: "completed" });
        } else {
          failed += 1;
          results.push({ id: j.id, status: "failed", error: rmErr?.message });
        }
      }
    }

    return json(200, {
      dryRun: false,
      requested: pending.length,
      completed,
      failed,
      jobs: results,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});