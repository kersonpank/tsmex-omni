# ACBr API (homologação e produção) — Plano de implementação e endurecimento

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Passos usam checkbox (`- [ ]`).

> **Para agentes/desenvolvimento:** use o fluxo por tarefas com checkboxes. Ordene trabalho pelo caminho feliz primeiro (OAuth → empresa → certificado → CT-e/DC-e), depois observabilidade e paridade prod/hom.

**Contexto produto:** prompt verbatim e links oficiais estão na skill do projeto [`.cursor/skills/tsmex-acbr-api-definitivo/SKILL.md`](../../../.cursor/skills/tsmex-acbr-api-definitivo/SKILL.md).

**Goal:** Operação fiscal confiável via ACBr API com separação explícita homologação versus produção, cadastro/sync de empresa e certificado prévisível, e diagnóstico claro quando nada aparece no console ACBr ou quando a API TSM só simula documentos.

**Architecture:** Gate central em `server/src/services/acbr/acbrConfig.ts` (`getAcbrProviderDecision` / `shouldUseAcbrHttp`) decide HTTP real versus simulação. OAuth2 client credentials ficam apenas no servidor (`acbrAuth.ts`). Chamadas REST usam `getAcbrApiBaseUrlForEnvironment` para escolher `hom.acbr.api.br` ou `prod.acbr.api.br` conforme ambiente do **emitente** (`FiscalEmitter.environment`). Sincronização de empresa/certificado CT-e é disparada nos endpoints de emitente fiscal; emissão CT-e e DC-e ocorrem em rotas nested de pedido/freight-calculation consumidas pelo frontend (preflight antes de POST).

**Tech Stack:** Node.js 20+, Express 4, Prisma, `fetch`, variáveis `ACBR_*` / `FISCAL_*`, S3/compat para PFX (`server/src/lib/objectStorage.ts`), React admin (`components/admin/OrderFreightCalculationSection.tsx`, `components/admin/IdentidadeVisualTab.tsx`).

---

## Baseline atual (mapa ponta-a-ponta)

### 1) Variáveis de ambiente (API)

| Variável | Papel neste repo |
|----------|------------------|
| `ACBR_CLIENT_ID` / `ACBR_CLIENT_SECRET` | Obrigatórios quando ACBr HTTP é escolhido; repassadas no Docker (`docker-compose.yml`). |
| `ACBR_TOKEN_URL` | Default `https://auth.acbr.api.br/realms/ACBrAPI/protocol/openid-connect/token` (`acbrConfig.ts`). |
| `ACBR_API_BASE_URL` | Só vale quando **nenhum** `apiEnvironment` explícito — emissão usa sempre `HOMOLOGACAO`/`PRODUCAO` do documento (`getAcbrApiBaseUrlForEnvironment`). |
| `ACBR_FALLBACK_CMUN` | Fallback IBGE quando município não resolve (`acbrIbge.ts`). |
| `FISCAL_CTE_PROVIDER` ou `FISCAL_PROVIDER` = `acbr` | Força `willUseAcbrHttp=true` mesmo com emitente `SIMULATED` (útil pra homologação). |
| `FISCAL_SECRET_KEY` | Criptografa senha do PFX armazenada no BD (`fiscalEmitterService.ts`). |
| Variáveis S3/MinIO | Requeridas para upload do certificado (`objectStorage.ts` → `uploadBase64Object`). |

### 2) OAuth2 (`server/src/services/acbr/acbrAuth.ts`)

`POST` form-urlencoded para `ACBR_TOKEN_URL`, `grant_type=client_credentials`, escopos passados pelo chamador (`empresa`, `cte`, `dce`, `mdfe`, etc.). Cache in-memory até ~1 min antes do `expires_in`.

### 3) Escolha do provedor HTTP (`server/src/services/acbr/acbrConfig.ts`)

Ordem efetiva: se `FISCAL_CTE_PROVIDER` ou `FISCAL_PROVIDER` === `acbr` **e** credenciais OAuth existem → **`willUseAcbrHttp: true`** (`reason: forced_by_env`), inclusive com emitente `SIMULATED`. Se env força ACBr mas faltam `ACBR_CLIENT_*` → `willUseAcbrHttp: false` (`missing_credentials`). Sem env force: HTTP só quando `FiscalEmitter.provider === 'ACBR'`. Caso contrário → **`authorizeCteWithProvider` cai na simulação local** (`cteService.ts`): nenhuma chamada `hom.acbr`/`prod.acbr`.

