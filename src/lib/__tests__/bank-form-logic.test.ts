import { describe, it, expect, vi } from "vitest";
import {
  BANK_DOCUMENT_TYPE_ID,
  buildPayload,
  collectMissing,
  saveBankDataFlow,
  type BankFormState,
} from "@/lib/bank-form-logic";

// Valid CPF for testing (widely used stub that passes mod-11).
const VALID_CPF = "39053344705";
const INVALID_CPF = "12345678900";

function baseState(overrides: Partial<BankFormState> = {}): BankFormState {
  return {
    modality: "pix",
    pixKeyType: "cpf",
    pixKey: "",
    bankName: "",
    agency: "",
    accountNumber: "",
    accountType: "checking",
    isSelfHolder: true,
    holderName: "",
    holderCpf: "",
    workerName: "Fulano Teste",
    workerCpf: VALID_CPF,
    workerId: "w-1",
    ...overrides,
  };
}

describe("collectMissing", () => {
  it("Pix sem banco/agência/conta é válido (só chave e tipo obrigatórios)", () => {
    const errs = collectMissing(baseState({ modality: "pix", pixKey: VALID_CPF }));
    expect(errs).toEqual([]);
  });

  it("Conta bancária completa sem Pix é válida", () => {
    const errs = collectMissing(baseState({
      modality: "bank_account",
      bankName: "Itaú", agency: "1234", accountNumber: "56789-0", accountType: "checking",
    }));
    expect(errs).toEqual([]);
  });

  it("Pix sem chave lista nominalmente Chave Pix", () => {
    const errs = collectMissing(baseState({ modality: "pix", pixKey: "" }));
    expect(errs).toContain("Chave Pix");
  });

  it("Conta bancária faltando todos lista Banco, Agência, Número da conta, Tipo da conta", () => {
    const errs = collectMissing(baseState({ modality: "bank_account" }));
    expect(errs).toEqual([
      "Banco", "Agência", "Número da conta",
    ]);
    // accountType has a default; ensure Tipo da conta is only listed when falsy:
    const errs2 = collectMissing(baseState({ modality: "bank_account", accountType: "" as any }));
    expect(errs2).toContain("Tipo da conta");
  });

  it("Titular terceiro com CPF inválido lista 'CPF do titular (inválido)'", () => {
    const errs = collectMissing(baseState({
      modality: "pix", pixKey: "x@y.com", pixKeyType: "email",
      isSelfHolder: false, holderName: "Terceiro", holderCpf: INVALID_CPF,
    }));
    expect(errs).toContain("CPF do titular (inválido)");
  });

  it("Titular terceiro sem nome/CPF lista ambos", () => {
    const errs = collectMissing(baseState({
      modality: "pix", pixKey: VALID_CPF,
      isSelfHolder: false, holderName: "", holderCpf: "",
    }));
    expect(errs).toContain("Nome do titular");
    expect(errs).toContain("CPF do titular");
  });
});

describe("buildPayload — valores canônicos", () => {
  it("Pix normaliza vazios em null e não envia account_type", () => {
    const p = buildPayload(baseState({ modality: "pix", pixKey: VALID_CPF }));
    expect(p.method_type).toBe("pix");
    expect(p.pix_key_type).toBe("cpf");
    expect(p.pix_key).toBe(VALID_CPF);
    expect(p.bank_name).toBeNull();
    expect(p.agency).toBeNull();
    expect(p.account_number).toBeNull();
    expect(p.account_type).toBeNull();
    expect(p.holder_cpf).toBe(VALID_CPF);
    expect(p.holder_name).toBe("Fulano Teste");
  });

  it("Conta bancária envia enums canônicos em inglês (checking/savings) e nunca pix fields", () => {
    const p1 = buildPayload(baseState({
      modality: "bank_account", bankName: "Itaú", agency: "1", accountNumber: "2",
      accountType: "checking",
    }));
    expect(p1.account_type).toBe("checking");
    expect(p1.pix_key).toBeNull();
    expect(p1.pix_key_type).toBeNull();
    const p2 = buildPayload(baseState({
      modality: "bank_account", bankName: "Itaú", agency: "1", accountNumber: "2",
      accountType: "savings",
    }));
    expect(p2.account_type).toBe("savings");
  });

  it("holder_cpf usa dígitos do worker quando isSelfHolder", () => {
    const p = buildPayload(baseState({
      modality: "pix", pixKey: "x", isSelfHolder: true, workerCpf: "390.533.447-05",
    }));
    expect(p.holder_cpf).toBe(VALID_CPF);
  });
});

