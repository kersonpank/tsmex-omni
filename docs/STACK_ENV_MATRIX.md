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
UPLOAD_MAX_SIZE_BYTES=10485760

RUN_SEED=false
RUN_MIGRATE_PERSONS=false
```

## Regras de segurança

- Nunca reutilizar `JWT_SECRET`, `S3_ACCESS_KEY` ou `S3_SECRET_KEY` entre ambientes.
- Nunca usar credenciais de admin MinIO (`MINIO_ROOT_*`) na aplicação.
- `S3_ENDPOINT` deve ser o domínio HTTPS público (não usar porta interna quando há proxy).

