# Produção na VPS dedicada — runbook do dono

Passo a passo para colocar o TSM EX em **uma VPS nova, dedicada à produção**, e para operá-la, escalá-la e
reconstruí-la. Complementa o [PRODUCAO_GO_LIVE.md](PRODUCAO_GO_LIVE.md) (regras fiscais, backup, convivência
com o legado) e a [STACK_ENV_MATRIX.md](STACK_ENV_MATRIX.md) (variáveis).

**Princípios (valem para sempre):**

1. **Nada é desenvolvido na VPS.** Só entra *release*: o GitHub Actions (`Deploy Production`, só da `main`,
   com aprovação) constrói as imagens e atualiza os serviços. Ninguém dá `git pull`, `npm install` ou edita
   arquivo de aplicação lá.
2. **A VPS é descartável; os dados não.** Tudo que importa está em: repositório (código e stack),
   cofre da empresa (segredos), GitHub Environment `production` (segredos de deploy) e o **destino externo
   de backup** (outro provedor). Reconstruir do zero é um procedimento, não uma emergência (§8).
3. **Os dados chegam organizados:** a carga do legado é validada no staging primeiro e só então repetida em
   produção (§4.10). Nunca se copia o banco do staging para a produção.

## 0. Mapa dos arquivos

| Arquivo | Para quê |
|---|---|
| `infra/prod-vps/bootstrap.sh` | Prepara a VPS do zero (SO, SSH, firewall, Docker, Swarm, rede). Idempotente |
| `infra/prod-vps/traefik-portainer.stack.yml` | Stack `infra`: Traefik v3 (HTTPS, Let's Encrypt) + Portainer CE + agente |
| `infra/prod-vps/healthwatch.sh` | Vigia no host: API, disco, backup, réplicas do Swarm; alerta no webhook do app |
| `docker-stack.prod.yml` | Stack `tsmexomni-prod` (a aplicação), criado no Portainer |
| `.github/workflows/production.yml` | Deploy de release (manual, `main`, com aprovação) |
| `.github/workflows/legacy-migration.yml` | Carga do legado dentro da infra (§4.9) |
| `docker/backup/` | Serviço de backup e `restore.sh` |

## 1. O que você decide antes de começar

| Decisão | Quem decide | Observação |
|---|---|---|
| Provedor e tamanho da VPS | Dono | Mínimo 4 vCPU, 8 GB RAM, 160 GB SSD, Ubuntu 22.04 ou 24.04 LTS, snapshot diário ligado, **IPv4 fixo**. Os limites de memória do stack foram dimensionados para 8 GB (ver §7) |
| Domínio de produção (`PROD_DOMAIN`) | Dono | Padrão `tsmex.com.br`. Se o domínio ainda aponta para outro lugar, comece com `prod.tsmex.com.br` e troque na virada (§4.10) |
| Destino externo de backup | Dono (contrata) | S3 de **outro provedor**, com versionamento. É o que salva a empresa se a VPS ou a conta do provedor sumirem |
| Quem recebe os alertas | Dono | Webhook do n8n que manda WhatsApp/e-mail do plantão (`OPS_ALERT_WEBHOOK_URL`) |
| IP fixo do escritório | TI | Restringe o acesso ao Portainer (`PORTAINER_ALLOWED_CIDRS`) e evita auto-banimento no fail2ban |
| Série fiscal do TSM | Contabilidade | Ver GO_LIVE §6 |

## 2. DNS

Crie estes registros **antes** do bootstrap (TTL **300** segundos: agiliza a virada e a recuperação):

| Tipo | Nome | Valor | Para quê |
|---|---|---|---|
| A | `tsmex.com.br` (ou o `PROD_DOMAIN`) | IP da VPS | Aplicação (web e `/api`) |
| A | `minio.tsmex.com.br` | IP da VPS | `MINIO_HOST`: URLs assinadas de upload/download |
| A | `portainer.tsmex.com.br` | IP da VPS | Painel do Portainer |
| CAA (opcional) | `tsmex.com.br` | `0 issue "letsencrypt.org"` | Só o Let's Encrypt pode emitir certificado |

- **Não crie registro AAAA** (IPv6), a menos que você tenha configurado IPv6 na VPS e no firewall.
- O Let's Encrypt só emite o certificado se o nome já aponta para a VPS **no momento** do primeiro acesso.
- Se o apex ainda é de outro sistema, aponte só `minio.` e `portainer.` agora e use `PROD_DOMAIN=prod.tsmex.com.br`
  até a virada.

## 3. Ordem exata (resumo)

1. DNS (§2) → 2. `bootstrap.sh` (§4.1) → 3. testar o acesso SSH (§4.2) → 4. stack `infra` (§4.3) →
5. Portainer: admin e registry (§4.4) → 6. segredos no GitHub (§4.5) → 7. primeira execução do `Deploy Production`
(§4.6) → 8. criar o stack `tsmexomni-prod` no Portainer (§4.7) → 9. usuário do MinIO (§4.8) →
10. segunda execução do deploy (§4.9) → 11. dados do legado (§4.10) → 12. checagens de go-live (§4.11).

## 4. Passo a passo

### 4.1 Bootstrap da VPS

No seu computador, gere as duas chaves SSH (a de deploy **não** tem senha porque é de máquina):

```bash
ssh-keygen -t ed25519 -C "github-actions-tsmex-prod" -f ./gh_actions_prod -N ""   # deploy (GitHub)
cat ./gh_actions_prod.pub                                                          # -> SSH_PUBKEY
cat ~/.ssh/id_ed25519.pub                                                          # -> ADMIN_SSH_PUBKEY (a sua)
```

Copie `infra/prod-vps/` para a VPS e rode como root (o provedor entrega acesso root no primeiro login):

```bash
scp -r infra/prod-vps root@IP_DA_VPS:/root/
ssh root@IP_DA_VPS
cd /root/prod-vps
export SSH_PUBKEY='ssh-ed25519 AAAA... github-actions-tsmex-prod'
export ADMIN_SSH_PUBKEY='ssh-ed25519 AAAA... voce@escritorio'
export PROD_DOMAIN=tsmex.com.br
export ACME_EMAIL=ti@seu-dominio.com.br
export FAIL2BAN_IGNORE_IPS='IP.FIXO.DO.ESCRITORIO'   # opcional
bash bootstrap.sh
```

O que o script faz: atualiza o sistema; liga só as atualizações de **segurança** (reinício automático, se o
kernel pedir, **às 04:00** de Brasília, nunca em horário comercial); fuso `America/Sao_Paulo` e `chrony`;
cria `deploy` (grupo `docker`, **sem** sudo, só chave) e `admin` (sudo, só chave); swap pelo tamanho da RAM;
`sysctl`; Docker Engine do repositório oficial com rotação de log (20 MB × 5); **UFW** liberando só
`22`, `80` e `443`; fail2ban; `docker swarm init`; rótulo `tsmex.stateful=true` no nó; rede overlay
`ProxyGM`; timers do `healthwatch` e da limpeza semanal de imagens; e por **último** desliga login de root e
senha no SSH. Não grava nenhum segredo. Log: `/var/log/tsmex-bootstrap.log`.

Para já subir o Traefik e o Portainer na mesma rodada, acrescente `DEPLOY_INFRA=1`.

### 4.2 Teste o acesso ANTES de fechar o terminal do root

Em **outro terminal**:

```bash
ssh admin@IP_DA_VPS 'sudo -n true && echo admin-ok'
ssh -i ./gh_actions_prod deploy@IP_DA_VPS 'docker ps >/dev/null && echo deploy-ok'
ssh root@IP_DA_VPS          # deve ser RECUSADO (Permission denied)
```

Só depois disso feche a sessão de root. Apague `./gh_actions_prod` do seu computador assim que colocar a chave
privada no GitHub (§4.5) e uma cópia no cofre.

### 4.3 Traefik + Portainer (stack `infra`)

Se não usou `DEPLOY_INFRA=1`:

```bash
ssh admin@IP_DA_VPS
export ACME_EMAIL=ti@seu-dominio.com.br
export PORTAINER_DOMAIN=portainer.tsmex.com.br
export PORTAINER_ALLOWED_CIDRS='IP.FIXO.DO.ESCRITORIO/32'     # recomendado; sem isto, qualquer IP chega ao login
sudo -E docker stack deploy -c /opt/tsmex/infra/traefik-portainer.stack.yml infra
docker service ls          # infra_traefik 1/1, infra_portainer 1/1, infra_agent 1/1
```

Decisões do stack: **Traefik v3.7.20** e **Portainer CE/agent 2.39.9 (LTS)**, versões exatas; portas 80/443 em
modo `host` (preserva o IP real do cliente); redireciona HTTP→HTTPS; Let's Encrypt por TLS-ALPN no
resolver `letsencryptresolver`; cabeçalhos de segurança (HSTS 1 ano, `nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy`, `Permissions-Policy`) em toda resposta HTTPS; *access log* JSON sem cabeçalhos; painel do
Traefik **desligado**. Ensaiando sem gastar o limite do Let's Encrypt: `export ACME_CASERVER=https://acme-staging-v02.api.letsencrypt.org/directory`
antes do deploy (o navegador reclamará do certificado de teste; depois remova a variável e redeploye).

### 4.4 Portainer: primeiro acesso e registry

1. Abra `https://portainer.tsmex.com.br` **em até 5 minutos** e crie o administrador (senha longa, no cofre).
   Passou do prazo? `docker service update --force infra_portainer` e tente de novo.
2. Ligue 2FA no seu usuário (Settings → Users).
3. **Registries → Add registry → Custom**: URL `ghcr.io`, usuário do GitHub dono do repositório e um *Personal
   Access Token* (classic) com **só** `read:packages`. Quem cria: o dono do repositório; guarde no cofre e
   renove na validade. Sem isto o Swarm não consegue baixar as imagens privadas.
4. O ambiente local (Swarm) já aparece conectado ao agente.

### 4.5 GitHub: Environment `production`

Repositório → Settings → **Environments → production**:

- **Required reviewers**: pelo menos 1 pessoa além de quem dispara. **Deployment branches**: só `main`.
- **Variables:** `PROD_DOMAIN` (o mesmo do stack; se vazio, vale `tsmex.com.br`).
- **Secrets** (todos os que os workflows referenciam; `GITHUB_TOKEN` é automático):

| Secret | Valor | Quem decide / de onde vem | Workflow |
|---|---|---|---|
| `VPS_HOST` | IP ou DNS da VPS de produção | TI (IP da VPS nova) | production, legacy-migration |
| `VPS_USER` | `deploy` | TI (o `DEPLOY_USER` do bootstrap) | idem |
| `VPS_SSH_KEY` | conteúdo **inteiro** de `gh_actions_prod` (chave privada) | TI gera no §4.1 | idem |
| `ACBR_CLIENT_ID_PRODUCAO` / `ACBR_CLIENT_SECRET_PRODUCAO` | OAuth de **produção** da ACBr | Responsável fiscal (console ACBr) | production |
| `EFRETE_PRODUCAO_USUARIO` / `_SENHA` / `_INTEGRADOR` / `_INTEGRADOR_CNPJ` | credenciais e-Frete de produção | Responsável fiscal / AT&M | production |
| `OPS_ALERT_WEBHOOK_URL` / `OPS_ALERT_WEBHOOK_TOKEN` | webhook do n8n e seu token | Dono (quem monta o fluxo do n8n) | production |
| `LEGADO_USUARIO` / `LEGADO_SENHA` | login da empresa no legado (só leitura é usada) | Dono | legacy-migration |
| `LEGADO_CONFIG_B64` | base64 do `legado.config.json` (o mesmo do staging) | TI | legacy-migration |

Os secrets `ACBR_CLIENT_ID`/`_SECRET` (sem `_PRODUCAO`) e `EFRETE_HOMOLOGACAO_*` pertencem **só** ao Environment
`staging`. O `Deploy Production` reaplica nos serviços, a cada deploy, os 8 valores de produção acima. Mantenha
os mesmos valores no stack do Portainer (§4.7): é a rede de segurança caso o stack seja recriado.

### 4.6 Primeira execução do `Deploy Production` (só para construir as imagens)

Actions → **Deploy Production** → Run workflow, na `main`, digitando `DEPLOY`. Aprove no ambiente.
O job `build-and-push` publica as imagens em `ghcr.io/<repo>/tsmex-*:latest`. O job `Deploy` vai **falhar**
com "Serviço não encontrado": é esperado, o stack ainda não existe. Confirme só que as imagens foram
publicadas (Packages do repositório).

### 4.7 Criar o stack `tsmexomni-prod` no Portainer

Stacks → **Add stack** → nome **exatamente** `tsmexomni-prod` (os workflows, o `REDIS_URL` e o healthwatch
dependem desse prefixo) → *Web editor* → cole o conteúdo de `docker-stack.prod.yml` → *Environment variables* →
*Load variables from .env file* (cole o bloco abaixo, já preenchido) → **Deploy the stack**.

Guarde esse mesmo bloco, preenchido, no cofre como `stack.env`: o Portainer **não** é backup dele.

```env
# ---------- identidade ----------
GITHUB_REPOSITORY=kersonpank/tsmex-omni
PROD_DOMAIN=tsmex.com.br
# ---------- banco ----------
POSTGRES_PASSWORD=<hex de 48 caracteres>
DATABASE_URL=postgresql://postgres:<mesma senha>@tsmexomni-prod_postgres:5432/tsmex?schema=public
# ---------- sessão ----------
JWT_SECRET=<hex de 96 caracteres, diferente do staging>
JWT_EXPIRES_IN=7d
# ---------- arquivos (MinIO) ----------
MINIO_ROOT_USER=<admin do MinIO>
MINIO_ROOT_PASSWORD=<hex de 48 caracteres>
MINIO_HOST=minio.tsmex.com.br
S3_ENDPOINT=https://minio.tsmex.com.br
S3_PUBLIC_BASE_URL=https://minio.tsmex.com.br
S3_SIGNED_URL_PUBLIC_HOST=https://minio.tsmex.com.br
S3_ACCESS_KEY=<usuário da aplicação no MinIO, NÃO o root>
S3_SECRET_KEY=<hex de 48 caracteres>
S3_BUCKET=tsmex-prod-uploads
# ---------- fiscal ----------
FISCAL_SECRET_KEY=<hex de 64 caracteres; COPIA OFFLINE obrigatória>
FISCAL_CTE_PROVIDER=acbr
FISCAL_PROVIDER=acbr
ACBR_CLIENT_ID_PRODUCAO=
ACBR_CLIENT_SECRET_PRODUCAO=
EFRETE_PRODUCAO_USUARIO=
EFRETE_PRODUCAO_SENHA=
EFRETE_PRODUCAO_INTEGRADOR=
EFRETE_PRODUCAO_INTEGRADOR_CNPJ=
# ---------- backup (destino externo) ----------
BACKUP_OFFSITE_BUCKET=<bucket do outro provedor>
BACKUP_OFFSITE_ENDPOINT=<https://s3.... do outro provedor>
BACKUP_OFFSITE_PROVIDER=Other
BACKUP_OFFSITE_REGION=us-east-1
BACKUP_OFFSITE_ACCESS_KEY=<chave só desse bucket>
BACKUP_OFFSITE_SECRET_KEY=<segredo>
BACKUP_AGE_RECIPIENT=<age1... chave PÚBLICA>
# ---------- alertas ----------
OPS_ALERT_WEBHOOK_URL=
OPS_ALERT_WEBHOOK_TOKEN=
# ---------- só no PRIMEIRO deploy (depois: RUN_SEED=false e atualizar o stack) ----------
RUN_SEED=true
SEED_ADMIN_PASSWORD=<12+ caracteres>
```

Quem escolhe cada valor:

| Variável | Quem escolhe / como gerar |
|---|---|
| `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `S3_SECRET_KEY` | TI: `openssl rand -hex 24`. Use **hex**: caracteres como `@ : / ?` quebram a `DATABASE_URL` |
| `JWT_SECRET` | TI: `openssl rand -hex 48`. Nunca igual ao do staging. Trocar só derruba as sessões |
| `FISCAL_SECRET_KEY` | TI gera (`openssl rand -hex 32`) **uma vez**. Dono + 1 pessoa guardam cópia offline. **Perder ou trocar = senha do certificado A1 e chaves de IA irrecuperáveis** |
| `MINIO_ROOT_USER`, `S3_ACCESS_KEY`, `S3_BUCKET` | TI (nomes). O usuário da aplicação é criado no §4.8 |
| `MINIO_HOST`, `PROD_DOMAIN` | Dono (nomes de DNS do §2) |
| `BACKUP_OFFSITE_*` | Dono contrata o provedor; TI cria bucket com versionamento e a chave só desse bucket (idealmente sem permissão de apagar) |
| `BACKUP_AGE_RECIPIENT` | TI gera o par num computador da empresa: `age-keygen -o tsmex-backup.key`. A linha `public key: age1...` vai aqui; o arquivo `.key` vai **só** ao cofre (GO_LIVE §3) |
| `ACBR_*_PRODUCAO`, `EFRETE_PRODUCAO_*` | Responsável fiscal |
| `OPS_ALERT_WEBHOOK_*` | Dono (webhook do n8n) |
| `RUN_SEED`, `SEED_ADMIN_PASSWORD` | TI, só no primeiro deploy. Cria o usuário `admin@tsmex.com`; no primeiro login crie os administradores reais e **desative** esse e qualquer conta de seed |

Acompanhe: `docker service ls` (esperado: `postgres`, `redis`, `minio`, `api` 2/2, `worker`, `web`, `backup` com réplicas
completas; `migrate` fica `0/1` depois de rodar, é normal). Se o `api` reclamar de bucket ou credencial,
vá ao §4.8.

### 4.8 Usuário e bucket do MinIO (uma vez)

O console do MinIO não é exposto na internet. Use um cliente `mc` descartável, preso à rede do container do MinIO:

```bash
MINIO_CID=$(docker ps -q -f label=com.docker.swarm.service.name=tsmexomni-prod_minio)
docker run --rm -it --network container:$MINIO_CID --entrypoint /bin/sh quay.io/minio/mc
```

Dentro dele (troque os valores entre `<>` pelos do `stack.env`):

```sh
mc alias set prod http://localhost:9000 '<MINIO_ROOT_USER>' '<MINIO_ROOT_PASSWORD>'
mc mb --ignore-existing prod/tsmex-prod-uploads
cat > /tmp/policy.json <<'EOF'
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::tsmex-prod-uploads"]},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::tsmex-prod-uploads/*"]}]}
EOF
mc admin policy create prod tsmex-app /tmp/policy.json
mc admin user add prod '<S3_ACCESS_KEY>' '<S3_SECRET_KEY>'
mc admin policy attach prod tsmex-app --user '<S3_ACCESS_KEY>'
exit
```

Depois `docker service update --force tsmexomni-prod_api` e confira `https://PROD_DOMAIN/api/health`.
(Política e regras: [MINIO_BUCKET_POLICY.md](MINIO_BUCKET_POLICY.md).)

