# Análise Completa do Admin TSM EX Omni

> **Objetivo:** Entender tudo que existe, o que falta e gerar contexto suficiente para implementar novos passos do MVP.

---

## 1. VISÃO GERAL DO ADMIN

O painel admin é acessado via rota `/gestao` por usuários com roles **ADMIN** ou **HUB**. O mesmo componente `AdminDashboard` serve ambos, com menu e dados filtrados por role e permissões.

### 1.1 Estrutura de Categorias (Menu Principal)

| Categoria   | Admin vê? | Hub vê? | Descrição                    |
|-------------|-----------|---------|------------------------------|
| Pessoas     | ✅        | ❌      | Cadastro de pessoas (CPF/CNPJ) |
| Transporte  | ✅        | ✅*     | Demandas, Entrada, Viagens, Pedidos, Motoristas, Rotas, Hubs |
| Comercial   | ✅        | ❌      | Cotações/Oportunidades, Clientes, Tarifas |
| Frota       | ✅        | ❌      | Tipos de veículo             |
| Finanças    | ✅        | ❌      | Notas/Faturamento            |
| Gerais      | ✅        | ❌      | Configurações LLM            |

*Hub vê apenas sub-abas permitidas (entrada, demandas, manifestos, pedidos) conforme `user.profile.hub.permissions`.

---

## 2. MAPA DAS ABAS E COMPONENTES

### 2.1 Pessoas (`PessoasTab`)

**O que tem:**
- Listagem de pessoas (Person) com filtros: tipo doc (CPF/CNPJ), nome, tem cliente, tem motorista
- Sincronização (personsApi.sync) – importa clientes e links existentes
- Criar/Editar pessoa (PersonFormModal)
- Modal detalhe com dados gerais e relacionamentos
- Adicionar como Cliente (AddClientModal)
- Adicionar como Motorista (AddLinkModal) – exige vehicleTypeId, placa, base
- Adicionar como operador de Hub (AddHubModal) – seleciona hub, email, senha

**APIs usadas:**
- `personsApi.list`, `getById`, `create`, `update`, `sync`
- `personsApi.addClient`, `addLink`, `addHub`
- `vehicleTypesApi.list`, `hubsApi.list`

**O que falta (plano):**
- Não há UI para editar `permissions` do usuário HUB ao adicionar via AddHubModal
- Sub-aba "Usuários do sistema" para Admin listar/editar Users e permissions (PATCH /users/:id/permissions)

---

### 2.2 Transporte – Sub-abas

#### 2.2.1 Entrada (`EntradaTab`)

**O que tem:**
- Formulário de entrada de mercadoria: cliente, NF, origem, destino, mercadoria, peso, volume, risco
- `hubsApi.entrada(data)` → cria Demand + Order + DemandEvent + OrderHistory
- Backend: **apenas HUB** pode usar – usa `req.user.hubId` automaticamente

**APIs:** `clientsApi.list`, `hubsApi.entrada`

**O que falta:**
- Admin não pode registrar entrada (API exige role HUB e hubId)
- Se Admin precisar simular entrada para um hub específico, seria necessário endpoint alternativo ou parametrização de hubId (fora do escopo MVP atual)
- Validação: para HUB, o form está OK; fluxo operacional esperado

---

#### 2.2.2 Demandas (inline no AdminDashboard)

**O que tem:**
- Lista demandas, stats (pendentes, em trânsito, risco A, faturado)
- Cotar demanda (modal)
- Avançar status (QUOTED → APPROVED → COLLECTED → … → DELIVERED)
- Link para tracking
- Ações rápidas: Novo via Chat, Novo via Formulário (Admin only)

**APIs:** `demandsApi.list`, `quote`, `updateStatus`

**Backend:** HUB vê apenas demandas onde manifest.hubId ou order.currentHubId = user.hubId

**O que falta:**
- Filtros por status, cliente, destino na UI
- Paginação explícita (usa limit 50)

