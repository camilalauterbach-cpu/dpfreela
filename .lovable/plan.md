
# E-QUALIF.1 — Painel de Qualificações (substitui Conformidade)

## Mudança de conceito

- Removemos a tela `Conformidade` como superfície principal.
- Criamos **Painel de Qualificações**: matriz `trabalhador × documento` com bolinhas coloridas por status.
- O motor de conformidade continua existindo, mas rebaixado para uso interno em telas de vínculo/credenciamento (badge contextual, nunca lista agregada).
- O rótulo `Apto` deixa de ser exibido ao usuário. Passa a ser um cálculo derivado, consumido apenas por regras de credenciamento.

## Menu e rota

- Sidebar: item **Conformidade** vira **Qualificações** (ícone `ShieldCheck` → `Grid3x3` ou similar).
- Rota `/compliance` → redireciona para `/qualifications`.
- Página antiga `src/pages/Compliance.tsx` removida; hook `useLinkComplianceList` fica só onde o motor ainda é usado internamente (badge de vínculo).

## Estrutura do painel

### Linhas
Uma linha por trabalhador ativo (não por vínculo). O painel é sobre a **pessoa**, não sobre o contrato. Isso é o que muda tudo — hoje o módulo pergunta "este vínculo está ok?", o painel pergunta "esta pessoa tem as qualificações?".

### Colunas
Configuráveis pelo usuário. Fonte de tipos:
- `document_types` com `category IN ('sst_nr','sst_aso','training')` e `is_active = true`, ordenados por `display_order`.
- O usuário escolhe quais colunas quer ver (persistido em `saved_filters` por usuário).
- Preset padrão: ASO + todas as NRs ativas na empresa.

### Célula (status por trabalhador × tipo)
Cinco estados visuais:

| Símbolo | Estado | Regra |
|---|---|---|
| 🟢 verde | válido | doc/NR existe, `is_current`, sem vencimento ou `expiry > today + warning_days` |
| 🟡 amarelo | vence em breve | dentro de `warning_days` (default 30) |
| 🔴 vermelho | vencido | `expiry < today` |
| ⚪ cinza | ausente | tipo é considerado relevante para o trabalhador (ver escopo abaixo) mas não há registro |
| — | não aplicável | tipo não é relevante para nenhum vínculo/cargo do trabalhador |

### Definição de "relevante para o trabalhador"
Um tipo de documento é `⚪ ausente` (e não `— n/a`) quando:
- É exigido por **algum cargo** de vínculo ativo do trabalhador, OU
- É um override `add` em algum vínculo ativo, OU
- O usuário forçou como "sempre mostrar" no filtro.

Caso contrário, exibe `—`.

Isso resolve o problema atual: o painel só considera um documento como "faltando" quando existe uma exigência real, calculada pelas mesmas fontes que o motor de conformidade usa. Nunca há falso positivo silencioso, porque não há agregador binário.

## Interação

### Clique na célula
Abre `QualificationCell` em Popover/Sheet com:
- Nome do documento + status
- Data de emissão, validade, emitente, carga horária (para NRs)
- Botões contextuais:
  - 🟢/🟡 → "Ver arquivo" (signed URL), "Ver histórico", "Enviar revisão"
  - 🔴/⚪ → "Enviar certificado" (abre `SstCertificateDrawer` para SST, ou upload padrão para o resto)
- Link "Abrir ficha do trabalhador" para o caso complexo

### Clique no nome do trabalhador
Vai para `/workers/:id` (comportamento atual).

### Filtros no topo
- Busca por nome/CPF
- Seletor de colunas visíveis (multi-select com preset "SST essencial")
- Filtro por estado: "com vermelhos", "com amarelos", "com ausentes", "sem pendências"
- Filtro por evento/vínculo ativo (opcional)
- Filtro por cargo

### Contadores no topo
Substituem o resumo atual "aptos/atenção/bloqueados". Passam a ser:
- N trabalhadores no painel
- N com pelo menos 1 documento vencido
- N com pelo menos 1 documento vencendo em 30 dias
- N com pelo menos 1 documento ausente

Todos clicáveis (filtro rápido).

### Exportação
CSV e XLSX da matriz visível (linhas × colunas selecionadas), status por célula em texto.

## Onde a conformidade sobrevive

Em duas superfícies apenas, com escopo estritamente contextual:

1. **`LinkWorkerDetail`** — dentro do vínculo, mantém `LinkComplianceCard` porque ali a pergunta legítima é "este trabalhador atende os requisitos deste cargo neste vínculo?". **Correção obrigatória antes do painel:** o motor precisa emitir `nao_configurado` (e não `apto`) quando `required = 0` ou quando `job_role_id IS NULL`. Sem essa correção, o card continua mentindo dentro do vínculo.
2. **`PayrollForm` / futuro credenciamento** — usa `evaluate_link_compliance` internamente para bloquear inclusão de vínculo com pendências, exibindo os documentos faltantes por nome (não um selo genérico).

Nenhuma outra tela renderiza `overall`.

## Backend

### RPC nova: `list_worker_qualifications`

