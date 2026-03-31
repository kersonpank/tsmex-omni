---
name: ""
overview: ""
todos: []
isProject: false
---

# Plano: Refatoração Operacional Admin / Hub / Link (MVP)

## Visão e Modelo de Negócio ("Teia")

O TSM EX é uma **teia logística** que conecta:

- **Admin** – orquestra, configura e delega
- **Hub** – opera o depósito (entrada, carregamento, manifestos, estoque)
- **Link** – executa o transporte (recebe carga designada, confirma, executa)

**Princípio:** Menos código, um painel reutilizado, permissões por pessoa definidas pelo Admin.

---

## 1. ARQUITETURA DE ROTAS (Final)


| Rota      | Quem acessa | Conteúdo                                                                                     |
| --------- | ----------- | -------------------------------------------------------------------------------------------- |
| `/gestao` | ADMIN, HUB  | Painel de gestão (mesmo código). Admin vê tudo; Hub vê só seu depósito e conforme permissões |
| `/link`   | LINK        | App do motorista – login/cadastro simplificado + manifestos/carga                            |


**Removido/alterado:**

- `/admin` → `/gestao`
- `/operacao` → descontinuado; HUB vai para `/gestao`, LINK para `/link`
- `/operacao/cadastro` → `/link/cadastro` (cadastro do Link)

---

## 2. ESTRATÉGIA DE REDUÇÃO DE CÓDIGO

### 2.1 Hub usa o mesmo painel Admin (/gestao)

- **AdminDashboard** renomeado para **GestaoDashboard** (ou mantém nome, só rota muda).
- GestaoDashboard aceita `role` e `permissions`:
  - **ADMIN:** vê todas as categorias (Pessoas, Transporte, Comercial, Frota, Finanças, Gerais).
  - **HUB:** vê só categorias permitidas em `user.permissions`; dados filtrados por `user.hubId`.
- **HubHome.tsx:** funcionalidades (Entrada, Pedidos) migradas para sub-abas de Transporte no GestaoDashboard. Componente pode ser removido ou virar subcomponente.
- **OperacaoApp:** removido ou vira redirecionador simples (HUB→/gestao, LINK→/link).

### 2.2 Link: app próprio em /link

- Rota `/link` com layout próprio (sem nav do sistema principal).
- Tela inicial: login ou cadastro simplificado.
- Após login: conteúdo do Link (manifesto designado, status, pedidos).
- **OperacaoOnboarding** → simplificado e movido para `/link/cadastro`.
- **LinkOnboardingWizard** → descontinuado no MVP; onboarding completo fica para depois.

---

## 3. PERMISSÕES POR PESSOA

### 3.1 Modelo

**Admin define para cada usuário** o que pode fazer.

**Schema (Prisma):**

```prisma
model User {
  // ... campos existentes
  permissions String[] @default([])  // ["entrada", "manifestos", "pedidos", "demandas"] para HUB
}
```

**Permissões para HUB:**

- `entrada` – registrar entrada de mercadoria
- `pedidos` – ver e atualizar pedidos no hub
- `manifestos` – criar/editar manifestos do hub
- `demandas` – ver demandas relacionadas ao hub

**Permissões para LINK:**

- Link usa `approvalStatus` (PENDING/APPROVED) – já existe. Permissões extras podem vir depois.

**Permissões para ADMIN:**

- Admin tem acesso total; `permissions` pode ser vazio ou ignorado.

### 3.2 Onde Admin configura

- **HubsTab:** ao listar hubs, permitir "Usuários" por hub; ao criar/editar usuário do hub, definir `permissions`.
- **PessoasTab:** ou nova sub-aba "Usuários do sistema" – listar Users (HUB, LINK) e editar `permissions`.

**API:** `PATCH /api/users/:id/permissions` (Admin only) com body `{ permissions: string[] }`.

---

## 4. IMPLEMENTAÇÃO DETALHADA

### Fase 1: Rotas e Autenticação

#### 1.1 Rotas no App.tsx

- Trocar `/admin` por `/gestao`
- Trocar `ProtectedRoute` em gestao para `allowedRoles={['ADMIN','HUB']}`
- Criar rota `/link` com `ProtectedRoute` implícito ou checagem própria (Login/Cadastro dentro de /link)
- Criar rota `/link/cadastro` (pública ou sem auth para cadastro)
- Remover ou redirecionar `/operacao`:
  - Se usuário acessar `/operacao`: redirect HUB→/gestao, LINK→/link

#### 1.2 Login e redirects