### 4.9 Segunda execução do `Deploy Production` (o deploy de verdade)

Actions → Deploy Production → `DEPLOY`. O workflow: confere o `DATABASE_URL`, **faz backup antes de migrar**
(se falhar, não migra), migra, atualiza worker/api/web pela tag do commit (`sha-xxxxxxx`), reaplica os segredos
fiscais e espera `/api/health` = 200. Se a API nova não ficar saudável, o Swarm volta sozinho para a versão
anterior (`failure_action: rollback`) e o job falha mostrando os comandos de rollback manual.
Agora ajuste `RUN_SEED=false` no stack (Portainer → Stack → Editor → Update) e rode o deploy de novo para
repinar a imagem (§5).

### 4.10 Dados: migração do legado, validada no staging primeiro

Regra: **nada vai direto para produção sem ter passado no staging**. Passos:

1. **Staging** concluído e conferido (GO_LIVE §9.1: `iniciar` → `andamento` → `carregar`, contagens batendo).
2. **Produção — copiar o extraído, não extrair de novo** (poupa o legado e carrega *exatamente* o que foi
   validado). Direto de VPS para VPS, sem passar pelo seu computador. Do seu computador, com *agent forwarding*
   (a chave não é copiada para o staging):

   ```bash
   ssh -A admin@IP_DO_STAGING
   STG=$(docker ps -q -f label=com.docker.swarm.service.name=staging-tsmex-dev_worker | head -1)
   docker exec "$STG" tar -C /app/legacy-data --exclude='*session*' -czf - extract \
     | ssh -o StrictHostKeyChecking=accept-new admin@IP_DA_PRODUCAO \
       'sudo docker exec -i $(sudo docker ps -q -f label=com.docker.swarm.service.name=tsmexomni-prod_worker | head -1) tar -C /app/legacy-data -xzf -'
   ```

   O arquivo contém dado pessoal: ele só trafega por SSH entre as duas VPS e fica no volume do worker.