### 4) Cadastro empresa e serviços (`server/src/services/acbr/acbrEmpresa.ts` + rotas)

- **POST `/empresas`**: `createAcbrEmpresaForPerson` (scope `empresa`), idempotente com `409` tratado como sucesso.
- **PUT `/empresas/{cnpj}/cte`**: CRT + ambiente `homologacao`/`producao` — `putAcbrEmpresaCteConfig`.
- **PUT `/empresas/{cnpj}/certificado`**: payload base64 + senha — `putAcbrEmpresaCertificado`.
- **Orquestração**: `syncFiscalEmitterToAcbr` combina empresa + config CT-e.
- **Triggers**: criar/atualizar emitente com `provider===ACBR` e credenciais → `trySyncAcbrEmitter` em `server/src/routes/fiscalEmitters.ts`. Upload certificado refaz PUT certificado quando ACBR + credenciais.

### 5) Wrapper HTTP (`server/src/services/acbr/acbrHttp.ts`)

`acbrFetchJson`: token + `Authorization` + URL por ambiente SEFAZ do documento (`apiEnvironment`). Erros sobem como `Error` texto.

### 6) CT-e (`server/src/services/acbr/acbrCteEmit.ts`, `acbrCteMapper.ts`)

`POST /cte` → loop até ~24 tentativas com `POST /cte/{id}/sincronizar` opcionalmente tolerante a falhas → `GET /cte/{id}` → opcionalmente `GET /cte/{id}/xml`.

### 7) DC-e (`server/src/services/dceService.ts`)

`POST /dce` + polling só `GET /dce/{id}` (sem ciclo `/sincronizar` como no CT-e neste codebase).

### 8) MDF-e (`server/src/services/acbr/acbrMdfeEmit.ts` + `routes/manifests.ts`)

Exige credenciais; verifica `isAcbrCredentialsConfigured` antes da emissão.

### 9) Distribuição NF-e (`server/src/services/acbr/acbrDistribuicaoNfe.ts`, `routes/fiscalDistribuicao.ts`)

Endpoints retornam 503 se OAuth não configurado.

### 10) Fluxo REST de emissão CT-e pelo pedido

`POST /api/orders/:orderId/freight-calculations/:calcId/emit-cte` (`freightCalculations.ts`): estado `CTE_READY`/`CTE_SENT`; monta input com `buildCteEmissionInputFromRecords` usando `calc.fiscalEmitter.environment` como `ambiente`; preflight (`ctePreflight.ts` → `validateCteReadiness` + decisão ACBr); chama `authorizeCteWithProvider` com provider do emitente.

### 11) Diagnóstico runtime

`GET /api/fiscal-emitters/acbr-diagnostics` (`fiscalEmitters.ts`) → `buildAcbrRuntimeDiagnostics` (`acbrDiagnostics.ts`): flags OAuth, vars forçando ACBr, URLs efetivas hom/prod flag S3.

### 12) Frontend (gates UX)

`OrderFreightCalculationSection.tsx`: pré-carrega preflight CT-e; botão só habilitado com emitente fiscal, frete > 0, não travado fiscalmente, `ctePreflight.canEmit`; após POST mostra texto se `rawResponse.provider` foi `acbr` vs `simulation`. `IdentidadeVisualTab.tsx`: painel com diagnóstico ACBr/S3/forçadores.

---

## Alinhamento com fluxo oficial ACBr API (documentação portal)

