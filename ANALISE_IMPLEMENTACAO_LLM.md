# ANÁLISE DA IMPLEMENTAÇÃO DE LLMs NO SISTEMA TSM EX

## Data: 26 de Janeiro de 2026

---

## 🔍 RESUMO EXECUTIVO

A implementação atual das LLMs apresenta **duplicação de código**, **falta de integração** entre componentes e **fluxo não unificado**. O sistema possui uma infraestrutura robusta de configuração de LLMs no banco de dados, mas o chat não está utilizando essa infraestrutura.

---

## 📊 ESTADO ATUAL DA IMPLEMENTAÇÃO

### ✅ O QUE EXISTE E ESTÁ BEM IMPLEMENTADO

#### 1. **Sistema de Configuração de LLMs (Backend)**
- ✅ **Schema Prisma completo** (`LLMProvider`, `LLMModel`, `LLMApiKey`)
  - Suporta múltiplos providers
  - Configuração de capabilities (chat, tools, vision, json_mode)
  - Sistema de modelos padrão por capability
  - Rastreamento de uso (tokens, chamadas)

- ✅ **API de Configuração** (`/api/settings/llm/*`)
  - CRUD completo de providers
  - CRUD completo de modelos
  - Gerenciamento de API keys
  - Endpoint para buscar modelo ativo por capability
  - Teste de conexão de modelos

- ✅ **Interface de Configuração** (`SettingsLLM.tsx`)
  - UI completa para gerenciar providers e modelos
  - Teste de modelos
  - Configuração de API keys

#### 2. **Serviço Universal de LLM** (`llmService.ts`)
- ✅ Suporta múltiplos formatos de API:
  - OpenAI-compatible (OpenAI, DeepSeek, Groq, Together, Ollama)
  - Google Gemini
  - Anthropic Claude
- ✅ Suporta function calling (tools)
- ✅ Função de teste de conexão
- ✅ Interface unificada `callLLM()`

#### 3. **Ferramentas do Agente** (`agentTools.ts`)
- ✅ Definições completas de ferramentas
- ✅ System prompt estruturado
- ✅ Ferramentas: `create_opportunity`, `calculate_quote`, `identify_account`, `request_collection`, `list_opportunities`

---

## ❌ PROBLEMAS IDENTIFICADOS

### 🔴 CRÍTICO 1: Chat Não Usa o Sistema de Configuração

**Problema:**
O chat (`/api/chat`) está usando **APENAS** o `geminiService.ts`, que é hardcoded para Gemini e não consulta o banco de dados para escolher o modelo configurado.

**Evidência:**
```typescript
// server/src/routes/chat.ts:2
import { processChatStep } from '../services/geminiService.js';

// server/src/routes/chat.ts:131
const result = await processChatStep(history || [], message);
```

**Impacto:**
- ❌ Não é possível trocar o modelo LLM usado no chat sem alterar código
- ❌ Não usa modelos configurados no banco de dados
- ❌ Não respeita configurações de modelo padrão
- ❌ Não pode usar outros providers (OpenAI, Claude, etc.) no chat

---

### 🔴 CRÍTICO 2: Duplicação de Código

**Problema:**
Existem **DOIS serviços** fazendo coisas similares:

1. **`llmService.ts`** - Serviço universal, bem estruturado, suporta múltiplos providers
2. **`geminiService.ts`** - Serviço específico Gemini, usa biblioteca `@google/genai`

**Evidência:**
```typescript
// llmService.ts - Suporta Gemini via callGeminiFormat()
async function callGeminiFormat(provider: ProviderConfig, options: CallOptions)

// geminiService.ts - Implementação específica
export const processChatStep = async (history: any[], newMessage: string)
```

**Impacto:**
- ❌ Manutenção duplicada
- ❌ Inconsistências entre implementações
- ❌ Confusão sobre qual usar

---

### 🔴 CRÍTICO 3: Ferramentas Duplicadas e Não Utilizadas