3. Actions → **Migração do legado** → alvo `production`, ação `carregar` (idempotente; pode repetir).
4. **Conferir:** contagens por tabela staging × produção (`psql ... select count(*)`), CSVs de conferência,
   telas **Histórico do legado**, **Arquivo fiscal externo** e **Numeração fiscal**. Assinar (GO_LIVE §8).
5. Durante a convivência, a rodada semanal do extrator (`iniciar`/`carregar`) roda em produção como descrito no GO_LIVE §9.
6. O que **não** se copia do staging: banco, usuários, certificados, emitentes, tabelas de frete. Cadastre em
   produção pela torre: certificado A1 (upload por administrador), emitentes em **Produção**, série própria.

Virada de domínio (se começou com `prod.`): troque `PROD_DOMAIN` no stack e no Environment do GitHub, atualize o
stack, rode o `Deploy Production`, aponte o A do apex e confira o certificado.

### 4.11 Checagens de go-live (todas precisam passar)

```bash
# de fora (seu computador)
curl -sI https://tsmex.com.br | grep -iE '^(HTTP|strict-transport|x-content|x-frame)'   # 200 + HSTS + nosniff
curl -sI http://tsmex.com.br | head -2                                                    # 301/308 para https
curl -fsS https://tsmex.com.br/api/health                                                 # {"status":"ok","database":true,"worker":true}
nmap -Pn -p 22,80,443,2377,4789,5432,6379,7946,8080,9000,9001 IP_DA_VPS                   # SÓ 22, 80 e 443 abertas
ssh root@IP_DA_VPS                                                                        # recusado
# na VPS (ssh admin@...)
docker service ls                                   # tudo N/N (migrate 0/1)
sudo ufw status verbose; sudo fail2ban-client status sshd
sudo tsmex-healthwatch check && sudo tsmex-healthwatch status    # "nenhum alerta em andamento"
sudo tsmex-healthwatch test-alert                   # chegou no WhatsApp/e-mail do plantão?
```

