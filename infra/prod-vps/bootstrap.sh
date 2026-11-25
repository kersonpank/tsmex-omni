#!/usr/bin/env bash
# TSM EX OMNI — bootstrap da VPS de PRODUÇÃO (Ubuntu 22.04 / 24.04).
#
# Rode UMA vez, como root, na VPS recém-resetada. É idempotente: pode rodar de novo (inclusive para
# reconstruir o servidor do zero num desastre) sem estragar o que já está certo.
# Não pede nada no terminal: tudo vem de variáveis de ambiente. Não grava segredo nenhum.
#
#   export SSH_PUBKEY='ssh-ed25519 AAAA... github-actions-tsmex'      # chave do GitHub Actions (deploy)
#   export ADMIN_SSH_PUBKEY='ssh-ed25519 AAAA... fulano@escritorio'   # chave de quem administra
#   export PROD_DOMAIN=tsmex.com.br
#   export ACME_EMAIL=ti@seu-dominio.com.br
#   bash bootstrap.sh
#
# Variáveis (obrigatórias marcadas com *):
#   SSH_PUBKEY *         chave pública do usuário de deploy (a PRIVADA vai em GitHub secret VPS_SSH_KEY).
#                        Várias chaves: uma por linha.
#   ADMIN_SSH_PUBKEY *   chave pública do administrador (usuário com sudo). Obrigatória porque o login
#                        de root por SSH é desligado; sem ela o script aborta antes de trancar a porta.
#                        ALLOW_NO_ADMIN=1 ignora essa trava (só se você tem console do provedor).
#   DEPLOY_USER          padrão `deploy` (grupo docker, SEM sudo). É o VPS_USER do GitHub.
#   ADMIN_USER           padrão `admin` (sudo, sem senha: só chave).
#   PROD_DOMAIN          domínio público (ex.: tsmex.com.br). Usado pelo healthwatch e por DEPLOY_INFRA.
#   ACME_EMAIL           e-mail do Let's Encrypt (só para DEPLOY_INFRA=1).
#   PORTAINER_DOMAIN     padrão portainer.$PROD_DOMAIN.
#   DEPLOY_INFRA=1       também sobe o stack `infra` (Traefik + Portainer) ao final.
#   TZ                   padrão America/Sao_Paulo.
#   SSH_PORT             padrão 22 (o script NÃO muda a porta; só garante que ela está liberada no UFW).
#   SWAP_SIZE_MB         força o tamanho do swap (0 = não criar). Padrão: automático pela RAM.
#   AUTO_REBOOT          true|false (padrão true): reinício automático após atualização de kernel...
#   AUTO_REBOOT_TIME     ...sempre neste horário local (padrão 04:00), nunca em horário comercial.
#   SWARM_PEERS          IPs/CIDRs PRIVADOS de outros nós do Swarm (vírgula): libera 2377/7946/4789
#                        só para eles. Vazio = nenhuma porta do Swarm aberta (padrão, nó único).
#   ADVERTISE_ADDR       IP do `docker swarm init` (padrão: IP da rota padrão). Use o IP PRIVADO se
#                        houver rede privada entre os nós.
#   FAIL2BAN_IGNORE_IPS  IPs que nunca são banidos (ex.: IP fixo do escritório), separados por espaço.
#   SWARM_JOIN_TOKEN     ENTRAR num Swarm existente como NÓ EXTRA (worker) em vez de criar um novo.
#   SWARM_JOIN_ADDR      IP:2377 do manager (use o IP PRIVADO). Com os dois, este servidor vira worker:
#                        não rotula estado, não cria rede, não sobe infra; healthwatch só de disco/Docker.
#                        (docs/PRODUCAO_VPS.md, "Escalar").
#   INSTALL_HEALTHWATCH  1 (padrão) instala o timer do healthwatch.sh (se o arquivo estiver ao lado).
#   DOCKER_PKG_VERSION   fixa a versão do docker-ce (ex.: 5:29.1.0-1~ubuntu.24.04~noble). Vazio = última.
#   FORCE_OS=1           aceita outra distribuição (por sua conta).
set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE=/var/log/tsmex-bootstrap.log

