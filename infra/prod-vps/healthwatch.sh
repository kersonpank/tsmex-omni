#!/usr/bin/env bash
# TSM EX OMNI — healthwatch: vigia a produção a partir do PRÓPRIO host, sem serviço pago.
#
#   tsmex-healthwatch check        roda todas as verificações (é o que o timer systemd chama)
#   tsmex-healthwatch test-alert   manda um alerta de teste ao webhook (ignora dedup)
#   tsmex-healthwatch status       mostra o que está em alerta agora
#
# Verificações (cada uma é um "alerta" com chave própria):
#   http        https://$PROD_DOMAIN/api/health  (200 = banco e worker ok; 503 = degradado)
#   cert        validade do certificado TLS (< CERT_WARN_DAYS dias)
#   disk_*      uso de disco e de inodes (WARN >= DISK_WARN_PCT, CRIT >= DISK_CRIT_PCT)
#   backup_*    frescor do último backup OK por tipo, lendo a tabela BackupRun (mesma fonte do
#               server/src/services/backup/backupFreshness.ts, mas com janelas MENORES: o app só
#               alerta com 26 h; aqui o banco alerta com 3 h, pois o backup é de hora em hora)
#   svc_*       réplicas do Swarm (atual < desejado) dos stacks $STACK_PREFIX e $INFRA_STACK
#   node_*      nós do Swarm fora de Ready
#   unhealthy   containers com healthcheck falhando
#   docker      daemon do Docker não responde
#
# Alerta = POST JSON no webhook do app (OPS_ALERT_WEBHOOK_URL / OPS_ALERT_WEBHOOK_TOKEN), mesmo formato de
# server/src/lib/opsAlert.ts: { environment, severity, source, title, detail, context,
# suppressedSinceLast, at, text }. Dedup:
#   - só alerta após FAIL_THRESHOLD execuções seguidas falhando (padrão 2 = ~4 min; evita ruído em deploy);
#   - repete o aviso a cada REALERT_MINUTES (padrão 60) enquanto persistir; subir de WARNING para CRITICAL
#     avisa na hora;
#   - quando volta ao normal manda UM aviso "RESOLVIDO".
# HEARTBEAT_URL (opcional): pinga a cada execução; um monitor externo (healthchecks.io gratuito, n8n)
# avisa se os pings PARAREM — é o que cobre "a VPS inteira caiu".
#
# Configuração: variáveis de ambiente (o systemd lê /etc/tsmex/healthwatch.env). Sem segredo no script.
set -uo pipefail

ENV_FILE="${HEALTHWATCH_ENV_FILE:-/etc/tsmex/healthwatch.env}"

