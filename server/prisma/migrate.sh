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
  npx prisma migrate deploy
elif [ "$MODE" = "push" ]; then
  npx prisma db push --accept-data-loss
else
  echo "Invalid MIGRATE_MODE: $MODE"
  exit 1
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  npx tsx prisma/seed.ts
fi

if [ "${RUN_MIGRATE_PERSONS:-false}" = "true" ]; then
  npx tsx prisma/migrate-persons.ts
fi
