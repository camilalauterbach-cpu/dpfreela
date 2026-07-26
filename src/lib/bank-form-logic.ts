// Pure/testable helpers for the bank data form.
// Extracted so we can unit-test validation, payload canonicalization, and the
// atomic compensation flow without rendering the React component.

import { normalizeCpf, validateCpf } from "@/lib/validators";

export const BANK_DOCUMENT_TYPE_ID = "f2653649-f673-40ae-b5a0-1e9e08a83e04";

export type Modality = "pix" | "bank_account";
export type PixKeyType = "cpf" | "phone" | "email" | "random";
export type AccountType = "checking" | "savings";

export interface BankFormState {
  modality: Modality;
  pixKeyType: PixKeyType;
  pixKey: string;
  bankName: string;
  agency: string;
  accountNumber: string;
  accountType: AccountType;
  isSelfHolder: boolean;
  holderName: string;
  holderCpf: string;
  workerName: string;
  workerCpf: string;
  workerId: string;
}

/**
 * Returns a human-friendly list of missing/invalid field labels. Empty list = valid.
 */
export function collectMissing(s: BankFormState): string[] {
  const errs: string[] = [];
  if (s.modality === "pix") {
    if (!s.pixKeyType) errs.push("Tipo de chave Pix");
    if (!s.pixKey.trim()) errs.push("Chave Pix");
  } else {
    if (!s.bankName.trim()) errs.push("Banco");
    if (!s.agency.trim()) errs.push("Agência");
    if (!s.accountNumber.trim()) errs.push("Número da conta");
    if (!s.accountType) errs.push("Tipo da conta");
  }
  if (!s.isSelfHolder) {
    if (!s.holderName.trim()) errs.push("Nome do titular");
    const cpfDigits = normalizeCpf(s.holderCpf);
    if (!cpfDigits) errs.push("CPF do titular");
    else if (!validateCpf(cpfDigits)) errs.push("CPF do titular (inválido)");
  }
  return errs;
}

export interface BankPayload {
  worker_id: string;
  method_type: Modality;
  pix_key_type: PixKeyType | null;
  pix_key: string | null;
  bank_name: string | null;
  agency: string | null;
  account_number: string | null;
  account_type: AccountType | null;
  holder_name: string | null;
  holder_cpf: string | null;
  is_preferred: boolean;
}

/**
 * Canonicalize per-modality fields. Pix rows never carry account_type; bank_account rows
 * never carry pix fields. Empty strings become null. Only canonical enum values are emitted.
 */
export function buildPayload(s: BankFormState): BankPayload {
  const holderCpfDigits = s.isSelfHolder ? normalizeCpf(s.workerCpf) : normalizeCpf(s.holderCpf);
  const holderName = (s.isSelfHolder ? s.workerName : s.holderName.trim()) || null;
  if (s.modality === "pix") {
    return {
      worker_id: s.workerId,
      method_type: "pix",
      pix_key_type: s.pixKeyType,
      pix_key: s.pixKey.trim(),
      bank_name: s.bankName.trim() || null,
      agency: s.agency.trim() || null,
      account_number: s.accountNumber.trim() || null,
      account_type: null,
      holder_name: holderName,
      holder_cpf: holderCpfDigits || null,
      is_preferred: false,
    };
  }
  return {
    worker_id: s.workerId,
    method_type: "bank_account",
    pix_key_type: null,
    pix_key: null,
    bank_name: s.bankName.trim(),
    agency: s.agency.trim(),
    account_number: s.accountNumber.trim(),
    account_type: s.accountType,
    holder_name: holderName,
    holder_cpf: holderCpfDigits || null,
    is_preferred: false,
  };
}

// ---------- Atomic save flow with compensation ------------------------------

export interface SaveDeps {
  insertPaymentMethod: (payload: BankPayload) => Promise<{ id: string }>;
  deletePaymentMethod: (id: string) => Promise<void>;
  generateReceiptBlob: (payload: BankPayload) => Blob;
  uploadReceipt: (path: string, blob: Blob) => Promise<void>;
  removeStorageObject: (path: string) => Promise<void>;
  insertWorkerDocument: (row: {
    worker_id: string;
    document_type: string;
    document_type_id: string;
    category: string;
    file_path: string;
    file_name: string;
    file_size: number;
    mime_type: string;
    status: string;
    notes: string;
  }) => Promise<void>;
  now?: () => number;
}

export interface SaveResult {
  paymentMethodId: string;
  uploadedPath: string;
  fileName: string;
}

/**
 * Orchestrate the atomic save: payment_method → PDF → upload → worker_documents.
 * On any failure after the payment_method insert, rolls back the storage object
 * and the payment_method row so nothing is orphaned.
 */
export async function saveBankDataFlow(payload: BankPayload, deps: SaveDeps): Promise<SaveResult> {
  const { id: paymentMethodId } = await deps.insertPaymentMethod(payload);
  let uploadedPath: string | null = null;
  try {
    const blob = deps.generateReceiptBlob(payload);
    const timestamp = (deps.now ?? Date.now)();
    const path = `${payload.worker_id}/bank_document/${timestamp}.pdf`;
    await deps.uploadReceipt(path, blob);
    uploadedPath = path;
    const fileName = `comprovante_bancario_${timestamp}.pdf`;
    await deps.insertWorkerDocument({
      worker_id: payload.worker_id,
      document_type: "bank_document",
      document_type_id: BANK_DOCUMENT_TYPE_ID,
      category: "bank_document",
      file_path: path,
      file_name: fileName,
      file_size: blob.size,
      mime_type: "application/pdf",
      status: "uploaded",
      notes: "auto_generated",
    });
    return { paymentMethodId, uploadedPath: path, fileName };
  } catch (err) {
    if (uploadedPath) {
      await deps.removeStorageObject(uploadedPath).catch(() => {});
    }
    await deps.deletePaymentMethod(paymentMethodId).catch(() => {});
    throw err;
  }
}