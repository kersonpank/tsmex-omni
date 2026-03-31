# TSM EX OMNI — Guia de Contexto

## Modelo de Negócio

**TSM EX** é uma plataforma de orquestração logística em formato de **Teia** (rede de transporte inteligente).

### Conceito Central: Teia Logística

```
[Cliente] → [Hub Origem] → [Link] → [Hub/CD Destino] → [Entrega Final]
                          ↑
               (consolida vários pedidos num Manifesto)
```

- **Hub**: Ponto de coleta, triagem e consolidação de cargas. Funciona como filial/CD.
  - Recebe cargas de clientes e de outros Hubs
  - Consolida múltiplos pedidos em um único Manifesto para otimizar frete
  - Emite CT-e / Minuta fiscal (integração SEFAZ brasileira)
  
- **Link**: Transportador (autônomo ou empresa) que move carga entre Hubs/CDs
  - Aceita Manifestos oferecidos pelo sistema
  - Atualiza status de coleta/entrega
  - **Não é Uber**: vínculo é B2B, não por demanda individual — movimenta lotes consolidados

- **Manifesto**: Agrupamento de demandas numa viagem → otimiza ocupação do veículo

### Fluxo Principal

```
1. Cotação      → Cliente solicita via Chat (IA) ou Formulário
2. Oportunidade → Entra no pipeline CRM (Kanban)
3. Demanda      → Aprovada vira Demand (ciclo de vida de carga)
4. Manifesto    → Admin consolida N demandas num Manifesto
5. Link aceita  → Transportador executa a viagem
6. Entrega      → Status atualizado, CT-e emitido no Hub destino
7. Fatura       → Invoice gerado para a conta do cliente
```

### Status da Demanda

`PENDING → QUOTED → APPROVED → ASSIGNED → COLLECTED → IN_TRANSIT → AT_HUB → OUT_FOR_DELIVERY → DELIVERED`

### Status do Manifesto

`DRAFT → PENDING_ACCEPT → ACCEPTED → IN_PROGRESS → COMPLETED`

### Papéis (UserRole)

| Role   | Quem é                         | O que faz                                          |
|--------|--------------------------------|----------------------------------------------------|
| ADMIN  | Equipe interna TSM             | Tudo: cotação, manifesto, aprovar Links, tarifas   |
| CLIENT | Embarcador (remetente)         | Solicita cotação/coleta, acompanha carga           |
| HUB    | Operador de filial/CD          | Registra entrada, emite CT-e/Minuta, roteia carga  |
| LINK   | Transportador (motorista/PJ)   | Aceita manifesto, atualiza entrega                 |

> Um usuário pode ter múltiplos papéis simultaneamente.

### Visão de Futuro

O objetivo é que **agentes de IA façam a orquestração** automaticamente:
- Sugestão de consolidação de demandas em manifestos
- Seleção de melhor Link por rota, score, disponibilidade
- Follow-up automático de oportunidades CRM
- Cotação inteligente via chat

**No MVP atual**, partes críticas ainda são manuais (admin consolida manifestos, aprova Links).

---

## Stack Técnica

### Frontend
- **React 19** + TypeScript + Vite 6
- **React Router DOM 7** (modo hash)
- **Zustand 5** (estado global com persistência localStorage)
- **Axios** com interceptors (auth Bearer, logout automático 401)
- **TailwindCSS** + dark mode
- **@dnd-kit** para Kanban drag-drop
- **Google GenAI SDK** (Gemini no chat frontend)

### Backend
- **Node.js + Express 4** + TypeScript
- **Prisma 6** (ORM) + **PostgreSQL 16**
- **Redis 7** (cache)
- **JWT** (jsonwebtoken) para autenticação
- **Zod** para validação de inputs
- **Serviço LLM universal**: suporta OpenAI, Gemini, Anthropic, DeepSeek

### Infraestrutura
- **Docker Compose** (postgres, redis, api, migrate, web/nginx)
- Nginx como reverse proxy frontend → backend
- API na porta 3002, Web na porta 3000, Postgres 5440, Redis 6390

---

## Comandos

```bash
# Subir tudo (Docker)
docker-compose up --build

# Só o backend em dev (dentro de server/)
cd server && npm run dev

# Migrations
cd server && npx prisma migrate dev

# Seed do banco
cd server && npx prisma db seed

# Prisma Studio (visualizar banco)
cd server && npx prisma studio

# Build frontend
npm run build

# Dev frontend
npm run dev
```

---

## Estrutura de Arquivos

