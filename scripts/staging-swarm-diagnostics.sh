#!/usr/bin/env bash
# Diagnóstico staging Swarm (executar no manager com acesso ao cluster).
# Ajuste STACK se o nome da stack for diferente de staging-tsmex-dev.

set -euo pipefail

STACK="${STACK:-staging-tsmex-dev}"
API_SVC="${STACK}_api"
WEB_SVC="${STACK}_web"
NET="${STACK}_tsmex-staging-internal"

echo "=== 1) API: tasks, imagem declarada ==="
docker service ps "$API_SVC" --no-trunc || true
echo
docker service inspect "$API_SVC" --format 'Image spec: {{json .Spec.TaskTemplate.ContainerSpec.Image}}' || true
echo

echo "=== 2) API: container da task Running + digest + primeiras linhas de log ==="
API_CID="$(docker ps -q -f "name=${STACK}_api" | head -1)"
if [[ -z "${API_CID}" ]]; then
  echo "Nenhum container encontrado com filtro name=${STACK}_api. Liste com: docker ps -a | grep api"
else
  docker inspect "$API_CID" --format 'Image: {{.Config.Image}} ID: {{.Image}}' || true
  echo "--- logs (startup) ---"
  docker logs "$API_CID" 2>&1 | head -25
fi
echo

echo "=== 3) Web -> API: getent + wget (mesmo caminho do Nginx) ==="
WEB_CID="$(docker ps -q -f "name=${STACK}_web" | head -1)"
if [[ -z "${WEB_CID}" ]]; then
  echo "Nenhum container web encontrado com filtro name=${STACK}_web."
else
  docker exec "$WEB_CID" sh -c 'getent hosts api || true'
  docker exec "$WEB_CID" wget -S -O- "http://api:3002/health" 2>&1 || true
fi
echo

echo "=== 4) Rede overlay: web e api presentes ==="
docker network inspect "$NET" --format '{{json .Containers}}' 2>/dev/null | head -c 4000 || echo "Rede $NET não encontrada; ajuste NET (docker network ls | grep staging)."
echo

echo "=== 5) API na rede ProxyGM (Traefik -> /api direto) ==="
docker service inspect "$API_SVC" --format '{{json .Spec.TaskTemplate.Networks}}' 2>/dev/null | head -c 2000 || true
echo
docker service inspect "$API_SVC" --format '{{json .Spec.Labels}}' 2>/dev/null | head -c 2000 || true

echo
echo "Critério OK: Traefik com labels tsmex-staging-api; API anexada a ProxyGM; log da API com 0.0.0.0:3002."
echo "Login no browser usa https://.../api (Traefik), nao depende mais do Nginx web->api."