DEPLOY_USER="${DEPLOY_USER:-deploy}"
ADMIN_USER="${ADMIN_USER:-admin}"
TZ="${TZ:-America/Sao_Paulo}"
SSH_PORT="${SSH_PORT:-22}"
AUTO_REBOOT="${AUTO_REBOOT:-true}"
AUTO_REBOOT_TIME="${AUTO_REBOOT_TIME:-04:00}"
SWARM_PEERS="${SWARM_PEERS:-}"
FAIL2BAN_IGNORE_IPS="${FAIL2BAN_IGNORE_IPS:-}"
INSTALL_HEALTHWATCH="${INSTALL_HEALTHWATCH:-1}"
DEPLOY_INFRA="${DEPLOY_INFRA:-0}"
SWARM_JOIN_TOKEN="${SWARM_JOIN_TOKEN:-}"
SWARM_JOIN_ADDR="${SWARM_JOIN_ADDR:-}"
NODE_ROLE="manager"
PROD_DOMAIN="${PROD_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
PORTAINER_DOMAIN="${PORTAINER_DOMAIN:-${PROD_DOMAIN:+portainer.$PROD_DOMAIN}}"
OVERLAY_NETWORK="ProxyGM"
STACK_INFRA_NAME="infra"
NODE_LABEL="tsmex.stateful=true"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l       # needrestart só lista; nunca reinicia o Docker no meio do expediente
export NEEDRESTART_SUSPEND=1

# --------------------------------------------------------------------------------------------
# utilidades
# --------------------------------------------------------------------------------------------
log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
warn() { printf '    \033[33maviso\033[0m  %s\n' "$*" >&2; }
die()  { printf '\n\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }

# Grava o conteúdo (stdin) em $1 só se for diferente. Retorna 0 se mudou, 1 se já estava igual.
write_if_changed() {
  local dest="$1" mode="${2:-0644}" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"; chmod "$mode" "$dest"; return 1
  fi
  install -D -m "$mode" "$tmp" "$dest"
  rm -f "$tmp"
  return 0
}

valid_pubkey() { printf '%s\n' "$1" | ssh-keygen -l -f /dev/stdin >/dev/null 2>&1; }

# Garante que cada chave de $2 (uma por linha) está em ~/.ssh/authorized_keys do usuário $1.
install_keys() {
  local user="$1" keys="$2" home line
  home="$(getent passwd "$user" | cut -d: -f6)"
  install -d -m 700 -o "$user" -g "$user" "$home/.ssh"
  touch "$home/.ssh/authorized_keys"
  while IFS= read -r line; do
    [ -n "${line// /}" ] || continue
    valid_pubkey "$line" || die "chave SSH inválida para $user: '${line:0:40}...' (precisa ser a chave PÚBLICA)"
    grep -qxF "$line" "$home/.ssh/authorized_keys" || printf '%s\n' "$line" >>"$home/.ssh/authorized_keys"
  done <<<"$keys"
  chown "$user:$user" "$home/.ssh/authorized_keys"
  chmod 600 "$home/.ssh/authorized_keys"
  [ -s "$home/.ssh/authorized_keys" ] || die "authorized_keys de $user ficou vazio"
}

ensure_user() {
  local user="$1" extra_groups="${2:-}"
  if ! id "$user" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash --comment "TSM EX ($user)" "$user"
    ok "usuário $user criado"
  fi
  passwd -l "$user" >/dev/null 2>&1 || true   # sem senha: só entra por chave
  if [ -n "$extra_groups" ]; then usermod -aG "$extra_groups" "$user"; fi
}

# --------------------------------------------------------------------------------------------
# 0. pré-condições
# --------------------------------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "rode como root (sudo -i)"
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
log "TSM EX — bootstrap da VPS de produção ($(date -Iseconds))"

# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  ubuntu:22.04|ubuntu:24.04) ok "Ubuntu $VERSION_ID ($VERSION_CODENAME)" ;;
  *) if [ "${FORCE_OS:-0}" = "1" ]; then warn "sistema ${PRETTY_NAME:-?} não testado (FORCE_OS=1)"; else die "suportado: Ubuntu 22.04 e 24.04 (encontrei ${PRETTY_NAME:-?}). FORCE_OS=1 para insistir"; fi ;;
