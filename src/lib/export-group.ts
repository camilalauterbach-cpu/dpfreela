import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";

const formatDateBR = (d: string | null | undefined) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const boolLabel = (v: boolean | null | undefined) => (v ? "Sim" : "Não");

const remunerationLabels: Record<string, string> = {
  cache: "Cachê", daily: "Diária", hourly: "Hora", fixed: "Salário fixo",
  monthly: "Mensalista", per_event: "Por evento",
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho", active: "Ativo", suspended: "Suspenso",
  completed: "Concluído", terminated: "Encerrado", cancelled: "Cancelado",
};

const sanitizeFileName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9áéíóúãõâêîôûç]+/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

// ── Fetch helpers ──

async function fetchGroupWorkersFull(groupId: string) {
  const { data, error } = await supabase
    .from("link_group_workers")
    .select("*, workers(*), job_roles:job_role_id(name)")
    .eq("link_group_id", groupId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).sort((a: any, b: any) =>
    (a.workers?.full_name || "").localeCompare(b.workers?.full_name || "", "pt-BR")
  );
}

async function fetchPreferredPayment(workerIds: string[]) {
  if (!workerIds.length) return new Map<string, any>();

  const { data, error } = await supabase
    .from("worker_payment_methods")
    .select("*")
    .in("worker_id", workerIds)
    .is("deleted_at", null)
    .order("is_preferred", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  const map = new Map<string, any>();
  for (const pm of data ?? []) {
    if (!map.has(pm.worker_id)) map.set(pm.worker_id, pm);
  }
  return map;
}

// ── XLSX ──

interface ExportGroupParams {
  groupId: string;
  groupName: string;
  eventName: string;
  companyName: string;
  period: string;
}

export async function exportGroupXlsx({ groupId, groupName, eventName, companyName }: ExportGroupParams) {
  const allocations = await fetchGroupWorkersFull(groupId);
  const workerIds = allocations.map((a: any) => a.worker_id);
  const paymentMap = await fetchPreferredPayment(workerIds);

  const headers = [
    // Cadastro do trabalhador
    "Nome Completo", "Nome Social", "Apelido", "CPF", "RG", "Órgão Emissor", "UF RG",
    "Data Nascimento", "País Nascimento", "Cidade Nascimento", "UF Nascimento",
    "Gênero", "Estado Civil", "Nacionalidade", "Raça/Cor", "Escolaridade",
    "Nome da Mãe", "Nome do Pai", "NIS/PIS",
    "CTPS Número", "CTPS Série", "CTPS UF",
    "Telefone Principal", "Telefone Secundário", "E-mail",
    "Endereço", "Bairro", "Cidade", "UF", "CEP",
    "Contato Emergência", "Tel. Emergência",
    "Tam. Camisa", "Tam. Calçado", "Tipo Sanguíneo", "Alergias", "Condições Médicas",
    "PCD", "Tipo PCD", "Obs. PCD", "Reabilitado", "Obs. Trabalhador",
    // Alocação
    "Grupo", "Evento", "Empresa",
    "Função", "Cargo/Atividade", "Departamento",
    "Tipo Contrato", "Status", "Data Início", "Data Fim",
    "Tipo Remuneração", "Diária (R$)", "Hora (R$)", "Salário Fixo (R$)",
    "Valor Ref. Categoria (R$)", "Freq. Pagamento",
    "Recebe VT", "Valor VT (R$)", "Recebe VR/VA", "Valor VR/VA (R$)",
    "Horas Diárias", "Horas Semanais",
    "Turno", "Escala", "Horário", "Hora Chamada",
    "Observações Alocação",
    // Bancários
    "Tipo Método", "Chave Pix", "Tipo Pix",
    "Banco", "Código Banco", "Agência", "Conta", "Tipo Conta",
    "Titular", "CPF Titular",
  ];

  const rows = allocations.map((a: any) => {
    const w = a.workers || {};
    const pm = paymentMap.get(a.worker_id) || {};

    return [
      w.full_name || "", w.social_name || "", w.nickname || "", w.cpf || "",
      w.rg || "", w.rg_issuer || "", w.rg_state || "",
      formatDateBR(w.birth_date), w.birth_country || "", w.birth_city || "", w.birth_state || "",
      w.gender || "", w.marital_status || "", w.nationality || "", w.race_color || "", w.education_level || "",
      w.mother_name || "", w.father_name || "", w.nis_pis || "",
      w.ctps_number || "", w.ctps_series || "", w.ctps_state || "",
      w.phone_main || "", w.phone_secondary || "", w.email || "",
      w.address || "", w.neighborhood || "", w.city || "", w.state || "", w.zip_code || "",
      w.emergency_contact_name || "", w.emergency_contact_phone || "",
      w.shirt_size || "", w.shoe_size || "", w.blood_type || "", w.allergies || "", w.medical_conditions || "",
      boolLabel(w.is_pcd), w.pcd_type || "", w.pcd_notes || "", boolLabel(w.is_rehabilitated), w.notes || "",
      // Alocação
      groupName, eventName, companyName,
      (a.job_roles?.name || a.job_role || ""), a.job_function || "", a.department || "",
      a.contract_type || "", statusLabels[a.status] || a.status,
      formatDateBR(a.hire_date), formatDateBR(a.end_date),
      a.remuneration_type ? remunerationLabels[a.remuneration_type] || a.remuneration_type : "",
      a.daily_rate ?? "", a.hourly_rate ?? "", a.fixed_salary ?? "",
      a.category_reference_rate ?? "", a.payment_frequency || "",
      boolLabel(a.has_transport_allowance), a.transport_allowance ?? "",
      boolLabel(a.has_meal_allowance), a.meal_allowance ?? "",
      a.daily_hours ?? "", a.weekly_hours ?? "",
      a.shift_type || "", a.work_shift || "", a.work_schedule || "", a.call_time || "",
      a.notes || "",
      // Bancários
      pm.method_type || "", pm.pix_key || "", pm.pix_key_type || "",
      pm.bank_name || "", pm.bank_code || "", pm.agency || "",
      pm.account_number || "", pm.account_type || "",
      pm.holder_name || "", pm.holder_cpf || "",
    ];
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Contabilidade");
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);

  // Style header
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A2744" } };
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

  // Auto-size columns
  ws.columns.forEach((col, i) => {
    const maxLen = Math.max(
      headers[i]?.length || 0,
      ...rows.map((r) => String(r[i] || "").length)
    );
    col.width = Math.min(maxLen + 2, 40);
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `grupo_${sanitizeFileName(groupName)}_contabilidade_${date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── PDF ──

export async function exportGroupPdf({ groupId, groupName, eventName, companyName, period }: ExportGroupParams) {
  const allocations = await fetchGroupWorkersFull(groupId);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const date = new Date().toLocaleDateString("pt-BR");

  // Header
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(`Relatório do Grupo: ${groupName}`, 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Evento: ${eventName}  |  Empresa: ${companyName}`, 14, 22);
  doc.text(`Período: ${period || "—"}  |  Trabalhadores: ${allocations.length}  |  Gerado em: ${date}`, 14, 27);

  // Table
  const tableRows = allocations.map((a: any) => {
    const w = a.workers || {};
    const effectiveVal = a.remuneration_type === "hourly" ? a.hourly_rate
      : a.remuneration_type === "fixed" ? a.fixed_salary
      : a.daily_rate;
    const fmtVal = effectiveVal != null
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(effectiveVal)
      : "—";
    return [
      w.full_name || "—",
      w.cpf || "—",
      (a.job_roles?.name || a.job_role || "—"),
      a.contract_type || "—",
      a.remuneration_type ? remunerationLabels[a.remuneration_type] || a.remuneration_type : "—",
      fmtVal,
      a.has_transport_allowance ? "Sim" : "Não",
      a.has_meal_allowance ? "Sim" : "Não",
      statusLabels[a.status] || a.status,
    ];
  });

  autoTable(doc, {
    startY: 32,
    head: [["Nome", "CPF", "Função", "Contrato", "Remuneração", "Valor", "VT", "VR/VA", "Status"]],
    body: tableRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [26, 39, 68], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 14, right: 14 },
  });

  // Footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`DPfreela · ${date} · Página ${i}/${pageCount}`, pageW - 14, doc.internal.pageSize.getHeight() - 8, { align: "right" });
  }

  const fileName = `grupo_${sanitizeFileName(groupName)}_resumo_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}
