# TSM EX - Task Checklist

## Fase: Sistema LLM Multi-Provider + Agente MVP

### 1️⃣ Schema e Backend ✅
- [x] Atualizar schema: apiFormat, baseUrl, supportsTools, isBuiltIn
- [x] Refatorar llmService.ts para usar apiFormat (OpenAI, Gemini, Anthropic)
- [x] Atualizar seed com 6 providers pré-configurados

### 2️⃣ UI SettingsLLM ✅
- [x] Form completo no "Adicionar Modelo" (capabilities, preços, context)
- [x] Modal "Adicionar Provider Customizado"
- [x] Visualização melhorada dos modelos

### 3️⃣ Agente com Function Calling (Próximo)
- [ ] Definir AGENT_TOOLS no backend
- [ ] Integrar function calling no ChatWeb.tsx
- [ ] Executor de funções (create_demand, get_quote, check_tracking)
- [ ] Testar fluxo completo
