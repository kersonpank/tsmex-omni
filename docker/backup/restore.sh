#!/usr/bin/env bash
# TSM EX — restauração do banco a partir do destino externo (procedimento manual, ver
# docs/PRODUCAO_GO_LIVE.md §Restauração).
#
#   restore.sh list                         lista os dumps disponíveis (hourly/daily/monthly)
#   restore.sh fetch <caminho-no-destino>   baixa e decifra para ./restore.dump
#   restore.sh into <DATABASE_URL-destino>  restaura ./restore.dump num banco VAZIO
#
# A chave privada age NUNCA fica no servidor: monte-a só durante a restauração
# (BACKUP_AGE_IDENTITY_FILE=/run/secrets/age.key) e remova depois.
set -Eeuo pipefail
REMOTE="${BACKUP_OFFSITE_REMOTE:-offsite}"
DEST="$REMOTE:${BACKUP_OFFSITE_BUCKET:?}/${BACKUP_OFFSITE_PREFIX:-tsmex-prod}"

case "${1:-}" in
  list)
    for tier in monthly daily hourly; do echo "== $tier"; rclone lsl "$DEST/postgres/$tier" | sort -k2,3 | tail -n 20; done ;;
  fetch)
    src="${2:?informe o caminho, ex.: postgres/daily/tsmex-2026-12-01.dump.age}"
    rclone copyto "$DEST/$src" ./restore.download
    if rclone lsf "$DEST/$src.sha256" >/dev/null 2>&1; then
      rclone cat "$DEST/$src.sha256" > ./restore.sha256 || true
      if [ -s ./restore.sha256 ]; then
        echo "$(cat ./restore.sha256)  ./restore.download" | sha256sum -c -
      fi
    fi
    case "$src" in
      *.age) age --decrypt --identity "${BACKUP_AGE_IDENTITY_FILE:?monte a chave privada age}" --output ./restore.dump ./restore.download ;;
      *) mv ./restore.download ./restore.dump ;;
    esac
    rm -f ./restore.download ./restore.sha256
    pg_restore --list ./restore.dump > ./restore.toc   # dump legível (sem pipe: pipefail + head = SIGPIPE)
    echo "ok: ./restore.dump ($(grep -c 'TABLE DATA' ./restore.toc) tabelas com dados)"
    rm -f ./restore.toc ;;
  into)
    target="${2:?informe a DATABASE_URL do banco vazio de destino}"
    target="${target%%\?*}"
    tables="$(psql "$target" -X -At -c "select count(*) from information_schema.tables where table_schema='public'")"
    if [ "$tables" != "0" ]; then echo "o banco de destino não está vazio ($tables tabelas) — recuso sobrescrever" >&2; exit 1; fi
    pg_restore --no-owner --no-acl --exit-on-error --dbname="$target" ./restore.dump
    psql "$target" -X -c 'select count(*) as pedidos from "Order"' -c 'select max(finished_at) as ultima_migracao from "_prisma_migrations"' ;;
  *) echo "uso: restore.sh list | fetch <caminho> | into <DATABASE_URL>" >&2; exit 2 ;;
esac
