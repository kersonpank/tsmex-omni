---
name: tsmex-acbr-api-definitivo
description: Fecha integração ACBr API no TSM EX OMNI (OAuth, empresa, certificado A1, CT-e/DC-e, homologação→produção). Use quando o console ACBr não mostrar requisições, emit-cte falhar, Portainer com env já OK, diagnóstico fiscal, sync emitente ou comparar implementação com a documentação oficial dev.acbr.api.br.
disable-model-invocation: true
---

# TSM EX — integração ACBr API (definitivo)

## Quando carregar esta skill

- CT-e (ou outro DF-e) não gera tráfego visível no console ACBr.
- Homologação precisa funcionar antes do corte para produção.
- Comparar o que o código faz versus o passo a passo da documentação pública ACBr API.

## Skill irmã

- Regras fiscais gerais (XML, preflight CFOP/CST, segurança): [tsmex-acbr-fiscal](../tsmex-acbr-fiscal/SKILL.md).

---

## Prompt de contexto produto (verbatim)

precisamos resolver a integração definitiva com o ACBr API. 

Basicamente, temos ja alguma coisa implementada, mas o fluxo nao funciona. 

ja configurei o certificado digital e nada de aparecer nenhuma requisição no console do ACBr API. 

Preciso que você entenda tudo o que temos e com clareza e objetividade descreva o passo a passo do que temos implementado. 
Entenda na Documentação o passo a passo necessario e compare o que temos para com a integração. Todos os env solicitados ja estão corretamente configurados no portainer. 
E então , crie um plano com clareza do que deve definitivamente ser implementado para funcionar perfeitamente em homologação para irmos para a produção . 

Segue links da URL da documentação do ACBRr API:
https://dev.acbr.api.br/docs/primeiros-passos
https://dev.acbr.api.br/docs/postman
https://dev.acbr.api.br/docs/autenticacao
https://dev.acbr.api.br/docs/empresas
https://dev.acbr.api.br/docs/limites
https://dev.acbr.api.br/docs/paginacao
https://dev.acbr.api.br/docs/servicos
https://dev.acbr.api.br/docs/cte
https://dev.acbr.api.br/docs/cteos
https://dev.acbr.api.br/docs/mdfe
https://dev.acbr.api.br/docs/dce
https://dev.acbr.api.br/docs/debug
http://dev.acbr.api.br/docs/cnpj
https://dev.acbr.api.br/docs/cep
https://dev.acbr.api.br/docs/cnpj-cnae
https://github.com/orgs/Projeto-ACBr-Oficial/repositories

 é valido tambem verificar projetos com essa api implementado

---

## O que o TSM já implementa (ordem de execução real)

1. **Gate HTTP vs simulação** — [`server/src/services/acbr/acbrConfig.ts`](server/src/services/acbr/acbrConfig.ts): `getAcbrProviderDecision` / `shouldUseAcbrHttp`. Se `FISCAL_CTE_PROVIDER` ou `FISCAL_PROVIDER` = `acbr` **e** existem `ACBR_CLIENT_ID` + `ACBR_CLIENT_SECRET`, `willUseAcbrHttp` é **true** mesmo com emitente `SIMULATED` (`reason: forced_by_env`). Sem credenciais com env forçando ACBr → `willUseAcbrHttp: false` (`missing_credentials`).
2. **OAuth2** — [`server/src/services/acbr/acbrAuth.ts`](server/src/services/acbr/acbrAuth.ts): `client_credentials` no token URL padrão Keycloak; escopos por chamada (`empresa`, `cte`, …).
3. **Base URL** — `getAcbrApiBaseUrlForEnvironment`: `HOMOLOGACAO` → `https://hom.acbr.api.br`, `PRODUCAO` → `https://prod.acbr.api.br` (independente de `ACBR_API_BASE_URL` quando o ambiente do emitente vem preenchido).
4. **Sync empresa + cert + config CT-e** — [`server/src/services/acbr/acbrEmpresa.ts`](server/src/services/acbr/acbrEmpresa.ts); gatilhos em [`server/src/routes/fiscalEmitters.ts`](server/src/routes/fiscalEmitters.ts) (`trySyncAcbrEmitter`, certificado).
5. **Emissão CT-e** — [`server/src/services/cteService.ts`](server/src/services/cteService.ts) → [`server/src/services/acbr/acbrCteEmit.ts`](server/src/services/acbr/acbrCteEmit.ts); rota [`server/src/routes/freightCalculations.ts`](server/src/routes/freightCalculations.ts) `emit-cte`.
6. **Bloqueio antes do HTTP** — [`server/src/services/fiscal/ctePreflight.ts`](server/src/services/fiscal/ctePreflight.ts): pendências → 400 e **nenhuma** chamada ACBr.
7. **Diagnóstico** — `GET /api/fiscal-emitters/acbr-diagnostics` + [`server/src/services/acbr/acbrDiagnostics.ts`](server/src/services/acbr/acbrDiagnostics.ts).

## Documentação oficial (resumo do que ela exige)

- **Token**: `POST` form-urlencoded para `https://auth.acbr.api.br/realms/ACBrAPI/protocol/openid-connect/token`; escopos incluem `cte`, `empresa`, `dce`, etc.
- **API**: hom `https://hom.acbr.api.br`, prod `https://prod.acbr.api.br`; header `Authorization: Bearer <access_token>`.
- **Empresa**: cadastro CNPJ, depois certificado A1 (Base64), depois configuração do serviço (ex.: CT-e CRT/ambiente) — ver [empresas](https://dev.acbr.api.br/docs/empresas) e tag OpenAPI em [referência API](https://dev.acbr.api.br/docs/api).
- **Postman / OpenAPI**: importar `https://prod.acbr.api.br/openapi/swagger.json` (homologação testar contra `hom.acbr.api.br` com mesmo fluxo de token, conforme [postman](https://dev.acbr.api.br/docs/postman)).
- **Cotas / erros**: `402` créditos, `429` rate limit — [limites](https://dev.acbr.api.br/docs/limites).

## Checklist “certificado OK mas console ACBr vazio”

1. **Restart** do container `api` após mudar env no Portainer.
2. **`acbr-diagnostics`**: `acbrCredentialsConfigured`, `s3Configured`, `fiscalSecretKeyConfigured`, `acbrHttpForcedByEnv`, `willUseAcbrHttpWithSimulatedEmitter` e `simulatedEmitterAcbrDecisionReason` no JSON (sem vazamento de segredo).
3. **`getAcbrProviderDecision`**: confirmar `willUseAcbrHttp` e `reason` (via diagnóstico ou log ao emitir).
4. **Ambiente do emitente** vs **filtro do console ACBr** (hom vs prod).
5. **UI**: preflight `canEmit` e POST `emit-cte` sem 400 — senão a requisição nunca chega no `POST /cte`.
6. **OAuth no painel**: token conta no realm; documento fiscal aparece como chamadas a `hom`/`prod`, não confundir as duas visões.

## Plano definitivo no repositório

Tarefas checkbox, arquivos e alinhamento doc ↔ código: [docs/superpowers/plans/2026-05-12-acbr-api-homologacao-producao.md](../../../docs/superpowers/plans/2026-05-12-acbr-api-homologacao-producao.md).

## Verificação rápida (local)

```bash
cd server && npm test -- src/services/acbr/acbrDiagnostics.test.ts src/services/cteService.test.ts src/services/fiscal/ctePreflight.test.ts
```

---

## Referência extra

- Links e notas de fetch: [reference-links.md](reference-links.md).
