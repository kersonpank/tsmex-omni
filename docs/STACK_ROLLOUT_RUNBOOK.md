# Runbook de Rollout — Staging e Produção

## Pré-check obrigatório

1. `docker network ls` contém `ProxyGM`.
2. Serviços existentes no Swarm:
   - `staging-tsmex-dev_api`, `staging-tsmex-dev_web`, `staging-tsmex-dev_migrate`
   - `prod-tsmex_api`, `prod-tsmex_web`, `prod-tsmex_migrate`
3. Variáveis conferidas no Portainer conforme [docs/STACK_ENV_MATRIX.md](docs/STACK_ENV_MATRIX.md).
4. MinIO bucket do ambiente criado e política da app aplicada.

## Onda 1 — Staging

1. Executar workflow `Deploy Staging`.
2. Confirmar no Swarm:
   - `staging-tsmex-dev_migrate` executou sem falha.
   - `staging-tsmex-dev_api` e `staging-tsmex-dev_web` em `Running`.
3. Smoke test funcional:
   - Login.
   - Abertura de Entrada.
   - Upload de anexo.
   - Listagem/download/remoção de anexo.
4. Monitorar logs 15 min:
   - `docker service logs staging-tsmex-dev_api --since 15m`
   - `docker service logs staging-tsmex-dev_web --since 15m`

## Onda 2 — Produção

1. Executar workflow `Deploy Production` com confirmação `DEPLOY`.
2. Confirmar no Swarm:
   - `prod-tsmex_migrate` sem falha.
   - `prod-tsmex_api` e `prod-tsmex_web` saudáveis.
3. Smoke essencial:
   - Login.
   - Consulta de pedidos.
   - Upload de evidência em pedido existente.
   - Download URL assinada.
4. Monitorar 30–60 min:
   - Erros 5xx no edge/proxy.
   - Logs de API.
   - Latência no upload/listagem.

## Rollback

### Falha antes da migração concluir

- Interromper rollout e manter serviços em imagem anterior.
- Corrigir env/stack e repetir.

### Falha após migração concluída

1. Fazer rollback de `api` e `web` para imagem anterior compatível.
2. Não tentar rollback de schema automaticamente.
3. Aplicar correção forward-only (nova migration) e redeploy.

## Critérios de aprovação final

- API e WEB com healthchecks estáveis.
- Sem erro crítico em `migrate`, `api` e `web`.
- Fluxo de anexos ponta a ponta validado em staging e produção.