esac
[ "${ID:-}" = "ubuntu" ] || die "FORCE_OS só vale para derivados com repositório Docker 'ubuntu'"
[ "$(uname -m)" = "x86_64" ] || warn "arquitetura $(uname -m): as imagens do CI são amd64"

[ -n "${SSH_PUBKEY:-}" ] || die "defina SSH_PUBKEY (chave PÚBLICA do usuário de deploy)"
if [ -z "${ADMIN_SSH_PUBKEY:-}" ] && [ "${ALLOW_NO_ADMIN:-0}" != "1" ]; then
  die "defina ADMIN_SSH_PUBKEY (chave pública de quem administra). O login de root por SSH será desligado; sem admin você ficaria sem acesso. ALLOW_NO_ADMIN=1 ignora."
fi
while IFS= read -r k; do [ -z "${k// /}" ] || valid_pubkey "$k" || die "SSH_PUBKEY inválida: '${k:0:40}...'"; done <<<"$SSH_PUBKEY"
if [ -n "${ADMIN_SSH_PUBKEY:-}" ]; then
  while IFS= read -r k; do [ -z "${k// /}" ] || valid_pubkey "$k" || die "ADMIN_SSH_PUBKEY inválida: '${k:0:40}...'"; done <<<"$ADMIN_SSH_PUBKEY"
fi
[ "$DEPLOY_USER" != "root" ] || die "DEPLOY_USER não pode ser root"
[ "$ADMIN_USER" != "root" ] || die "ADMIN_USER não pode ser root"
[ "$DEPLOY_USER" != "$ADMIN_USER" ] || die "DEPLOY_USER e ADMIN_USER precisam ser diferentes"
if [ -n "$SWARM_JOIN_TOKEN" ]; then
  [ -n "$SWARM_JOIN_ADDR" ] || die "SWARM_JOIN_TOKEN exige SWARM_JOIN_ADDR (IP:2377 do manager)"
  [ "$DEPLOY_INFRA" != "1" ] || die "DEPLOY_INFRA=1 não faz sentido num nó worker"
  NODE_ROLE="worker"
fi
if [ "$DEPLOY_INFRA" = "1" ]; then
  [ -n "$ACME_EMAIL" ] || die "DEPLOY_INFRA=1 exige ACME_EMAIL"
  [ -n "$PORTAINER_DOMAIN" ] || die "DEPLOY_INFRA=1 exige PROD_DOMAIN ou PORTAINER_DOMAIN"
  [ -f "$SELF_DIR/traefik-portainer.stack.yml" ] || die "traefik-portainer.stack.yml precisa estar ao lado do bootstrap.sh"
fi
[ -n "$PROD_DOMAIN" ] || warn "PROD_DOMAIN não definido: o healthwatch ficará sem URL (edite /etc/tsmex/healthwatch.env depois)"

# --------------------------------------------------------------------------------------------
# 1. pacotes base e atualizações
# --------------------------------------------------------------------------------------------
log "1/12 Atualizando o sistema e instalando pacotes base"
apt-get update -y
apt-get -o Dpkg::Options::=--force-confold -y upgrade
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release jq ufw fail2ban python3-systemd chrony unattended-upgrades \
  apt-transport-https cron openssl util-linux iproute2 procps rsync
ok "pacotes base"

# --------------------------------------------------------------------------------------------
# 2. fuso e relógio (certificado TLS, token JWT, Swarm e fiscal dependem de hora certa)
# --------------------------------------------------------------------------------------------
log "2/12 Fuso horário ($TZ) e chrony"
timedatectl set-timezone "$TZ"
systemctl enable --now chrony >/dev/null 2>&1 || systemctl enable --now chronyd >/dev/null 2>&1 || warn "chrony não iniciou"
timedatectl set-ntp true >/dev/null 2>&1 || true
ok "$(timedatectl show -p Timezone --value) — $(date '+%F %T %Z')"