# Carrega KEY=VALUE do arquivo sem `source` (URL com & ou ? não pode virar comando) e sem sobrescrever
# o que já veio no ambiente (o systemd já exportou).
load_env_file() {
  [ -r "$ENV_FILE" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    [ -n "${!key:-}" ] || export "$key=$val"
  done <"$ENV_FILE"
}
load_env_file

PROD_DOMAIN="${PROD_DOMAIN:-}"
STACK_PREFIX="${STACK_PREFIX:-tsmexomni-prod}"
HEALTHWATCH_ROLE="${HEALTHWATCH_ROLE:-manager}"   # manager | worker
INFRA_STACK="${INFRA_STACK:-infra}"
OPS_ALERT_WEBHOOK_URL="${OPS_ALERT_WEBHOOK_URL:-}"
OPS_ALERT_WEBHOOK_TOKEN="${OPS_ALERT_WEBHOOK_TOKEN:-}"
OPS_ALERT_ENVIRONMENT="${OPS_ALERT_ENVIRONMENT:-producao}"
HEARTBEAT_URL="${HEARTBEAT_URL:-}"
STATE_DIR="${HEALTHWATCH_STATE_DIR:-/var/lib/tsmex/healthwatch}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"
REALERT_MINUTES="${REALERT_MINUTES:-60}"
DISK_WARN_PCT="${DISK_WARN_PCT:-80}"
DISK_CRIT_PCT="${DISK_CRIT_PCT:-90}"
CERT_WARN_DAYS="${CERT_WARN_DAYS:-14}"
BACKUP_DB_MAX_AGE_MIN="${BACKUP_DB_MAX_AGE_MIN:-180}"            # intervalo do backup: 60 min
BACKUP_OBJECTS_MAX_AGE_MIN="${BACKUP_OBJECTS_MAX_AGE_MIN:-780}"  # intervalo: 360 min
BACKUP_RESTORE_MAX_AGE_MIN="${BACKUP_RESTORE_MAX_AGE_MIN:-11520}" # intervalo: 7 dias (+1 de folga)
BACKUP_FIRST_RUN_GRACE_MIN="${BACKUP_FIRST_RUN_GRACE_MIN:-120}"  # serviço de backup recém-criado
EXCLUDE_SERVICES_REGEX="${EXCLUDE_SERVICES_REGEX:-_migrate$}"    # o migrate roda e sai: 0/1 é normal
HOST_NAME="$(hostname -s 2>/dev/null || echo vps)"

mkdir -p "$STATE_DIR/state" 2>/dev/null || { echo "healthwatch: sem acesso a $STATE_DIR" >&2; exit 1; }
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log() { printf '%s healthwatch %s\n' "$(date -Iseconds)" "$*"; }

for bin in jq curl; do
  command -v "$bin" >/dev/null 2>&1 || { log "ERRO: '$bin' não instalado"; exit 1; }
done

# --------------------------------------------------------------------------------------------
# envio do alerta
# --------------------------------------------------------------------------------------------
# send_alert SEVERITY TITLE DETAIL KEY SUPPRESSED [tipo=alert|resolved]  -> 0 se o webhook aceitou
send_alert() {
  local severity="$1" title="$2" detail="$3" key="$4" suppressed="${5:-0}" kind="${6:-alert}"
  if [ -z "$OPS_ALERT_WEBHOOK_URL" ]; then
    log "SEM WEBHOOK (OPS_ALERT_WEBHOOK_URL vazio) — $severity: $title — $detail"
    return 1
  fi
  local icon="🟠"
  [ "$severity" = "CRITICAL" ] && icon="🔴"
  [ "$kind" = "resolved" ] && icon="🟢"
  local body
  body="$(jq -cn \
    --arg env "$OPS_ALERT_ENVIRONMENT" --arg sev "$severity" --arg title "$title" \
    --arg detail "${detail:0:2000}" --arg key "$key" --arg host "$HOST_NAME" \
    --argjson sup "$suppressed" --arg at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" --arg icon "$icon" \
    '{environment:$env, severity:$sev, source:"healthwatch", title:$title,
      detail:(if $detail == "" then null else $detail end),
      context:{host:$host, key:$key}, suppressedSinceLast:$sup, at:$at,
      text:("[" + $env + "] " + $icon + " " + $title + (if $detail == "" then "" else " — " + $detail[0:300] end))}')"
  local hdr="$TMP_DIR/hdr"
  : >"$hdr"; chmod 600 "$hdr"
  [ -n "$OPS_ALERT_WEBHOOK_TOKEN" ] && printf 'Authorization: Bearer %s\n' "$OPS_ALERT_WEBHOOK_TOKEN" >"$hdr"
  local code
  code="$(printf '%s' "$body" | curl -sS -m 10 --retry 2 --retry-delay 2 --retry-connrefused \
    -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "@$hdr" \
    --data-binary @- -- "$OPS_ALERT_WEBHOOK_URL" 2>/dev/null)" || code=000
  if [[ "$code" =~ ^2 ]]; then
    log "alerta enviado ($severity): $title"
    return 0
  fi
  log "FALHA ao enviar alerta (HTTP $code): $title"
  return 1
}

