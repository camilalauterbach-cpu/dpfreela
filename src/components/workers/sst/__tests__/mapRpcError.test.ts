import { describe, it, expect } from "vitest";
import { mapRpcError, looksTechnical } from "../SstCertificateDrawer";

describe("mapRpcError — mensagens amigáveis para o usuário", () => {
  describe("Renovar com datas idênticas", () => {
    it("traduz renewal_same_period_use_correction em orientação clara", () => {
      const msg = mapRpcError(
        "register_sst_revision: renewal_same_period_use_correction",
        { mode: "renew", category: "sst_nr" },
      );
      expect(msg).toMatch(/idênticas à vigência atual/i);
      expect(msg).toMatch(/Substituir/);
      expect(msg).not.toMatch(/renewal_same_period_use_correction/);
    });

    it("em Renovar, duplicate key nunca vaza — orienta usar Substituir", () => {
      const msg = mapRpcError(
        'duplicate key value violates unique constraint "uq_worker_sst_current_worker_document_type"',
        { mode: "renew", category: "sst_nr" },
      );
      expect(msg).toMatch(/Substituir/);
      expect(msg).not.toMatch(/duplicate|unique|uq_worker/i);
    });

    it("em Renovar, qualification_current_version_exists é reformulada", () => {
      const msg = mapRpcError("qualification_current_version_exists", {
        mode: "renew", category: "sst_nr",
      });
      expect(msg).toMatch(/vigência atual/i);
      expect(msg).toMatch(/Substituir/);
    });
  });

  describe("document_type não-NR", () => {
    it("ASO recebe orientação para aba Documentos", () => {
      const msg = mapRpcError("document_type_not_sst_or_training", {
        mode: "create", category: "sst_aso",
      });
      expect(msg).toMatch(/ASO/);
      expect(msg).toMatch(/aba Documentos/i);
      expect(msg).not.toMatch(/document_type_not/);
    });

    it("outros tipos recebem orientação de NR/Treinamento", () => {
      const msg = mapRpcError("document_type_not_sst_or_training", {
        mode: "create", category: null,
      });
      expect(msg).toMatch(/NR ou um Treinamento/);
      expect(msg).not.toMatch(/sst_or_training/);
    });

    it("invalid_nr_code_format em tipo não-NR aponta seleção incorreta", () => {
      const msg = mapRpcError("invalid_nr_code_format", {
        mode: "create", category: "training",
      });
      expect(msg).toMatch(/não é uma NR/i);
    });
  });

  describe("Nunca vazar duplicidade técnica em Cadastrar/Substituir", () => {
    it("duplicate key + 23505 em create → texto humano", () => {
      const msg = mapRpcError(
        "ERROR: duplicate key value violates unique constraint (SQLSTATE 23505)",
        { mode: "create", category: "sst_nr" },
      );
      expect(msg).toMatch(/versão vigente/i);
      expect(msg).toMatch(/Renovar/);
      expect(msg).toMatch(/Substituir/);
      expect(msg).not.toMatch(/23505|duplicate|SQLSTATE/i);
    });

    it("em Substituir, stale/conflict orienta recarregar a página", () => {
      const msg = mapRpcError("additional_conflicts_with_current", {
        mode: "replace", category: "sst_nr",
      });
      expect(msg).toMatch(/Recarregue/i);
      expect(msg).not.toMatch(/additional_conflicts_with_current/);
    });
  });

  describe("Fallbacks", () => {
    it("mensagens técnicas não mapeadas caem em texto genérico", () => {
      const msg = mapRpcError("violates check constraint chk_something", {
        mode: "create", category: "sst_nr",
      });
      expect(msg).toMatch(/Não foi possível salvar/i);
      expect(msg).not.toMatch(/violates|constraint/i);
    });

    it("mensagens não-técnicas passam intactas (ex: falha de upload)", () => {
      const raw = "Falha no upload: bucket indisponível";
      expect(
        mapRpcError(raw, { mode: "create", category: "sst_nr" }),
      ).toBe(raw);
    });
  });
});