Testes que valem a pena **antes de entrar com dados reais**:

- **Reinício**: `sudo reboot`. Em até ~5 min tudo deve voltar sozinho (`docker service ls`, `/api/health` 200).
- **Alerta**: `docker service scale tsmexomni-prod_worker=0`; em ~4 min deve chegar o alerta de réplica e de API
  degradada. Depois `docker service scale tsmexomni-prod_worker=1` e deve chegar o "RESOLVIDO".
- **Backup**: em Gestão → Sistema → Backup e contingência as três linhas **Em dia**; arquivos aparecem no destino externo.
- **Restauração**: o ensaio do §6.3.
- Monitor **externo** (UptimeRobot, Better Stack…) em `https://tsmex.com.br/api/health` e, se quiser cobrir "a VPS inteira
  caiu", `HEARTBEAT_URL` no `/etc/tsmex/healthwatch.env` (healthchecks.io gratuito).
- Complete a lista do GO_LIVE §8.

## 5. Rotina

| Quero | Faço |
|---|---|
| Publicar versão | Merge na `main` → Actions → **Deploy Production** → `DEPLOY` → aprovar. Janela fora do horário de emissão |
| Ver estado | `docker service ls`; `docker stack ps tsmexomni-prod --filter desired-state=running`; `sudo tsmex-healthwatch status` |
| Logs | `docker service logs -f --tail 100 tsmexomni-prod_api` (idem `worker`, `backup`, `infra_traefik`) |
| Voltar versão | `docker service rollback tsmexomni-prod_api` (e `_worker`, `_web`). **O banco não volta**: migrações só andam para frente; correção é nova migração |
| Reiniciar um serviço | `docker service update --force tsmexomni-prod_api` |
| Mudar variável | Portainer → Stack → Editor/Environment → Update; **depois** rode o `Deploy Production` (o "Update" do Portainer reaplica `:latest` e perde os segredos reaplicados pelo workflow) |
| Atualizar Traefik/Portainer | Edite a versão em `infra/prod-vps/traefik-portainer.stack.yml`, `docker stack deploy ... infra` à noite (Traefik para ~10 s). Os certificados ficam no volume `traefik_letsencrypt` |
| Atualizar Docker Engine | À noite, depois de um backup: `sudo apt-get install --only-upgrade docker-ce docker-ce-cli containerd.io` (os containers reiniciam, ~1 min) |
| Patches do Ubuntu | Automáticos (segurança); reinício às 04:00 só se necessário. `cat /var/run/reboot-required` mostra se há um pendente |
| Quem foi banido | `sudo fail2ban-client status sshd`; `sudo fail2ban-client set sshd unbanip IP` |
| Disco | `df -h /`; `docker system df`. Limpeza de imagens antigas já é semanal (domingo 03:30). **Nunca** `docker volume prune` |