---

#### 2.2.3 Viagens (`ManifestsTab`)

**O que tem:**
- Criar viagem (tipo veículo, origem, destino, hub opcional)
- Adicionar demanda aprovada à viagem
- Atribuir motorista (Link)
- Enviar oferta ao Link
- Remover demanda da viagem
- Lista de manifestos com status e demandas

**APIs:** `manifestsApi.create`, `addDemand`, `removeDemand`, `assignLink`, `offerToLink`
**Backend:** HUB só cria manifestos para seu hub; só vê manifestos do seu hub

**O que falta:**
- Iniciar viagem / Concluir viagem (API existe: start, complete) – **UI não expõe**
- Filtro por status na listagem

---

#### 2.2.4 Pedidos (`PedidosTab`)

**O que tem:**
- Lista pedidos (Order) com NF, origem→destino, status, HUB atual
- Filtro por status

**APIs:** `ordersApi.list`
**Backend:** HUB vê apenas pedidos com currentHubId = user.hubId

**O que falta:**
- Atualizar status do pedido (Chegou no hub, Saiu para entrega, Entregue) – **API existe** (`ordersApi.updateStatus`, `addHistory`), **UI não expõe**
- Link para detalhe/tracking do pedido

---

#### 2.2.5 Motoristas (`MotoristasTab`)

**O que tem:**
- Lista Links (motoristas)
- Aprovar/Recusar com seleção de VehicleType
- Exibição de status (PENDING, APPROVED, REJECTED, SUSPENDED)

**APIs:** `linksApi.list`, `approve`, `reject`, `vehicleTypesApi.list`

**O que falta:**
- Editar motorista (linksApi.update)
- Ver detalhes (documentos, histórico)
- Suspender (API pode ter; verificar)

---

#### 2.2.6 Rotas (`TransportTab`)

**O que tem:**
- CRUD de rotas de precificação (PricingRoute): nome, origem, destino, códigos
- Filtrar por nome, incluir inativas
- Desativar rota (delete – soft via active)

**APIs:** `pricingApi.listRoutes`, `createRoute`, `updateRoute`, `deleteRoute`, `getRouteById`

**Estado:** Funcional para o MVP

---

#### 2.2.7 Hubs (`HubsTab`)

**O que tem:**
- Lista hubs, criar/editar hub (nome, código, cidade, estado, endereço, gerente, contato, ativo)
- Copiar link de cadastro para usuários do hub

**APIs:** `hubsApi.list`, `create`, `update`

**O que falta (plano):**
- UI para gerenciar usuários do hub (listar, adicionar com permissions)
- `POST /api/hubs/:id/users` com body incluindo `permissions` – backend já suporta?
- Verificar se HubsTab deveria listar usuários por hub e permitir edição de permissions

---

### 2.3 Comercial

#### 2.3.1 Cotações / Oportunidades (`CommercialTab`)

**O que tem:**
- Pipeline Kanban com colunas drag-and-drop
- Cards de oportunidades com stage, data, origem→destino
- Modal de detalhes (OpportunityDetailsModal)
- Converter em demanda

**APIs:** `opportunitiesApi`, `pipelineApi`

**Estado:** Funcional

---

#### 2.3.2 Clientes (`ClientesTab`)

**O que tem:**
- Lista clientes (razão social, documento, contato, email)
- Somente leitura

**APIs:** `clientsApi.list`

**O que falta:**
- Criar/Editar cliente a partir do Admin (hoje via PessoasTab > AddClient)
- Link para conta/empresas

---

#### 2.3.3 Tarifas (`TarifasTab`)

**O que tem:**
- Gestão de tabelas de preço (PricingTable) vinculadas a rotas e clientes
- Cálculo de frete

**APIs:** `pricingApi`

**Estado:** Integrado ao CommercialTab; verificar completude

---

### 2.4 Frota (`FrotaTab`)

