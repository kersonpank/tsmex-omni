# Matriz de Variáveis — Staging e Produção

Use esta matriz no Portainer (Stack variables) para evitar drift e falha no startup.

## Variáveis obrigatórias para ambos ambientes

- `GITHUB_REPOSITORY`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `MINIO_HOST`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `S3_PUBLIC_BASE_URL`
- `S3_SIGNED_URL_PUBLIC_HOST` (recomendado, pode repetir o mesmo valor de `S3_PUBLIC_BASE_URL`)

## Variáveis para Integração Fiscal (ACBr API)

Estas variáveis habilitam e configuram a comunicação com os endpoints fiscais da ACBr API:

- `ACBR_CLIENT_ID` — Client ID do OAuth gerado no console da ACBr API.
- `ACBR_CLIENT_SECRET` — Client Secret correspondente obtido no console da ACBr API.
- `ACBR_TOKEN_URL` — (Opcional) Endpoint OAuth. Default: `https://auth.acbr.api.br/realms/ACBrAPI/protocol/openid-connect/token`
- `ACBR_API_BASE_URL` — (Opcional) Host base da API. Default: `https://hom.acbr.api.br`
- `ACBR_FALLBACK_CMUN` — (Opcional) Código IBGE padrão caso falhe a resolução automática de município.
- `FISCAL_CTE_PROVIDER` — Definir como `acbr` para forçar chamadas reais à API em vez do simulador.
- `FISCAL_PROVIDER` — Definir como `acbr` para uso fiscal geral.
- `FISCAL_SECRET_KEY` — Chave simétrica de criptografia usada para proteger a senha do certificado PFX do emitente no banco de dados.

> **`ACBR_CLIENT_ID`/`ACBR_CLIENT_SECRET` em staging**: além de configurados no painel "Environment
> variables" do Portainer, esses dois **também vivem como GitHub Secret** (`Settings → Secrets and
> variables → Actions`) e são reaplicados diretamente nos serviços `api`/`worker` via
> `docker service update --env-add` a cada deploy (`.github/workflows/staging.yml`). Isso existe
> porque o painel do Portainer não reaplica esses valores de forma confiável quando o stack inteiro
> é apagado e recriado (o build method usado é "Web editor" — a definição do compose é colada
> manualmente, e reaplicar as env vars digitadas exige uma ação de deploy específica que nem
> sempre acontece). Se o serviço `worker`/`api` aparecer com `ACBR_CLIENT_ID`/`SECRET` vazios
> mesmo com o painel do Portainer preenchido, rode o workflow "Deploy Staging" manualmente
> (`Actions → Deploy Staging → Run workflow`) — ele corrige sozinho, sem precisar mexer no
> Portainer. Para trocar o valor, atualize o GitHub Secret, não só o painel do Portainer.

## Variáveis opcionais (somente imagem `tsmex-migrate`)

- `POSTGRES_HOST` (default `postgres`) — host TCP usado pela espera antes do Prisma (deve bater com o hostname em `DATABASE_URL`).
- `POSTGRES_PORT` (default `5432`)
- `MIGRATE_MODE` — **`push`** para staging, **`deploy`** para produção.
  - `push` (`prisma db push`): sincroniza schema sem exigir histórico de migrations — ideal para staging onde o banco foi criado antes das migrations.
  - `deploy` (`prisma migrate deploy`): aplica migrations rastreadas — obrigatório em produção para zero downtime e rollback seguro.
  - Valor já fixo nos stack files: staging=`push`, prod=`deploy`. Não precisa definir no Portainer.

## Serviço `worker` (fila de emissão CT-e assíncrona)

O serviço `worker` roda a **mesma imagem** `tsmex-api` (`command: ["node", "dist/worker.js"]`),
consumindo a fila BullMQ `cte-emission` via Redis. Reutiliza todas as envs do serviço `api`
listadas acima (`DATABASE_URL`, `S3_*`, `ACBR_*`, `FISCAL_*`), **exceto**:

- `PORT`, `CORS_ORIGIN`, `JWT_SECRET`, `JWT_EXPIRES_IN` — o worker não sobe servidor HTTP
  nem autentica requisições, essas variáveis não são lidas por `server/src/worker.ts`.

Variável adicional:

- `REDIS_URL` — (Opcional) string de conexão do Redis usada pelo BullMQ.
  Default: `redis://redis:6379` (hostname do próprio serviço `redis` do stack — não precisa
  configurar no Portainer a menos que o Redis esteja fora do stack).

Se `api` já está configurado no Portainer, `worker` não exige nenhuma variável nova.

## Variáveis recomendadas com default

- `S3_REGION` (default `us-east-1`)
- `S3_FORCE_PATH_STYLE` (default `true`)
- `UPLOAD_MAX_SIZE_BYTES` (default `10485760`)
- `RUN_SEED` (default `false`)
- `RUN_MIGRATE_PERSONS` (default `false`)

## Exemplo — Staging

```env
GITHUB_REPOSITORY=kersonpank/tsmex-omni
POSTGRES_PASSWORD=senha_staging_forte
DATABASE_URL=postgresql://postgres:senha_staging_forte@postgres:5432/tsmex?schema=public
JWT_SECRET=jwt_staging_bem_longo
JWT_EXPIRES_IN=7d

MINIO_ROOT_USER=minio_stg_admin
MINIO_ROOT_PASSWORD=minio_stg_admin_senha_forte
MINIO_HOST=minio-stg.seu-dominio.com

S3_ENDPOINT=https://minio-stg.seu-dominio.com
S3_ACCESS_KEY=minio_stg_app
S3_SECRET_KEY=minio_stg_app_senha_forte
S3_BUCKET=tsmex-staging-uploads
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_BASE_URL=https://minio-stg.seu-dominio.com
S3_SIGNED_URL_PUBLIC_HOST=https://minio-stg.seu-dominio.com
UPLOAD_MAX_SIZE_BYTES=10485760

RUN_SEED=false
RUN_MIGRATE_PERSONS=false
```

## Exemplo — Produção

```env
GITHUB_REPOSITORY=kersonpank/tsmex-omni
POSTGRES_PASSWORD=senha_prod_muito_forte
DATABASE_URL=postgresql://postgres:senha_prod_muito_forte@postgres:5432/tsmex?schema=public
JWT_SECRET=jwt_producao_bem_longo_diferente_do_staging
JWT_EXPIRES_IN=7d

MINIO_ROOT_USER=minio_prod_admin
MINIO_ROOT_PASSWORD=minio_prod_admin_senha_forte
MINIO_HOST=minio.seu-dominio.com

S3_ENDPOINT=https://minio.seu-dominio.com
S3_ACCESS_KEY=minio_prod_app
S3_SECRET_KEY=minio_prod_app_senha_forte
S3_BUCKET=tsmex-prod-uploads
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_BASE_URL=https://minio.seu-dominio.com
S3_SIGNED_URL_PUBLIC_HOST=https://minio.seu-dominio.com
UPLOAD_MAX_SIZE_BYTES=10485760

RUN_SEED=false
RUN_MIGRATE_PERSONS=false
```

## Regras de segurança

- Nunca reutilizar `JWT_SECRET`, `S3_ACCESS_KEY` ou `S3_SECRET_KEY` entre ambientes.
- Nunca usar credenciais de admin MinIO (`MINIO_ROOT_*`) na aplicação.
- `S3_ENDPOINT` deve ser o domínio HTTPS público (não usar porta interna quando há proxy).
- Para assinatura estável no browser, `S3_SIGNED_URL_PUBLIC_HOST` deve apontar para host HTTPS público do MinIO.