# --------------------------------------------------------------------------------------------
# estado de dedup por chave (arquivo key=valor; nunca executado)
# --------------------------------------------------------------------------------------------
state_file() { printf '%s/state/%s.state' "$STATE_DIR" "${1//[^A-Za-z0-9_.-]/_}"; }
state_get() {   # chave campo padrão
  local f v=""
  f="$(state_file "$1")"
  [ -f "$f" ] && v="$(sed -n "s/^$2=//p" "$f" | head -n1)"
  printf '%s' "${v:-$3}"
}
state_put() {   # chave fails alerting last suppressed severity title
  local f tmp
  f="$(state_file "$1")"; tmp="$f.tmp"
  printf 'fails=%s\nalerting=%s\nlast=%s\nsuppressed=%s\nseverity=%s\ntitle=%s\n' \
    "$2" "$3" "$4" "$5" "$6" "${7//$'\n'/ }" >"$tmp" && mv "$tmp" "$f"
}

# report CHAVE ok|fail SEVERIDADE LIMIAR TÍTULO [DETALHE]
report() {
  local key="$1" st="$2" sev="$3" thr="$4" title="$5" detail="${6:-}"
  local fails alerting last suppressed psev ptitle now need=0
  fails="$(state_get "$key" fails 0)"; alerting="$(state_get "$key" alerting 0)"
  last="$(state_get "$key" last 0)"; suppressed="$(state_get "$key" suppressed 0)"
  psev="$(state_get "$key" severity "")"; ptitle="$(state_get "$key" title "$title")"
  now="$(date +%s)"

  if [ "$st" = "ok" ]; then
    if [ "$alerting" = "1" ]; then
      if send_alert WARNING "RESOLVIDO: $ptitle" "voltou ao normal" "$key" 0 resolved; then
        rm -f "$(state_file "$key")"
      fi
    else
      rm -f "$(state_file "$key")"
    fi
    return 0
  fi

  fails=$(( fails + 1 ))
  if [ "$fails" -lt "$thr" ]; then
    state_put "$key" "$fails" "$alerting" "$last" "$suppressed" "$sev" "$title"
    return 0
  fi
  if [ "$alerting" != "1" ]; then need=1
  elif [ "$sev" != "$psev" ]; then need=1
  elif [ $(( now - last )) -ge $(( REALERT_MINUTES * 60 )) ]; then need=1
  else suppressed=$(( suppressed + 1 )); fi

  if [ "$need" = "1" ]; then
    if send_alert "$sev" "$title" "$detail" "$key" "$suppressed"; then
      alerting=1; last="$now"; suppressed=0
    fi
  fi
  state_put "$key" "$fails" "$alerting" "$last" "$suppressed" "$sev" "$title"
}

# --------------------------------------------------------------------------------------------
# verificações
# --------------------------------------------------------------------------------------------
check_http() {
  [ -n "$PROD_DOMAIN" ] || { log "PROD_DOMAIN vazio: pulando http/cert"; return 0; }
  local url="https://$PROD_DOMAIN/api/health" out="$TMP_DIR/health.json" code err
  err="$(curl -sS -m 10 -o "$out" -w '%{http_code}' "$url" 2>&1 >"$TMP_DIR/code")" || true
  code="$(cat "$TMP_DIR/code" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    report http ok CRITICAL "$FAIL_THRESHOLD" "API de produção fora do ar"
    return 0
  fi
  local detail="HTTP $code em $url"
  if [ "$code" = "503" ] && jq -e . "$out" >/dev/null 2>&1; then
    detail="$detail — banco=$(jq -r '.database' "$out") worker=$(jq -r '.worker' "$out")"
    report http fail CRITICAL "$FAIL_THRESHOLD" "API de produção degradada (banco ou worker)" "$detail"
  else
    [ -n "$err" ] && detail="$detail — ${err:0:200}"
    report http fail CRITICAL "$FAIL_THRESHOLD" "API de produção fora do ar" "$detail"
  fi
}