## 6. Backup e ensaio de restauração

### 6.1 O que existe

O serviço `backup` (detalhes e retenção no GO_LIVE §3) faz `pg_dump` cifrado com age **a cada hora**, espelha o
bucket do MinIO **a cada 6 h** (com histórico do que foi apagado/sobrescrito) e testa a restauração **toda semana**.
O `healthwatch` confere a tabela `BackupRun` pelo host e alerta **antes** do app: banco sem sucesso há mais de **3 h**
(o app só avisa com 26 h), arquivos há mais de 13 h, teste de restauração há mais de 8 dias ou falhando.

### 6.2 Quando ensaiar

Antes do go-live, depois **a cada 3 meses** e sempre que mudar o destino externo, a chave age ou a versão do Postgres.
Ensaio que ninguém fez não vale como backup.

### 6.3 Ensaio completo (em outra máquina, sem tocar na produção)

Pode ser o servidor de staging ou qualquer máquina com Docker. Você precisa do `stack.env`, da chave privada age
e do token do GHCR (todos do cofre).

```bash
# 1) Postgres vazio descartável + login no GHCR
docker login ghcr.io
docker run -d --name drill-pg -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=tsmex postgres:16-alpine

# 2) Variáveis do destino externo (copie do stack.env) num arquivo temporário
cat > /dev/shm/drill.env <<'EOF'
BACKUP_OFFSITE_BUCKET=...
BACKUP_OFFSITE_PREFIX=tsmex-prod
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=Other
RCLONE_CONFIG_OFFSITE_ENDPOINT=...
RCLONE_CONFIG_OFFSITE_REGION=us-east-1
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=...
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=...
BACKUP_AGE_IDENTITY_FILE=/run/secrets/age.key
EOF
chmod 600 /dev/shm/drill.env

# 3) Sessão com as ferramentas de restauração, na rede do Postgres descartável
time docker run --rm -it --user root --network container:drill-pg --env-file /dev/shm/drill.env \
  -v "$PWD/tsmex-backup.key:/run/secrets/age.key:ro" --entrypoint bash \
  ghcr.io/kersonpank/tsmex-omni/tsmex-backup:latest
```

