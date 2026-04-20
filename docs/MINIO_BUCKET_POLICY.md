# Política MinIO — Buckets e Credenciais

## Estratégia por ambiente

- Buckets separados:
  - `tsmex-staging-uploads`
  - `tsmex-prod-uploads`
- Credenciais separadas por ambiente:
  - `minio_stg_app` (somente bucket staging)
  - `minio_prod_app` (somente bucket produção)

## Permissões mínimas da aplicação

Permitir somente operações necessárias:

- `s3:ListBucket` no bucket do ambiente.
- `s3:GetObject` nos objetos do bucket.
- `s3:PutObject` nos objetos do bucket.
- `s3:DeleteObject` nos objetos do bucket.

Negar acesso cruzado entre buckets de staging e produção.

## Regras operacionais

- Não usar usuário root do MinIO na API.
- Rotacionar `S3_SECRET_KEY` periodicamente.
- Habilitar versionamento de bucket se houver requisito de trilha forte.
- Configurar ciclo de vida para limpeza de objetos órfãos quando aplicável.

## Checklist de smoke (staging)

1. Console MinIO em `https://${MINIO_HOST}` com `MINIO_ROOT_*`.
2. Bucket do ambiente criado (`tsmex-staging-uploads` ou o valor de `S3_BUCKET`).
3. Access key da app (`S3_ACCESS_KEY` / `S3_SECRET_KEY`) com política mínima acima.
4. `curl -fsS https://<host-da-api>/api/health` (via Traefik, ex.: `tsm.mesquitagrupo.com.br`).
5. Na UI: login → Entrada → anexo sobe; objeto visível no bucket; download e remoção ok.