```
tsm ex omni/
├── components/
│   ├── admin/          ← Tabs do painel admin (Pedidos, Manifestos, Hubs, etc.)
│   ├── client/         ← Modais de gestão de conta/CNPJ
│   ├── commercial/     ← Tabelas de tarifas
│   ├── forms/          ← FormColeta, FormCotacao (forms públicos)
│   ├── operacao/       ← Dashboards Hub e Link
│   └── ui/             ← Componentes reutilizáveis
├── server/
│   ├── prisma/
│   │   └── schema.prisma   ← Fonte da verdade do modelo de dados (28 modelos)
│   └── src/
│       ├── routes/     ← Um arquivo por domínio (demands, orders, manifests, hubs, links...)
│       ├── services/   ← llmService, freightEmission, cnpjService, agentTools
│       ├── middleware/ ← auth.ts (JWT + RBAC), errorHandler
│       └── lib/        ← prisma.ts, routeUtils
├── store/
│   ├── authStore.ts    ← Zustand auth (user, token, role)
│   └── themeStore.ts
├── lib/
│   └── api.ts          ← Cliente Axios com interceptors
├── App.tsx             ← Roteamento por role
└── docker-compose.yml
```

---

## Modelo de Dados — Entidades Chave

### Núcleo Logístico
- **Demand** — pedido de carga (NF, origem, destino, peso, volume, tipo)
- **Order** — pedido físico gerado a partir de Demand (partes: remetente, destinatário, consignatário)
- **Manifest** — consolidação de N demandas em uma viagem (Link + veículo)
- **Hub** — filial/CD com capacidade, cobertura, RNTRC
- **Link** — transportador com veículo, score, status de aprovação

### Comercial / CRM
- **Opportunity** — cotação no pipeline Kanban (estágios: QUOTE → CONVERTED → LOST)
- **PricingTable** — tabela de tarifas (ESPECIAL por cliente ou GERAL)
- **PricingRoute** — rotas origem/destino com preço
- **Account** — conta (empresa ou pessoa) com N CNPJs (AccountCompany)
- **Invoice** — fatura para a conta (subtotal, impostos, total, status)

### Fiscal & Documental
- **OrderFreightCalculation** — CT-e ou Minuta (status: DRAFT → CTE_AUTHORIZED)
- **OrderInvoice** — NF-e vinculada ao pedido (chave 44 dígitos)
- **NfSpecies** — lookup de espécies de NF (Volumes, Peças, etc.)

### IA / LLM
- **ChatSession / ChatMessage** — sessões de chat com IA
- **LLMProvider / LLMModel / LLMApiKey** — configuração multi-provedor
- **ConsolidationFeedback** — aprendizado de sugestões de manifesto

---

## Padrões de Código

### RBAC nos endpoints
```typescript
router.post('/manifests', authenticate, authorize(['ADMIN']), async (req, res) => {...})
router.patch('/manifests/:id/status', authenticate, authorize(['ADMIN', 'LINK']), ...)
```

### Transações Prisma (operações atômicas)
```typescript
await prisma.$transaction([
  prisma.demand.update({...}),
  prisma.orderHistory.create({...}),
])
```

### Multi-tenancy
- Clientes pertencem a **Account** → Account tem N **AccountCompany** (CNPJs)
- Tabelas de preço ESPECIAL vinculadas a Account

### LLM Service (universal)
- `server/src/services/llmService.ts` — abstrai OpenAI/Gemini/Anthropic
- `server/src/services/agentTools.ts` — ferramentas customizadas para agentes

---

## Variáveis de Ambiente

### Backend (`server/.env` ou docker-compose)
```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/tsmex
JWT_SECRET=<secret>
JWT_EXPIRES_IN=7d
PORT=3002
CORS_ORIGIN=http://localhost:3000
```

### Frontend (`.env.local`)
```env
GEMINI_API_KEY=<chave gemini para chat frontend>
```

---

## Gotchas & Observações

- **Hash routing**: React Router usa modo hash (`/#/rota`). Links diretos requerem `/#/`.
- **Multitenancy por role**: `HUB` só vê seu próprio hub; `LINK` só vê seus manifestos; `CLIENT` só seus pedidos.
- **CT-e vs Minuta**: CT-e é documento fiscal (requer SEFAZ). Minuta é interno. Hub emite conforme configuração.
- **Peso cubado**: tarifas usam fator de cubagem (kg/m³) — comparar peso real vs cubado, cobrar o maior.
- **Approval de Link**: Transportadores ficam `PENDING` até ADMIN aprovar (verificação de documentos).
- **Consolidação manual (MVP)**: No MVP, admin cria Manifesto manualmente. Futuramente, IA sugere.
- **Prisma schema é a fonte da verdade**: antes de alterar lógica de negócio, consultar `server/prisma/schema.prisma`.

---

## Contexto do MVP

**Objetivo imediato**: fazer a teia funcionar manualmente com escala:
1. Cliente solicita coleta/cotação
2. Admin consolida em Manifestos
3. Links executam as rotas
4. Hubs triagem e emitem CT-e

**Próximos passos planejados**:
- Agente IA para sugestão de consolidação de manifestos
- Agente IA para follow-up automático de oportunidades
- Dashboard de rastreamento em tempo real para clientes
- App mobile para motoristas (Links)