describe("saveBankDataFlow — atomicidade e compensação", () => {
  function mkDeps(overrides: Partial<Parameters<typeof saveBankDataFlow>[1]> = {}) {
    const calls: Record<string, any[]> = {
      insert: [], del: [], gen: [], up: [], remove: [], doc: [],
    };
    const deps = {
      insertPaymentMethod: vi.fn(async (p: any) => { calls.insert.push(p); return { id: "pm-1" }; }),
      deletePaymentMethod: vi.fn(async (id: string) => { calls.del.push(id); }),
      generateReceiptBlob: vi.fn((p: any) => { calls.gen.push(p); return new Blob(["pdf"], { type: "application/pdf" }); }),
      uploadReceipt: vi.fn(async (path: string, blob: Blob) => { calls.up.push({ path, size: blob.size }); }),
      removeStorageObject: vi.fn(async (path: string) => { calls.remove.push(path); }),
      registerBankDocumentRevision: vi.fn(async (row: any) => { calls.doc.push(row); }),
      now: () => 1_700_000_000_000,
      ...overrides,
    };
    return { deps, calls };
  }

  const okPayload = buildPayload({
    modality: "pix", pixKeyType: "cpf", pixKey: VALID_CPF,
    bankName: "", agency: "", accountNumber: "", accountType: "checking",
    isSelfHolder: true, holderName: "", holderCpf: "",
    workerName: "Fulano Teste", workerCpf: VALID_CPF, workerId: "w-9",
  });

  it("Sucesso: insere payment_method, gera PDF, upload e worker_documents com document_type_id canônico", async () => {
    const { deps, calls } = mkDeps();
    const result = await saveBankDataFlow(okPayload, deps);
    expect(result.paymentMethodId).toBe("pm-1");
    expect(result.uploadedPath).toBe("w-9/bank_document/1700000000000.pdf");
    expect(calls.doc[0].document_type_id).toBe(BANK_DOCUMENT_TYPE_ID);
    expect(calls.doc[0].file_path).toBe(result.uploadedPath);
    expect(calls.doc[0].notes).toBe("auto_generated");
    expect(deps.deletePaymentMethod).not.toHaveBeenCalled();
    expect(deps.removeStorageObject).not.toHaveBeenCalled();
  });

  it("Falha no upload: remove nada do storage e apaga payment_method (rollback)", async () => {
    const { deps } = mkDeps({
      uploadReceipt: vi.fn(async () => { throw new Error("boom upload"); }) as any,
    });
    await expect(saveBankDataFlow(okPayload, deps)).rejects.toThrow(/boom upload/);
    expect(deps.deletePaymentMethod).toHaveBeenCalledWith("pm-1");
    expect(deps.removeStorageObject).not.toHaveBeenCalled(); // upload failed before path stored
    expect(deps.registerBankDocumentRevision).not.toHaveBeenCalled();
  });

  it("Falha no register RPC: apaga objeto do storage e apaga payment_method (rollback)", async () => {
    const { deps } = mkDeps({
      registerBankDocumentRevision: vi.fn(async () => { throw new Error("boom doc"); }) as any,
    });
    await expect(saveBankDataFlow(okPayload, deps)).rejects.toThrow(/boom doc/);
    expect(deps.removeStorageObject).toHaveBeenCalledWith("w-9/bank_document/1700000000000.pdf");
    expect(deps.deletePaymentMethod).toHaveBeenCalledWith("pm-1");
  });
});