**Problema:**
- `agentTools.ts` define ferramentas completas, mas **não está sendo usado**
- `geminiService.ts` define ferramentas próprias (`AGENT_TOOLS`)
- `ChatWeb.tsx` também define ferramentas (`AGENT_TOOLS`)

**Evidência:**
```typescript
// agentTools.ts - Definições completas (NÃO USADO)
export const AGENT_TOOLS: Tool[] = [ ... ]

// geminiService.ts - Ferramentas próprias (USADO)
export const AGENT_TOOLS: any[] = [ ... ]

// ChatWeb.tsx - Ferramentas próprias (NÃO USADO no backend)
const AGENT_TOOLS = [ ... ]
```

**Impacto:**
- ❌ Três definições diferentes de ferramentas
- ❌ Inconsistência entre frontend e backend
- ❌ Ferramentas do `agentTools.ts` não estão disponíveis

---

### ⚠️ PROBLEMA 4: Frontend Busca Config Mas Não Usa

**Problema:**
O `ChatWeb.tsx` tem uma função `getLLMConfig()` que busca o modelo ativo, mas **não está sendo usada**.

**Evidência:**
```typescript
// ChatWeb.tsx:141-150
const getLLMConfig = async () => {
  const res = await fetch(`${API_URL}/settings/llm/models/active?capability=chat`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  // ... retorna config mas nunca é usado
}
```

**Impacto:**
- ⚠️ Código morto
- ⚠️ Confusão sobre intenção

---

### ⚠️ PROBLEMA 5: System Prompt Duplicado

**Problema:**
System prompts definidos em múltiplos lugares:
- `geminiService.ts` - `SYSTEM_PROMPT`
- `agentTools.ts` - `AGENT_SYSTEM_PROMPT`
- `ChatWeb.tsx` - `SYSTEM_PROMPT`

**Impacto:**
- ⚠️ Inconsistência de comportamento
- ⚠️ Difícil manter sincronizado

---

## 🔄 FLUXO ATUAL (Como Funciona Hoje)

### Fluxo do Chat Atual:
```
1. Cliente envia mensagem no ChatWeb.tsx
   ↓
2. Frontend chama POST /api/chat
   ↓
3. Backend (chat.ts) importa geminiService.ts
   ↓
4. geminiService.ts usa biblioteca @google/genai diretamente
   ↓
5. Gemini retorna resposta + tool calls
   ↓
6. Backend executa tool calls (create_opportunity, calculate_quote)
   ↓
7. Retorna resposta ao frontend
```

**Problemas neste fluxo:**
- ❌ Não consulta banco para escolher modelo
- ❌ Hardcoded para Gemini
- ❌ Não usa llmService.ts universal
- ❌ Não usa agentTools.ts

---

## 🎯 FLUXO IDEAL (Como Deveria Funcionar)

### Fluxo Proposto:
```
1. Cliente envia mensagem no ChatWeb.tsx
   ↓
2. Frontend chama POST /api/chat
   ↓
3. Backend (chat.ts):
   a. Busca modelo ativo para capability "chat" no banco
   b. Busca provider e API key
   c. Busca ferramentas de agentTools.ts
   d. Busca system prompt de agentTools.ts
   ↓
4. Usa llmService.ts universal:
   - callLLM() com provider config
   - Passa tools de agentTools.ts
   - Passa system prompt de agentTools.ts
   ↓
5. llmService.ts chama API apropriada (OpenAI/Gemini/Claude)
   ↓
6. Retorna resposta + tool calls
   ↓
7. Backend executa tool calls usando agentTools.ts
   ↓
8. Retorna resposta ao frontend
```

---

## 📋 PLANO DE CORREÇÃO

### Fase 1: Unificar Serviço de LLM (PRIORIDADE ALTA)

#### 1.1 Remover `geminiService.ts`
- ❌ Deletar arquivo
- ✅ Migrar lógica específica para `llmService.ts` (já existe)