Texto guia público: [https://dev.acbr.api.br/docs/primeiros-passos](https://dev.acbr.api.br/docs/primeiros-passos), [autenticação](https://dev.acbr.api.br/docs/autenticacao), [empresas](https://dev.acbr.api.br/docs/empresas), [CT-e](https://dev.acbr.api.br/docs/cte), [referência OpenAPI](https://dev.acbr.api.br/docs/api) (import Postman: `https://prod.acbr.api.br/openapi/swagger.json`). Console do tenant ([console.acbr.api.br](https://console.acbr.api.br/)) continua sendo onde se criam credenciais, créditos e se inspeciona tráfego por ambiente.

URLs de runtime usadas no código:

- Token: `https://auth.acbr.api.br/realms/ACBrAPI/protocol/openid-connect/token`
- API homologação: `https://hom.acbr.api.br`
- API produção: `https://prod.acbr.api.br`

| Etapa oficial (esperado) | Implementação TSM atual |
|-------------------------|-------------------------|
| Criar aplicação client credentials no painel ACBr | Operacional apenas se `ACBR_CLIENT_ID` / `SECRET` existem no runtime da API. |
| Solicitar scopes por serviço (`empresa`, `cte`, `dce`, `mdfe`…) | `acbrFetchJson`/`acbrEmpresa` passam scopes por endpoint (ex.: CT-e usa `empresa`+`cte`). |
| Cadastrar CNPJ (empresa) | `POST /empresas` em `syncFiscalEmitterToAcbr`/`createAcbrEmpresaForPerson`. |
| Configurar certificado digital A1 na nuvem | `POST .../certificate` no TSM faz upload storage + `PUT /empresas/{cnpj}/certificado` na ACBr. |
| Parametrizar CRT/ambiente do serviço CT-e | `PUT /empresas/{cnpj}/cte` com CRT e `homologacao`/`producao`. |
| Emitir/consultar/sincronizar documento | CT-e implementa criar+sincronizar+poll; DC-e só criar+poll; MDF-e próprio loop. |

---

## Por que pode não aparecer nada no console de requisições ACBr?

1. **`willUseAcbrHttp` é falso**: emitente `SIMULATED` e **sem** `FISCAL_CTE_PROVIDER`/`FISCAL_PROVIDER` = `acbr` → só simulação local (`cteService.ts`): zero chamadas `hom.acbr`/`prod.acbr`.
2. **Credenciais ausentes com ACBr obrigatório**: emissão rejeita com `ACBR_CONFIG` antes do HTTP outbound (ou erro claro); OAuth não completa logs de API REST de documento mas pode gerar erro no realm.
3. **Host hom versus prod divergindo do esperado pelo console**: o host vem estritamente de `FiscalEmitter.environment` nos paths de emissão; console filtrando só produção não mostrará chamadas à hom ou vice-versa (`acbrConfig.getAcbrApiBaseUrlForEnvironment`).
4. **`ACBR_API_BASE_URL` só no fallback global**: uso incorreto raro quando `null` ambiente é passado; emissões de CT-e sempre passam `apiEnvironment`; diagnóstico mostra URLs efetivas hom/prod.
5. **Requisição nunca despachada**: preflight/rota (`emit-cte`) retorna **400** com pendências; UI bloqueada (`OrderFreightCalculationSection`); erro de autorização Hub (`403`); estado fiscal travado (`FISCAL_LOCKED_STATUSES` em `freightCalculations.ts`).
6. **Token válido só no auth realm**: primeira chamada real pode ser apenas OAuth até uma emissão; separar métricas de autenticação versus API de documentos no painel ACBr.

---

## Quando o Portainer já tem todas as variáveis (caso atual)

Se `ACBR_CLIENT_ID`, `ACBR_CLIENT_SECRET`, `FISCAL_SECRET_KEY`, S3/MinIO e `FISCAL_CTE_PROVIDER=acbr` já estão no stack (como no print), **não trate como problema de “falta de env”**. O próximo passo é provar que o **processo Node em execução** enxerga esses valores e que o fluxo de negócio chega até `emitCteViaAcbr`:

1. **Recriar/reiniciar o serviço `api` após alterar env** — o aviso do Portainer (“Environment changes will not take effect…”) vale: sem restart, o container pode estar com env antiga na memória.
2. **`GET /api/fiscal-emitters/acbr-diagnostics`** — deve retornar `acbrCredentialsConfigured: true` e URLs hom/prod esperadas; se `false`, o runtime **não** recebeu `ACBR_*` (nome do serviço errado, env só no stack pai, typo, ou API não reiniciada).
3. **Emitente no banco** — `environment: HOMOLOGACAO` para host `hom.acbr.api.br` nas chamadas de documento. Com `FISCAL_CTE_PROVIDER=acbr` e credenciais OAuth, `getAcbrProviderDecision` já força HTTP mesmo se `provider` do emitente for `SIMULATED` (`forced_by_env`); ainda assim configure emitente `ACBR` em produção para modelo mental e RBAC claros.
4. **Console ACBr** — filtrar **homologação** se o emitente estiver `HOMOLOGACAO`; filtro só “produção” esconde as chamadas.
5. **Preflight + `emit-cte`** — qualquer 400 antes de `authorizeCteWithProvider` significa **zero** `POST /cte` na ACBr.

---

### Task 1: Conferência de ambiente e injeção (Portainer/Docker Compose)

**Files:**

- Revisão: `docker-compose.yml` (serviço `api`), `server/.env.example`
- Opcional CI: manifests de deploy

- [ ] **Step:** Com variáveis já preenchidas no Portainer: **redeploy/restart** do serviço `api` e confirmar que nenhuma camada (stack pai vs serviço filho) sobrescreve ou omite `ACBR_*` / `FISCAL_*`.

- [ ] **Step:** Chamar como ADMIN `GET /api/fiscal-emitters/acbr-diagnostics` e validar `acbrCredentialsConfigured`, `effectiveAcbrBaseUrlHomologacao`, `effectiveAcbrBaseUrlProducao`, `s3Configured` (isso prova o que o **processo** vê, não só o formulário do Portainer).

### Task 2: Paridade HOMOLOGACAO — emitente fiscal

**Files:**

- `server/src/routes/fiscalEmitters.ts` (`trySyncAcbrEmitter`, POST/PATCH/create certificate)
- `server/src/services/acbr/acbrEmpresa.ts`

- [ ] **Step:** Criar emitente `provider: ACBR`, `environment: HOMOLOGACAO`, dados de pessoa CNPJ completos via UI Identidade Fiscal.

- [ ] **Step:** Verificar resposta `acbrSync` ou status `providerStatus`/`READY`; se `ERROR`, inspecionar `message` (empresa DUPLICADA tratada; outros erros são bloqueadores).

### Task 3: Certificado A1 na homologação

**Files:**

- `server/src/lib/objectStorage.ts`
- `server/src/routes/fiscalEmitters.ts` (POST `/:id/certificate`)
- `server/src/services/acbr/acbrEmpresa.ts` (`putAcbrEmpresaCertificado`)

- [ ] **Step:** Confirmar bucket/prefixo permissões e que `acbrCertificate` na resposta indica `{ ok: true }`.

### Task 4: CT-e ponta-a-ponta com HTTP real

**Files:**

- `server/src/services/cteService.ts` (`authorizeCteWithProvider`)
- `server/src/services/acbr/acbrCteEmit.ts`
- `server/src/services/fiscal/ctePreflight.ts`
- `server/src/routes/freightCalculations.ts` (`/:calcId/emit-cte`)
- Frontend: `components/admin/OrderFreightCalculationSection.tsx`

- [ ] **Step:** Pedido com NF-e 44 dígitos, CFOP/CST válidos catálogo, emitente fiscal vinculado ao cálculo, ambiente HOMOLOGACAO.

- [ ] **Step:** Emitir CT-e; validar payload resposta `fiscal.rawResponse.provider === 'acbr'` e aparecimento esperado em console ACBr (`POST /cte`, `GET /cte/...`).

### Task 5: Produção (`PRODUCAO`)

**Files:**

- `server/src/services/acbr/acbrConfig.ts` (hosts hom/prod)
- Modelo Prisma emitente (`server/prisma/schema.prisma`)

- [ ] **Step:** Emitentes separados ou mesmo CNPJ com ambiente prod no painel apenas após QA hom — evitar série/número conflituante (`getNextFiscalEmitterCteNumber` em `freightEmission.js`/`ts`).

- [ ] **Step:** Checklist jurídico/contábil CRT/CFOP/CST antes de habilitar `environment: PRODUCAO`.

### Task 6: DC-e

**Files:**

- `server/src/services/dceService.ts`
- `server/src/routes/freightCalculations.ts` (`emit-dce`)

- [ ] **Step:** Fluxo apenas quando política NF (`getFiscalDocModeForFreight`) permite DC-e; testar dados coleta commodity/notes.

### Task 7: Observabilidade e testes regressivos

**Files:**

- `server/src/services/acbr/acbrDiagnostics.ts`
- `server/src/services/acbr/acbrDiagnostics.test.ts`
- `server/src/services/cteService.test.ts`
- `server/src/routes/freightCalculations.test.ts`

- [ ] **Step:** Estender mensagens/log estruturado (sem dados sensível) onde útil quando `emitCteViaAcbr` falha antes do poll.

- [ ] **Step:** Rodar `npm test --prefix server -- src/services/cteService.test.ts` e pacote relacionado antes de merge.

---

## Definições de pronto (“done” para este épico operacional)

- Ambiente Portainer/docker reproduz checklist `CLAUDE.md` seção ACBr com credenciais reais sanitizadas.
- Emissões homologação geram registros perceptíveis no console ACBr (criação CT-e pelo menos uma vez bem-sucedida).
- Produção apenas com política escrita para troca CRT/série/certificado quando aplicável.
