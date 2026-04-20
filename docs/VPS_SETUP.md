# Configuração da VPS — Passo a Passo (feito UMA VEZ)

Execute estes passos na sua VPS na ordem indicada.

---

## 1. Inicializar Docker Swarm (se ainda não feito)

```bash
docker swarm init
```

Se já estiver inicializado, pule.

---

## 2. Criar rede overlay compartilhada

```bash
docker network create --driver overlay --attachable ProxyGM
```

Essa rede é compartilhada entre o Traefik e os stacks da aplicação.

---

## 3. Configurar Traefik

Crie o arquivo `/opt/traefik/traefik-stack.yml` na VPS:

```yaml
version: "3.8"
services:
  traefik:
    image: traefik:v3.0
    command:
      - --providers.swarm=true
      - --providers.swarm.exposedByDefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=SEU@EMAIL.COM
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.letsencrypt.acme.tlschallenge=true
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt
    networks:
      - ProxyGM
    deploy:
      placement:
        constraints: [node.role == manager]

networks:
  ProxyGM:
    external: true

volumes:
  letsencrypt:
```

> Substitua `SEU@EMAIL.COM` pelo seu email real (usado pelo Let's Encrypt).

```bash
docker stack deploy -c /opt/traefik/traefik-stack.yml traefik
```

---

## 4. Validar serviços existentes no Swarm

```bash
docker service ls
```

Confirme que os serviços esperados existem:

- `staging-tsmex-dev_api`, `staging-tsmex-dev_web`, `staging-tsmex-dev_migrate`
- `prod-tsmex_api`, `prod-tsmex_web`, `prod-tsmex_migrate`

O workflow de deploy atual atualiza serviços existentes via `docker service update` (não depende de stack file em `/opt/tsmex`).

Se o staging ainda não existir, o workflow tentará bootstrap automático usando:

- `/opt/tsmex/docker-stack.staging.yml`

Para habilitar esse bootstrap, mantenha esse arquivo na VPS:

```bash
mkdir -p /opt/tsmex
scp docker-stack.staging.yml usuario@IP_VPS:/opt/tsmex/
```

---

## 5. Configurar as variáveis de ambiente no Portainer

No Portainer, acesse **Stacks → Add stack** e configure as env vars antes do primeiro deploy.

Use a matriz oficial:

- [docs/STACK_ENV_MATRIX.md](docs/STACK_ENV_MATRIX.md)

Ela inclui variáveis de banco/JWT e também o contrato obrigatório de MinIO/S3 por ambiente.

> **IMPORTANTE**: JWT_SECRET de produção deve ser diferente e mais longo que o de staging.

---

## 6. Criar chave SSH para o GitHub Actions

Na VPS ou na sua máquina local:

```bash
ssh-keygen -t ed25519 -C "github-actions-tsmex" -f ~/.ssh/github_actions_tsmex -N ""
```

Adicionar a chave pública na VPS:

```bash
cat ~/.ssh/github_actions_tsmex.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

O conteúdo de `~/.ssh/github_actions_tsmex` (chave **privada**) vai no GitHub Secret `VPS_SSH_KEY`.

---

## 7. Configurar o GitHub

### 7.1 Criar o repositório

- Acesse github.com → New repository
- Nome: `tsmex-omni`
- Visibilidade: **Private**
- Não inicializar com README

### 7.2 Conectar o projeto local

```bash
# No terminal, dentro da pasta do projeto:
git remote add origin https://github.com/SEU_USUARIO/tsmex-omni.git
git branch -M develop
git push -u origin develop

# Criar a branch main a partir de develop
git checkout -b main
git push -u origin main
git checkout develop
```

### 7.3 Proteger a branch `main`

```
GitHub → Settings → Branches → Add branch protection rule
Branch name pattern: main
✅ Require a pull request before merging
✅ Require approvals: 1
✅ Do not allow bypassing the above settings
```

### 7.4 Criar o Environment de produção

```
GitHub → Settings → Environments → New environment
Nome: production
✅ Required reviewers → adicionar seu usuário GitHub
```

### 7.5 Adicionar os Secrets

```
GitHub → Settings → Secrets and variables → Actions → New repository secret
```


| Secret        | Valor                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `VPS_HOST`    | IP público da VPS                                                                                                                   |
| `VPS_USER`    | Usuário SSH (ex: root)                                                                                                              |
| `VPS_SSH_KEY` | Conteúdo de `~/.ssh/github_actions_tsmex` (chave privada)                                                                           |
| `GHCR_TOKEN`  | Token gerado em github.com → Settings → Developer settings → Personal access tokens → Fine-grained → com permissão `write:packages` |


---

## 8. Primeiro deploy

```bash
# Com tudo configurado, faça o primeiro push:
git checkout develop
git push origin develop

# Abra GitHub Actions e acompanhe o workflow "Deploy Staging"
# Em ~5 minutos, tsm.mesquitagrupo.com.br deve estar online
```

## 9. Rollout e rollback padronizados

Use o runbook:

- [docs/STACK_ROLLOUT_RUNBOOK.md](docs/STACK_ROLLOUT_RUNBOOK.md)

E para buckets/políticas:

- [docs/MINIO_BUCKET_POLICY.md](docs/MINIO_BUCKET_POLICY.md)

---

## Rollback de emergência

```bash
# Na VPS, atualize apenas o serviço afetado para uma versão anterior:
docker service update \
  --image ghcr.io/SEU_USUARIO/tsmex-api:sha-ABCDEF \
  tsmex-prod_api

# Para ver as versões disponíveis, acesse:
# https://github.com/SEU_USUARIO/tsmex-omni/pkgs/container/tsmex-api
```