Dentro da sessão:

```bash
restore.sh list                                                    # escolha o dump mais recente de hourly/
restore.sh fetch postgres/hourly/tsmex-AAAAMMDDTHHMMSS.dump.age    # baixa, confere sha256, decifra
restore.sh into postgresql://postgres:drill@localhost:5432/tsmex   # só restaura em banco VAZIO
psql postgresql://postgres:drill@localhost:5432/tsmex -c 'select count(*) from "Order"'
exit
```

Limpeza: `docker rm -f drill-pg; shred -u /dev/shm/drill.env; rm -f tsmex-backup.key`. Anote **quanto tempo levou** e o
que travou; esse é o seu RTO real (atualize a tabela do §8.2). Confira também os arquivos:
`rclone lsd offsite:BUCKET/tsmex-prod/objects` e que o último `contingencia/latest.csv.age` decifra.

## 7. Escalar

**Ordem: vertical primeiro, depois nós extras para o que é sem estado. O banco continua um só.**

### 7.1 Vertical (o caminho normal)

1. Backup agora: `docker exec $(docker ps -q -f label=com.docker.swarm.service.name=tsmexomni-prod_backup) /usr/local/bin/backup.sh once`.
2. À noite, redimensione a VPS no painel do provedor (reinicia: 2 a 5 min de indisponibilidade). O Swarm e os
   volumes voltam sozinhos.
3. Aumente os limites em `docker-stack.prod.yml` (`deploy.resources.limits`) e aplique pelo Portainer → Update; rode o `Deploy Production`.
   Referência para 16 GB: postgres 6G, api 1.5G cada, worker 1.5G, minio 2G, redis 1G. No Postgres, quando a RAM
   passar de 8 GB, acrescente ao serviço `postgres` o `command: ["postgres", "-c", "shared_buffers=<25% da RAM do
   container>", "-c", "effective_cache_size=<50%>"]`.
4. Monitore uns dias: `docker stats --no-stream`; disco `df -h /`.

Limites atuais (para VPS de 8 GB): postgres 3G/2 CPU, api 768M/1 CPU (×2), worker 768M/1 CPU, backup 768M, minio 1G,
redis 1G, web 256M, migrate 1G (só durante o deploy). A soma dos limites passa de 8 GB de propósito (nem todos
picam juntos; o swap cobre o resto), mas as **reservas** somam ~3 GB.

### 7.2 Horizontal: adicionar um nó worker

O que dá para espalhar: **`api` e `web`** (sem estado; o stack já pede `spread` por nó). O que **não** dá: postgres, redis, minio,
worker, backup, traefik e portainer — têm volume local e ficam **presos** ao nó com o rótulo `tsmex.stateful=true`
(o único nó manager). Adicionar nó **não** aumenta a capacidade do banco nem cria alta disponibilidade de entrada:
a porta 443 continua só no manager. Serve para folga de CPU/RAM da API.

Pré-requisitos: uma **rede privada** do provedor entre as VPS (nunca o Swarm pela internet) e o IP privado de cada uma.

