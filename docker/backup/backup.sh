#!/usr/bin/env bash
# TSM EX — backup de produção.
#
#   backup.sh loop           serviço: banco a cada BACKUP_INTERVAL_MINUTES, arquivos a cada
#                            BACKUP_OBJECTS_INTERVAL_MINUTES, teste de restauração a cada
#                            BACKUP_RESTORE_TEST_INTERVAL_HOURS
#   backup.sh once           um backup do banco agora (usado antes de toda migração no deploy)
#   backup.sh db | objects | restore-test
#
# Destino externo: um remote do rclone chamado "offsite", configurado só por variáveis de ambiente
# (RCLONE_CONFIG_OFFSITE_TYPE=s3, ..._PROVIDER, ..._ENDPOINT, ..._ACCESS_KEY_ID, ..._SECRET_ACCESS_KEY,
# ..._REGION). Origem dos arquivos: remote "local" (o MinIO do stack). Ver docs/PRODUCAO_GO_LIVE.md.
#
# O dump sai cifrado com age para a chave PÚBLICA em BACKUP_AGE_RECIPIENT; a chave privada fica fora
# do servidor (cofre da empresa). Sem destinatário o backup recusa (fail-closed), a não ser com
# BACKUP_ALLOW_UNENCRYPTED=true.
set -Eeuo pipefail
# Falha dentro de $(...) também aborta o passo (sem isto o bash ignora o -e em substituições).
shopt -s inherit_errexit

STATE_DIR="${BACKUP_STATE_DIR:-/var/lib/tsmex-backup}"
TMP_DIR="$STATE_DIR/tmp"
BUCKET="${BACKUP_OFFSITE_BUCKET:?BACKUP_OFFSITE_BUCKET é obrigatório}"
PREFIX="${BACKUP_OFFSITE_PREFIX:-tsmex-prod}"
REMOTE="${BACKUP_OFFSITE_REMOTE:-offsite}"
DEST="$REMOTE:$BUCKET/$PREFIX"
PGURL="${DATABASE_URL:?DATABASE_URL é obrigatório}"
PGURL="${PGURL%%\?*}"   # libpq não aceita os parâmetros do Prisma (?schema=..., connection_limit=...)

mkdir -p "$TMP_DIR"

log() { printf '{"ts":"%s","level":"%s","type":"backup","msg":%s}\n' "$(date -Iseconds)" "$1" "$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"; }

