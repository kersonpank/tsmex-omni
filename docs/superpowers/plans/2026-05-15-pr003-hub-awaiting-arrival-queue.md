# PR003 — Fila "Aguardando chegada" no Hub (recebimento operacional)

## Status (congelamento de escopo)

**Aprovado conceitualmente.** Escopo **fechado** para merge/deploy deste PR — **sem** aba de exceções na Torre de Controle; isso fica no follow-up **[PR003.1 — Exceções de Intake](2026-05-15-pr003-1-intake-exceptions-tower.md)**.

**Incluído no PR003:**

- Fila **Aguardando chegada** no app Hub (`AWAITING_ARRIVAL` + isolamento por `expectedHubId`).
- **Busca** (`q`) e **lookup por chave** (`lookup-by-key`).
- **`confirm-arrival`**: cria `Order`, `Demand` → `AT_HUB`, eventos/histórico alinhados ao serviço.
- API `onlyUnassignedHub` pode existir para uso futuro; **não** há UI Admin de exceções neste PR.

**Antes de commit/deploy:** rodar smoke manual do fluxo completo — `server/scripts/smoke-pr002-intake.mjs` (inclui etapa **PR003**: lookup + confirm-arrival), com API no ar e seed aplicado.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O operador Hub vê uma fila dedicada de materiais esperados para **o próprio CD** (`AWAITING_ARRIVAL` + `expectedHubId`), pesquisa por chave/NF/CNPJ/etc., resolve chegada por chave NF (0/1/N candidatos) e **confirma chegada** criando `Order` e retirando a demanda da fila.

**Architecture:** Reutilizar rotas `/api/intake` existentes (`server/src/routes/intakeDemands.ts`) e `createIntakeDemand` / política de intake. Estender API com **busca textual** + **lookup por chave** + **confirm-arrival** (transação Prisma: cria `Order`, atualiza `Demand.status`, eventos). No front, nova aba no shell Hub (`components/operacao/HubHome.tsx`) consumindo `intakeDemandsApi` (`lib/api.ts`) com fluxo de scanner e confirmação.

**Tech Stack:** React 19 + Vite, Zustand auth, Axios (`lib/api.ts`), Express + Prisma 6 + PostgreSQL, Zod.

---

## Mapa de arquivos (fronteiras)

| Área | Arquivo | Responsabilidade |
|------|---------|------------------|
| API intake | `server/src/routes/intakeDemands.ts` | Novos query params, lookup, confirm-arrival POST |
| Serviço | `server/src/services/intake/confirmIntakeArrival.ts` (novo) | Transação: validar guard, criar Order, AT_HUB, eventos |
| Política | `server/src/services/intake/intakeDemandPolicy.ts` | Helpers: exige expectedHubId em criação; who can confirm |
| Criação intake | `server/src/services/intake/createIntakeDemand.ts` | Garantir preenchimento de `expectedHubId` quando regras exigirem |
| Carga NF | `server/src/lib/nfeChaveIntake.ts` | Normalizar chave (reuso lookup) |
| Demandas legado | `server/src/routes/demands.ts` | Opcional: listagem admin "exceções" ou só intake estendido |
| Cliente HTTP | `lib/api.ts` | `search`, `lookupByNfeKey`, `confirmArrival` |
| Tipos | `types/index.ts` | Tipos de request/response novos |
| UI Hub | `components/operacao/HubHome.tsx` | Nova aba + navegação inferior |
| UI fila | `components/operacao/HubAwaitingArrivalTab.tsx` (novo) | Lista, busca, modal confirmação, fluxo chave |
| Ícone nav | `components/operacao/hubNavIcons.tsx` | Ícone "recebimento" (opcional) |
| Testes | `server/src/services/intake/confirmIntakeArrival.test.ts` (novo) | Mocks Prisma, casos confirm + bloqueios |
| Testes rota | `server/src/routes/intakeDemands.confirm.test.ts` (novo) **ou** supertest folder existente se houver | HTTP 200/403/404 |

---

### Task 1: Política `expectedHubId` obrigatório "sempre que possível"

**Files:**
- Modify: `server/src/services/intake/intakeDemandPolicy.ts`
- Modify: `server/src/routes/intakeDemands.ts` (`resolveExpectedHubId`, validação pós-parse)
- Modify: `server/src/services/intake/createIntakeDemand.ts` (apenas se precisar de default explícito)
- Test: `server/src/services/intake/intakeDemandPolicy.test.ts`

**Regras codificadas:**
- **HUB:** já força `req.user.hubId` — ok.
- **ADMIN** em `POST /intake/demands` e `POST /intake/demands/from-nfe-key`: se `expectedHubId` ausente, **rejeitar 400** com mensagem clara *("Informe o hub de recebimento esperado.")*, exceto se no futuro existir fluxo explícito "triagem nacional"; **para PR003 não há exceção silenciosa** — admin sempre informa hub na criação via UI/API.
- Intakes criados por integração futura (DFE_ACBR) ficam fora desta task; quando implementados, devem setar `expectedHubId` na origem.