**O que tem:**
- CRUD de tipos de veículo (VehicleType): nome, código, peso/volume/valor máx., fechado, refrigerado, ativo
- Desativar tipo

**APIs:** `vehicleTypesApi.list`, `create`, `update`

**Estado:** Funcional

---

### 2.5 Finanças (`FaturasTab`)

**O que tem:**
- Lista faturas (Invoice) com filtro por status
- Exibe: ID, conta, subtotal, status, vencimento

**APIs:** `invoicesApi.list`

**Inconsistência:**
- `FaturasTab` usa labels: DRAFT, ISSUED, SENT, PAID, OVERDUE, CANCELLED
- Schema Prisma: `PENDING`, `PAID`, `OVERDUE`, `CANCELLED`
- Ajustar labels para refletir o schema real

**O que falta:**
- Criar fatura (API existe: `invoicesApi.create`, `createBatch`)
- Editar fatura (API existe: `invoicesApi.update`, `updateStatus`)
- Marcar como paga
- Download/visualização de PDF

---

### 2.6 Gerais (`SettingsLLM`)

**O que tem:**
- Configuração de provedores e modelos LLM para o chat
- API keys, rotação de modelos

**Estado:** Específico do LLM; funcional dentro do escopo

---

## 3. BACKEND – RESUMO DAS APIs

| Rota              | Admin | Hub   | Observação                                  |
|-------------------|-------|-------|---------------------------------------------|
| demands           | ✅    | ✅*   | Hub: filtrado por manifest/order no hub     |
| manifests         | ✅    | ✅*   | Hub: só próprio hub                         |
| orders            | ✅    | ✅*   | Hub: currentHubId = user.hubId              |
| hubs              | ✅    | ✅*   | Hub: só próprio hub                         |
| hubs/entrada      | ❌    | ✅    | Exige hubId (HUB only)                      |
| clients           | ✅    | ✅    | Ambos para dropdown de entrada              |
| links             | ✅    | ?     | Admin lista todos; Hub normalmente não usa  |
| invoices          | ✅    | ❌    | Admin; Client vê da conta                   |
| persons           | ✅    | ❌    | Admin only                                  |
| users             | ✅    | ❌    | Admin only; PATCH permissions               |
| pipeline          | ✅    | ❌    | Admin only                                  |
| pricing           | ✅    | ❌    | Admin only                                  |
| vehicle-types     | ✅    | ✅    | Ambos (para manifestos, entrada, etc.)      |

---

## 4. PERMISSÕES HUB (Plano vs Implementado)

**Schema:** `User.permissions String[]` ✅ existe no Prisma

**Auth:** Login/me retornam `permissions` no payload do user ✅

**AdminDashboard:** Usa `user?.profile?.hub?.permissions` – possível inconsistência; o auth retorna `user.permissions`. Verificar estrutura exata e alinhar leitura.

**Permissões definidas no plano:**
- `entrada` – registrar entrada
- `pedidos` – ver/atualizar pedidos no hub
- `manifestos` – criar/editar manifestos do hub
- `demandas` – ver demandas do hub

**O que falta:**
- HubsTab / PessoasTab AddHubModal: UI para marcar permissions ao criar usuário HUB
- PATCH /users/:id/permissions – API existe; falta tela para Admin alterar

---

## 5. O QUE FALTA PARA O MVP FUNCIONAR COMPLETAMENTE

### 5.1 Prioridade Alta (Fluxo Operacional)

1. **PedidosTab – Atualizar status**
   - Botões/ações: "Chegou no hub", "Saiu para entrega", "Entregue"
   - Usar `ordersApi.updateStatus` e `addHistory`
   - Para "Chegou no hub": dropdown de hub (Admin) ou fixo no user.hubId (Hub)

2. **ManifestsTab – Iniciar e Concluir viagem**
   - Botões "Iniciar viagem" e "Concluir viagem" quando status permitir
   - Chamar `manifestsApi.start` e `manifestsApi.complete`

