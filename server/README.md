# TSM EX API - Backend

Backend da plataforma TSM EX para orquestração logística inteligente.

## Requisitos

- Node.js 18+
- Docker Desktop (para PostgreSQL e Redis)

## Setup Rápido

### 1. Iniciar banco de dados

```bash
docker-compose up -d
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

O arquivo `.env` já está configurado para desenvolvimento local.

### 4. Gerar cliente Prisma e rodar migrations

```bash
npm run db:generate
npm run db:migrate
```

### 5. Popular banco com dados iniciais

```bash
npm run db:seed
```

### 6. Iniciar servidor

```bash
npm run dev
```

O servidor estará disponível em `http://localhost:3001`

## Credenciais de Teste

| Role | Email | Senha |
|------|-------|-------|
| Admin | admin@tsmex.com.br | admin123 |
| Client | cliente@exemplo.com.br | cliente123 |
| Link | motorista@exemplo.com.br | link123 |

## Endpoints Principais

### Auth
- `POST /api/auth/register` - Cadastro
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Usuário atual

### Vehicle Types
- `GET /api/vehicle-types` - Listar
- `POST /api/vehicle-types` - Criar (Admin)

### HUBs
- `GET /api/hubs` - Listar
- `POST /api/hubs` - Criar (Admin)

### Demands
- `GET /api/demands` - Listar demandas
- `POST /api/demands` - Criar demanda
- `POST /api/demands/batch` - Criar em lote
- `PATCH /api/demands/:id/quote` - Cotar (Admin)

### Manifests
- `GET /api/manifests` - Listar manifestos
- `POST /api/manifests` - Criar (Admin)
- `POST /api/manifests/:id/demands` - Adicionar demanda
- `PATCH /api/manifests/:id/assign` - Atribuir a LINK

### Pricing
- `GET /api/pricing/tables` - Listar tabelas
- `POST /api/pricing/tables` - Criar tabela (Admin)
- `POST /api/pricing/calculate` - Calcular preço

## Estrutura de Pastas

```
server/
├── prisma/
│   ├── schema.prisma    # Schema do banco
│   └── seed.ts          # Dados iniciais
├── src/
│   ├── index.ts         # Entry point
│   ├── lib/
│   │   └── prisma.ts    # Cliente Prisma
│   ├── middleware/
│   │   ├── auth.ts      # Autenticação JWT
│   │   └── errorHandler.ts
│   └── routes/
│       ├── auth.ts
│       ├── vehicleTypes.ts
│       ├── hubs.ts
│       ├── clients.ts
│       ├── links.ts
│       ├── demands.ts
│       ├── manifests.ts
│       └── pricing.ts
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

### Cadastro de Pessoas (Admin)

- `GET /api/persons` - Listar pessoas (Admin)
- `GET /api/persons/:id` - Detalhe de uma pessoa
- `POST /api/persons` - Criar pessoa (Admin)
- `PATCH /api/persons/:id` - Editar pessoa (Admin)
- `POST /api/persons/sync` - Sincronizar: criar Person para Client/Link sem personId (Admin). Use na primeira vez ou quando a lista de pessoas estiver vazia.
- `POST /api/persons/:id/add-client` - Adicionar pessoa como Cliente (Admin)
- `POST /api/persons/:id/add-link` - Adicionar pessoa como Motorista (Admin)

Na primeira vez que usar a aba **Pessoas** no painel admin, clique em **Sincronizar pessoas** para importar clientes e motoristas existentes. Ou execute: `npm run db:migrate-persons`.

## Scripts

- `npm run dev` - Desenvolvimento com hot reload
- `npm run build` - Build para produção
- `npm run start` - Rodar build de produção
- `npm run db:generate` - Gerar cliente Prisma
- `npm run db:migrate` - Rodar migrations
- `npm run db:push` - Aplicar schema sem migration (dev)
- `npm run db:migrate-persons` - Criar Person para cada Client/Link existente (backfill)
- `npm run db:studio` - Visualizar banco (Prisma Studio)
- `npm run db:seed` - Popular banco