#### 1.2 Atualizar `chat.ts` para usar `llmService.ts`
```typescript
// ANTES:
import { processChatStep } from '../services/geminiService.js';
const result = await processChatStep(history || [], message);

// DEPOIS:
import { callLLM } from '../services/llmService.js';
import { AGENT_TOOLS, AGENT_SYSTEM_PROMPT } from '../services/agentTools.js';

// Buscar modelo ativo do banco
const modelConfig = await getActiveModel('chat');
const result = await callLLM(
  {
    apiFormat: modelConfig.provider.apiFormat,
    baseUrl: modelConfig.provider.baseUrl,
    apiKey: modelConfig.apiKey
  },
  {
    model: modelConfig.modelId,
    messages: [...history, { role: 'user', content: message }],
    tools: AGENT_TOOLS,
    maxTokens: 4096
  }
);
```

#### 1.3 Criar função helper para buscar modelo ativo
```typescript
// server/src/services/llmService.ts
export async function getActiveModel(capability: string = 'chat') {
  const model = await prisma.lLMModel.findFirst({
    where: {
      active: true,
      isDefault: true,
      capabilities: { has: capability }
    },
    include: {
      provider: {
        include: { apiKey: true }
      }
    }
  });
  
  if (!model || !model.provider.apiKey) {
    throw new Error(`No active model with API key found for capability: ${capability}`);
  }
  
  return {
    modelId: model.modelId,
    provider: {
      apiFormat: model.provider.apiFormat,
      baseUrl: model.provider.baseUrl,
      apiKey: model.provider.apiKey.apiKey
    }
  };
}
```

---

### Fase 2: Unificar Ferramentas e Prompts (PRIORIDADE ALTA)

#### 2.1 Remover definições duplicadas
- ❌ Remover `AGENT_TOOLS` de `geminiService.ts`
- ❌ Remover `AGENT_TOOLS` e `SYSTEM_PROMPT` de `ChatWeb.tsx`
- ✅ Usar apenas `agentTools.ts`

#### 2.2 Atualizar `chat.ts` para usar `agentTools.ts`
```typescript
import { AGENT_TOOLS, AGENT_SYSTEM_PROMPT } from '../services/agentTools.js';

// Adicionar system prompt às mensagens
const messages: ChatMessage[] = [
  { role: 'system', content: AGENT_SYSTEM_PROMPT },
  ...history,
  { role: 'user', content: message }
];
```

#### 2.3 Atualizar handler de tool calls
- ✅ Usar definições de `agentTools.ts`
- ✅ Implementar todas as ferramentas definidas:
  - `create_opportunity` ✅ (já existe)
  - `calculate_quote` ✅ (já existe, mas usa mock)
  - `identify_account` ❌ (não implementado)
  - `request_collection` ❌ (não implementado)
  - `list_opportunities` ❌ (não implementado)

---

### Fase 3: Implementar Ferramentas Faltantes (PRIORIDADE MÉDIA)

#### 3.1 `identify_account`
- Buscar/criar Account por CNPJ, CPF ou nome
- Retornar accountId para usar em outras ferramentas

#### 3.2 `request_collection`
- Atualizar opportunity com dados de coleta
- Criar registro de endereço e contato

#### 3.3 `list_opportunities`
- Listar oportunidades da sessão/conta
- Retornar resumo para o agente

---

### Fase 4: Integrar Pricing Engine Real (PRIORIDADE ALTA)

#### 4.1 Substituir mock em `calculate_quote`
```typescript
// ANTES (mock):
const freight = weight * 1.5;
const gris = value * 0.003;

// DEPOIS (real):
const pricingResponse = await fetch(`${API_URL}/pricing/calculate`, {
  method: 'POST',
  body: JSON.stringify({ origin, destination, weight, nfValue })
});
const pricing = await pricingResponse.json();
```

---

### Fase 5: Limpeza e Documentação (PRIORIDADE BAIXA)

#### 5.1 Remover código morto
- ❌ Remover `getLLMConfig()` não usado do `ChatWeb.tsx`
- ❌ Remover `geminiService.ts` após migração