- **Login.tsx:** após login, redirect: ADMIN→/gestao, HUB→/gestao, LINK→/link, CLIENT→/client
- **auth/me e auth/login:** retornar `hubId` e `permissions` para HUB; `hub` (objeto) opcional

#### 1.3 Backend auth

- **auth/login:** incluir `hubId`, `hub: { id, name, code }`, `permissions` quando role=HUB
- **auth/me:** incluir `hub`, `permissions` para User
- **Middleware:** garantir que `req.user.hubId` e `req.user.permissions` estejam preenchidos para HUB

### Fase 2: Schema e Permissões

#### 2.1 Migração Prisma

```prisma
model User {
  // ... existente
  permissions String[] @default([])
}
```

#### 2.2 API de permissões

- `GET /api/users` – Admin lista users (filtro por role, hubId)
- `PATCH /api/users/:id/permissions` – Admin atualiza `permissions`

#### 2.3 Criação de usuário Hub

- `POST /api/hubs/:id/users` – incluir `permissions` no body
- HubsTab: ao adicionar usuário ao Hub, permitir selecionar permissões (checkboxes)

### Fase 3: GestaoDashboard (Admin + Hub)

#### 3.1 GestaoDashboard

- Renomear referências de "Admin" para "Gestao" onde fizer sentido
- Receber `user` (role, hubId, permissions) via `useAuthStore`
- **Se role=HUB:**
  - Filtrar categorias: mostrar só as que o usuário tem permissão
  - Ex.: se `permissions` inclui `entrada` e `pedidos`, mostrar só Transporte com sub-abas relevantes
  - Todas as chamadas de API já filtram por `hubId` (hubs, orders, manifests) – validar isso

#### 3.2 Menu condicional

- ADMIN: Pessoas, Transporte (Demandas, Viagens, Pedidos, Motoristas, Rotas, Hubs), Comercial, Frota, Finanças, Gerais
- HUB: conforme permissions, ex.:
  - `entrada` → sub-aba Entrada (formulário de HubHome)
  - `pedidos` → sub-aba Pedidos
  - `manifestos` → sub-aba Viagens (ManifestsTab)
  - `demandas` → sub-aba Demandas

#### 3.3 Componentes reutilizados

- **Entrada:** extrair form de HubHome para um componente `EntradaForm` usado na aba Transporte quando Hub tem `entrada`
- **PedidosTab:** já suporta filtro por hub (orders API)
- **ManifestsTab:** ajustar para HUB – filtrar por hubId; permitir criar manifesto com hubId=user.hubId

#### 3.4 APIs para HUB

- **manifests:** `POST` e `POST :id/demands` – permitir HUB quando `hubId=user.hubId`
- **demands:** `GET` – HUB vê demandas onde Order.currentHubId=hubId ou Manifest.hubId=hubId
- **orders:** já filtra por currentHubId
- **hubs:** HUB já vê só o próprio hub

### Fase 4: App Link (/link)

#### 4.1 Estrutura de rotas /link

- `/link` – tela principal do Link
  - Se não logado: mostrar Login simplificado
  - Se logado como LINK: mostrar conteúdo (manifesto, pedidos)
- `/link/cadastro` – cadastro simplificado (email, senha, WhatsApp)

#### 4.2 Layout

- Sem Navigation principal (ou nav minimal: logo, sair)
- Container focado em mobile

#### 4.3 Login simplificado

- Componente `LinkLogin`: email + senha, botão Entrar, link "Cadastrar"
- Usa mesma API `/api/auth/login`
- Após login: se role=LINK, redirect para conteúdo; senão, erro ou redirect

#### 4.4 Cadastro simplificado

- Componente `LinkCadastro`: email, senha, WhatsApp (obrigatório)
- Usa `POST /api/auth/register` com `role: 'LINK'`, `whatsappPhone`
- Após sucesso: login automático, redirect para /link

#### 4.5 Conteúdo pós-login (MVP)

- **Tela principal:** "Minha Carga"
  - Se há manifesto PENDING_ACCEPT: card para Confirmar
  - Se há manifesto ACCEPTED/IN_PROGRESS: card da viagem + Iniciar / Finalizar / status
- **Pedidos:** lista de pedidos da viagem atual (coleta, chegou no hub, entregue)
- Sem tab "Ofertas"; Link só vê carga designada

#### 4.6 O que remover/adiar

- LinkOnboardingWizard: não mostrar no MVP; Link aprovado pode ir direto ao app
- Onboarding completo do Link: fase futura

### Fase 5: Navegação e Ajustes

#### 5.1 Navigation

