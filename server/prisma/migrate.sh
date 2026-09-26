#!/bin/sh
set -e

PG_HOST=${POSTGRES_HOST:-postgres}
PG_PORT=${POSTGRES_PORT:-5432}

echo "Aguardando Postgres em $PG_HOST:$PG_PORT..."
i=1
while [ "$i" -le 90 ]; do
  if nc -z "$PG_HOST" "$PG_PORT" 2>/dev/null; then
    echo "Postgres aceitando conexões."
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "Timeout aguardando Postgres em $PG_HOST:$PG_PORT"
    exit 1
  fi
  i=$((i + 1))
  sleep 2
done

MODE=${MIGRATE_MODE:-deploy}
if [ "$MODE" = "deploy" ]; then
  node --import tsx prisma/report-pre-migration.ts
  npx prisma migrate deploy
  # Auditoria somente leitura do responsável RNTRC por unidade (não bloqueia o deploy).
  node --import tsx prisma/report-rntrc-holders.ts || echo "Aviso: relatório RNTRC não pôde ser gerado."
elif [ "$MODE" = "reset" ]; then
  # PERIGO: apaga TODOS os dados e recria o schema do zero.
  # Usar APENAS em staging/dev quando o DB esta sujo (ex: veio de db push sem historico).
  # NUNCA usar em producao.
  echo "⚠️  MIGRATE_MODE=reset: apagando schema e reaplicando todas as migrações..."
  npx prisma migrate reset --force --skip-seed
  echo "✅ Reset concluído. Troque MIGRATE_MODE para deploy no proximo deploy."
elif [ "$MODE" = "push" ]; then
  # LEGADO/dev apenas. Nao usar em staging/prod.
  npx prisma db push --accept-data-loss
else
  echo "Invalid MIGRATE_MODE: $MODE (validos: deploy | reset | push)"
  exit 1
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  npx tsx prisma/seed.ts
fi

if [ "${RUN_MIGRATE_PERSONS:-false}" = "true" ]; then
  npx tsx prisma/migrate-persons.ts
fi