check_cert() {
  [ -n "$PROD_DOMAIN" ] && command -v openssl >/dev/null 2>&1 || return 0
  local end end_epoch days
  end="$(timeout 10 openssl s_client -servername "$PROD_DOMAIN" -connect "$PROD_DOMAIN:443" </dev/null 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"
  [ -n "$end" ] || return 0   # sem resposta: o check http já cobre
  end_epoch="$(date -d "$end" +%s 2>/dev/null)" || return 0
  days=$(( (end_epoch - $(date +%s)) / 86400 ))
  if [ "$days" -lt "$CERT_WARN_DAYS" ]; then
    report cert fail WARNING 1 "Certificado TLS de $PROD_DOMAIN vence em ${days} dia(s)" \
      "validade até $end. O Traefik renova sozinho aos 30 dias: confira 'docker service logs infra_traefik' e se a porta 443 está acessível"
  else
    report cert ok WARNING 1 "Certificado TLS"
  fi
}

check_disk() {
  local root seen="" path dev pct ipct key sev
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  for path in / "$root"; do
    [ -d "$path" ] || continue
    dev="$(df -P "$path" 2>/dev/null | awk 'NR==2{print $1}')"
    case " $seen " in *" $dev "*) continue ;; esac
    seen="$seen $dev"
    pct="$(df -P "$path" | awk 'NR==2{gsub("%","",$5); print $5}')"
    ipct="$(df -Pi "$path" | awk 'NR==2{gsub("%","",$5); print ($5 ~ /^[0-9]+$/ ? $5 : 0)}')"
    key="disk_${path//\//_}"
    sev=""
    if [ "$pct" -ge "$DISK_CRIT_PCT" ] || [ "$ipct" -ge "$DISK_CRIT_PCT" ]; then sev=CRITICAL
    elif [ "$pct" -ge "$DISK_WARN_PCT" ] || [ "$ipct" -ge "$DISK_WARN_PCT" ]; then sev=WARNING; fi
    if [ -n "$sev" ]; then
      report "$key" fail "$sev" 1 "Disco da VPS em ${pct}% ($path)" \
        "uso de espaço ${pct}%, inodes ${ipct}% em $path ($dev). Veja: docker system df; du -xh --max-depth=2 /var/lib/docker | sort -h | tail"
    else
      report "$key" ok WARNING 1 "Disco da VPS ($path)"
    fi
  done
}

service_age_min() {   # idade do serviço em minutos (vazio se não existir)
  local created epoch
  created="$(docker service inspect "$1" --format '{{.CreatedAt}}' 2>/dev/null | sed -E 's/\.[0-9]+//; s/ m=.*//; s/ UTC$//')" || return 0
  [ -n "$created" ] || return 0
  epoch="$(date -d "$created" +%s 2>/dev/null)" || return 0
  echo $(( ($(date +%s) - epoch) / 60 ))
}