alert() {
  local title="$1" detail="$2"
  [ -n "${OPS_ALERT_WEBHOOK_URL:-}" ] || return 0
  local auth=()
  [ -n "${OPS_ALERT_WEBHOOK_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${OPS_ALERT_WEBHOOK_TOKEN}")
  local text="[${OPS_ALERT_ENVIRONMENT:-producao}] 🔴 ${title} — ${detail:0:300}"
  curl -fsS -m 10 -X POST -H 'Content-Type: application/json' "${auth[@]}" \
    --data "$(printf '{"environment":"%s","severity":"CRITICAL","source":"backup","title":"%s","detail":"%s","text":"%s"}' \
      "${OPS_ALERT_ENVIRONMENT:-producao}" "$title" "${detail//\"/\'}" "${text//\"/\'}")" \
    "$OPS_ALERT_WEBHOOK_URL" >/dev/null || log warn "webhook de alerta falhou"
}

# Registra a execução na tabela BackupRun (variáveis do psql, sem interpolar texto no SQL).
record() {
  local kind="$1" ok="$2" started="$3" size="${4:-}" location="${5:-}" detail="${6:-}"
  psql "$PGURL" -X -q -v ON_ERROR_STOP=1 \
    -v kind="$kind" -v ok="$ok" -v started="$started" -v size="$size" -v loc="$location" -v detail="${detail:0:2000}" <<'SQL' || log error "não foi possível gravar BackupRun"
INSERT INTO "BackupRun" (id, kind, ok, "startedAt", "finishedAt", "sizeBytes", location, detail)
VALUES (gen_random_uuid()::text, :'kind'::"BackupKind", :'ok'::boolean, :'started'::timestamptz, now(),
        NULLIF(:'size', '')::bigint, NULLIF(:'loc', ''), NULLIF(:'detail', ''));
SQL
}

run_step() {
  # run_step KIND função — mede, registra sucesso/falha e alerta na falha.
  local kind="$1" fn="$2" started out rc
  started="$(date -Iseconds)"
  set +e
  out="$(set -e; "$fn" 2>&1)"
  rc=$?
  set -e
  if [ $rc -eq 0 ]; then
    # A função imprime "size|location" na última linha.
    local last size location
    last="$(printf '%s\n' "$out" | tail -n1)"
    size="${last%%|*}"; location="${last#*|}"
    record "$kind" true "$started" "$size" "$location" ""
    log info "$kind ok ($location, ${size:-?} bytes)"
  else
    local detail
    detail="$(printf '%s' "$out" | tail -n 5 | tr '\n' ' ')"
    record "$kind" false "$started" "" "" "$detail"
    log error "$kind falhou: $detail"
    alert "Backup $kind falhou" "$detail"
  fi
  return $rc
}

dump_database() {
  local ts file
  ts="$(date +%Y%m%dT%H%M%S)"
  file="$TMP_DIR/tsmex-$ts.dump"
  pg_dump --format=custom --compress=6 --no-owner --no-acl --file="$file" "$PGURL"
  pg_restore --list "$file" >/dev/null   # o arquivo é um dump válido
  cp "$file" "$TMP_DIR/latest.dump"      # base do teste de restauração (fica só no volume do serviço)

  local payload="$file" ext="dump"
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$file.age" "$file"
    payload="$file.age"; ext="dump.age"
  elif [ "${BACKUP_ALLOW_UNENCRYPTED:-false}" != "true" ]; then
    rm -f "$file"
    echo "BACKUP_AGE_RECIPIENT ausente: dump não enviado (defina a chave pública age ou BACKUP_ALLOW_UNENCRYPTED=true)" >&2
    return 1
  fi

  local size day month hourly daily monthly
  size="$(stat -c %s "$payload")"
  day="$(date +%Y-%m-%d)"; month="$(date +%Y-%m)"
  hourly="$DEST/postgres/hourly/tsmex-$ts.$ext"
  daily="$DEST/postgres/daily/tsmex-$day.$ext"
  monthly="$DEST/postgres/monthly/tsmex-$month.$ext"
  sha256sum "$payload" | awk '{print $1}' > "$payload.sha256"
  rclone copyto --s3-no-check-bucket "$payload" "$hourly"
  rclone copyto --s3-no-check-bucket "$payload.sha256" "$hourly.sha256"
  # Último do dia e primeiro do mês: cópias no próprio destino (sem reenviar).
  rclone copyto --s3-no-check-bucket "$hourly" "$daily"
  if ! rclone lsf "$monthly" >/dev/null 2>&1 || [ -z "$(rclone lsf "$monthly" 2>/dev/null)" ]; then
    rclone copyto --s3-no-check-bucket "$hourly" "$monthly"
  fi
  # Retenção: por hora 3 dias; diário 35 dias; mensal fica (guarda fiscal ≥ 5 anos — apagar só à mão).
  rclone delete --min-age "${BACKUP_HOURLY_RETENTION:-72h}" "$DEST/postgres/hourly" || true
  rclone delete --min-age "${BACKUP_DAILY_RETENTION:-35d}" "$DEST/postgres/daily" || true
  rm -f "$file" "$file.age" "$file.age.sha256" "$file.sha256"
  export_contingency "$ts"
  echo "$size|$hourly"
}

# Pacote de contingência (view contingency_open_work): pedidos e viagens em aberto com os documentos
# fiscais. Se o TSM cair, a operação reabre no sistema legado a partir dele — por isso sai junto com
# cada backup do banco, para FORA do servidor. Cifrado com a mesma chave (dado pessoal).
export_contingency() {
  local ts="$1" csv="$TMP_DIR/contingencia-$1.csv" payload ext="csv"
  psql "$PGURL" -X -q -v ON_ERROR_STOP=1 \
    -c "\copy (SELECT * FROM contingency_open_work ORDER BY pedido) TO '$csv' WITH (FORMAT csv, HEADER true, DELIMITER ';')"
  payload="$csv"
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$csv.age" "$csv"
    payload="$csv.age"; ext="csv.age"
  fi
  rclone copyto --s3-no-check-bucket "$payload" "$DEST/contingencia/latest.$ext"
  rclone copyto --s3-no-check-bucket "$payload" "$DEST/contingencia/historico/contingencia-$ts.$ext"
  rclone delete --min-age "${BACKUP_CONTINGENCY_RETENTION:-7d}" "$DEST/contingencia/historico" || true
  rm -f "$csv" "$csv.age"
}

mirror_objects() {
  local src="${BACKUP_OBJECTS_SOURCE:-local:${S3_BUCKET:?S3_BUCKET é obrigatório}}"
  local day
  day="$(date +%Y-%m-%d)"
  # sync com --backup-dir: o que foi apagado/sobrescrito na origem vai para objects-history/<dia>
  # em vez de sumir (XML fiscal e comprovante nunca se perdem por um delete na origem).
  rclone sync --s3-no-check-bucket --fast-list --checksum "$src" "$DEST/objects" --backup-dir "$DEST/objects-history/$day"
  local size
  size="$(rclone size --json "$DEST/objects" 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
  echo "${size:-}|$DEST/objects"
}

restore_test() {
  local dump="$TMP_DIR/latest.dump" db="tsmex_restore_check"
  [ -s "$dump" ] || dump_database >/dev/null
  local admin="${PGURL%/*}/postgres"
  psql "$admin" -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"
  local target="${PGURL%/*}/$db"
  pg_restore --no-owner --no-acl --exit-on-error --dbname="$target" "$dump"
  # Conferência: as tabelas que carregam a operação e o fiscal voltaram com linhas.
  local counts
  counts="$(psql "$target" -X -At -F= -c "SELECT 'Order', count(*) FROM \"Order\" UNION ALL SELECT 'Demand', count(*) FROM \"Demand\" UNION ALL SELECT 'OrderFreightCalculation', count(*) FROM \"OrderFreightCalculation\" UNION ALL SELECT 'Manifest', count(*) FROM \"Manifest\" UNION ALL SELECT 'ExternalFiscalDocument', count(*) FROM \"ExternalFiscalDocument\" UNION ALL SELECT '_prisma_migrations', count(*) FROM \"_prisma_migrations\"" | tr '\n' ' ')"
  psql "$admin" -X -q -c "DROP DATABASE IF EXISTS $db"
  case "$counts" in *"_prisma_migrations=0"*) echo "restauração sem histórico de migrações: $counts" >&2; return 1;; esac
  echo "$(stat -c %s "$dump")|restaurado: $counts"
}