#### 5.2 Documentar fluxo
- ✅ Criar diagrama de fluxo
- ✅ Documentar como adicionar novo provider
- ✅ Documentar como adicionar nova ferramenta

---

## 📊 COMPARAÇÃO: ANTES vs DEPOIS

| Aspecto | ANTES | DEPOIS |
|--------|------|--------|
| **Serviço LLM** | 2 serviços (llmService + geminiService) | 1 serviço universal (llmService) |
| **Configuração** | Hardcoded Gemini | Consulta banco de dados |
| **Providers** | Apenas Gemini | Qualquer provider configurado |
| **Ferramentas** | 3 definições diferentes | 1 definição centralizada |
| **System Prompt** | 3 definições diferentes | 1 definição centralizada |
| **Manutenibilidade** | Baixa (código duplicado) | Alta (código unificado) |
| **Flexibilidade** | Baixa (hardcoded) | Alta (configurável) |

---

## ⚠️ RISCOS E CONSIDERAÇÕES

### Riscos:
1. **Breaking Change**: Mudar o chat pode quebrar funcionalidade existente
   - **Mitigação**: Testar extensivamente antes de deploy
   - **Mitigação**: Manter fallback para Gemini se modelo não encontrado

2. **Performance**: Consultar banco a cada requisição pode ser lento
   - **Mitigação**: Cachear modelo ativo em memória (TTL 5min)
   - **Mitigação**: Usar variável de ambiente para override rápido

3. **Compatibilidade**: Diferentes providers podem ter formatos ligeiramente diferentes
   - **Mitigação**: Testar com múltiplos providers
   - **Mitigação**: Tratamento de erros robusto

---

## ✅ CHECKLIST DE IMPLEMENTAÇÃO

### Fase 1: Unificar Serviço
- [ ] Criar função `getActiveModel()` em `llmService.ts`
- [ ] Atualizar `chat.ts` para usar `llmService.ts`
- [ ] Remover import de `geminiService.ts` de `chat.ts`
- [ ] Testar chat com modelo Gemini configurado
- [ ] Testar chat com modelo OpenAI configurado
- [ ] Deletar `geminiService.ts`

### Fase 2: Unificar Ferramentas
- [ ] Atualizar `chat.ts` para usar `AGENT_TOOLS` de `agentTools.ts`
- [ ] Atualizar `chat.ts` para usar `AGENT_SYSTEM_PROMPT` de `agentTools.ts`
- [ ] Remover `AGENT_TOOLS` de `geminiService.ts` (se ainda existir)
- [ ] Remover `AGENT_TOOLS` e `SYSTEM_PROMPT` de `ChatWeb.tsx`
- [ ] Testar function calling funciona corretamente

### Fase 3: Implementar Ferramentas
- [ ] Implementar `identify_account`
- [ ] Implementar `request_collection`
- [ ] Implementar `list_opportunities`
- [ ] Testar cada ferramenta individualmente

### Fase 4: Pricing Engine
- [ ] Substituir mock em `calculate_quote` por chamada real
- [ ] Testar cálculo de preço funciona corretamente
- [ ] Validar com diferentes cenários (com/sem tabela de preço)

### Fase 5: Limpeza
- [ ] Remover código morto
- [ ] Adicionar comentários/documentação
- [ ] Criar diagrama de fluxo
- [ ] Atualizar README

---

## 🎯 CONCLUSÃO

A implementação atual tem uma **base sólida** (schema, API, UI de configuração, serviço universal), mas o **chat não está integrado** com essa infraestrutura. A correção é relativamente simples: migrar o chat para usar `llmService.ts` e `agentTools.ts` ao invés de `geminiService.ts`.

**Estimativa de tempo:** 2-3 dias para Fase 1 e 2 (crítico), mais 2-3 dias para Fase 3 e 4.

**Prioridade:** ALTA - Bloqueia uso de outros providers e cria confusão na manutenção.

---

**Documento criado em:** 26 de Janeiro de 2026
**Próxima revisão:** Após implementação da Fase 1
