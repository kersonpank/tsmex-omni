# Runbook de Rollout — Staging e Produção

## Pré-check obrigatório

1. `docker network ls` contém `ProxyGM`.
2. Serviços existentes no Swarm:
   - Staging: `staging-tsmex-dev_{postgres,redis,minio,migrate,api,web}`
   - Produção: `tsmexomni-prod_{postgres,redis,minio,migrate,api,web}`
3. Se o stack ainda não existir no Portainer, criá-lo **uma vez** seguindo [docs/VPS_SETUP.md](docs/VPS_SETUP.md) com o YAML (`docker-stack.staging.yml` ou `docker-stack.prod.yml`) do repositório. O CI **não** faz bootstrap — apenas atualiza imagens via `docker service update`.
4. Variáveis conferidas no Portainer conforme [docs/STACK_ENV_MATRIX.md](docs/STACK_ENV_MATRIX.md).
5. MinIO bucket do ambiente criado e política da app aplicada.

## Onda 1 — Staging

1. Executar workflow `Deploy Staging`.
   - Se os serviços não existirem, o workflow falha com mensagem apontando este runbook — criar o stack no Portainer antes de repetir.
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
   - `tsmexomni-prod_migrate` sem falha.
   - `tsmexomni-prod_api` e `tsmexomni-prod_web` saudáveis.
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