- [ ] **Step 1: Escrever teste que ADMIN sem `expectedHubId` em body recebe 400**

Adicionar em `intakeDemandPolicy.test.ts` uma função pura exportada, por exemplo `assertExpectedHubIdForIntakeCreation(isAdmin: boolean, expectedHubId: string | null | undefined): void` que lança mensagem fixa se admin e hub ausente.

```typescript
// intakeDemandPolicy.ts — exemplo a implementar
export function requireExpectedHubIdForAdminIntake(
  roles: string[],
  expectedHubId: string | null | undefined,
): asserts expectedHubId is string {
  if (roles.includes('ADMIN') && !roles.includes('HUB')) {
    if (!expectedHubId || !expectedHubId.trim()) {
      throw new Error('Informe o hub de recebimento esperado (expectedHubId).');
    }
  }
}
```

- [ ] **Step 2: Rodar teste isolado**

Run: `cd server && npm test -- intakeDemandPolicy.test.ts`  
Expected: novo teste passa; testes existentes passam após ajuste.

- [ ] **Step 3: Chamar validação em `intakeDemands.ts` nos dois POSTs** após `resolveExpectedHubId` (para ADMIN, `resolveExpectedHubId` retorna `bodyHubId`; validar não-nulo).

- [ ] **Step 4: Commit**

```bash
git add server/src/services/intake/intakeDemandPolicy.ts server/src/services/intake/intakeDemandPolicy.test.ts server/src/routes/intakeDemands.ts
git commit -m "fix(intake): exige expectedHubId para criação intake por admin"
```

---

### Task 2: GET `/api/intake/demands` — busca `q` + filtro exceções (admin, API apenas no PR003)

**Files:**
- Modify: `server/src/routes/intakeDemands.ts`
- Test: novo arquivo `server/src/services/intake/intakeListQuery.test.ts` (função pura `buildIntakeSearchWhere`) **ou** testes de integração mínimos

**Comportamento:**
- Query existente: `status` (default `AWAITING_ARRIVAL`), `expectedHubId`, paginação.
- Novo: `q` string opcional — busca case-insensitive em:
  - `documentKey` (normalizar só dígitos para comparar chave colada)
  - `nfNumber`
  - `id` (uuid completo ou prefixo 8 chars se quiser UX; mínimo: contains uuid string)
  - `externalReference`
  - `origin`, `destination`
  - `client.document`, `client.companyName` (via `include` onde ou subconsulta Prisma `OR`)
- **HUB:** mantém filtro `expectedHubId = user.hubId` **e** aplica `q` dentro desse escopo.
- **ADMIN:** 
  - Novo query `onlyUnassignedHub=true` (ou `exceptions=1`): `status=AWAITING_ARRIVAL` **e** `expectedHubId = null` para tela "Exceções".
  - Sem esse flag: lista todas intake com filtros normais + `q`.

Implementação sugerida: função exportada `buildIntakeDemandSearchWhere(q: string | undefined): Prisma.DemandWhereInput` com array `OR` de condições; mesclar com `intakeListWhere`.

- [ ] **Step 1: Teste unitário `buildIntakeDemandSearchWhere` com q contendo 44 dígitos**

```typescript
// intakeListQuery.ts (novo)
import type { Prisma } from '@prisma/client';
import { extractChaveFromInput } from '../../lib/nfeChaveIntake.js';

export function buildIntakeDemandSearchWhere(q: string | undefined): Prisma.DemandWhereInput {
  if (!q || !q.trim()) return {};
  const raw = q.trim();
  const digits = extractChaveFromInput(raw);
  const or: Prisma.DemandWhereInput[] = [
    { nfNumber: { contains: raw, mode: 'insensitive' } },
    { origin: { contains: raw, mode: 'insensitive' } },
    { destination: { contains: raw, mode: 'insensitive' } },
    { externalReference: { contains: raw.replace(/\s/g, ''), mode: 'insensitive' } },
    { client: { companyName: { contains: raw, mode: 'insensitive' } } },
    { client: { document: { contains: raw.replace(/\D/g, ''), mode: 'insensitive' } } },
  ];
  if (digits.length >= 8) {
    or.push({ documentKey: { contains: digits.slice(0, 44), mode: 'insensitive' } });
  }
  if (raw.length >= 8 && /^[0-9a-f-]+$/i.test(raw)) {
    or.push({ id: { equals: raw } });
  }
  return { OR: or };
}
```