describe("looksTechnical — detecção ampliada de padrões técnicos", () => {
  // Cada entrada é uma mensagem "crua" que já foi observada (ou é plausível)
  // vindo do Postgres, PostgREST, Supabase, HTTP ou runtime JS. Todas devem
  // ser detectadas como técnicas e nunca chegar ao usuário como estão.
  const technicalSamples: Array<[string, string]> = [
    ["duplicate key value", 'duplicate key value violates unique constraint "uq_x"'],
    ["check constraint", "new row violates check constraint chk_positive"],
    ["foreign key", "insert violates foreign key constraint fk_worker"],
    ["not-null constraint", 'null value in column "worker_id" violates not-null constraint'],
    ["exclusion constraint", "conflicting key value violates exclusion constraint ex_range"],
    ["sqlstate padrão", "ERROR: something (SQLSTATE 23505)"],
    ["errcode ERRCODE", "ERRCODE=40001 could not serialize access"],
    ["sqlstate 22001", "value too long (22001)"],
    ["sqlstate 40001", "sqlstate 40001: serialization failure"],
    ["sqlstate 42703", "column does not exist (42703)"],
    ["sqlstate 42P01", "relation not found 42P01"],
    ["P0001 raise", "P0001: custom raise"],
    ["relation missing", 'relation "public.foo" does not exist'],
    ["column missing", 'column "deleted_at" does not exist'],
    ["function missing", "function public.foo(uuid) does not exist"],
    ["operator missing", "operator does not exist: text = integer"],
    ["invalid input", "invalid input syntax for type uuid: \"abc\""],
    ["syntax error", "syntax error at or near \"SELECT\""],
    ["deadlock", "deadlock detected while waiting for lock"],
    ["serialize", "could not serialize access due to concurrent update"],
    ["permission denied", "permission denied for table workers"],
    ["plpgsql context", "CONTEXT: PL/pgSQL function register_sst_revision"],
    ["HINT postgres", "HINT: Try granting SELECT to authenticated"],
    ["DETAIL postgres", "DETAIL: Key (worker_id)=(...) already exists."],
    ["pg_ prefix", "pg_stat_activity blocked"],
    ["pq prefix", "pq: could not connect"],
    ["PGRST code", "PGRST116: JSON object requested, multiple (or no) rows returned"],
    ["JWT expired", "JWT expired"],
    ["JWT malformed", "JWT malformed"],
    ["Results contain rows", "Results contain 0 rows"],
    ["http 500", "HTTP 500 Internal Server Error"],
    ["status code", "status code: 504"],
    ["ECONNRESET", "ECONNRESET at socket"],
    ["ETIMEDOUT", "ETIMEDOUT while contacting supabase"],
    ["TypeError", "TypeError: Cannot read properties of undefined (reading 'id')"],
    ["ReferenceError", "ReferenceError: foo is not defined"],
    ["stack frame", "at Object.<anonymous> (SstCertificateDrawer.tsx:1:1)"],
  ];

  it.each(technicalSamples)("detecta padrão técnico: %s", (_label, raw) => {
    expect(looksTechnical(raw)).toBe(true);
  });

  it.each(technicalSamples)(
    "mapRpcError nunca vaza o texto cru: %s",
    (_label, raw) => {
      const friendly = mapRpcError(raw, { mode: "create", category: "sst_nr" });
      // O texto amigável não pode conter os fragmentos mais reveladores.
      expect(friendly).not.toMatch(
        /SQLSTATE|ERRCODE|PGRST\d+|duplicate key|unique constraint|check constraint|foreign key|not-null|deadlock|serialize|permission denied|PL\/pgSQL|TypeError|ReferenceError|ECONN|ETIMEDOUT|HTTP \d{3}|relation "|column "|function [a-z0-9_.]+\(/i,
      );
      // E precisa ser uma frase humana em português.
      expect(friendly.length).toBeGreaterThan(0);
      expect(/[a-záéíóúãõç]/i.test(friendly)).toBe(true);
    },
  );

  it("mensagem vazia não é considerada técnica", () => {
    expect(looksTechnical("")).toBe(false);
  });

  it("texto humano em português não é considerado técnico", () => {
    expect(
      looksTechnical("Não foi possível enviar o arquivo. Tente novamente."),
    ).toBe(false);
  });
});