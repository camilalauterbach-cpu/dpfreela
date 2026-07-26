// storage-cleanup-process — processa (ou pré-visualiza) a fila
// worker_document_storage_cleanup_jobs de forma segura.
//
// Contratos (Q-026.CLEANUP.RETRY):
//   • Elegibilidade + backoff + lease são centralizados no banco via as RPCs
//     claim_due_storage_cleanup_jobs (atômica, FOR UPDATE SKIP LOCKED),
//     peek_due_storage_cleanup_jobs  (read-only, para dry-run) e
//     mark_storage_cleanup_job_status (fecha ou reagenda).
//   • Esta função NÃO reimplementa elegibilidade nem backoff — apenas orquestra
//     Storage e chama as RPCs.
//   • Dois modos: (1) usuário autenticado admin/manager/operator, (2) cron
//     via header x-cron-secret == CLEANUP_CRON_SECRET (nunca logado).
//   • Dry-run é 100% read-only: peek + relatório, sem claim/mark/remove.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type JobRow = {
  id: string;
  bucket: string;
  path: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  completed_at: string | null;
  last_error: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const CRON_SECRET = Deno.env.get("CLEANUP_CRON_SECRET") ?? "";

    // Descobre o modo. Nunca ecoamos o valor de CRON_SECRET.
    const cronHeader = req.headers.get("x-cron-secret") ?? "";
    const isCron = CRON_SECRET.length > 0 && cronHeader === CRON_SECRET;

    let callerId = "cron";
    let client;

    if (isCron) {
      // Service role — a checagem de auth.role()='service_role' acontece dentro das RPCs.
      client = createClient(SUPABASE_URL, SERVICE_ROLE);
    } else {
      const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
      if (!token) return json(401, { error: "Unauthorized" });
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData.user) return json(401, { error: "Unauthorized" });
      callerId = userData.user.id;
      // Verificação de papel — a checagem final ocorre dentro das RPCs também.
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
      const { data: canAct } = await admin.rpc("has_any_role", {
        _user_id: callerId,
        _roles: ["admin", "manager", "operator"],
      });
      if (!canAct) return json(403, { error: "Forbidden" });
      client = userClient;
    }

    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(Math.max(Number(body?.limit ?? 50), 1), 200);
    const dryRun: boolean = Boolean(body?.dryRun ?? body?.dry_run ?? false);

    // ---------- DRY-RUN: peek only (nada é claim/mark/removido) ----------
    if (dryRun) {
      const { data: peek, error: peekErr } = await client.rpc(
        "peek_due_storage_cleanup_jobs",
        { p_limit: limit },
      );
      if (peekErr) return json(500, { error: peekErr.message });
      const rows = (peek ?? []) as JobRow[];
      const byBucket: Record<string, number> = {};
      for (const j of rows) byBucket[j.bucket] = (byBucket[j.bucket] ?? 0) + 1;
      const preview = rows.map((j) => ({
        id: j.id,
        bucket: j.bucket,
        path: j.path,
        status: "would_remove" as const,
        attempts: j.attempts,
        max_attempts: j.max_attempts,
        next_attempt_at: j.next_attempt_at,
      }));
      console.log(
        JSON.stringify({
          event: "storage_cleanup_dry_run",
          caller_id: callerId,
          cron: isCron,
          requested: rows.length,
          buckets: byBucket,
          // Paths ficam no log estruturado; nunca inclui o secret.
          paths: preview.map((p) => `${p.bucket}/${p.path}`),
        }),
      );
      return json(200, {
        dryRun: true,
        cron: isCron,
        requested: rows.length,
        completed: 0,
        failed: 0,
        buckets: byBucket,
        jobs: preview,
      });
    }

    // ---------- PROCESSAMENTO REAL ----------
    // 1) Claim atômico — SKIP LOCKED garante que dois workers concorrentes
    //    não peguem o mesmo job. A RPC incrementa attempts e coloca lease
    //    de 10 minutos em next_attempt_at.
    const { data: claimed, error: claimErr } = await client.rpc(
      "claim_due_storage_cleanup_jobs",
      { p_limit: limit },
    );
    if (claimErr) return json(500, { error: claimErr.message });
    const jobs = (claimed ?? []) as JobRow[];
    if (jobs.length === 0) {
      return json(200, {
        dryRun: false,
        cron: isCron,
        requested: 0,
        completed: 0,
        failed: 0,
        jobs: [],
      });
    }

    // Agrupa por bucket para chamada em batch ao Storage.
    const byBucket = new Map<string, JobRow[]>();
    for (const j of jobs) {
      const list = byBucket.get(j.bucket) ?? [];
      list.push(j);
      byBucket.set(j.bucket, list);
    }

    // Service role para operar no Storage. O bucket é sempre o persistido em cada
    // job (hoje `worker-documents`, o único bucket privado usado para NR/ASO).
    const storage = createClient(SUPABASE_URL, SERVICE_ROLE);

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
      const { data: removed, error: rmErr } = await storage.storage.from(bucket).remove(paths);
      const removedSet = new Set((removed ?? []).map((f: { name: string }) => f.name));

      for (const j of list) {
        // Storage.remove sem erro OU "path removido" = sucesso.
        // "not found" cai como sucesso (nada a limpar) — Storage retorna sem erro nesse caso.
        const wasRemoved = removedSet.has(j.path);
        const ok = !rmErr || wasRemoved;

        // 2) Fecha ou reagenda via RPC. Não incrementamos attempts aqui —
        //    o claim já fez isso. Backoff/esgotamento é decidido no banco.
        const { data: marked, error: mkErr } = await client.rpc(
          "mark_storage_cleanup_job_status",
          {
            p_id: j.id,
            p_status: ok ? "completed" : "failed",
            p_error: ok ? null : (rmErr?.message ?? "unknown"),
          },
        );

        if (mkErr) {
          failed += 1;
          results.push({ id: j.id, status: "failed", error: mkErr.message });
          continue;
        }
        const row = marked as unknown as JobRow | null;
        if (ok) {
          completed += 1;
          results.push({
            id: j.id,
            status: "completed",
            attempts: row?.attempts ?? j.attempts,
          });
        } else {
          failed += 1;
          results.push({
            id: j.id,
            status: "failed",
            error: rmErr?.message,
            attempts: row?.attempts ?? j.attempts,
            next_attempt_at: row?.next_attempt_at ?? null,
          });
        }
      }
    }

    console.log(
      JSON.stringify({
        event: "storage_cleanup_run",
        caller_id: callerId,
        cron: isCron,
        requested: jobs.length,
        completed,
        failed,
      }),
    );

    return json(200, {
      dryRun: false,
      cron: isCron,
      requested: jobs.length,
      completed,
      failed,
      jobs: results,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
