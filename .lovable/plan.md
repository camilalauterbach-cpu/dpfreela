

## Correções documentais: Preview, "Outros" e consistência

### 1. Preview com tratamento de erro e fallback (+ nome do arquivo)

**Arquivos**: `src/components/links/LinkDocumentsTab.tsx`, `src/components/workers/DocumentChecklist.tsx`

Ambos os componentes têm a mesma fragilidade: `handlePreview` não trata erro. Se o signed URL falhar, nada acontece.

**Alterações**:
- Envolver `handlePreview` em try/catch
- Adicionar estados `previewError` (boolean) e `previewFileName` (string)
- No Dialog de preview, quando `previewError = true`: exibir card com:
  - Nome do arquivo (para conferência operacional)
  - Mensagem "Não foi possível carregar o preview deste documento"
  - Botão "Baixar arquivo" (window.open para o signed URL com download)
  - Botão "Abrir em nova aba" (window.open)
- Quando o preview carrega normalmente, exibir o nome do arquivo acima da imagem/iframe
- Quando MIME não é imagem nem PDF: exibir o mesmo fallback com download direto

**LinkDocumentsTab** — `handlePreview` atual (linha 177-185):
```typescript
// De:
const handlePreview = async (filePath, mimeType, bucket) => {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(filePath, 300);
  if (data?.signedUrl) { setPreviewUrl(...); setPreviewMime(...); }
};

// Para:
const handlePreview = async (filePath, mimeType, bucket, fileName?: string) => {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, 300);
    if (error || !data?.signedUrl) throw new Error("Falha ao gerar URL");
    setPreviewUrl(data.signedUrl);
    setPreviewMime(mimeType);
    setPreviewFileName(fileName || filePath.split("/").pop() || "documento");
    setPreviewError(false);
  } catch {
    setPreviewError(true);
    setPreviewFileName(fileName || filePath.split("/").pop() || "documento");
    setPreviewUrl("error");
  }
};
```

**DocumentChecklist** — mesma refatoração no `handlePreview` (linha 189-198).

**Dialog de preview** — nos dois componentes, substituir o conteúdo condicional por:
- Se `previewError` ou MIME não suportado: card informativo com nome do arquivo + botões de fallback
- Se imagem: `<img>` com nome do arquivo acima
- Se PDF: `<iframe>` com nome do arquivo acima

---

### 2. "Outros" customizado com texto específico

**Arquivo**: `src/lib/link-document-config.ts`

Na função `getConfiguredDocs` (linha 56-83), quando `operational` contém `"outros_operacionais"` e `operational_custom` tem texto, o item `outros_operacionais` já aparece com label genérico "Outros operacionais" (vindo de OPERATIONAL_OPTIONS). Mas o texto customizado é adicionado separadamente como `operational_custom`.

**Correção**: quando `operational_custom` tem texto E `operational` contém `"outros_operacionais"`, substituir o label do item `outros_operacionais` pelo texto customizado, e não duplicar com `operational_custom` separado. Mesma lógica para NRs com `nr_custom`.

```typescript
// Lógica corrigida em getConfiguredDocs:
for (const cat of config.operational) {
  if (cat === "outros_operacionais" && config.operational_custom) {
    // Usa o texto customizado como label em vez do genérico
    docs.push({ category: cat, label: config.operational_custom, group: "operational" });
  } else {
    const opt = OPERATIONAL_OPTIONS.find((o) => o.value === cat);
    docs.push({ category: cat, label: opt?.label || cat, group: "operational" });
  }
}
// Só adiciona operational_custom como item separado se NÃO há "outros_operacionais" selecionado
if (config.operational_custom && !config.operational.includes("outros_operacionais")) {
  docs.push({ category: "operational_custom", label: config.operational_custom, group: "operational" });
}

// Mesma lógica para NRs:
// Se nr_custom tem texto, usa como label em vez de "NR custom"
// Não duplica como item separado
```

---

### 3. Nenhuma alteração adicional necessária

- Categoria "Outros" do trabalhador: já funciona em `DocumentChecklist` (linhas 430-516) com multi-upload
- A seção "Outros (complementares)" no `LinkDocumentsTab` (linhas 371-399) já exibe os docs globais do trabalhador
- O preview dessas seções será corrigido automaticamente pelo item 1

---

### Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `src/components/links/LinkDocumentsTab.tsx` | Preview try/catch, estados de erro/fileName, Dialog com fallback e nome do arquivo |
| `src/components/workers/DocumentChecklist.tsx` | Mesma correção de preview |
| `src/lib/link-document-config.ts` | Label customizado para "outros_operacionais" e NR custom sem duplicação |

### Garantias
- Sem apagar documentos existentes
- Sem sobrescrever configuração manual do grupo
- Sem alterar legado
- Sem mexer nos 27 trabalhadores cadastrados

