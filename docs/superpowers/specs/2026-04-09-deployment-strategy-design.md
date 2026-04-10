# Design: Estratégia de Deploy CI/CD — TSM EX OMNI

**Data:** 2026-04-09  
**Status:** Aprovado

---

## Contexto

O TSM EX OMNI é uma aplicação full-stack Dockerizada (React/Nginx + Express/Node + PostgreSQL + Redis) sem pipeline de CI/CD. A necessidade é ter dois ambientes independentes — staging para desenvolvimento e testes, produção para clientes reais — com deploy automatizado e controle de versão das imagens.

---

## Ambientes

| Ambiente | Domínio | Branch | Trigger |
|---|---|---|---|
| Staging | `tsm.mesquitagrupo.com.br` | `develop` | Push automático |
| Produção | `tsmex.com.br` | `main` | Merge via PR + aprovação manual |

---

## Arquitetura

```
GitHub (código + Actions)
    ↓ build & push imagens
GitHub Container Registry (ghcr.io) — gratuito, integrado
    ↓ pull das imagens na VPS
VPS: Docker Swarm + Portainer + Traefik
    ├── Stack: tsmex-staging  →  tsm.mesquitagrupo.com.br  (HTTPS auto)
    └── Stack: tsmex-prod     →  tsmex.com.br               (HTTPS auto)
```

---

## Branching Strategy

```
feature/* → develop → (PR) → main
               │                │
           auto-deploy       approval gate
            staging            + deploy prod
```

- `main` é branch protegida: só aceita merge via PR com 1 aprovação
- GitHub Environment `production` exige revisão manual antes do deploy

---

## Versionamento de Imagens

Cada build gera **duas tags** por imagem:
- `:staging` ou `:latest` — alias do último deploy (mutável)
- `:sha-<git_sha>` — referência imutável para rollback preciso

Exemplo de rollback de emergência:
```bash
docker service update \
  --image ghcr.io/USUARIO/tsmex-api:sha-abc1234 \
  tsmex-prod_api
```

---

## Fluxo Completo

### Staging
1. `git push origin develop`
2. GitHub Actions → build 3 imagens → push `ghcr.io` (`:staging` + `:sha-xxx`)
3. SSH na VPS → `docker stack deploy -c docker-stack.staging.yml tsmex-staging`
4. Traefik roteia `tsm.mesquitagrupo.com.br` → container web

### Produção
1. Abre PR `develop → main` → revisa diff → merge aprovado
2. GitHub Actions → build 3 imagens → push `ghcr.io` (`:latest` + `:sha-xxx`)
3. Workflow pausa no `environment: production` → notificação por email
4. Aprovação manual no GitHub Actions UI
5. SSH na VPS → `docker stack deploy -c docker-stack.prod.yml tsmex-prod`
6. Traefik roteia `tsmex.com.br` → container web

---

## Segredos e Configuração

### GitHub Secrets (CI/CD)
| Secret | Propósito |
|---|---|
| `VPS_HOST` | IP da VPS |
| `VPS_USER` | Usuário SSH |
| `VPS_SSH_KEY` | Chave privada ed25519 |
| `GHCR_TOKEN` | PAT com `write:packages` |

### Portainer (env vars das stacks — nunca no código)
- `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`
- `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `GEMINI_API_KEY`
- Valores **diferentes** entre staging e produção

---

## Arquivos do Projeto

| Arquivo | Ação | Motivo |
|---|---|---|
| `.github/workflows/staging.yml` | Criar | Pipeline staging |
| `.github/workflows/production.yml` | Criar | Pipeline produção com approval gate |
| `docker-stack.staging.yml` | Criar | Swarm stack staging com Traefik labels |
| `docker-stack.prod.yml` | Criar | Swarm stack produção |
| `Dockerfile.web` | Modificar | Remover entrypoint debug, usar nginx direto |
| `docker-compose.yml` | Modificar | Adicionar `image:` para compatibilidade Swarm |
| `.gitignore` | Modificar | Garantir que `.env` nunca seja commitado |

---

## Observação sobre Migrations

- **Staging**: usa `prisma db push` (aceita perda de dados) — ok para ambiente de teste
- **Produção**: usa `prisma migrate deploy` — aplica apenas migrations pendentes sem risco de perda de dados

---

## Verificação

1. Push em `develop` → GitHub Actions `staging` verde ✅
2. `https://tsm.mesquitagrupo.com.br` carrega com HTTPS ✅
3. Login funciona (API respondendo) ✅
4. PR `develop → main` → merge → workflow pausa aguardando aprovação ✅
5. Aprovação → `https://tsmex.com.br` atualizado ✅
6. `ghcr.io` tem imagens com `:staging`, `:latest` e `:sha-xxxxx` ✅