# --------------------------------------------------------------------------------------------
# 3. atualizações automáticas de SEGURANÇA (reinício só de madrugada)
# --------------------------------------------------------------------------------------------
log "3/12 unattended-upgrades (só segurança; reinício às $AUTO_REBOOT_TIME)"
write_if_changed /etc/apt/apt.conf.d/20auto-upgrades <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
REBOOT_FLAG="false"; [ "$AUTO_REBOOT" = "true" ] && REBOOT_FLAG="true"
write_if_changed /etc/apt/apt.conf.d/51tsmex-unattended <<EOF || true
// Gerado por infra/prod-vps/bootstrap.sh — só repositórios de SEGURANÇA do Ubuntu.
#clear Unattended-Upgrade::Allowed-Origins;
Unattended-Upgrade::Allowed-Origins {
    "\${distro_id}:\${distro_codename}-security";
    "\${distro_id}ESMApps:\${distro_codename}-apps-security";
    "\${distro_id}ESM:\${distro_codename}-infra-security";
};
// O Docker vem do repositório próprio e é atualizado à mão, numa janela combinada.
Unattended-Upgrade::Package-Blacklist {
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
    "docker-buildx-plugin";
    "docker-compose-plugin";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
// Nó único: um reinício derruba a produção por 1-2 min. Nunca em horário comercial: o reinício
// pendente espera até a hora abaixo (America/Sao_Paulo) e só acontece se o kernel/libc exigir.
Unattended-Upgrade::Automatic-Reboot "$REBOOT_FLAG";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
Unattended-Upgrade::Automatic-Reboot-Time "$AUTO_REBOOT_TIME";
EOF
# needrestart: nunca reiniciar serviços sozinho (reiniciar o dockerd derruba todos os containers).
mkdir -p /etc/needrestart/conf.d
write_if_changed /etc/needrestart/conf.d/50-tsmex.conf <<'EOF' || true
$nrconf{restart} = 'l';
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
ok "atualizações de segurança automáticas; auto-reboot=$REBOOT_FLAG às $AUTO_REBOOT_TIME"

# --------------------------------------------------------------------------------------------
# 4. usuários e chaves (ainda sem mexer no sshd)
# --------------------------------------------------------------------------------------------
log "4/12 Usuários: $DEPLOY_USER (deploy, docker) e $ADMIN_USER (admin, sudo)"
ensure_user "$DEPLOY_USER"
install_keys "$DEPLOY_USER" "$SSH_PUBKEY"
if [ -n "${ADMIN_SSH_PUBKEY:-}" ]; then
  ensure_user "$ADMIN_USER" sudo
  install_keys "$ADMIN_USER" "$ADMIN_SSH_PUBKEY"
  write_if_changed "/etc/sudoers.d/90-tsmex-$ADMIN_USER" 0440 <<EOF || true
# Sem senha local (conta travada): a segurança é a chave SSH.
$ADMIN_USER ALL=(ALL) NOPASSWD:ALL
EOF
  visudo -cf "/etc/sudoers.d/90-tsmex-$ADMIN_USER" >/dev/null || { rm -f "/etc/sudoers.d/90-tsmex-$ADMIN_USER"; die "sudoers inválido"; }
fi
ok "usuários e chaves instalados"

# --------------------------------------------------------------------------------------------
# 5. swap
# --------------------------------------------------------------------------------------------
log "5/12 Swap"
RAM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
if [ -n "${SWAP_SIZE_MB:-}" ]; then WANT_SWAP="$SWAP_SIZE_MB"
elif [ "$RAM_MB" -le 2048 ]; then WANT_SWAP=$(( RAM_MB * 2 ))   # RAM pequena: 2x
else WANT_SWAP=4096                                              # acima: 4 GiB de colchão (swappiness baixo)
fi
if [ "$WANT_SWAP" -eq 0 ]; then
  ok "swap desativado por SWAP_SIZE_MB=0"
elif [ -n "$(swapon --show --noheadings 2>/dev/null)" ]; then
  ok "já existe swap ativo: $(swapon --show --noheadings | awk '{print $1" "$3}' | tr '\n' ';')"
else
  if [ ! -f /swapfile ]; then
    fallocate -l "${WANT_SWAP}M" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count="$WANT_SWAP" status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "swap de ${WANT_SWAP} MiB (RAM ${RAM_MB} MiB)"
fi

# --------------------------------------------------------------------------------------------
# 6. sysctl
# --------------------------------------------------------------------------------------------
log "6/12 sysctl"
write_if_changed /etc/sysctl.d/99-tsmex.conf <<'EOF' || true
# TSM EX produção — gerado por infra/prod-vps/bootstrap.sh
# Memória: usa swap só em último caso; Redis exige overcommit para o fork do AOF/RDB.
vm.swappiness = 10
vm.overcommit_memory = 1
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
# Rede
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_syncookies = 1
net.ipv4.ip_local_port_range = 10240 65000
# Overlay do Swarm (IPVS) descarta conexão ociosa após ~15 min: keepalive menor mantém as conexões
# do pool do Postgres/Redis vivas.
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
-net.netfilter.nf_conntrack_max = 262144
# Muitos containers/inotify
fs.inotify.max_user_instances = 512
fs.inotify.max_user_watches = 524288
fs.file-max = 2097152
EOF
sysctl --system >/dev/null 2>&1 || warn "sysctl --system retornou erro (algum parâmetro não existe neste kernel)"
ok "sysctl aplicado"

# journald com teto (log não pode encher o disco)
if write_if_changed /etc/systemd/journald.conf.d/tsmex.conf <<'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=1month
EOF
then systemctl restart systemd-journald || true; fi

# --------------------------------------------------------------------------------------------
# 7. Docker Engine (repositório oficial) + daemon.json
# --------------------------------------------------------------------------------------------
log "7/12 Docker Engine"
if ! command -v docker >/dev/null 2>&1 || ! dpkg -s docker-ce >/dev/null 2>&1; then
  for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg -s "$pkg" >/dev/null 2>&1; then apt-get remove -y "$pkg"; fi
  done
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"
  echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  if [ -n "${DOCKER_PKG_VERSION:-}" ]; then
    apt-get install -y docker-ce="$DOCKER_PKG_VERSION" docker-ce-cli="$DOCKER_PKG_VERSION" containerd.io docker-buildx-plugin docker-compose-plugin
  else
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi

# NÃO usar "live-restore": é incompatível com o modo Swarm.
DAEMON_WANT="$(jq -n '{
  "log-driver": "json-file",
  "log-opts": {"max-size": "20m", "max-file": "5"},
  "default-ulimits": {"nofile": {"Name": "nofile", "Hard": 65536, "Soft": 65536}}
}')"
if [ -s /etc/docker/daemon.json ]; then
  DAEMON_NEW="$(jq -S -s '.[0] * .[1]' /etc/docker/daemon.json <(printf '%s' "$DAEMON_WANT"))"
