import { test, expect, BASE_URL } from "./fixtures/auth";

/**
 * Q-014.0 · Fase 0A — Diagnóstico SST/vínculos (read-only).
 *
 * Valida a nova seção Configurações → SST → "Diagnóstico SST e vínculos":
 *  - Botão "Rodar diagnóstico" chama `dry_run_sst_link_readiness()` sem erros.
 *  - Botão "Exportar JSON" fica disponível após a execução.
 *  - Não existem botões mutáveis (Salvar snapshot / Corrigir / Migrar / Recalcular / Aplicar / Limpar).
 *  - Sem pageerrors durante o fluxo.
 */
test.describe("Configurações → SST · Diagnóstico read-only", () => {
  test("executa diagnóstico, exporta JSON e não expõe ações mutáveis", async ({ authedPage }) => {
    const pageErrors: string[] = [];
    authedPage.on("pageerror", (err) => pageErrors.push(err.message));

    await authedPage.goto(`${BASE_URL}/settings/sst`);
    await expect(
      authedPage.getByRole("heading", { name: /Diagnóstico SST e vínculos/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Aviso read-only visível.
    await expect(
      authedPage.getByText(/Diagnóstico somente leitura/i),
    ).toBeVisible();

    // Nenhum botão mutável.
    const forbidden = /Salvar snapshot|Corrigir|Migrar|Recalcular|Aplicar|Limpar/i;
    await expect(authedPage.getByRole("button", { name: forbidden })).toHaveCount(0);

    // Roda diagnóstico.
    await authedPage.getByRole("button", { name: /Rodar diagnóstico/i }).click();
    await expect(authedPage.getByText(/Resumo/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(authedPage.getByText(/Baseline de preservação/i)).toBeVisible();

    // Exportar JSON habilitado.
    const exportBtn = authedPage.getByRole("button", { name: /Exportar JSON/i });
    await expect(exportBtn).toBeEnabled();

    // Recarrega e confirma que continua sem botões mutáveis.
    await authedPage.reload();
    await expect(
      authedPage.getByRole("heading", { name: /Diagnóstico SST e vínculos/i }),
    ).toBeVisible();
    await expect(authedPage.getByRole("button", { name: forbidden })).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});