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