else
  DAEMON_NEW="$(printf '%s' "$DAEMON_WANT" | jq -S .)"
fi
mkdir -p /etc/docker
if printf '%s\n' "$DAEMON_NEW" | write_if_changed /etc/docker/daemon.json 0644; then
  if systemctl is-active --quiet docker && [ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null)" = "active" ]; then
    warn "daemon.json mudou com o Swarm ativo: reiniciando o Docker (derruba os containers por instantes)"
  fi
  systemctl restart docker
fi
systemctl enable --now docker containerd >/dev/null 2>&1
for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
docker info >/dev/null 2>&1 || die "o Docker não subiu"
usermod -aG docker "$DEPLOY_USER"
ok "Docker $(docker version --format '{{.Server.Version}}'), log-driver json-file 20m x 5"

# --------------------------------------------------------------------------------------------
# 8. UFW (ANTES do Swarm e do sshd)
# --------------------------------------------------------------------------------------------
log "8/12 Firewall (UFW): $SSH_PORT/tcp, 80/tcp, 443/tcp"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit "${SSH_PORT}/tcp" comment 'ssh' >/dev/null
ufw allow 80/tcp comment 'http (traefik)' >/dev/null
ufw allow 443/tcp comment 'https (traefik)' >/dev/null
if [ -n "$SWARM_PEERS" ]; then
  IFS=',' read -r -a PEERS <<<"$SWARM_PEERS"
  for peer in "${PEERS[@]}"; do
    peer="${peer// /}"; [ -n "$peer" ] || continue
    ufw allow from "$peer" to any port 2377 proto tcp comment 'swarm manager' >/dev/null
    ufw allow from "$peer" to any port 7946 proto tcp comment 'swarm gossip' >/dev/null
    ufw allow from "$peer" to any port 7946 proto udp comment 'swarm gossip' >/dev/null
    ufw allow from "$peer" to any port 4789 proto udp comment 'swarm overlay vxlan' >/dev/null
    ok "portas do Swarm abertas só para $peer"
  done