check_backup() {
  local pg cid age_svc rows kind age lastok max sev title
  pg="${STACK_PREFIX}_postgres"
  cid="$(docker ps --filter "label=com.docker.swarm.service.name=$pg" --filter status=running --format '{{.ID}}' 2>/dev/null | head -n1)"
  if [ -z "$cid" ]; then log "postgres local não encontrado: pulando backup (svc_* cobre)"; return 0; fi
  age_svc="$(service_age_min "${STACK_PREFIX}_backup")"
  local sql
  sql='SELECT k.kind,
         COALESCE((EXTRACT(EPOCH FROM now() - (SELECT max("finishedAt") FROM "BackupRun" b WHERE b.kind::text = k.kind AND b.ok)) / 60)::bigint, -1),
         COALESCE((SELECT ok::text FROM "BackupRun" b WHERE b.kind::text = k.kind ORDER BY "finishedAt" DESC LIMIT 1), '"'"'none'"'"')
       FROM (VALUES ('"'"'DATABASE'"'"'), ('"'"'OBJECTS'"'"'), ('"'"'RESTORE_TEST'"'"')) AS k(kind)'
  if ! rows="$(timeout 20 docker exec "$cid" psql -U postgres -d tsmex -X -At -F'|' -c "$sql" 2>&1)"; then
    report backup_query fail WARNING "$FAIL_THRESHOLD" "Healthwatch não conseguiu ler BackupRun" "${rows:0:300}"
    return 0
  fi
  report backup_query ok WARNING 1 "Healthwatch lendo BackupRun"
  while IFS='|' read -r kind age lastok; do
    [ -n "$kind" ] || continue
    case "$kind" in
      DATABASE)     max="$BACKUP_DB_MAX_AGE_MIN";      sev=CRITICAL; title="Backup do banco atrasado" ;;
      OBJECTS)      max="$BACKUP_OBJECTS_MAX_AGE_MIN"; sev=CRITICAL; title="Cópia dos arquivos (MinIO) atrasada" ;;
      RESTORE_TEST) max="$BACKUP_RESTORE_MAX_AGE_MIN"; sev=WARNING;  title="Teste de restauração do backup atrasado ou falhando" ;;
      *) continue ;;
    esac
    if [ "$age" = "-1" ]; then
      # Sem nenhum sucesso registrado. Logo após o go-live é esperado (o teste de restauração só roda na 1ª hora).
      if [ -n "$age_svc" ] && [ "$age_svc" -lt "$BACKUP_FIRST_RUN_GRACE_MIN" ]; then
        report "backup_$kind" ok "$sev" 1 "$title"; continue
      fi
      report "backup_$kind" fail "$sev" "$FAIL_THRESHOLD" "$title" "nenhum backup $kind com sucesso registrado em BackupRun (última tentativa: $lastok). Veja: docker service logs ${STACK_PREFIX}_backup --tail 50"
    elif [ "$age" -gt "$max" ]; then
      report "backup_$kind" fail "$sev" "$FAIL_THRESHOLD" "$title" "último sucesso há $(( age / 60 )) h $(( age % 60 )) min (limite $(( max / 60 )) h; última tentativa ok=$lastok). Veja: docker service logs ${STACK_PREFIX}_backup --tail 50"
    elif [ "$kind" = "RESTORE_TEST" ] && [ "$lastok" = "false" ]; then
      report "backup_$kind" fail "$sev" 1 "$title" "a última restauração de teste FALHOU: o backup existe mas pode não voltar. Veja: docker service logs ${STACK_PREFIX}_backup --tail 80"
    else
      report "backup_$kind" ok "$sev" 1 "$title"
    fi
  done <<<"$rows"
}