- [ ] **Step 2: Integrar na rota GET** — fazer merge seguro com `intakeListWhere`, cuidado com `AND` de `sourceType` in intake.

- [ ] **Step 3: Rodar `npm run typecheck` e `npm test` no server**

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/intakeDemands.ts server/src/services/intake/intakeListQuery.ts server/src/services/intake/intakeListQuery.test.ts
git commit -m "feat(intake): busca q e filtro exceções sem expectedHubId (admin)"
```

---

### Task 3: POST `/api/intake/demands/lookup-by-key` (hub + admin)

**Files:**
- Modify: `server/src/routes/intakeDemands.ts`
- Modify: `lib/api.ts` — método `lookupAwaitingByKey(chave: string)`
- Modify: `types/index.ts` se precisar tipo de resposta

**Corpo:** `{ "chave": "3525..." }`  
**Resposta:** `{ success, data: { matches: Demand[] } }` com máximo **20** candidatos, apenas:
- `status === 'AWAITING_ARRIVAL'`
- `sourceType in INTAKE_SOURCE_TYPES`
- sem `order` ( relation null )
- **HUB:** `expectedHubId === user.hubId`
- **ADMIN:** sem filtro de hub (ou opcional `?expectedHubId=` no body)

Normalizar chave com `extractChaveFromInput` + se 44 dígitos comparar `documentKey` normalizado.

- [ ] **Step 1: Implementar rota com Zod** `z.object({ chave: z.string().min(8) })`

- [ ] **Step 2: Teste integração leve** com mock prisma em arquivo `lookupByKey.test.ts` **ou** test de serviço puro `findIntakeByDocumentKeyForHub`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(intake): lookup demandas aguardando por chave NF"
```

---

### Task 4: Serviço `confirmIntakeArrival` + POST `/api/intake/demands/:id/confirm-arrival`

**Files:**
- Create: `server/src/services/intake/confirmIntakeArrival.ts`
- Create: `server/src/services/intake/confirmIntakeArrival.test.ts`
- Modify: `server/src/routes/intakeDemands.ts`
- Modify: `lib/api.ts` — `confirmArrival(id: string, body?: { currentHubId?: string })`
- Modify: `server/src/routes/demands.ts` — **não** duplicar lógica; confirm só via intake

**Lógica (transação):**
1. Carregar `Demand` com `order`, `client`, `expectedHubId`, `sourceType`, `status`.
2. Se `status !== 'AWAITING_ARRIVAL'` → 400  
3. Se `order` existe → 400 "Já confirmada"  
4. Se não `isIntakeSource(sourceType)` → 404 ou 400  
5. **HUB:** `demand.expectedHubId !== user.hubId` → 403  
6. Criar `Order` espelhando padrão de `demands.ts` quando cria a partir de COLLECTED/AT_HUB (campos mínimos): `demandId`, `status: 'AT_HUB'`, `currentHubId: user.hubId` (hub) ou `demand.expectedHubId` / body `currentHubId` (admin), `freightTerm` opcional null até preenchimento posterior se modelo permitir.
   - **Nota:** Order exige pessoas (`remetentePersonId`, `destinatarioPersonId`) no `orders/entrada`; para intake pode ser necessário:
     - **Opção A (MVP PR003):** criar Order com `remetentePersonId`/`destinatarioPersonId` derivados do `Client.personId` quando existir; se `client.personId` null, exigir no body da confirm `remetentePersonId` + `destinatarioPersonId` (Zod opcional primeiro, depois reforçar).
   - Escolha no plano: **body opcional com pessoas; se ausente e `client.personId` existe, usar como remetente e exigir destinatário em campo separado ou placeholder Person "A definir"** — **proibido placeholder silencioso sem produto definido**.
   - **Definição fechada para o implementador:** Confirm body:

```typescript
// confirm-arrival body schema
const confirmArrivalSchema = z.object({
  remetentePersonId: z.string().uuid().optional(),
  destinatarioPersonId: z.string().uuid().optional(),
  freightTerm: z.enum(['CIF', 'FOB', 'REDESPACHO']).optional(),
});
```

   - Regra: após carregar demand + client:  
     `const remetente = body.remetentePersonId ?? client.personId`  
     se `!remetente` → 400 "Associe pessoa remetente ao cliente ou informe remetentePersonId."  
     `destinatarioPersonId` **obrigatório no body** na v1 PR003 (hub conhece NF; operador informa ou seleciona destinatário na UI).  

7. Atualizar `Demand.status` para `AT_HUB` (alinhar com Order AT_HUB).  
8. `DemandEvent` + `OrderHistory` CREATED.  
9. Retornar `{ demand, order }`.

Remover bloqueio anterior em `PATCH /demands/:id/status` para intake quando fluxo passa por confirm — hoje bloqueia AT_HUB sem order; **confirm-arrival** não usa PATCH.