fi
ufw --force enable >/dev/null
ok "UFW ativo (Swarm 2377/7946/4789 fechadas para a internet)"
warn "O Docker publica portas por fora do UFW: NUNCA use 'ports:' num stack para Postgres/Redis/MinIO."

# --------------------------------------------------------------------------------------------
# 9. fail2ban
# --------------------------------------------------------------------------------------------
log "9/12 fail2ban"
write_if_changed /etc/fail2ban/jail.d/tsmex.local <<EOF || true
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 ${FAIL2BAN_IGNORE_IPS}
bantime = 1h
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 1w
findtime = 10m
maxretry = 4
backend = systemd

[sshd]
enabled = true
port = ${SSH_PORT}
mode = aggressive
EOF
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban
sleep 2
if fail2ban-client status sshd >/dev/null 2>&1; then
  ok "fail2ban: jail sshd ativo (4 falhas em 10 min = 1 h, dobrando a cada reincidência)"
else
  warn "jail sshd do fail2ban NÃO ficou ativo: confira 'fail2ban-client status' e 'journalctl -u fail2ban'"
fi

# --------------------------------------------------------------------------------------------
# 10. Swarm, rótulo do nó e redes
# --------------------------------------------------------------------------------------------
log "10/12 Docker Swarm"
SWARM_STATE="$(docker info --format '{{.Swarm.LocalNodeState}}')"
if [ "$SWARM_STATE" != "active" ]; then
  ADVERTISE_ADDR="${ADVERTISE_ADDR:-$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')}"
  [ -n "$ADVERTISE_ADDR" ] || die "não consegui detectar o IP; defina ADVERTISE_ADDR"
  if [ "$NODE_ROLE" = "worker" ]; then
    docker swarm join --token "$SWARM_JOIN_TOKEN" --advertise-addr "$ADVERTISE_ADDR" "$SWARM_JOIN_ADDR" >/dev/null
    ok "entrou no Swarm como worker (via $SWARM_JOIN_ADDR)"
  else
    docker swarm init --advertise-addr "$ADVERTISE_ADDR" >/dev/null
    ok "Swarm iniciado (manager em $ADVERTISE_ADDR)"
  fi
else
  ok "Swarm já ativo"
fi
if [ "$NODE_ROLE" = "manager" ]; then
  [ "$(docker info --format '{{.Swarm.ControlAvailable}}')" = "true" ] || die "este nó não é manager do Swarm"
  docker swarm update --task-history-limit 5 >/dev/null
  NODE_ID="$(docker info --format '{{.Swarm.NodeID}}')"
  docker node update --label-add "$NODE_LABEL" "$NODE_ID" >/dev/null
  ok "nó rotulado $NODE_LABEL (serviços com estado ficam presos a ele)"

  if ! docker network inspect "$OVERLAY_NETWORK" >/dev/null 2>&1; then
    docker network create --driver overlay --attachable "$OVERLAY_NETWORK" >/dev/null
    ok "rede overlay $OVERLAY_NETWORK criada"
  else
    ok "rede $OVERLAY_NETWORK já existe"
  fi
else
  ok "nó worker: rótulo de estado e redes ficam no manager (o Swarm propaga a rede ProxyGM ao agendar tarefas aqui)"
fi
# Segredos/configs do Swarm: os stacks de produção usam variáveis de ambiente (Portainer + GitHub),
# portanto nenhum `docker secret`/`docker config` é criado aqui.

