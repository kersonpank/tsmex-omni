# Correção: Problema com API Keys de LLM

## Problema Identificado

O chat estava retornando erro 500 com a mensagem:
```
Error: Incorrect API key provided: 35345345
```

### Causa Raiz

1. **Busca de modelo não validava API key**: A função `getActiveModel()` buscava modelos ativos, mas não verificava se tinham API keys válidas antes de retornar
2. **Priorização incorreta**: O sistema podia retornar um modelo OpenAI com API key inválida ao invés de um modelo Gemini válido
3. **Falta de validação**: Não havia validação suficiente antes de tentar usar o modelo

## Solução Implementada

### 1. Melhorias em `getActiveModel()` (`server/src/services/llmService.ts`)

**Antes:**
- Buscava modelos ativos sem verificar API key
- Fallback podia retornar modelo sem API key válida

**Depois:**
- Busca apenas modelos com API keys válidas e ativas
- Valida API key antes de retornar
- Mensagens de erro mais claras e específicas
- Prioriza modelos padrão com API keys válidas

### 2. Melhorias em `chat.ts`

- Tratamento de erros melhorado
- Mensagens de erro mais claras para o usuário
- Logs de debug em desenvolvimento

### 3. Melhorias em `settings.ts` (API Keys)

- Validação de provider antes de salvar
- Mensagens de erro mais específicas do Zod

### 4. Script de Diagnóstico

Criado `server/check_llm_status.ts` para verificar o estado da configuração:
```bash
cd server
npx tsx check_llm_status.ts
```

## Como Configurar Corretamente

### Passo 1: Verificar Status Atual
```bash
cd server
npx tsx check_llm_status.ts
```

### Passo 2: Configurar API Key do Gemini

1. Acesse Settings > LLM no admin
2. Encontre o provider "Google Gemini"
3. Clique em "Adicionar Chave" ou "Atualizar Chave"
4. Cole sua API key do Gemini (obtenha em https://aistudio.google.com/apikey)
5. Salve

### Passo 3: Criar/Ativar Modelo Gemini

1. Em Settings > LLM, clique em "+ Modelo"
2. Selecione provider "Google Gemini"
3. Configure:
   - Nome: "Gemini 1.5 Flash" (ou outro)
   - Model ID: `gemini-1.5-flash` (ou `gemini-1.5-pro`)
   - Capabilities: Marque "Chat" e "Function Calling"
   - Marque como "Padrão" (isDefault)
4. Salve

### Passo 4: Verificar

Execute novamente o script de diagnóstico:
```bash
npx tsx check_llm_status.ts
```

Deve mostrar:
```
✅ Gemini 1.5 Flash (Google Gemini) ⭐ DEFAULT 💬
✅ Has valid API key
```

## Validações Implementadas

A função `getActiveModel()` agora valida:

1. ✅ Modelo está ativo (`active: true`)
2. ✅ Provider está ativo (`provider.active: true`)
3. ✅ API key existe (`provider.apiKey` não é null)
4. ✅ API key está ativa (`provider.apiKey.active: true`)
5. ✅ API key não está vazia (`apiKey.trim() !== ''`)
6. ✅ Modelo tem capability "chat"

## Mensagens de Erro Melhoradas

Agora o sistema retorna mensagens específicas:

- `No API key configured for provider: X. Please add an API key in Settings > LLM.`
- `API key is inactive for provider: X. Please activate the API key in Settings > LLM.`
- `API key is empty for provider: X. Please configure a valid API key in Settings > LLM.`
- `No active model found for capability: chat. Please configure a model with a valid API key in Settings > LLM.`

## Testes

Após configurar:

1. **Teste o modelo**: Em Settings > LLM, clique em "Testar" no modelo Gemini
2. **Teste o chat**: Acesse o chat e envie uma mensagem
3. **Verifique logs**: Os logs devem mostrar qual modelo está sendo usado

## Próximos Passos

Se ainda houver problemas:

1. Execute o script de diagnóstico
2. Verifique se há múltiplos modelos marcados como padrão
3. Verifique se a API key do Gemini está correta
4. Verifique se o modelo está marcado como ativo e padrão