due() {
  # due NOME MINUTOS — já passou o intervalo desde a última execução com sucesso?
  local stamp="$STATE_DIR/last-$1" minutes="$2" now last
  now="$(date +%s)"; last="$(cat "$stamp" 2>/dev/null || echo 0)"
  [ $(( now - last )) -ge $(( minutes * 60 )) ]
}
mark() { date +%s > "$STATE_DIR/last-$1"; }

loop() {
  local db_every="${BACKUP_INTERVAL_MINUTES:-60}"
  local obj_every="${BACKUP_OBJECTS_INTERVAL_MINUTES:-360}"
  local test_every=$(( ${BACKUP_RESTORE_TEST_INTERVAL_HOURS:-168} * 60 ))
  log info "serviço de backup iniciado (banco ${db_every}m, arquivos ${obj_every}m, restauração ${test_every}m) → $DEST"
  while true; do
    if due db "$db_every"; then run_step DATABASE dump_database && mark db || true; fi
    if due objects "$obj_every"; then run_step OBJECTS mirror_objects && mark objects || true; fi
    if due restore "$test_every"; then run_step RESTORE_TEST restore_test && mark restore || true; fi
    sleep 60
  done
}

case "${1:-loop}" in
  loop) loop ;;
  once|db) run_step DATABASE dump_database ;;
  objects) run_step OBJECTS mirror_objects ;;
  restore-test) run_step RESTORE_TEST restore_test ;;
  *) echo "uso: backup.sh loop|once|db|objects|restore-test" >&2; exit 2 ;;
esac