check_swarm() {
  if ! timeout 15 docker info >/dev/null 2>&1; then
    report docker fail CRITICAL 1 "Docker não responde na VPS" "docker info falhou; confira: systemctl status docker"
    return 0
  fi
  report docker ok CRITICAL 1 "Docker não responde na VPS"

  local name status
  while IFS='|' read -r name status; do
    [ -n "$name" ] || continue
    if [ "$status" != "Ready" ]; then
      report "node_$name" fail CRITICAL "$FAIL_THRESHOLD" "Nó do Swarm $name fora de Ready ($status)" "docker node ls; no nó: systemctl status docker"
    else
      report "node_$name" ok CRITICAL 1 "Nó do Swarm $name"
    fi
  done < <(docker node ls --format '{{.Hostname}}|{{.Status}}' 2>/dev/null)

  local svc _mode reps cur want upd rep_field
  while IFS='|' read -r svc _mode reps; do
    [ -n "$svc" ] || continue
    case "$svc" in "${STACK_PREFIX}_"*|"${INFRA_STACK}_"*) ;; *) continue ;; esac
    if [[ -n "$EXCLUDE_SERVICES_REGEX" && "$svc" =~ $EXCLUDE_SERVICES_REGEX ]]; then continue; fi
    rep_field="${reps%% *}"; cur="${rep_field%/*}"; want="${rep_field#*/}"
    [[ "$cur" =~ ^[0-9]+$ && "$want" =~ ^[0-9]+$ ]] || continue
    # Deploy em andamento (docker service update): não conta como falha.
    upd="$(docker service inspect "$svc" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || true)"
    if [ "$cur" -lt "$want" ] && [ "$upd" != "updating" ]; then
      report "svc_$svc" fail CRITICAL "$FAIL_THRESHOLD" "Serviço $svc com $cur de $want réplicas" \
        "$(docker service ps "$svc" --no-trunc --filter desired-state=running --format '{{.Name}} {{.CurrentState}} {{.Error}}' 2>/dev/null | head -n 3 | tr '\n' ';')"
    else
      report "svc_$svc" ok CRITICAL 1 "Serviço $svc"
    fi
  done < <(docker service ls --format '{{.Name}}|{{.Mode}}|{{.Replicas}}' 2>/dev/null)

  # Serviços esperados que SUMIRAM (stack apagado por engano, por exemplo).
  local expected s
  for s in postgres redis minio api worker web backup; do expected="${STACK_PREFIX}_$s"
    if ! docker service inspect "$expected" >/dev/null 2>&1; then
      report "svc_$expected" fail CRITICAL "$FAIL_THRESHOLD" "Serviço $expected não existe no Swarm" "stack ${STACK_PREFIX} incompleto ou removido"
    fi
  done
  for s in traefik portainer; do expected="${INFRA_STACK}_$s"
    if ! docker service inspect "$expected" >/dev/null 2>&1; then
      report "svc_$expected" fail CRITICAL "$FAIL_THRESHOLD" "Serviço $expected não existe no Swarm" "stack ${INFRA_STACK} incompleto ou removido"
    fi
  done

  local bad
  bad="$(docker ps --filter health=unhealthy --format '{{.Names}}' 2>/dev/null | head -n 5 | tr '\n' ' ')"
  if [ -n "$bad" ]; then
    report unhealthy fail CRITICAL "$FAIL_THRESHOLD" "Container(es) unhealthy na VPS" "$bad"
  else
    report unhealthy ok CRITICAL 1 "Container(es) unhealthy na VPS"
  fi
}

cmd_status() {
  local f n=0
  for f in "$STATE_DIR"/state/*.state; do
    [ -e "$f" ] || continue
    n=$(( n + 1 ))
    printf '%s: ' "$(basename "$f" .state)"
    tr '\n' ' ' <"$f"; echo
  done
  [ "$n" -gt 0 ] || echo "nenhum alerta em andamento"
}

cmd_test_alert() {
  if send_alert CRITICAL "Teste do healthwatch (pode ignorar)" "alerta de teste disparado manualmente em $HOST_NAME" "healthwatch_test" 0; then
    echo "ok: o webhook aceitou o alerta de teste"
  else
    echo "FALHOU: confira OPS_ALERT_WEBHOOK_URL/TOKEN em $ENV_FILE" >&2
    return 1
  fi
}

cmd_check() {
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || { log "outra execução em andamento"; return 0; }
  if [ "$HEALTHWATCH_ROLE" = "worker" ]; then
    # Nó extra do Swarm: só vigia o próprio disco e o Docker (réplicas/nós/backup são do manager).
    if ! timeout 15 docker info >/dev/null 2>&1; then
      report docker fail CRITICAL 1 "Docker não responde no nó $HOST_NAME" "docker info falhou; confira: systemctl status docker"
    else
      report docker ok CRITICAL 1 "Docker não responde no nó $HOST_NAME"
    fi
    check_disk
  else
    check_swarm
    check_disk
    check_http
    check_cert
    check_backup
  fi
  # Ping de vida: prova que a VPS e o timer estão de pé (cobre "a máquina inteira caiu").
  if [ -n "$HEARTBEAT_URL" ]; then
    curl -fsS -m 10 --retry 2 -o /dev/null -- "$HEARTBEAT_URL" 2>/dev/null || log "heartbeat falhou"
  fi
}

case "${1:-check}" in
  check) cmd_check ;;
  test-alert) cmd_test_alert ;;
  status) cmd_status ;;
  *) echo "uso: tsmex-healthwatch check | test-alert | status" >&2; exit 2 ;;
esac