# --------------------------------------------------------------------------------------------
# 11. diretórios, infra e healthwatch
# --------------------------------------------------------------------------------------------
log "11/12 Arquivos de infra, healthwatch e limpeza de imagens"
install -d -m 755 /opt/tsmex/infra
install -d -m 700 /etc/tsmex
install -d -m 700 /var/lib/tsmex/healthwatch
for f in traefik-portainer.stack.yml healthwatch.sh bootstrap.sh; do
  [ -f "$SELF_DIR/$f" ] && install -m 644 "$SELF_DIR/$f" "/opt/tsmex/infra/$f"
done

if [ "$INSTALL_HEALTHWATCH" = "1" ]; then
  if [ -f "$SELF_DIR/healthwatch.sh" ]; then
    install -m 750 -o root -g root "$SELF_DIR/healthwatch.sh" /usr/local/sbin/tsmex-healthwatch
    if [ ! -f /etc/tsmex/healthwatch.env ]; then
      umask 077
      cat >/etc/tsmex/healthwatch.env <<EOF
# Configuração do healthwatch (lida pelo systemd; só root). NÃO versionar.
PROD_DOMAIN=${PROD_DOMAIN}
STACK_PREFIX=tsmexomni-prod
# manager = todas as verificações; worker = só disco e Docker (nó extra do Swarm).
HEALTHWATCH_ROLE=${NODE_ROLE}
# Mesmos valores de OPS_ALERT_WEBHOOK_URL / OPS_ALERT_WEBHOOK_TOKEN do stack (n8n -> WhatsApp):
OPS_ALERT_WEBHOOK_URL=
OPS_ALERT_WEBHOOK_TOKEN=
OPS_ALERT_ENVIRONMENT=producao
# Opcional: URL de "ping de vida" (healthchecks.io ou n8n). Sem ela, uma VPS totalmente fora do ar
# não gera alerta — use também um monitor EXTERNO em https://${PROD_DOMAIN:-SEU-DOMINIO}/api/health.
HEARTBEAT_URL=
# Limiares (padrões entre parênteses):
# DISK_WARN_PCT=80  DISK_CRIT_PCT=90  FAIL_THRESHOLD=2  REALERT_MINUTES=60
# BACKUP_DB_MAX_AGE_MIN=180  BACKUP_OBJECTS_MAX_AGE_MIN=780  BACKUP_RESTORE_MAX_AGE_MIN=11520
EOF
      umask 022
      ok "criado /etc/tsmex/healthwatch.env (preencha OPS_ALERT_WEBHOOK_URL)"
    else
      ok "/etc/tsmex/healthwatch.env já existe (mantido)"
    fi
    write_if_changed /etc/systemd/system/tsmex-healthwatch.service <<'EOF' || true
[Unit]
Description=TSM EX healthwatch (saúde, disco, backup, réplicas do Swarm)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-/etc/tsmex/healthwatch.env
ExecStart=/usr/local/sbin/tsmex-healthwatch check
TimeoutStartSec=90
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/tsmex/healthwatch
EOF
    write_if_changed /etc/systemd/system/tsmex-healthwatch.timer <<'EOF' || true
[Unit]
Description=TSM EX healthwatch a cada 2 minutos

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now tsmex-healthwatch.timer >/dev/null 2>&1
    ok "timer tsmex-healthwatch ativo (a cada 2 min)"
  else
    warn "healthwatch.sh não está ao lado do bootstrap.sh: monitoramento NÃO instalado"
  fi
fi

# Limpeza semanal de imagens: cada deploy deixa uma tag sha-xxxxxxx; sem isto o disco enche em meses.
# `image prune -a` só remove imagem SEM container (nem parado) e com mais de 30 dias; NUNCA toca volumes.
write_if_changed /etc/systemd/system/tsmex-docker-prune.service <<'EOF' || true
[Unit]
Description=TSM EX: limpar imagens Docker antigas e sem uso (nunca volumes)
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker image prune --all --force --filter until=720h
ExecStart=/usr/bin/docker builder prune --force --filter until=168h
Nice=15
EOF
write_if_changed /etc/systemd/system/tsmex-docker-prune.timer <<'EOF' || true
[Unit]
Description=TSM EX: limpeza semanal de imagens Docker