- [ ] **Step 1: Escrever `confirmIntakeArrival.test.ts` com prisma mockado** — casos: sucesso hub; 403 hub errado; 400 já tem order.

- [ ] **Step 2: Implementar serviço + rota POST** autorizada `ADMIN` e `HUB`.

- [ ] **Step 3: `npm test` + `npm run typecheck`**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(intake): confirm-arrival cria Order e move demanda para AT_HUB"
```

---

### Task 5: Frontend — aba "Recebimento" / Aguardando chegada no Hub

**Files:**
- Modify: `components/operacao/HubHome.tsx` — tipo `Tab` incluir `'recebimento'`; KPI ou badge com contagem da fila
- Create: `components/operacao/HubAwaitingArrivalTab.tsx`
- Modify: `components/operacao/hubNavIcons.tsx` — ícone inbox/scan (SVG simples)
- Modify: `lib/api.ts` — métodos já adicionados nas tasks anteriores

**UX mínima (aceite):**
- Lista principal: `intakeDemandsApi.list({ status: 'AWAITING_ARRIVAL' })` — hub recebe só seu hub pelo backend.
- Campo de busca único chamando `list({ q: texto })` com debounce 300ms.
- Botão "Escanear / chave NF" abre input focado; ao colar 44 dígitos chama `lookupAwaitingByKey`:
  - **0:** modal "Não encontrado" com CTAs: "Criar manual" → navegar para aba `entrada` existente (`EntradaTab`) ou abrir formulário intake mínimo reutilizando API create (com `expectedHubId` do user hub).
  - **1:** abrir `ConfirmArrivalModal` com resumo NF/cliente/rotas + formulário destinatário (select Person ou busca se já existir componente admin).
  - **N:** lista radio de candidatos; ao escolher → mesmo modal de confirmação.
- Após confirm success: toast + invalidar lista (`order` aparece em pedidos conforme fluxo existente).
- **Admin (Torre):** fila de recebimento / exceções **fora do escopo PR003** — ver **[PR003.1](2026-05-15-pr003-1-intake-exceptions-tower.md)**.

- [ ] **Step 1: Componente lista + busca** sem scanner (só `q`).

- [ ] **Step 2: Integrar lookup + fluxos 0/1/N**

- [ ] **Step 3: Modal confirm com `destinatarioPersonId` obrigatório** (dropdown desde `GET /api/persons?hasClient=true` ou busca — reutilizar padrão de `EntradaTab` se houver seleção de pessoa).

- [ ] **Step 4: Smoke manual** — login hub seed `hub.spgru@tsmex.com`, ver fila após criar intake como admin com `expectedHubId` SP-GRU.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(hub): fila aguardando chegada com busca e confirm-arrival"
```

---

### Task 6: Documentação e smoke script

**Files:**
- Modify: `docs/smoke-pr002-intake-evidence.md` → renomear ou adicionar `docs/smoke-pr003-hub-recebimento.md` com passos curl da confirm
- Modify: `server/scripts/smoke-pr002-intake.mjs` ou criar `smoke-pr003-recebimento.mjs` que: cria intake → lookup → confirm → assert demand status AT_HUB e order exists

- [ ] **Step 1: Atualizar evidência smoke**

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: smoke PR003 recebimento hub"
```

---

## Self-review (checklist do autor do plano)

1. **Cobertura do spec:**  
   - Regras 1–6 → Tasks 1–2 + UI Task 5.  
   - Regras 7–10 → Task 3 + Task 5 fluxo chave.  
   - Regras 11–12 → Task 4 (Order + sai da fila por status).  
   - Admin exceções (UI Torre) → **PR003.1**; Task 2 cobre só API `onlyUnassignedHub` se necessário ao backend.  

2. **Placeholder scan:** Sem TBD genérico; decisão explícita sobre `destinatarioPersonId` obrigatório na confirm v1.

3. **Consistência:** `confirm-arrival` não conflita com `PATCH /demands/:id/status` bloqueado — fluxo oficial é POST intake.

---

## Handoff de execução

**Plan complete and saved to `docs/superpowers/plans/2026-05-15-pr003-hub-awaiting-arrival-queue.md`. Duas opções de execução:**

1. **Subagent-Driven (recomendado)** — um subagent por task, revisão entre tasks; usar skill `superpowers:subagent-driven-development`.

2. **Inline Execution** — executar tasks nesta sessão com checkpoints; usar skill `superpowers:executing-plans`.

**Qual abordagem você prefere?**

---

## Smoke pós-PR003

Mesmo script: `BASE_URL=http://localhost:3002/api node server/scripts/smoke-pr002-intake.mjs` (inclui bloco **13 — PR003**: `lookup-by-key` como Hub + `confirm-arrival` + asserts `AT_HUB` / `order`).
