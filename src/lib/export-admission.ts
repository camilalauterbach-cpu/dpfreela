import ExcelJS from "exceljs";

const formatDateBR = (d: string | null | undefined) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const boolLabel = (v: boolean | null | undefined) => (v ? "Sim" : "Não");

const remunerationLabels: Record<string, string> = {
  daily: "Diarista", monthly: "Mensalista", hourly: "Horista", per_event: "Por evento",
};

const workDatesLabel = (link: any) => {
  if (link.work_days_mode === "specific_dates" && link.specific_work_dates?.length > 0) {
    return link.specific_work_dates.map((d: string) => formatDateBR(d)).join("; ");
  }
  return "Contínuo";
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  suspended: "Suspenso",
  completed: "Concluído",
  terminated: "Encerrado",
  cancelled: "Cancelado",
};

interface ExportAdmissionParams {
  links: any[];
  companyNameMap: Map<string, string>;
  eventCompanyMap: Map<string, string>;
  filePrefix?: string;
  includeEmptyColumns?: boolean;
}

export async function exportAdmissionXlsx({ links, companyNameMap, eventCompanyMap, filePrefix = "admissao", includeEmptyColumns = true }: ExportAdmissionParams) {
  const headers = [
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
    "Nome do Vínculo", "Evento", "Empresa", "Função", "Cargo", "Departamento",
    "Tipo Contrato", "Status", "Data Início", "Data Fim",
    "Modo Dias", "Dias de Atuação", "Obs. Escala",
    "Diária (R$)", "Hora (R$)", "Salário Fixo (R$)", "Freq. Pagamento",
    "Tipo Remuneração", "Recebe VT", "Valor VT (R$)", "Recebe VR/VA", "Valor VR/VA (R$)",
    "Horas Diárias", "Horas Semanais",
    "Turno", "Escala", "Horário", "Padrão Dias", "Padrão Folgas", "Hora Chamada",
    "Supervisor", "Ponto Encontro", "Uniforme", "Transporte", "Alimentação",
    "Crachá", "Armário", "Estacionamento", "Obs. Vínculo",
  ];

  const rows = links.map((link: any) => {
    const w = link.workers || {};
    const eventName = link.events?.name || "";
    const companyId = link.event_id ? eventCompanyMap.get(link.event_id) : null;
    const companyName = companyId ? companyNameMap.get(companyId) || "" : "";

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
      link.link_name || "", eventName, companyName,
      link.job_role || "", link.job_function || "", link.department || "",
      link.contract_type || "", statusLabels[link.status] || link.status,
      formatDateBR(link.hire_date), formatDateBR(link.end_date),
      link.work_days_mode === "specific_dates" ? "Datas específicas" : "Contínuo",
      workDatesLabel(link), link.work_days_notes || "",
      link.daily_rate ?? "", link.hourly_rate ?? "", link.fixed_salary ?? "", link.payment_frequency || "",
      link.remuneration_type ? remunerationLabels[link.remuneration_type] || link.remuneration_type : "",
      boolLabel(link.has_transport_allowance), link.transport_allowance ?? "",
      boolLabel(link.has_meal_allowance), link.meal_allowance ?? "",
      link.daily_hours ?? "", link.weekly_hours ?? "",
      link.shift_type || "", link.work_shift || "", link.work_schedule || "",
      link.work_days_pattern || "", link.rest_days_pattern || "", link.call_time || "",
      link.supervisor_name || "", link.assembly_point || "",
      link.uniform_notes || "", link.transport_notes || "", link.meal_entitlement || "",
      link.badge_number || "", link.locker_number || "", link.parking_spot || "",
      link.notes || "",
    ];
  });

  let finalHeaders = headers;
  let finalRows = rows;

  if (!includeEmptyColumns) {
    const nonEmptyCols = headers.map((_, i) => rows.some((r) => r[i] !== "" && r[i] != null));
    finalHeaders = headers.filter((_, i) => nonEmptyCols[i]);
    finalRows = rows.map((r) => r.filter((_, i) => nonEmptyCols[i]));
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Admissão");

  ws.addRow(finalHeaders);
  for (const row of finalRows) {
    ws.addRow(row);
  }

  // Auto-size columns
  ws.columns.forEach((col, i) => {
    const maxLen = Math.max(
      finalHeaders[i]?.length || 0,
      ...finalRows.map((r) => String(r[i] || "").length)
    );
    col.width = Math.min(maxLen + 2, 40);
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