Assinatura:
```
list_worker_qualifications(
  p_document_type_ids uuid[] DEFAULT NULL,   -- NULL = todos ativos SST/training
  p_search text DEFAULT NULL,
  p_state text DEFAULT NULL,                  -- 'expired' | 'warning' | 'missing' | 'ok' | NULL
  p_event_id uuid DEFAULT NULL,
  p_job_role_id uuid DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
) RETURNS jsonb
```

Retorna:
```json
{
  "schema_version": 1,
  "generated_at": "...",
  "columns": [{ "document_type_id", "code", "name", "category" }],
  "total": N,
  "items": [{
    "worker_id", "worker_name", "cpf_masked",
    "cells": [{
      "document_type_id",
      "status": "ok|warning|expired|missing|not_applicable",
      "expiry_date", "issue_date", "issuer",
      "worker_document_id", "sst_qualification_id",
      "is_required_by": ["job_role:<uuid>", "link_override:<uuid>"] | []
    }]
  }]
}
```

Fontes: `worker_sst_qualifications_current` (NRs) + `worker_documents` (`is_current = true`) unidos por `document_type_id`. "Relevância" calculada por CTE que agrega requisitos dos vínculos ativos do trabalhador.

### RPC nova: `get_qualification_cell(p_worker_id, p_document_type_id)`
Detalhe expandido de uma célula para o popover: histórico de revisões, signed URL, próxima renovação sugerida.

### Sem migração destrutiva
Nenhuma tabela é alterada. `document_compliance_history` e `evaluate_link_compliance` permanecem — o painel apenas não os consulta.

## Frontend

### Arquivos novos
- `src/pages/Qualifications.tsx` — página principal.
- `src/components/qualifications/QualificationMatrix.tsx` — grid virtualizada (react-virtual) para escalar até ~1000 trabalhadores.
- `src/components/qualifications/QualificationCell.tsx` — bolinha + popover.
- `src/components/qualifications/QualificationColumnPicker.tsx` — seletor de colunas com persistência.
- `src/components/qualifications/QualificationFilters.tsx`.
- `src/hooks/useWorkerQualifications.ts`.
- `src/lib/qualifications-export.ts`.

### Arquivos alterados
- `src/App.tsx` — rota `/qualifications`, redirect `/compliance`.
- `src/components/AppSidebar.tsx` — renomeia item, novo ícone.
- `src/pages/Dashboard.tsx` — se houver card "Conformidade", vira "Qualificações" e aponta para o painel.

### Arquivos removidos
- `src/pages/Compliance.tsx`
- `src/hooks/useLinkComplianceList.ts` (usado só pela tela agregada — o painel não usa)
- `src/lib/compliance-export.ts` (substituído por `qualifications-export.ts`)

### Arquivos mantidos
- `src/components/compliance/LinkComplianceCard.tsx` — segue em uso dentro do vínculo, com a correção do estado `nao_configurado`.
- `src/hooks/useLinkCompliance.ts` — idem.
- `src/components/compliance/ComplianceBadge.tsx` — segue, ganha variante `nao_configurado` (cinza).

## Correção mínima do motor (pré-requisito, não opcional)

Antes de qualquer trabalho no painel, uma migration curta:
- `calculate_compliance_overall`: quando `required = 0`, retorna `nao_configurado` (não mais `apto`).
- `evaluate_link_compliance`: quando `job_role_id IS NULL`, retorna `nao_configurado` com `status_reason` claro.
- `ComplianceBadge`: aceita `nao_configurado` (cinza neutro, sem ícone de sucesso).

Sem isso, o `LinkComplianceCard` continua exibindo verde falso dentro do vínculo, mesmo depois de removermos a lista agregada.

## Ordem de execução

1. **Fix mínimo do motor** — migration única alterando `calculate_compliance_overall` e `evaluate_link_compliance` para emitir `nao_configurado`.
2. **RPCs do painel** — `list_worker_qualifications` e `get_qualification_cell`.
3. **Frontend do painel** — matriz + filtros + popover + exportação.
4. **Sidebar/rotas** — renomeia menu, adiciona redirect.
5. **Remoção** — apaga `Compliance.tsx`, `useLinkComplianceList`, `compliance-export`.
6. **Homologação** — você valida contra os mesmos 27 vínculos que hoje mostram "Apto" falso.

## Fora do escopo

- Redesenho do `LinkComplianceCard` (só adiciona estado `nao_configurado`).
- Job automático de credenciamento (bloqueio no `PayrollForm` fica para entrega própria).
- Dashboard executivo com gráficos — o painel matricial é a resposta principal; gráficos são complemento futuro.
- Notificações de vencimento por email/push.

## Ganho concreto

- Elimina o falso positivo estrutural (23 de 27 vínculos hoje).
- Substitui uma resposta binária escondendo problemas por uma matriz que **expõe** cada pendência individualmente.
- Reduz cliques: coordenador enxerga 100 trabalhadores em uma tela sem abrir fichas.
- Filtros por documento respondem diretamente às perguntas reais do RH ("quem está sem NR35?", "quem vence NR10 em 30 dias?").
