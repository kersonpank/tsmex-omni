# Runbook de Rollout — Staging e Produção

## Pré-check obrigatório

1. `docker network ls` contém `ProxyGM`.
2. Serviços existentes no Swarm:
   - Staging: `staging-tsmex-dev_{postgres,redis,minio,migrate,api,web,worker}`
   - Produção: `tsmexomni-prod_{postgres,redis,minio,migrate,api,web,worker}`
3. Se o stack ainda não existir no Portainer, criá-lo **uma vez** seguindo [docs/VPS_SETUP.md](docs/VPS_SETUP.md) com o YAML (`docker-stack.staging.yml` ou `docker-stack.prod.yml`) do repositório. O CI **não** faz bootstrap — apenas atualiza imagens via `docker service update`.
4. Variáveis conferidas no Portainer conforme [docs/STACK_ENV_MATRIX.md](docs/STACK_ENV_MATRIX.md).
5. MinIO bucket do ambiente criado e política da app aplicada.

## Diagnóstico — Prisma P1001 (`Can't reach database server at postgres:5432`)

Use quando o CI ou `staging-tsmex-dev_migrate` falhar com erro de conectividade ao Postgres.

1. **Réplicas do Postgres** (no manager do Swarm):

   ```bash
   docker service ps staging-tsmex-dev_postgres --no-trunc
   ```

   Esperado: task em `Running` e serviço `1/1`.

2. **`DATABASE_URL` no Portainer** deve apontar para o **nome do serviço** do stack (`postgres`), não `localhost` nem host de outro stack. Formato alinhado à matriz: [docs/STACK_ENV_MATRIX.md](docs/STACK_ENV_MATRIX.md).

   Conferir env efetiva do migrate (mascarar senha ao copiar):

   ```bash
   docker service inspect staging-tsmex-dev_migrate --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .Name .Value}}{{end}}' | grep DATABASE_URL
   ```

3. **Teste de rede na mesma overlay** do stack (nome típico: `staging-tsmex-dev_tsmex-staging-internal`; confira com `docker network ls | grep staging-tsmex-dev`):

   ```bash
   NET=$(docker network ls --format '{{.Name}}' | grep '^staging-tsmex-dev_' | head -1)
   docker run --rm --network "$NET" alpine:3.20 sh -c "apk add -q netcat-openbsd && nc -zv postgres 5432"
   ```

   Se `nc` falhar, o problema é rede/DNS do Swarm ou o Postgres não está escutando — corrigir antes de reexecutar o workflow.

4. **Race no primeiro deploy**: o Swarm não garante ordem entre serviços. Com a imagem `tsmex-migrate` atualizada (espera TCP ao Postgres antes do Prisma), novos deploys tendem a estabilizar; após Postgres `1/1`, pode **Re-run** do job no GitHub Actions.

## Onda 1 — Staging

1. Executar workflow `Deploy Staging`.
   - Se os serviços não existirem, o workflow falha com mensagem apontando este runbook — criar o stack no Portainer antes de repetir.
2. Confirmar no Swarm:
   - `staging-tsmex-dev_migrate` executou sem falha.
   - `staging-tsmex-dev_api` e `staging-tsmex-dev_web` em `Running`.
3. Smoke test funcional:
   - **API**: `curl -fsS https://tsm.mesquitagrupo.com.br/api/health` (ajuste o host se usar outro domínio de staging).
   - **MinIO**: console em `https://${MINIO_HOST}` (login com `MINIO_ROOT_*`); confirmar bucket do ambiente (`tsmex-staging-uploads`) e objeto após upload.
   - **App**: login → Entrada → upload de anexo (`POST /api/upload` com JWT; corpo JSON base64 conforme [server/src/routes/upload.ts](../server/src/routes/upload.ts)) → listagem/download/remoção de anexo.
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