[Timer]
OnCalendar=Sun *-*-* 03:30:00
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now tsmex-docker-prune.timer >/dev/null 2>&1
ok "timer tsmex-docker-prune ativo (domingo 03:30, só imagens antigas sem uso)"

# --------------------------------------------------------------------------------------------
# 12. SSH — por último (sshd -t antes, reload depois; a sessão atual continua aberta)
# --------------------------------------------------------------------------------------------
log "12/12 Endurecendo o SSH (sem senha, sem root)"
ALLOW_USERS="$DEPLOY_USER"
[ -n "${ADMIN_SSH_PUBKEY:-}" ] && ALLOW_USERS="$ALLOW_USERS $ADMIN_USER"
# O nome 00-* vence qualquer arquivo posterior (o sshd usa o PRIMEIRO valor visto), inclusive o
# 50-cloud-init.conf que muitos provedores deixam com "PasswordAuthentication yes".
write_if_changed /etc/ssh/sshd_config.d/00-tsmex-hardening.conf <<EOF || true
# Gerado por infra/prod-vps/bootstrap.sh
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
AllowUsers $ALLOW_USERS
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
grep -qE '^\s*Include\s+/etc/ssh/sshd_config.d/' /etc/ssh/sshd_config \
  || die "/etc/ssh/sshd_config sem 'Include sshd_config.d/*.conf': endurecimento não seria aplicado"
sshd -t || die "configuração do sshd inválida (nada foi recarregado)"
for u in $ALLOW_USERS; do
  [ -s "$(getent passwd "$u" | cut -d: -f6)/.ssh/authorized_keys" ] || die "sem chave para $u — abortando antes de trancar o SSH"
done
systemctl reload ssh 2>/dev/null || systemctl reload sshd
EFFECTIVE="$(sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|allowusers) ' | tr '\n' ';')"
ok "sshd: $EFFECTIVE"
warn "ANTES de fechar esta sessão, abra OUTRO terminal e teste: ssh $ADMIN_USER@<IP> e ssh $DEPLOY_USER@<IP>"

# --------------------------------------------------------------------------------------------
# opcional: stack infra (Traefik + Portainer)
# --------------------------------------------------------------------------------------------
if [ "$DEPLOY_INFRA" = "1" ]; then
  log "Subindo o stack '$STACK_INFRA_NAME' (Traefik + Portainer)"
  ACME_EMAIL="$ACME_EMAIL" PORTAINER_DOMAIN="$PORTAINER_DOMAIN" \
    PORTAINER_ALLOWED_CIDRS="${PORTAINER_ALLOWED_CIDRS:-0.0.0.0/0,::/0}" \
    docker stack deploy --detach=true -c "$SELF_DIR/traefik-portainer.stack.yml" "$STACK_INFRA_NAME"
  ok "stack $STACK_INFRA_NAME enviado ao Swarm (acompanhe: docker service ls)"
fi

log "Resumo"
printf '    Docker ........ %s\n' "$(docker version --format '{{.Server.Version}}')"
printf '    Swarm ......... %s (%s)\n' "$(docker info --format '{{.Swarm.LocalNodeState}}')" "$NODE_ROLE"
printf '    Rede .......... %s\n' "$(docker network ls --filter name="^${OVERLAY_NETWORK}\$" --format '{{.Name}} ({{.Driver}}/{{.Scope}})')"
printf '    UFW ........... %s\n' "$(ufw status | head -1)"
printf '    Swap .......... %s\n' "$(swapon --show --noheadings | awk '{print $1" "$3}' | tr '\n' ' ')"
printf '    Fuso .......... %s\n' "$(timedatectl show -p Timezone --value)"
cat <<EOF

Próximos passos (docs/PRODUCAO_VPS.md):
  1. Teste o login de $ADMIN_USER e de $DEPLOY_USER em outro terminal.
  2. Stack da infra (só no manager):  ACME_EMAIL=... PORTAINER_DOMAIN=... docker stack deploy -c /opt/tsmex/infra/traefik-portainer.stack.yml infra
  3. Preencha OPS_ALERT_WEBHOOK_URL em /etc/tsmex/healthwatch.env e teste: sudo tsmex-healthwatch test-alert
Log desta execução: $LOG_FILE
EOF