- ADMIN: link "Torre de Controle" → /gestao
- HUB: link "Operação" ou "Meu Depósito" → /gestao
- LINK: não aparece na nav principal (acessa /link direto)
- Esconder links irrelevantes: HUB não vê Chat, Formulário (a menos que queiramos)

#### 5.2 Redirect raiz

- `/` → ADMIN→/gestao, HUB→/gestao, LINK→/link, CLIENT→/client, não logado→/login

#### 5.3 Links no Login

- "Criar Conta Empresarial" → /onboarding
- "Cadastre-se como motorista" → /link/cadastro

---

## 5. ORDEM DE IMPLEMENTAÇÃO


| #   | Tarefa                                                 | Arquivos                               | Dependência |
| --- | ------------------------------------------------------ | -------------------------------------- | ----------- |
| 1   | Migração User.permissions                              | schema.prisma, migrate                 | -           |
| 2   | API users/permissions                                  | server/routes/users.ts (novo)          | 1           |
| 3   | auth/me e login retornam hubId, permissions            | server/routes/auth.ts                  | 1           |
| 4   | Trocar /admin→/gestao, gestao aceita HUB               | App.tsx, Login.tsx, Navigation         | -           |
| 5   | GestaoDashboard: menu condicional por role+permissions | AdminDashboard.tsx                     | 3, 4        |
| 6   | Integrar Entrada no GestaoDashboard (aba Transporte)   | AdminDashboard, novo EntradaForm       | 5           |
| 7   | APIs manifests/demands permitir HUB com escopo         | server/routes/manifests.ts, demands.ts | 3           |
| 8   | HubsTab: UI para permissions ao criar/editar user      | HubsTab.tsx, api                       | 2           |
| 9   | Criar rota /link e layout                              | App.tsx, LinkApp.tsx (novo)            | -           |
| 10  | LinkLogin + LinkCadastro simplificados                 | LinkLogin.tsx, LinkCadastro.tsx        | 9           |
| 11  | Conteúdo Link: Minha Carga + Pedidos                   | LinkHome.tsx refatorado                | 10          |
| 12  | Remover /operacao, redirect HUB→gestao, LINK→link      | App.tsx, OperacaoApp                   | 4, 9        |
| 13  | Corrigir seleção de Hub em "Chegou no hub" (dropdown)  | LinkHome                               | 11          |


---

## 6. ARQUIVOS A CRIAR / ALTERAR


| Arquivo                             | Ação                                               |
| ----------------------------------- | -------------------------------------------------- |
| `server/prisma/schema.prisma`       | Adicionar User.permissions                         |
| `server/src/routes/users.ts`        | Novo – GET users, PATCH permissions                |
| `server/src/routes/auth.ts`         | Incluir hubId, permissions em login e me           |
| `server/src/routes/hubs.ts`         | Incluir permissions em add user                    |
| `server/src/routes/manifests.ts`    | Permitir HUB em create/addDemand                   |
| `server/src/routes/demands.ts`      | Filtro para HUB                                    |
| `server/src/index.ts`               | Registrar usersRouter                              |
| `App.tsx`                           | Rotas /gestao, /link, /link/cadastro; redirects    |
| `Login.tsx`                         | Redirect por role                                  |
| `AdminDashboard.tsx`                | Menu condicional, EntradaForm integrado            |
| `components/gestao/EntradaForm.tsx` | Extrair de HubHome                                 |
| `components/link/LinkApp.tsx`       | Novo – container /link                             |
| `components/link/LinkLogin.tsx`     | Novo – login simplificado                          |
| `components/link/LinkCadastro.tsx`  | Novo – cadastro simplificado                       |
| `components/operacao/LinkHome.tsx`  | Refatorar – usar em /link                          |
| `components/admin/HubsTab.tsx`      | UI permissions em add user                         |
| `OperacaoApp.tsx`                   | Remover ou virar redirect                          |
| `HubHome.tsx`                       | Migrar lógica para GestaoDashboard, depois remover |


---

## 7. O QUE FICA BEM DEFINIDO NO MVP

- Admin e Hub no mesmo painel (/gestao) com permissões por usuário
- Link com app próprio (/link) e login/cadastro simplificado
- Fluxo: Admin/Hub atribui manifesto ao Link → Link vê em /link → Confirma → Executa
- Menos componentes e rotas; reuso máximo no painel de gestão

---

## 8. O QUE FICA PARA DEPOIS

- Etiquetas, estoque, retirada no Hub
- Onboarding completo do Link (documentos, fotos, banco)
- Cadastro de Hub pelo fluxo público
- Notificações (WhatsApp, email)

