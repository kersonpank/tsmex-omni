# TSM EX OMNI

Plataforma de orquestração logística em formato de **Teia** (rede de transporte inteligente B2B).

## Conceito

```text
[Cliente] → [Hub Origem] → [Link] → [Hub/CD Destino] → [Entrega Final]
                          ↑
               (consolida vários pedidos num Manifesto)
```

- **Hub** — filial/CD que recebe carga, consolida pedidos em **Manifestos** e emite CT-e/Minuta.
- **Link** — transportador (autônomo ou empresa) que move Manifestos entre Hubs. Vínculo B2B, não sob demanda individual.
- **Demand → Order → Manifest → Entrega → Invoice** é o ciclo de vida completo de uma carga.

Contexto de negócio completo (fluxos, status, RBAC, fiscal): ver [CLAUDE.md](CLAUDE.md).

## Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 + React Router 7 (hash mode) + Zustand 5 + Axios + TailwindCSS |
| Backend | Node.js + Express 4 + TypeScript + Prisma 6 + PostgreSQL 16 + Redis 7 + JWT + Zod |
| Infra | Docker Compose (postgres, redis, api, migrate, web/nginx) |

## Quick Start

### Opção A — Docker (sobe tudo: banco, redis, api, web)

```bash
docker-compose up --build
```

### Opção B — Dev manual (hot reload)

```bash
# Backend
cd server
npm install
npm run dev

# Frontend (em outro terminal, na raiz)
npm install
npm run dev
```

### Portas

| Serviço | Porta |
|---|---|
| API | 3002 |
| Web | 3000 |
| Postgres | 5440 |
| Redis | 6390 |

## Variáveis de Ambiente

- Backend: `server/.env` (ver `server/.env.example`) — `DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN`, credenciais ACBr/fiscal.
- Frontend: `.env.local` — `GEMINI_API_KEY` (chat com IA).

Lista completa e checklist ACBr: ver [CLAUDE.md](CLAUDE.md#variáveis-de-ambiente).

## Estrutura

```text
tsm ex omni/
├── components/      ← UI React (admin, client, commercial, forms, operacao)
├── server/
│   ├── prisma/      ← schema.prisma (fonte da verdade do modelo de dados)
│   └── src/         ← routes/, services/, middleware/
├── store/           ← Zustand (auth, theme)
├── lib/api.ts       ← Cliente Axios
└── docker-compose.yml
```

## Comandos Úteis

```bash
npm run dev              # Frontend dev
npm run build             # Build frontend
npm run test               # Testes frontend (vitest)
npm run typecheck:web      # Typecheck frontend
npm run typecheck:server   # Typecheck backend
npm run test:server        # Testes backend
```

Comandos de backend (migrations, seed, Prisma Studio, endpoints da API): ver [server/README.md](server/README.md).

## Papéis (RBAC)

| Role | Quem | Acesso |
|---|---|---|
| ADMIN | Equipe TSM | Tudo: cotação, manifesto, aprovar Links, tarifas |
| CLIENT | Embarcador | Solicita coleta/cotação, acompanha própria carga |
| HUB | Operador de filial/CD | Entrada de carga, CT-e/Minuta, roteamento |
| LINK | Transportador | Aceita manifesto, atualiza entrega |

Um usuário pode ter múltiplos papéis simultaneamente.

## Documentação

- [CLAUDE.md](CLAUDE.md) — modelo de negócio, fluxos de status, stack detalhada, gotchas.
- [server/README.md](server/README.md) — setup do backend, endpoints da API, credenciais de teste, scripts.