```bash
# 1) No MANAGER: liberar o novo nó nas portas do Swarm (só para o IP privado dele) e pegar o token
sudo ufw allow from 10.0.0.12 to any port 2377 proto tcp
sudo ufw allow from 10.0.0.12 to any port 7946
sudo ufw allow from 10.0.0.12 to any port 4789 proto udp
docker swarm join-token worker        # o token é segredo: não cole em chat nem em ticket

# 2) Na VPS NOVA (Ubuntu limpo): mesmo bootstrap, em modo worker
export SSH_PUBKEY='...' ADMIN_SSH_PUBKEY='...'
export ADVERTISE_ADDR=10.0.0.12 SWARM_PEERS=10.0.0.11          # IP privado dele / do manager
export SWARM_JOIN_ADDR=10.0.0.11:2377 SWARM_JOIN_TOKEN='SWMTKN-...'
bash bootstrap.sh

# 3) No MANAGER: conferir e escalar
docker node ls
docker service scale tsmexomni-prod_api=3
docker service ps tsmexomni-prod_api
```

**Importante:** o manager precisa ter sido iniciado anunciando o **IP privado** (`ADVERTISE_ADDR=<IP privado>` já no primeiro
`bootstrap.sh`); os workers voltam a procurar o manager pelo IP anunciado, e o IP público está fechado no UFW. Se você
subiu com o IP público e agora quer crescer, é uma janela de manutenção: `docker swarm leave --force`, `bootstrap.sh` de novo
com o IP privado e recriar os stacks (`infra` e `tsmexomni-prod`, do `stack.env`); os volumes locais continuam no disco.
Não promova um segundo manager: com 2 managers, perder 1 trava o Swarm (quórum). Se
um dia precisar de alta disponibilidade de verdade, são 3 managers, banco com réplica (streaming) e balanceador na frente,
o que é um projeto à parte.

Overlay criptografado (`docker network create --opt encrypted`) é opcional quando a rede privada do provedor já é isolada;
exige liberar o protocolo ESP entre os nós.

## 8. Desastre: reconstruir do zero

### 8.1 Kit de recuperação (confira a cada trimestre que tudo existe e está acessível)

No cofre da empresa, com ao menos 2 pessoas sabendo onde está: `stack.env` completo e atual (§4.7) · chave **privada** age ·
`FISCAL_SECRET_KEY` · token do GHCR · acesso ao painel do provedor da VPS, ao DNS e ao destino externo de backup · chave SSH
de administração · arquivo do certificado A1 (cópia com o responsável fiscal). Os secrets do Environment `production` ficam no GitHub.

### 8.2 Metas, ditas com honestidade

| | Meta | De onde vem | Observações |
|---|---|---|---|
| **RPO banco** | **≤ 1 hora** | `backup.sh`: `BACKUP_INTERVAL_MINUTES=60` | Pior caso: o desastre ocorre logo antes do próximo dump (e se um dump falhar, o `healthwatch` avisa em 3 h e o app em 26 h: durante esse intervalo a perda cresce). Há ainda o backup obrigatório antes de cada migração e o snapshot diário do provedor (camada extra, mesma conta do provedor) |
| **RPO arquivos** (XML, comprovantes, certificados no MinIO) | **≤ 6 horas** | `BACKUP_OBJECTS_INTERVAL_MINUTES=360` | O que foi apagado ou sobrescrito fica em `objects-history/<dia>`. XML fiscal perdido nessa janela pode ser rebaixado da SEFAZ/ACBr pela chave |
| **RPO filas (Redis)** | **não coberto** | Redis só tem AOF local | Jobs fiscais em andamento no desastre se perdem; reconcilie pelos documentos em estado intermediário no banco |
| **RTO** (VPS perdida → sistema no ar) | **meta de 4 horas** | GO_LIVE §3 (meta "menos de 4 h") | **Ainda não medido em produção.** Estimativa: VPS nova 15–30 min, bootstrap 10, infra 5, stack 15, restauração do banco 30–90 (cresce com o tamanho), arquivos 30–120. O primeiro ensaio do §6.3 substitui esta estimativa pelo número real: registre-o aqui |

### 8.3 Procedimento (VPS nova, a partir do zero)

1. **VPS nova** (ou reset da atual) no provedor. Aponte o DNS (§2) para o IP novo; atualize o secret `VPS_HOST` se ele for o IP.
2. **Bootstrap** (§4.1, mesmas chaves) e **teste de acesso** (§4.2). Stack `infra` (§4.3), Portainer e registry (§4.4).
3. **Stack `tsmexomni-prod`** no Portainer com o `stack.env` do cofre e `RUN_SEED=false` (§4.7). O `migrate` cria o esquema vazio.
4. **Usuário e bucket do MinIO** (§4.8), com os mesmos `S3_ACCESS_KEY`/`S3_SECRET_KEY` do `stack.env`.
5. **Pare quem escreve, principalmente o backup** (um dump do banco vazio **não pode** ir para o destino externo):

   ```bash
   for s in api web worker backup; do docker service scale tsmexomni-prod_$s=0; done
   PG=$(docker ps -q -f label=com.docker.swarm.service.name=tsmexomni-prod_postgres)
   docker exec "$PG" psql -U postgres -c 'DROP DATABASE tsmex WITH (FORCE)' -c 'CREATE DATABASE tsmex'
   ```
