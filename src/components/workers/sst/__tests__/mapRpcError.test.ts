import { describe, it, expect } from "vitest";
import { mapRpcError } from "../SstCertificateDrawer";

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