3. **FaturasTab – Labels**
   - Corrigir statusLabels para PENDING, PAID, OVERDUE, CANCELLED
   - Adicionar ações: criar fatura, marcar como paga

### 5.2 Prioridade Média (Gestão e Permissões)

4. **HubsTab – Usuários e Permissions**
   - Listar usuários do hub
   - Ao adicionar usuário (via HubsTab ou PessoasTab), permitir marcar permissions (entrada, pedidos, manifestos, demandas)

5. **EntradaTab – Esconder para Admin sem hub**
   - Se Admin não tiver hubId, não mostrar Entrada ou exibir mensagem "Apenas operadores de hub podem registrar entrada"

6. **ClientesTab – Edição**
   - Criar/editar cliente pelo Admin (ou garantir que o fluxo via PessoasTab seja o único e bem documentado)

### 5.3 Prioridade Baixa (Melhorias)

7. **Demandas – Filtros e paginação**
8. **MotoristasTab – Editar motorista**
9. **FaturasTab – Criar/editar fatura, PDF**

---

## 6. FLUXO DE DADOS RESUMIDO

```
Pessoa (CPF/CNPJ) 
  → + Cliente (Client) 
  → + Motorista (Link) 
  → + Operador Hub (User HUB)

Demanda (cotação → aprovada) 
  → Order (pedido) 
  → Manifest (viagem) 
  → Link (motorista) 
  → Execução (start/complete)

Order AT_HUB 
  → currentHubId = hub onde está
  → Invoice (fatura) ligada a Order/Demand/Manifest + Account
```

---

## 7. ARQUIVOS RELEVANTES

| Área        | Frontend                               | Backend                          |
|------------|-----------------------------------------|----------------------------------|
| Admin      | `AdminDashboard.tsx`                    | -                                |
| Pessoas    | `admin/PessoasTab.tsx`                  | `routes/persons.ts`              |
| Hubs       | `admin/HubsTab.tsx`                     | `routes/hubs.ts`                 |
| Entrada    | `admin/EntradaTab.tsx`                  | `routes/hubs.ts` (POST /entrada) |
| Manifests  | `admin/ManifestsTab.tsx`                | `routes/manifests.ts`            |
| Pedidos    | `admin/PedidosTab.tsx`                  | `routes/orders.ts`               |
| Motoristas | `admin/MotoristasTab.tsx`               | `routes/links.ts`                |
| Frota      | `admin/FrotaTab.tsx`                    | `routes/vehicleTypes.ts`         |
| Faturas    | `admin/FaturasTab.tsx`                  | `routes/invoices.ts`             |
| Clientes   | `admin/ClientesTab.tsx`                 | `routes/clients.ts`              |
| Rotas      | `transport/TransportTab.tsx`            | `routes/pricing.ts`              |
| Comercial  | `CommercialTab.tsx`, `TarifasTab.tsx`   | `routes/opportunities.ts`, etc.  |
| Auth       | `authStore.ts`                          | `routes/auth.ts`                 |
| API        | `lib/api.ts`                            | -                                |

---

## 8. PRÓXIMOS PASSOS SUGERIDOS (Ordem de Implementação)

1. **Corrigir FaturasTab** – labels de status (5 min)
2. **PedidosTab – Ações de status** – Chegou no hub, Saiu para entrega, Entregue (1–2 h)
3. **ManifestsTab – Iniciar/Concluir** – botões e chamadas API (30 min)
4. **HubsTab – UI de permissions** – ao criar usuário no hub, checkboxes de entrada/pedidos/manifestos/demandas (1–2 h)
5. **Verificar authStore/profile** – garantir que permissions são lidas corretamente no AdminDashboard
6. **Documentar fluxo** – para quem for dar manutenção ou implementar novas features

---

*Documento gerado em 12/02/2026 para suporte à evolução do MVP TSM EX Omni.*