6. **Restaure o banco** como no §6.3, só que no lugar do `drill-pg` use o Postgres de produção e a URL real:

   ```bash
   docker service inspect tsmexomni-prod_backup --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' \
     | grep -E '^(RCLONE_CONFIG_|BACKUP_|S3_BUCKET)' >/dev/shm/dr.env; chmod 600 /dev/shm/dr.env
   echo 'BACKUP_AGE_IDENTITY_FILE=/run/secrets/age.key' >>/dev/shm/dr.env
   docker run --rm -it --user root --network container:$PG --env-file /dev/shm/dr.env \
     -v "$PWD/tsmex-backup.key:/run/secrets/age.key:ro" --entrypoint bash \
     ghcr.io/kersonpank/tsmex-omni/tsmex-backup:latest
   # dentro: restore.sh list | fetch ... | into postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/tsmex
   ```
7. **Restaure os arquivos** (na mesma sessão, antes de sair; o `local` aponta para o MinIO do stack):

   ```bash
   rclone sync --checksum --fast-list --s3-no-check-bucket -v "offsite:$BACKUP_OFFSITE_BUCKET/${BACKUP_OFFSITE_PREFIX:-tsmex-prod}/objects" "local:$S3_BUCKET"
   ```
   O Postgres e o MinIO estão na mesma rede interna do stack, então o remote `local` (`tsmexomni-prod_minio:9000`) resolve de dentro dessa sessão.
8. Apague `shred -u /dev/shm/dr.env` e o `.key` da máquina. **Religue** (`docker service scale ...api=2 ...web=1 ...worker=1 ...backup=1`) e rode o **Deploy Production** (aplica migrações novas por cima do dump, com backup antes).
9. **Confira:** `/api/health`, login, últimos pedidos (a data do último confere com o RPO), emitentes fiscais e certificado (estão no banco e no MinIO),
   Gestão → Sistema → Backup (a primeira rodada nova em até 1 min). Reabra a fila fiscal: documentos que estavam "em emissão" precisam ser reconciliados com a SEFAZ antes de reemitir (nunca reemitir às cegas).
10. Avise a operação: a perda máxima são as últimas horas (§8.2). Registre o tempo total no §8.2.

Outras situações: **serviço travado** → o Swarm reinicia sozinho; **deploy ruim** → rollback automático/`docker service rollback`;
**dado apagado por engano** → restaure o dump num banco **ao lado** (§6.3) e copie as linhas, **não** sobrescreva a produção;
**conta do provedor perdida** → é para isso que o backup está em outro provedor: siga o §8.3 numa VPS de outro provedor.

## 9. Nunca faça

- **Nunca desenvolva, faça `git pull`, `npm install` ou edite arquivo de aplicação na VPS.** Só release pelo workflow.
- **Nunca** `docker system prune -a --volumes`, `docker volume prune`, `docker volume rm`, `docker stack rm` seguido de limpeza de volumes: apagam banco, filas e arquivos. (A limpeza semanal de imagens já existe e não toca em volumes.)
- **Nunca publique porta** (`ports:`) de Postgres, Redis ou MinIO nos stacks: o Docker fura o UFW. Nem abra `2377`, `7946`, `4789` para a internet.
- **Nunca** use `MIGRATE_MODE=push` ou `reset`, `prisma migrate reset` ou `db push` em produção. Migração é `deploy`, só para frente.
- **Nunca copie o banco do staging para a produção** nem reutilize `JWT_SECRET`, `S3_*` ou senhas entre ambientes.
- **Nunca** guarde a chave **privada** age no servidor (só montada durante a restauração e apagada em seguida), nem coloque segredo em arquivo do repositório, chat ou ticket.
- **Nunca perca nem troque o `FISCAL_SECRET_KEY`** depois que houver certificado A1 cadastrado.
- **Nunca restaure sobre um banco que não esteja vazio** e **nunca com o serviço `backup` ligado** apontando para um banco vazio/parcial (um dump vazio pode virar o "mensal" do mês).
- **Nunca apague** `postgres/monthly` do destino externo (guarda fiscal ≥ 5 anos) nem dê ao backup uma chave com permissão de apagar, se o provedor permitir restringir.
- **Nunca deixe `RUN_SEED=true`** depois do primeiro deploy, nem contas de seed/demo ativas.
- **Nunca** reative login de root ou por senha no SSH, nem adicione chave de quem saiu da empresa. Tire a chave do `~/.ssh/authorized_keys` e do `VPS_SSH_KEY`.
- **Nunca remova o rótulo `tsmex.stateful`** do nó nem adicione um segundo nó com ele: os volumes são locais.
- **Nunca promova um segundo manager** sem os 3 do quórum; nunca ative `live-restore` no Docker (incompatível com Swarm).
- **Nunca rode `carregar` do legado em produção** antes de passar no staging; nunca extraia do legado em paralelo com a rotina oficial de alguém sem avisar.
- **Nunca** use `docker service update` para mudança permanente de variável (some no próximo "Update" do Portainer): mude no stack e no GitHub.
- **Nunca** publique versão em horário de emissão fiscal pesada nem com alerta crítico aberto no healthwatch.
- **Nunca reemita** documento fiscal de um job perdido sem consultar a situação na SEFAZ antes.
