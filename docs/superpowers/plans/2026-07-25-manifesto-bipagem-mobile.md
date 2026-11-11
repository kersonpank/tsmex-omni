# Manifesto: bipagem NF-e/CT-e/Minuta + tela de detalhe mobile + paridade Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador bipe (câmera, leitor físico ou digitação) a chave/número de NF-e, CT-e ou Minuta pra adicionar pedidos a um manifesto sem navegar um dropdown longo, e mover as ações do manifesto (Capa, Carta Frete, Motorista, CIOT, MDF-e, Paradas) pra uma tela de detalhe dedicada que funciona no mobile e que o Hub também enxerga por completo.

**Architecture:** Endpoint novo `GET /orders/resolve` faz busca em cascata (chave 44 dígitos → número escopado por hub → sufixo do ID) sem migração de schema. Um componente `OrderScanInput` compartilhado (câmera via `QRCodeScanner` já existente + input de texto pra leitor físico/digitação) chama esse endpoint. Uma tela nova `ManifestDetailPage` (rota `/#/manifests/:id`) concentra toda a lógica de ação hoje espalhada em `ManifestsTab.tsx`, compartilhada entre Admin e Hub por RBAC de seção. `ManifestsTab.tsx` e `HubHome.tsx` encolhem para listas + navegação.

**Tech Stack:** React 19 + TypeScript, React Router (hash mode), Express + Prisma, Zod, `node:test`/`node:assert` (runner nativo do Node via `tsx`, não Jest — ver `server/src/services/pricingService.test.ts` pro padrão de mock usado: reatribuição direta dos métodos do `prisma` importado, com snapshot/restore em `beforeEach`/`afterEach`).

**Spec de referência:** [docs/superpowers/specs/2026-07-25-manifesto-bipagem-mobile-design.md](../specs/2026-07-25-manifesto-bipagem-mobile-design.md)

---

## Task 1: Backend — endpoint de resolução em cascata

**Files:**
- Create: `server/src/services/orderResolve.ts`
- Create: `server/src/services/orderResolve.test.ts`
- Modify: `server/src/routes/orders.ts:33` (adicionar rota logo após `router.use('/:orderId/freight-calculations', ...)`)

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// server/src/services/orderResolve.test.ts
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { resolveOrderByCode } from './orderResolve.js';

const prismaSnapshot = {
    orderInvoiceFindMany: prisma.orderInvoice.findMany.bind(prisma.orderInvoice),
    orderFreightCalculationFindMany: prisma.orderFreightCalculation.findMany.bind(prisma.orderFreightCalculation),
    orderFindMany: prisma.order.findMany.bind(prisma.order),
};

function restorePrismaMocks() {
    prisma.orderInvoice.findMany = prismaSnapshot.orderInvoiceFindMany;
    prisma.orderFreightCalculation.findMany = prismaSnapshot.orderFreightCalculationFindMany;
    prisma.order.findMany = prismaSnapshot.orderFindMany;
}

const baseOrder = {
    id: 'order-abc12345',
    nfNumber: '123',
    status: 'AT_HUB',
    currentHubId: 'hub-1',
    demand: { origin: 'São Paulo', destination: 'Imperatriz' },
};

describe('resolveOrderByCode', () => {
    beforeEach(() => restorePrismaMocks());
    afterEach(() => restorePrismaMocks());

    it('resolve por chave de NF-e de 44 dígitos (busca global, sem escopo de hub)', async () => {
        const key = '1'.repeat(44);
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async (args: any) => {
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode(key, 'hub-1');

        assert.equal(result.match, 'single');
        assert.equal(result.match === 'single' && result.order.id, 'order-abc12345');
        assert.deepEqual(calledWith.where, { nfKey: key });
    });

    it('cai pra cteAccessKey quando não acha por nfKey', async () => {
        const key = '2'.repeat(44);
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async (args: any) => {
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode(key, 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { cteAccessKey: key });
    });

    it('busca por número (nfNumber/cteNumber/minutaNumber) restrito ao hub quando código não tem 44 dígitos', async () => {
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async (args: any) => {
            calledWith = args;
            return [{ order: baseOrder }];
        }) as any;

        const result = await resolveOrderByCode('123', 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { nfNumber: '123', order: { status: 'AT_HUB', currentHubId: 'hub-1' } });
    });

    it('retorna match "multiple" quando o número resolve mais de um pedido (não é ambíguo silencioso)', async () => {
        const other = { ...baseOrder, id: 'order-def67890' };
        prisma.orderInvoice.findMany = (async () => [{ order: baseOrder }, { order: other }]) as any;

        const result = await resolveOrderByCode('123', 'hub-1');

        assert.equal(result.match, 'multiple');
        assert.equal(result.match === 'multiple' && result.candidates.length, 2);
    });

    it('cai pro sufixo do Order.id quando não acha por nenhuma chave/número', async () => {
        let calledWith: any = null;
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async () => []) as any;
        prisma.order.findMany = (async (args: any) => {
            calledWith = args;
            return [baseOrder];
        }) as any;

        const result = await resolveOrderByCode('abc12345', 'hub-1');

        assert.equal(result.match, 'single');
        assert.deepEqual(calledWith.where, { id: { endsWith: 'abc12345' }, status: 'AT_HUB', currentHubId: 'hub-1' });
    });

    it('retorna match "none" quando nada resolve', async () => {
        prisma.orderInvoice.findMany = (async () => []) as any;
        prisma.orderFreightCalculation.findMany = (async () => []) as any;
        prisma.order.findMany = (async () => []) as any;

        const result = await resolveOrderByCode('naoexiste', 'hub-1');

        assert.equal(result.match, 'none');
    });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd server && node --import tsx --test src/services/orderResolve.test.ts`
Expected: FAIL — módulo `./orderResolve.js` não existe ainda

- [ ] **Step 3: Implementar `resolveOrderByCode`**

```typescript
// server/src/services/orderResolve.ts
import prisma from '../lib/prisma.js';

export interface ResolvedOrderSummary {
    id: string;
    nfNumber: string | null;
    status: string;
    currentHubId: string | null;
    origin: string | null;
    destination: string | null;
}

export type OrderResolveResult =
    | { match: 'single'; order: ResolvedOrderSummary }
    | { match: 'multiple'; candidates: ResolvedOrderSummary[] }
    | { match: 'none' };

const toSummary = (order: any): ResolvedOrderSummary => ({
    id: order.id,
    nfNumber: order.nfNumber ?? null,
    status: order.status,
    currentHubId: order.currentHubId ?? null,
    origin: order.demand?.origin ?? null,
    destination: order.demand?.destination ?? null,
});

const orderInclude = { demand: { select: { origin: true, destination: true } } };

const dedupeById = (orders: any[]): any[] => {
    const seen = new Map<string, any>();
    for (const o of orders) seen.set(o.id, o);
    return [...seen.values()];
};

const finish = (orders: any[]): OrderResolveResult => {
    const unique = dedupeById(orders);
    if (unique.length === 0) return { match: 'none' };
    if (unique.length === 1) return { match: 'single', order: toSummary(unique[0]) };
    return { match: 'multiple', candidates: unique.map(toSummary) };
};

const isAccessKey44 = (code: string) => /^\d{44}$/.test(code);

/**
 * Cascata de resolução (nunca escolhe silenciosamente em caso de ambiguidade):
 * 1. Chave de 44 dígitos (NF-e > CT-e > DC-e) — únicas globalmente, sem escopo de hub.
 * 2. Número (NF/CT-e/Minuta/DC-e) — restrito a AT_HUB no hub do manifesto (não é único globalmente).
 * 3. Sufixo do Order.id — único (é PK), mesmo escopo de hub pra manter a lista relevante.
 */
export async function resolveOrderByCode(rawCode: string, hubId: string | undefined): Promise<OrderResolveResult> {
    const code = rawCode.trim();
    if (!code) return { match: 'none' };

    if (isAccessKey44(code)) {
        const byNfKey = await prisma.orderInvoice.findMany({
            where: { nfKey: code },
            include: { order: { include: orderInclude } },
        });
        if (byNfKey.length > 0) return finish(byNfKey.map((r) => r.order));

        const byCte = await prisma.orderFreightCalculation.findMany({
            where: { cteAccessKey: code },
            include: { order: { include: orderInclude } },
        });
        if (byCte.length > 0) return finish(byCte.map((r) => r.order));

        const byDce = await prisma.orderFreightCalculation.findMany({
            where: { dceAccessKey: code },
            include: { order: { include: orderInclude } },
        });
        if (byDce.length > 0) return finish(byDce.map((r) => r.order));

        return { match: 'none' };
    }

    const hubScope = hubId ? { status: 'AT_HUB' as const, currentHubId: hubId } : { status: 'AT_HUB' as const };

    const byNfNumber = await prisma.orderInvoice.findMany({
        where: { nfNumber: code, order: hubScope },
        include: { order: { include: orderInclude } },
    });
    if (byNfNumber.length > 0) return finish(byNfNumber.map((r) => r.order));

    const byCteNumber = await prisma.orderFreightCalculation.findMany({
        where: { cteNumber: code, order: hubScope },
        include: { order: { include: orderInclude } },
    });
    if (byCteNumber.length > 0) return finish(byCteNumber.map((r) => r.order));

    const byMinuta = await prisma.orderFreightCalculation.findMany({
        where: { minutaNumber: code, order: hubScope },
        include: { order: { include: orderInclude } },
    });
    if (byMinuta.length > 0) return finish(byMinuta.map((r) => r.order));

    const byDceNumber = await prisma.orderFreightCalculation.findMany({
        where: { dceNumber: code, order: hubScope },
        include: { order: { include: orderInclude } },
    });
    if (byDceNumber.length > 0) return finish(byDceNumber.map((r) => r.order));

    const byIdSuffix = await prisma.order.findMany({
        where: { id: { endsWith: code }, ...hubScope },
        include: orderInclude,
    });
    return finish(byIdSuffix);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd server && node --import tsx --test src/services/orderResolve.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Expor a rota HTTP**

Adicionar em `server/src/routes/orders.ts`, logo depois da linha 33 (`router.use('/:orderId/freight-calculations', freightCalculationsRouter);`):

```typescript
router.get('/resolve', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const code = String(req.query.code ?? '').trim();
        if (!code) throw new AppError('Informe o código escaneado ou digitado', 400);

        const manifestId = req.query.manifestId ? String(req.query.manifestId) : undefined;
        let hubId: string | undefined;
        if (manifestId) {
            const manifest = await prisma.manifest.findUnique({ where: { id: manifestId }, select: { hubId: true } });
            if (!manifest) throw new AppError('Manifesto não encontrado', 404);
            if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN') && manifest.hubId !== req.user!.hubId) {
                throw new AppError('Not authorized', 403);
            }
            hubId = manifest.hubId ?? undefined;
        } else if (req.user!.roles.includes('HUB') && !req.user!.roles.includes('ADMIN')) {
            hubId = req.user!.hubId ?? undefined;
        }

        const result = await resolveOrderByCode(code, hubId);
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});
```

E importar no topo do arquivo, junto dos demais imports de serviço:

```typescript
import { resolveOrderByCode } from '../services/orderResolve.js';
```

- [ ] **Step 6: Rodar typecheck do server**

Run: `cd server && npm run typecheck`
Expected: sem erros novos

- [ ] **Step 7: Commit**

```bash
git add server/src/services/orderResolve.ts server/src/services/orderResolve.test.ts server/src/routes/orders.ts
git commit -m "feat(orders): endpoint de resolucao em cascata por chave/numero/sufixo de pedido"
```

---

## Task 2: Frontend — cliente da API e tipos

**Files:**
- Modify: `lib/api.ts:1223` (dentro de `ordersApi`, adicionar método)
- Modify: `types/index.ts` (adicionar tipo `OrderResolveResult`)

- [ ] **Step 1: Adicionar tipo em `types/index.ts`** (logo abaixo da definição de `OrderListItem`, linha ~608 após o fechamento da interface):

```typescript
export interface ResolvedOrderSummary {
    id: string;
    nfNumber: string | null;
    status: string;
    currentHubId: string | null;
    origin: string | null;
    destination: string | null;
}

export type OrderResolveResponse =
    | { success: true; match: 'single'; order: ResolvedOrderSummary }
    | { success: true; match: 'multiple'; candidates: ResolvedOrderSummary[] }
    | { success: true; match: 'none' };
```

- [ ] **Step 2: Adicionar método em `lib/api.ts`**, dentro do objeto `ordersApi` (após `getById`, por volta da linha 1254):

```typescript
    resolve: async (code: string, manifestId?: string) => {
        const response = await api.get<OrderResolveResponse>('/orders/resolve', { params: { code, manifestId } });
        return response.data;
    },
```

E adicionar `OrderResolveResponse` ao import de tipos no topo de `lib/api.ts` (mesmo bloco de import que já traz `OrderListItem`).

- [ ] **Step 3: Rodar typecheck do frontend**

Run: `npm run typecheck:web`
Expected: sem erros novos

- [ ] **Step 4: Commit**

```bash
git add lib/api.ts types/index.ts
git commit -m "feat(api): cliente ordersApi.resolve para busca em cascata de pedido"
```

---

## Task 3: Extrair `CollapsibleSection` para componente compartilhado

**Files:**
- Create: `components/ui/CollapsibleSection.tsx`
- Modify: `components/admin/OrderDetailPage.tsx:63-109` (remover definição local, importar a nova)

- [ ] **Step 1: Criar o componente compartilhado** (é a definição que já existe em `OrderDetailPage.tsx:63-109`, movida sem alteração de comportamento):

```typescript
// components/ui/CollapsibleSection.tsx
import React from 'react';

export type CollapsibleSectionKey = string;

interface CollapsibleSectionProps {
  title: string;
  sectionKey: CollapsibleSectionKey;
  expanded: boolean;
  onToggle: (section: CollapsibleSectionKey) => void;
  children: React.ReactNode;
  helper?: string;
  showToggle?: boolean;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  sectionKey,
  expanded,
  onToggle,
  children,
  helper,
  showToggle = true,
}) => (
  <section className="rounded-2xl border border-tower-200 bg-white p-5 dark:border-tower-700 dark:bg-tower-900/50">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-tower-600 dark:text-tower-300">{title}</h2>
      {showToggle ? (
        <button
          type="button"
          onClick={() => onToggle(sectionKey)}
          className="admin-focus rounded-lg border border-tower-300 px-2.5 py-1 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Recolher' : 'Expandir'} seção ${title}`}
        >
          {expanded ? 'Recolher' : 'Expandir'}
        </button>
      ) : null}
    </div>
    {helper ? <p className="mt-2 text-xs text-tower-500 dark:text-tower-400">{helper}</p> : null}
    {showToggle ? (
      <div
        className={`grid transition-all duration-300 ease-out ${expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    ) : (
      <div className="mt-3">{children}</div>
    )}
  </section>
);

export default CollapsibleSection;
```

- [ ] **Step 2: Em `components/admin/OrderDetailPage.tsx`, remover as linhas 63-109** (a definição local de `CollapsibleSection` e sua interface `CollapsibleSectionProps`) e adicionar o import no topo do arquivo (junto aos demais imports de `components/ui`):

```typescript
import { CollapsibleSection } from '../ui/CollapsibleSection';
```

O tipo `SectionKey` (`'coleta' | 'notas' | 'frete' | 'anexos'`, linha 41) continua local em `OrderDetailPage.tsx` — `CollapsibleSection` agora aceita `string` genérico em `sectionKey`, então continua compatível sem mudança de chamada.

- [ ] **Step 3: Rodar typecheck e o app pra conferir que `OrderDetailPage` não regrediu**

Run: `npm run typecheck:web`
Expected: sem erros novos

- [ ] **Step 4: Commit**

```bash
git add components/ui/CollapsibleSection.tsx components/admin/OrderDetailPage.tsx
git commit -m "refactor(ui): extrai CollapsibleSection de OrderDetailPage para componente compartilhado"
```

---

## Task 4: Componente `OrderScanInput` (bipagem)

**Files:**
- Create: `components/ui/OrderScanInput.tsx`

- [ ] **Step 1: Implementar o componente**

Combina input de texto (cobre leitor físico USB/Bluetooth, que digita o código e envia Enter sozinho, e digitação manual) com botão de câmera que reaproveita `QRCodeScanner` já existente. Em ambiguidade, mostra os candidatos pro operador escolher — nunca decide sozinho.

```typescript
// components/ui/OrderScanInput.tsx
import React, { useRef, useState } from 'react';
import { ordersApi } from '../../lib/api';
import type { ResolvedOrderSummary } from '../../types/index';
import QRCodeScanner from './QRCodeScanner';

interface OrderScanInputProps {
  manifestId?: string;
  onResolved: (order: ResolvedOrderSummary) => void;
  disabled?: boolean;
}

const OrderScanInput: React.FC<OrderScanInputProps> = ({ manifestId, onResolved, disabled }) => {
  const [code, setCode] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [candidates, setCandidates] = useState<ResolvedOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolve = async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setCandidates(null);
    try {
      const res = await ordersApi.resolve(trimmed, manifestId);
      if (res.match === 'single') {
        onResolved(res.order);
        setCode('');
      } else if (res.match === 'multiple') {
        setCandidates(res.candidates);
      } else {
        setError('Nenhum pedido encontrado com esse código neste hub.');
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao buscar pedido');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void resolve(code);
  };

  const handleCameraScan = (result: string) => {
    setShowCamera(false);
    setCode(result);
    void resolve(result);
  };

  const chooseCandidate = (order: ResolvedOrderSummary) => {
    setCandidates(null);
    setCode('');
    onResolved(order);
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={disabled || busy}
          placeholder="Bipe ou digite chave NF-e/CT-e, número ou nº do pedido"
          className="flex-1 min-w-0 px-3 py-2 border border-tower-200 rounded-lg dark:border-tower-600 dark:bg-tower-900"
        />
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          disabled={disabled || busy}
          className="px-3 py-2 bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700 disabled:opacity-50"
          aria-label="Escanear com a câmera"
        >
          📷
        </button>
        <button
          type="submit"
          disabled={disabled || busy || !code.trim()}
          className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? '...' : 'Buscar'}
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {candidates && candidates.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-3">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 mb-2">
            Mais de um pedido encontrado com esse código — escolha o correto:
          </p>
          <ul className="space-y-1">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => chooseCandidate(c)}
                  className="w-full text-left px-3 py-2 bg-white dark:bg-tower-800 rounded-lg border border-tower-200 dark:border-tower-600 hover:bg-tower-50 dark:hover:bg-tower-700 text-sm"
                >
                  {c.origin} → {c.destination} · NF {c.nfNumber ?? '—'} (#{c.id.slice(0, 8)})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showCamera && <QRCodeScanner onScan={handleCameraScan} onClose={() => setShowCamera(false)} />}
    </div>
  );
};

export default OrderScanInput;
```

- [ ] **Step 2: Rodar typecheck**

Run: `npm run typecheck:web`
Expected: sem erros novos

- [ ] **Step 3: Commit**

```bash
git add components/ui/OrderScanInput.tsx
git commit -m "feat(ui): componente OrderScanInput para bipar/digitar identificacao de pedido"
```

---

## Task 5: `ManifestDetailPage` — esqueleto, carregamento e seção Pedidos (bipagem)

**Files:**
- Create: `components/manifest/ManifestDetailPage.tsx`

Esta é a tela de detalhe compartilhada Admin/Hub (drill-down). Este task cria o esqueleto (carregar manifesto por `:id`, header com botão voltar, seções vazias) e a seção **Pedidos**, que é o coração da funcionalidade pedida: bipar adiciona na hora via `manifestsApi.addDemand` (endpoint que já existe, sem mudança de contrato).

- [ ] **Step 1: Criar o arquivo**

```typescript
// components/manifest/ManifestDetailPage.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi } from '../../lib/api';
import type { Manifest } from '../../types/index';
import type { ResolvedOrderSummary } from '../../types/index';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import InlineNotice from '../ui/InlineNotice';
import StatusBadge from '../ui/StatusBadge';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import OrderScanInput from '../ui/OrderScanInput';

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
};

type SectionKey = 'pedidos' | 'paradas' | 'capa' | 'motorista' | 'cartaFrete' | 'fiscal';

const ManifestDetailPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;
  const backPath = isHub && !isAdmin ? '/hub' : '/gestao?cat=transport&sub=viagens';

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    pedidos: true,
    paradas: true,
    capa: false,
    motorista: false,
    cartaFrete: false,
    fiscal: false,
  });
  const [addingOrderId, setAddingOrderId] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await manifestsApi.getById(id);
      setManifest((res as any)?.data ?? null);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  const toggle = (section: SectionKey) => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleOrderResolved = async (order: ResolvedOrderSummary) => {
    if (!id) return;
    setAddingOrderId(order.id);
    setError(null);
    try {
      await manifestsApi.addDemand(id, { orderId: order.id });
      flashSuccess(`Pedido #${order.id.slice(0, 8)} adicionado à viagem.`);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar pedido');
    } finally {
      setAddingOrderId(null);
    }
  };

  const handleRemoveDemand = async (demandId: string) => {
    if (!id || !window.confirm('Remover este pedido da viagem?')) return;
    setError(null);
    try {
      await manifestsApi.removeDemand(id, demandId);
      flashSuccess('Pedido removido.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const canEditOrders = manifest?.status === 'DRAFT';

  if (loading) return <LoadingPanel label="Carregando viagem…" />;
  if (error && !manifest) return <ErrorPanel message={error} onRetry={load} />;
  if (!manifest) return <EmptyState title="Viagem não encontrada" description="Não foi possível localizar esta viagem." />;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RouterLink
          to={backPath}
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Voltar para viagens
        </RouterLink>
        <StatusBadge label={statusLabels[manifest.status] ?? manifest.status} tone={manifest.status === 'COMPLETED' ? 'success' : 'info'} />
        <span className="font-bold text-tower-900 dark:text-tower-50">{manifest.origin} → {manifest.destination}</span>
      </div>

      {error && <InlineNotice variant="error" message={error} onDismiss={() => setError(null)} />}
      {success && <InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} />}

      <CollapsibleSection title="Pedidos" sectionKey="pedidos" expanded={expanded.pedidos} onToggle={() => toggle('pedidos')}>
        {canEditOrders && (
          <div className="mb-4">
            <OrderScanInput manifestId={id} onResolved={handleOrderResolved} disabled={addingOrderId !== null} />
          </div>
        )}
        {manifest.demands && manifest.demands.length > 0 ? (
          <ul className="space-y-1">
            {manifest.demands.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm border-b border-tower-100 dark:border-tower-800 py-2 last:border-0">
                <span>{d.origin} → {d.destination} · {d.commodity} · {d.weight}kg</span>
                {canEditOrders && (
                  <button type="button" onClick={() => handleRemoveDemand(d.id)} className="text-red-600 hover:underline">Remover</button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tower-500 dark:text-tower-400">Nenhum pedido nesta viagem ainda.</p>
        )}
      </CollapsibleSection>
    </div>
  );
};

export default ManifestDetailPage;
```

- [ ] **Step 2: Rodar typecheck**

Run: `npm run typecheck:web`
Expected: sem erros novos (`Manifest`/`ResolvedOrderSummary` já exportados nos Tasks anteriores)

- [ ] **Step 3: Commit**

```bash
git add components/manifest/ManifestDetailPage.tsx
git commit -m "feat(manifest): esqueleto da tela de detalhe compartilhada + secao Pedidos com bipagem"
```

---

## Task 6: `ManifestDetailPage` — seções Paradas, Capa e Motorista

**Files:**
- Modify: `components/manifest/ManifestDetailPage.tsx`

Move a lógica de `showAddStop`/`handleAddStop`/`handleCompleteStop` (hoje em `ManifestsTab.tsx:226-272,843-879,1411-1438`), `showCapa`/`handleSaveCapa` (`ManifestsTab.tsx:302-333,904-943`) e `showAssign`/`showDriverAssign` (`ManifestsTab.tsx:287-300,414-463,881-902,997-1038`) pra dentro da nova tela, sem alteração de comportamento.

- [ ] **Step 1: Adicionar states e handlers** (logo após os states existentes do Task 5, antes de `const canEditOrders = ...`):

```typescript
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [fiscalEmitters, setFiscalEmitters] = useState<FiscalEmitter[]>([]);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStopForm, setNewStopForm] = useState({ destHubId: '', destinationLabel: '', destCity: '', destState: '' });
  const [showCapaForm, setShowCapaForm] = useState(false);
  const [capaForm, setCapaForm] = useState({ fiscalEmitterId: '', plannedDepartureAt: '', plannedArrivalAt: '', notes: '', seloLacre: '', liberacao: '' });
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignLinkId, setAssignLinkId] = useState('');
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [driversForLink, setDriversForLink] = useState<Driver[]>([]);
  const [assignDriverId, setAssignDriverId] = useState('');
```

Adicionar imports no topo (`hubsApi`, `linksApi`, `fiscalEmittersApi`, tipos `Hub`, `Link`, `FiscalEmitter`, `Driver`):

```typescript
import { manifestsApi, hubsApi, linksApi, fiscalEmittersApi } from '../../lib/api';
import type { Manifest, Hub, Link, FiscalEmitter, Driver } from '../../types/index';
```

Carregar as listas auxiliares junto do manifesto — substituir o `load` do Task 5 por:

```typescript
  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [manRes, hubRes, linkRes, feRes] = await Promise.all([
        manifestsApi.getById(id),
        hubsApi.list(),
        linksApi.list(),
        fiscalEmittersApi.list(),
      ]);
      setManifest((manRes as any)?.data ?? null);
      setHubs(((hubRes as any)?.data ?? []) as Hub[]);
      setLinks(((linkRes as any)?.data ?? []) as Link[]);
      setFiscalEmitters(((feRes as any)?.data ?? []) as FiscalEmitter[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagem');
    } finally {
      setLoading(false);
    }
  };
```

Handlers (adicionar após `handleRemoveDemand`):

```typescript
  const handleAddStop = async () => {
    if (!id || !manifest) return;
    const isTransfer = manifest.tripType === 'TRANSFER';
    if (isTransfer && !newStopForm.destHubId) { setError('Selecione o hub destino desta parada.'); return; }
    if (!isTransfer && !newStopForm.destinationLabel.trim() && !newStopForm.destCity.trim()) {
      setError('Informe um rótulo ou cidade destino para esta parada.');
      return;
    }
    setError(null);
    try {
      await manifestsApi.createStop(id, {
        destHubId: isTransfer ? newStopForm.destHubId : undefined,
        destinationLabel: !isTransfer && newStopForm.destinationLabel.trim() ? newStopForm.destinationLabel.trim() : undefined,
        destCity: !isTransfer && newStopForm.destCity.trim() ? newStopForm.destCity.trim() : undefined,
        destState: !isTransfer && newStopForm.destState.trim() ? newStopForm.destState.trim().toUpperCase() : undefined,
      });
      flashSuccess('Parada adicionada à viagem.');
      setShowAddStop(false);
      setNewStopForm({ destHubId: '', destinationLabel: '', destCity: '', destState: '' });
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar parada');
    }
  };

  const handleCompleteStop = async (stopId: string) => {
    if (!id || !window.confirm('Concluir esta parada? Os pedidos dela mudarão de status.')) return;
    setError(null);
    try {
      const res = await manifestsApi.completeStop(id, stopId);
      const allDone = (res as any)?.data?.allStopsCompleted;
      flashSuccess(allDone ? 'Parada concluída — viagem finalizada.' : 'Parada concluída.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao concluir parada');
    }
  };

  const handleSaveCapa = async () => {
    if (!id) return;
    setError(null);
    try {
      await manifestsApi.updateCapa(id, {
        fiscalEmitterId: capaForm.fiscalEmitterId || undefined,
        plannedDepartureAt: capaForm.plannedDepartureAt ? new Date(capaForm.plannedDepartureAt).toISOString() : undefined,
        plannedArrivalAt: capaForm.plannedArrivalAt ? new Date(capaForm.plannedArrivalAt).toISOString() : undefined,
        notes: capaForm.notes || undefined,
        seloLacre: capaForm.seloLacre || undefined,
        liberacao: capaForm.liberacao || undefined,
      });
      flashSuccess('Capa da viagem atualizada.');
      setShowCapaForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar capa da viagem');
    }
  };

  const openCapaForm = () => {
    if (!manifest) return;
    setCapaForm({
      fiscalEmitterId: manifest.fiscalEmitterId ?? '',
      plannedDepartureAt: manifest.plannedDepartureAt ? manifest.plannedDepartureAt.slice(0, 16) : '',
      plannedArrivalAt: manifest.plannedArrivalAt ? manifest.plannedArrivalAt.slice(0, 16) : '',
      notes: manifest.notes ?? '',
      seloLacre: manifest.seloLacre ?? '',
      liberacao: manifest.liberacao ?? '',
    });
    setShowCapaForm(true);
  };

  const handleAssignLink = async () => {
    if (!id || !assignLinkId) return;
    setError(null);
    try {
      await manifestsApi.assignLink(id, assignLinkId);
      flashSuccess('Motorista (Link) atribuído.');
      setShowAssignForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao atribuir motorista');
    }
  };

  const openDriverForm = async () => {
    if (!manifest?.linkId) return;
    setShowDriverForm(true);
    setAssignDriverId('');
    try {
      const res = await linksApi.getDrivers(manifest.linkId);
      setDriversForLink(((res as any)?.data ?? []) as Driver[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar motoristas do Link');
      setDriversForLink([]);
    }
  };

  const handleAssignDriver = async () => {
    if (!id || !assignDriverId) return;
    setError(null);
    try {
      await manifestsApi.setDriver(id, assignDriverId);
      flashSuccess('Motorista definido.');
      setShowDriverForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao definir motorista');
    }
  };
```

- [ ] **Step 2: Adicionar as 3 seções JSX**, logo depois do `</CollapsibleSection>` da seção Pedidos:

```tsx
      <CollapsibleSection title="Paradas" sectionKey="paradas" expanded={expanded.paradas} onToggle={() => toggle('paradas')}>
        {manifest.tripStops && manifest.tripStops.length > 0 && (
          <ul className="space-y-2 mb-3">
            {manifest.tripStops.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span>
                  #{s.sequence} — {s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel ?? s.destCity ?? 'Parada')}
                  {' · '}
                  <StatusBadge label={s.completedAt ? 'Concluída' : 'Pendente'} tone={s.completedAt ? 'success' : 'warning'} />
                </span>
                {manifest.status === 'IN_PROGRESS' && !s.completedAt && (
                  <button type="button" onClick={() => handleCompleteStop(s.id)} className="rounded-lg bg-brand-600 px-3 py-1 text-xs text-white hover:bg-brand-700">
                    Concluir parada
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEditOrders && !showAddStop && (
          <button type="button" onClick={() => setShowAddStop(true)} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
            + Adicionar parada
          </button>
        )}
        {showAddStop && (
          <div className="flex gap-2 items-end flex-wrap mt-2">
            {manifest.tripType === 'TRANSFER' ? (
              <div className="flex-1 min-w-[240px]">
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Hub destino desta parada</label>
                <select value={newStopForm.destHubId} onChange={(e) => setNewStopForm((f) => ({ ...f, destHubId: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                  <option value="">Selecione</option>
                  {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
                </select>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Rótulo/cliente</label>
                  <input value={newStopForm.destinationLabel} onChange={(e) => setNewStopForm((f) => ({ ...f, destinationLabel: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="Ex: Loja Centro" />
                </div>
                <div className="min-w-[160px]">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Cidade destino</label>
                  <input value={newStopForm.destCity} onChange={(e) => setNewStopForm((f) => ({ ...f, destCity: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="Ex: São Luís" />
                </div>
                <div className="w-24">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">UF</label>
                  <input value={newStopForm.destState} onChange={(e) => setNewStopForm((f) => ({ ...f, destState: e.target.value }))} maxLength={2} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="MA" />
                </div>
              </>
            )}
            <button type="button" onClick={handleAddStop} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Adicionar</button>
            <button type="button" onClick={() => setShowAddStop(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Capa da viagem" sectionKey="capa" expanded={expanded.capa} onToggle={() => toggle('capa')}>
        {!showCapaForm ? (
          <button type="button" onClick={openCapaForm} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
            Editar capa
          </button>
        ) : (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Empresa emitente</label>
                <select value={capaForm.fiscalEmitterId} onChange={(e) => setCapaForm((f) => ({ ...f, fiscalEmitterId: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                  <option value="">Sem emitente definido</option>
                  {fiscalEmitters.map((fe) => <option key={fe.id} value={fe.id}>{fe.displayName || fe.tradeName || fe.id.slice(0, 8)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Saída prevista</label>
                <input type="datetime-local" value={capaForm.plannedDepartureAt} onChange={(e) => setCapaForm((f) => ({ ...f, plannedDepartureAt: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Previsão de chegada</label>
                <input type="datetime-local" value={capaForm.plannedArrivalAt} onChange={(e) => setCapaForm((f) => ({ ...f, plannedArrivalAt: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Lacre(s)</label>
                <input value={capaForm.seloLacre} onChange={(e) => setCapaForm((f) => ({ ...f, seloLacre: e.target.value }))} placeholder="Ex: 25897, 25898" className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Liberação</label>
                <input value={capaForm.liberacao} onChange={(e) => setCapaForm((f) => ({ ...f, liberacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Observações</label>
                <textarea value={capaForm.notes} onChange={(e) => setCapaForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleSaveCapa} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
              <button type="button" onClick={() => setShowCapaForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Motorista" sectionKey="motorista" expanded={expanded.motorista} onToggle={() => toggle('motorista')}>
        <p className="text-sm text-tower-600 dark:text-tower-400 mb-2">
          Link (transportador): {manifest.link?.name ?? 'Nenhum atribuído'}
          {manifest.driver && ` · Motorista: ${manifest.driver.name}`}
        </p>
        <div className="flex gap-2 flex-wrap">
          {!showAssignForm && (
            <button type="button" onClick={() => { setShowAssignForm(true); setAssignLinkId(manifest.linkId || ''); }} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.linkId ? 'Trocar Link' : 'Atribuir Link'}
            </button>
          )}
          {manifest.linkId && !showDriverForm && (
            <button type="button" onClick={openDriverForm} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.driver ? 'Trocar motorista' : 'Definir motorista'}
            </button>
          )}
        </div>
        {showAssignForm && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Link (transportador)</label>
              <select value={assignLinkId} onChange={(e) => setAssignLinkId(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Selecione</option>
                {links.filter((l) => l.approvalStatus === 'APPROVED').map((l) => <option key={l.id} value={l.id}>{l.name} ({l.document})</option>)}
              </select>
            </div>
            <button type="button" onClick={handleAssignLink} disabled={!assignLinkId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Atribuir</button>
            <button type="button" onClick={() => setShowAssignForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
        {showDriverForm && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Motorista</label>
              <select value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Selecione</option>
                {driversForLink.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.document})</option>)}
              </select>
            </div>
            <button type="button" onClick={handleAssignDriver} disabled={!assignDriverId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Definir</button>
            <button type="button" onClick={() => setShowDriverForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
      </CollapsibleSection>
```

- [ ] **Step 3: Rodar typecheck**

Run: `npm run typecheck:web`
Expected: sem erros novos

- [ ] **Step 4: Commit**

```bash
git add components/manifest/ManifestDetailPage.tsx
git commit -m "feat(manifest): secoes Paradas, Capa e Motorista na tela de detalhe"
```

---

## Task 7: `ManifestDetailPage` — seções Carta Frete e Fiscal (CIOT/MDF-e)

**Files:**
- Modify: `components/manifest/ManifestDetailPage.tsx`

Move `showFreightAgreement`/`handleSaveFreightAgreement` (`ManifestsTab.tsx:335-394,945-995`) e todo o bloco de CIOT/MDF-e (`ManifestsTab.tsx:79-112,465-598,1040-1178,1266-1384`). CIOT e MDF-e ficam visíveis pra Hub também (decisão do usuário) — só **Cancelar CIOT** continua exclusivo ADMIN, espelhando o backend (`manifests.ts:1058`, `authorize(['ADMIN'])`).

- [ ] **Step 1: Adicionar states e handlers de Carta Frete e Fiscal**

```typescript
  const emptyFreightForm = { freteBruto: '', adiantamento: '', pedagio: '', irrf: '', inss: '', issqn: '', sestSenat: '', outrosDescontos: '', outrosDescontosDescricao: '' };
  const [showFreightForm, setShowFreightForm] = useState(false);
  const [freightForm, setFreightForm] = useState(emptyFreightForm);
  const [fiscalBusy, setFiscalBusy] = useState(false);
  const [showCiotForm, setShowCiotForm] = useState(false);
  const emptyCiotForm = {
    documentoViagem: '', distanciaPercorrida: '', dataInicioViagem: '', dataFimViagem: '',
    codigoNcmNaturezaCarga: '', pesoCarga: '', codigoTipoCarga: '2', altoDesempenho: false,
    retornoVazio: false, composicaoVeicular: false, tipoPagamento: 'TransferenciaBancaria' as const,
    entregaDocumentacao: 'RedeCredenciada' as const, totalOperacao: '', totalViagem: '',
    totalAdiantamento: '', totalQuitacao: '', pedagio: '', combustivel: '',
    destNome: '', destCpfCnpj: '', destBairro: '', destCep: '', destCodigoMunicipio: '', destRua: '', destNumero: '',
  };
  const [ciotForm, setCiotForm] = useState(emptyCiotForm);
  const [ciotOverride, setCiotOverride] = useState('');
```

Handlers (após `handleAssignDriver`):

```typescript
  const openFreightForm = () => {
    if (!manifest) return;
    const fa = manifest.freightAgreement;
    setFreightForm(fa ? {
      freteBruto: String(fa.freteBruto), adiantamento: String(fa.adiantamento), pedagio: String(fa.pedagio),
      irrf: String(fa.irrf), inss: String(fa.inss), issqn: String(fa.issqn), sestSenat: String(fa.sestSenat),
      outrosDescontos: String(fa.outrosDescontos), outrosDescontosDescricao: fa.outrosDescontosDescricao ?? '',
    } : emptyFreightForm);
    setShowFreightForm(true);
  };

  const handleSaveFreightAgreement = async () => {
    if (!id || !freightForm.freteBruto) { setError('Informe o frete bruto contratado.'); return; }
    setError(null);
    try {
      await manifestsApi.upsertFreightAgreement(id, {
        freteBruto: Number(freightForm.freteBruto),
        adiantamento: Number(freightForm.adiantamento || 0),
        pedagio: Number(freightForm.pedagio || 0),
        irrf: Number(freightForm.irrf || 0),
        inss: Number(freightForm.inss || 0),
        issqn: Number(freightForm.issqn || 0),
        sestSenat: Number(freightForm.sestSenat || 0),
        outrosDescontos: Number(freightForm.outrosDescontos || 0),
        outrosDescontosDescricao: freightForm.outrosDescontosDescricao || undefined,
      });
      flashSuccess('Carta Frete salva.');
      setShowFreightForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar Carta Frete');
    }
  };

  const getCiotAuthorizedDoc = () => manifest?.fiscalDocuments?.find((d) => d.documentType === 'CIOT' && d.status === 'AUTHORIZED') ?? null;
  const getMdfeAuthorizedDoc = () => manifest?.fiscalDocuments?.find((d) => d.documentType === 'MDFE' && d.status === 'AUTHORIZED') ?? null;

  const openCiotForm = async () => {
    if (!id || !manifest) return;
    setShowCiotForm(true);
    setCiotOverride(manifest.ciotTipoViagemOverride ?? '');
    const fa = manifest.freightAgreement;
    setCiotForm({
      ...emptyCiotForm,
      documentoViagem: `OS-${id.slice(0, 8)}`,
      composicaoVeicular: Boolean(manifest.link?.trailerPlate),
      ...(fa ? { totalOperacao: String(fa.freteBruto), totalViagem: String(fa.freteBruto), totalAdiantamento: String(fa.adiantamento), pedagio: String(fa.pedagio) } : {}),
    });
    try {
      await manifestsApi.ciotSuggestion(id);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao calcular sugestão de CIOT');
    }
  };

  const handleEmitCiot = async () => {
    if (!id) return;
    const f = ciotForm;
    if (!f.distanciaPercorrida || !f.dataFimViagem || !f.destNome || !f.destCpfCnpj || !f.destCodigoMunicipio || !f.destCep || !f.destRua || !f.destNumero || !f.destBairro) {
      setError('Preencha distância, data fim de viagem e os dados do destinatário (obrigatórios para o CIOT).');
      return;
    }
    setError(null);
    setFiscalBusy(true);
    try {
      const isTac = ciotOverride === 'TAC_AGREGADO';
      await manifestsApi.emitCiot(id, {
        tipoViagemOverride: (ciotOverride || undefined) as any,
        requestData: {
          documentoViagem: f.documentoViagem || `OS-${id.slice(0, 8)}`,
          distanciaPercorrida: Number(f.distanciaPercorrida),
          ...(isTac ? {} : { dataInicioViagem: f.dataInicioViagem || undefined }),
          dataFimViagem: f.dataFimViagem,
          ...(isTac ? {} : { codigoNcmNaturezaCarga: f.codigoNcmNaturezaCarga || undefined, pesoCarga: f.pesoCarga ? Number(f.pesoCarga) : undefined, codigoTipoCarga: f.codigoTipoCarga ? Number(f.codigoTipoCarga) : undefined }),
          altoDesempenho: f.altoDesempenho,
          ...(isTac ? {} : { retornoVazio: f.retornoVazio }),
          composicaoVeicular: f.composicaoVeicular,
          tipoPagamento: f.tipoPagamento,
          entregaDocumentacao: f.entregaDocumentacao,
          valores: { totalOperacao: Number(f.totalOperacao || 0), totalViagem: Number(f.totalViagem || 0), totalAdiantamento: Number(f.totalAdiantamento || 0), totalQuitacao: Number(f.totalQuitacao || 0), pedagio: Number(f.pedagio || 0), combustivel: Number(f.combustivel || 0) },
          impostos: {},
          pagamentos: [{ idPagamentoCliente: `PAG-${id.slice(0, 8)}-1`, dataLiberacao: f.dataFimViagem, valor: Number(f.totalViagem || 0), tipoPagamento: f.tipoPagamento, categoria: 'SemCategoria', cpfCnpjCreditado: manifest?.link?.document ?? '', indicadorPagamento: 'Avista', pix: { tipoChave: 'CpfOuCnpj', valorChave: manifest?.link?.document ?? '' } }],
          destinatario: { nomeOuRazaoSocial: f.destNome, cpfOuCnpj: f.destCpfCnpj, endereco: { bairro: f.destBairro, cep: f.destCep, codigoMunicipio: Number(f.destCodigoMunicipio), rua: f.destRua, numero: f.destNumero } },
        },
      });
      flashSuccess('Emissão de CIOT enfileirada — acompanhando status…');
      setShowCiotForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao emitir CIOT');
    } finally {
      setFiscalBusy(false);
    }
  };

  const handleCancelCiotTrip = async () => {
    if (!id) return;
    const justificativa = window.prompt('Justificativa do cancelamento do CIOT:');
    if (!justificativa) return;
    setError(null);
    setFiscalBusy(true);
    try {
      const res = await manifestsApi.cancelCiotTrip(id, justificativa);
      const mdfeFlag = (res as any)?.data?.mdfeRequiresManualCancellation;
      flashSuccess(mdfeFlag ? 'CIOT cancelado. MDF-e vinculado precisa ser cancelado manualmente na SEFAZ.' : 'CIOT cancelado.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao cancelar CIOT');
    } finally {
      setFiscalBusy(false);
    }
  };

  const handleEmitMdfe = async () => {
    if (!id) return;
    setError(null);
    setFiscalBusy(true);
    try {
      await manifestsApi.emitMdfe(id);
      flashSuccess('MDF-e solicitado via ACBr. Verifique documentos fiscais do manifesto.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.response?.data?.message || e.message || 'Erro ao emitir MDF-e');
    } finally {
      setFiscalBusy(false);
    }
  };
```

- [ ] **Step 2: Adicionar as 2 seções JSX**, ao final (antes do `</div>` de fechamento da página):

```tsx
      <CollapsibleSection title="Carta Frete" sectionKey="cartaFrete" expanded={expanded.cartaFrete} onToggle={() => toggle('cartaFrete')} helper="Valor real acordado com o transportador — vira a fonte de custo/margem e pré-preenche o CIOT.">
        {!showFreightForm ? (
          <button type="button" onClick={openFreightForm} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
            {manifest.freightAgreement ? `Editar (R$ ${manifest.freightAgreement.saldoLiquido.toLocaleString('pt-BR')})` : 'Preencher Carta Frete'}
          </button>
        ) : (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Frete bruto contratado*</label><input type="number" min={0} value={freightForm.freteBruto} onChange={(e) => setFreightForm((f) => ({ ...f, freteBruto: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Adiantamento</label><input type="number" min={0} value={freightForm.adiantamento} onChange={(e) => setFreightForm((f) => ({ ...f, adiantamento: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Pedágio</label><input type="number" min={0} value={freightForm.pedagio} onChange={(e) => setFreightForm((f) => ({ ...f, pedagio: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Outros descontos</label><input type="number" min={0} value={freightForm.outrosDescontos} onChange={(e) => setFreightForm((f) => ({ ...f, outrosDescontos: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleSaveFreightAgreement} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
              <button type="button" onClick={() => setShowFreightForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Fiscal — CIOT e MDF-e" sectionKey="fiscal" expanded={expanded.fiscal} onToggle={() => toggle('fiscal')}>
        <div className="flex gap-2 flex-wrap items-center mb-3">
          {getCiotAuthorizedDoc() ? (
            <>
              <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">
                CIOT #{getCiotAuthorizedDoc()!.number}
              </span>
              {isAdmin && (
                <button type="button" disabled={fiscalBusy} onClick={handleCancelCiotTrip} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-tower-800 dark:text-red-300">
                  Cancelar CIOT
                </button>
              )}
            </>
          ) : manifest.ciotDispensado ? (
            <span className="rounded-lg border border-tower-300 bg-tower-50 px-3 py-1.5 text-sm text-tower-700 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-300">CIOT dispensado</span>
          ) : (
            <button type="button" disabled={!manifest.driverId || fiscalBusy} onClick={openCiotForm} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" title={!manifest.driverId ? 'Defina o motorista antes de emitir o CIOT' : ''}>
              Emitir CIOT
            </button>
          )}
          <button type="button" disabled={fiscalBusy || (!getCiotAuthorizedDoc() && !manifest.ciotDispensado)} onClick={handleEmitMdfe} className="rounded-lg border border-tower-300 bg-white px-3 py-1.5 text-sm text-tower-800 hover:bg-tower-50 disabled:opacity-50 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100">
            {getMdfeAuthorizedDoc() ? 'MDF-e emitido' : 'MDF-e (ACBr)'}
          </button>
        </div>

        {showCiotForm && (
          <div className="border-t border-tower-100 dark:border-tower-800 pt-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de viagem</label>
                <select value={ciotOverride} onChange={(e) => setCiotOverride(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                  <option value="">Automático</option>
                  <option value="PADRAO">Lotação (Padrão)</option>
                  <option value="FRACIONADO">Fracionado</option>
                  <option value="TAC_AGREGADO">TAC Agregado</option>
                </select>
              </div>
              <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Documento da viagem</label><input value={ciotForm.documentoViagem} onChange={(e) => setCiotForm((f) => ({ ...f, documentoViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Distância percorrida (km)*</label><input type="number" min={0} value={ciotForm.distanciaPercorrida} onChange={(e) => setCiotForm((f) => ({ ...f, distanciaPercorrida: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              {ciotOverride !== 'TAC_AGREGADO' && (
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Início da viagem</label><input type="datetime-local" value={ciotForm.dataInicioViagem} onChange={(e) => setCiotForm((f) => ({ ...f, dataInicioViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              )}
              <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Fim da viagem*</label><input type="datetime-local" value={ciotForm.dataFimViagem} onChange={(e) => setCiotForm((f) => ({ ...f, dataFimViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              {ciotOverride !== 'TAC_AGREGADO' && (
                <>
                  <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">NCM natureza da carga</label><input value={ciotForm.codigoNcmNaturezaCarga} onChange={(e) => setCiotForm((f) => ({ ...f, codigoNcmNaturezaCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Peso da carga (kg)</label><input type="number" min={0} value={ciotForm.pesoCarga} onChange={(e) => setCiotForm((f) => ({ ...f, pesoCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Código tipo de carga (1-12)</label><input type="number" min={1} max={12} value={ciotForm.codigoTipoCarga} onChange={(e) => setCiotForm((f) => ({ ...f, codigoTipoCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de pagamento</label>
                <select value={ciotForm.tipoPagamento} onChange={(e) => setCiotForm((f) => ({ ...f, tipoPagamento: e.target.value as any }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                  <option value="TransferenciaBancaria">Transferência bancária</option>
                  <option value="eFRETE">eFRETE</option>
                  <option value="DepositoAgendado">Depósito agendado</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Entrega de documentação</label>
                <select value={ciotForm.entregaDocumentacao} onChange={(e) => setCiotForm((f) => ({ ...f, entregaDocumentacao: e.target.value as any }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                  <option value="RedeCredenciada">Rede credenciada</option>
                  <option value="Cliente">Cliente</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-tower-700 dark:text-tower-200 mt-6">
                <input type="checkbox" checked={ciotForm.altoDesempenho} onChange={(e) => setCiotForm((f) => ({ ...f, altoDesempenho: e.target.checked }))} /> Alto desempenho
              </label>
              {ciotOverride !== 'TAC_AGREGADO' && (
                <label className="flex items-center gap-2 text-sm text-tower-700 dark:text-tower-200 mt-6">
                  <input type="checkbox" checked={ciotForm.retornoVazio} onChange={(e) => setCiotForm((f) => ({ ...f, retornoVazio: e.target.checked }))} /> Retorno vazio
                </label>
              )}
              <label className="flex items-center gap-2 text-sm text-tower-700 dark:text-tower-200 mt-6">
                <input type="checkbox" checked={ciotForm.composicaoVeicular} onChange={(e) => setCiotForm((f) => ({ ...f, composicaoVeicular: e.target.checked }))} /> Composição veicular (com carreta)
              </label>
            </div>

            <div className="mt-4 border-t border-tower-100 dark:border-tower-800 pt-4">
              <span className="text-xs font-semibold text-tower-500 uppercase">Valores (Carta Frete)</span>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Frete bruto (total)</label><input type="number" min={0} value={ciotForm.totalViagem} onChange={(e) => setCiotForm((f) => ({ ...f, totalViagem: e.target.value, totalOperacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Adiantamento</label><input type="number" min={0} value={ciotForm.totalAdiantamento} onChange={(e) => setCiotForm((f) => ({ ...f, totalAdiantamento: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Quitação</label><input type="number" min={0} value={ciotForm.totalQuitacao} onChange={(e) => setCiotForm((f) => ({ ...f, totalQuitacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Pedágio</label><input type="number" min={0} value={ciotForm.pedagio} onChange={(e) => setCiotForm((f) => ({ ...f, pedagio: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              </div>
            </div>

            <div className="mt-4 border-t border-tower-100 dark:border-tower-800 pt-4">
              <span className="text-xs font-semibold text-tower-500 uppercase">Destinatário</span>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
                <input placeholder="Nome/Razão social*" value={ciotForm.destNome} onChange={(e) => setCiotForm((f) => ({ ...f, destNome: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                <input placeholder="CPF/CNPJ*" value={ciotForm.destCpfCnpj} onChange={(e) => setCiotForm((f) => ({ ...f, destCpfCnpj: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                <input placeholder="Bairro*" value={ciotForm.destBairro} onChange={(e) => setCiotForm((f) => ({ ...f, destBairro: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                <input placeholder="CEP*" value={ciotForm.destCep} onChange={(e) => setCiotForm((f) => ({ ...f, destCep: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                <input placeholder="Rua*" value={ciotForm.destRua} onChange={(e) => setCiotForm((f) => ({ ...f, destRua: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                <input placeholder="Número*" value={ciotForm.destNumero} onChange={(e) => setCiotForm((f) => ({ ...f, destNumero: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                <input placeholder="Código IBGE do município*" value={ciotForm.destCodigoMunicipio} onChange={(e) => setCiotForm((f) => ({ ...f, destCodigoMunicipio: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button type="button" disabled={fiscalBusy} onClick={handleEmitCiot} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">
                {fiscalBusy ? 'Emitindo…' : 'Emitir CIOT'}
              </button>
              <button type="button" onClick={() => setShowCiotForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
            </div>
          </div>
        )}
      </CollapsibleSection>
```

Este formulário replica **todos** os campos que já existem hoje em `ManifestsTab.tsx:1059-1164` (não é uma versão reduzida) — só muda de lugar, pra dentro da seção Fiscal da tela de detalhe. Nenhum campo editável do fluxo atual de emissão de CIOT é perdido.

- [ ] **Step 3: Rodar typecheck**

Run: `npm run typecheck:web`
Expected: sem erros novos

- [ ] **Step 4: Commit**

```bash
git add components/manifest/ManifestDetailPage.tsx
git commit -m "feat(manifest): secoes Carta Frete e Fiscal (CIOT/MDF-e) na tela de detalhe, Hub com acesso total"
```

---

## Task 8: Rota `/manifests/:id`

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Importar o componente** (junto aos demais imports de página, perto de `OrderDetailPage`):

```typescript
import ManifestDetailPage from './components/manifest/ManifestDetailPage';
```

- [ ] **Step 2: Adicionar a rota**, logo após a rota `/orders/:id` (App.tsx:305-309):

```tsx
            <Route path="/manifests/:id" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'HUB']}>
                <ManifestDetailPage />
              </ProtectedRoute>
            } />
```

- [ ] **Step 3: Rodar typecheck e testar navegação manual**

Run: `npm run dev` (num terminal) e abrir `http://localhost:3000/#/manifests/<id-de-um-manifesto-existente>` logado como ADMIN
Expected: tela carrega sem erro de rota (pode faltar dado se o manifesto não existir — o `EmptyState` deve aparecer nesse caso, não uma tela em branco)

- [ ] **Step 4: Commit**

```bash
git add App.tsx
git commit -m "feat(routing): rota /manifests/:id para a tela de detalhe compartilhada"
```

---

## Task 9: Encolher `ManifestsTab.tsx` — lista enxuta + navegação

**Files:**
- Modify: `components/admin/ManifestsTab.tsx`

Remove os painéis inline de ação (`showAddDemand`, `showAddStop`, `showAssign`, `showCapa`, `showFreightAgreement`, `showDriverAssign`, `showCiotForm` e todos os handlers associados) e o bloco de botões do card (linhas 1220-1385). Mantém intacto: `showCreate`/`handleCreate` (criação de viagem — não faz parte do problema de UX mobile) e o filtro/busca da lista.

- [ ] **Step 1: Remover states não usados mais**, deixando só:

```typescript
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    vehicleTypeId: '',
    origin: '',
    destination: '',
    hubId: '',
    tripType: 'TRANSFER' as 'TRANSFER' | 'DELIVERY',
    destHubId: '',
  });
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterQ, setFilterQ] = useState('');
```

Isso remove: `links`, `ordersAvailable`, `showAddDemand`, `selectedStopId`, `showAddStop`, `newStopForm`, `showAssign`, `showCapa`, `fiscalEmitters`, `capaForm`, `showFreightAgreement`, `emptyFreightForm`, `freightForm`, `assignLinkId`, `fiscalBusyId`, `showDriverAssign`, `driversForLink`, `assignDriverId`, `newDriverForm`, `showNewDriverForm`, `showCiotForm`, `ciotSuggestion`, `ciotOverride`, `ciotJobStatus`, `emptyCiotForm`, `ciotForm`, `ciotContratadoDocument`, `selectedOrderId`, `selectedManifestId`.

- [ ] **Step 2: Remover as funções**: `loadOrdersForAdd`, `openAddDemand`, `handleAddDemand`, `openAddStop`, `handleAddStop`, `handleCompleteStop`, `handleRemoveDemand`, `handleAssign`, `openCapa`, `handleSaveCapa`, `openFreightAgreement`, `freightFormSaldoLiquido`, `handleSaveFreightAgreement`, `handleEmitMdfe`, `getCiotAuthorizedDoc`, `getMdfeAuthorizedDoc`, `openDriverAssign`, `handleAssignDriver`, `handleCreateDriver`, `openCiotForm`, `pollCiotStatus`, `handleEmitCiot`, `handleCancelCiotTrip`, `canShowFiscalActions` (linhas 147-601). Também simplificar `load` pra não buscar mais `links`/`fiscalEmitters` (só precisa de `manifests`, `vehicleTypes`, `hubs`):

```typescript
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [manRes, vtRes, hubRes] = await Promise.all([
        manifestsApi.list({}),
        vehicleTypesApi.list(),
        hubsApi.list(),
      ]);
      setManifests(Array.isArray((manRes as any)?.data) ? (manRes as any).data : []);
      setVehicleTypes(Array.isArray((vtRes as any)?.data) ? (vtRes as any).data : []);
      setHubs(Array.isArray((hubRes as any)?.data) ? (hubRes as any).data : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagens');
    } finally {
      setLoading(false);
    }
  };
```

- [ ] **Step 3: Ajustar `manifestGestao`** (linhas 616-651) — `onEdit` agora navega pra tela de detalhe em vez de abrir painel inline. Precisa de `useNavigate`:

```typescript
import { useNavigate } from 'react-router-dom';
// ...dentro do componente:
  const navigate = useNavigate();
```

```typescript
  const manifestGestao = useMemo(
    () => ({
      listActive: !showCreate && !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount: (filterStatus ? 1 : 0) + (filterQ.trim() ? 1 : 0),
      pills: [
        ...(filterStatus ? [{ id: 'st', label: `Status: ${statusLabels[filterStatus] ?? filterStatus}`, onRemove: () => setFilterStatus('') }] : []),
        ...(filterQ.trim() ? [{ id: 'q', label: `Busca: ${filterQ.trim()}`, onRemove: () => setFilterQ('') }] : []),
      ],
      onList: () => {
        setGestaoFilterOpen(false);
        setShowCreate(false);
        void load();
        document.getElementById('manifests-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onNew: isHub ? undefined : () => setShowCreate(true),
      disabled: { new: isHub } as const,
      labels: { new: isHub ? 'Novas viagens são criadas pela central.' : 'Nova viagem' },
    }),
    [showCreate, gestaoFilterOpen, filterStatus, filterQ, isHub]
  );
```

(Remove `onEdit`/`disabled.edit`/`labels.edit` do config — não existe mais "selecionar card + editar via toolbar", cada card agora tem seu próprio link "Ver detalhes".)

- [ ] **Step 4: Substituir o card da lista** (linhas 1187-1442) por uma versão enxuta que só navega:

```tsx
        <div id="manifests-lista" className="space-y-4">
          {filteredManifests.map((m) => (
            <RouterLink
              key={m.id}
              to={`/manifests/${m.id}`}
              className="block rounded-xl border border-tower-200 bg-white/95 p-5 shadow-sm transition-shadow hover:border-brand-300 dark:border-tower-700 dark:bg-tower-900/80"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-ids text-[10px] font-bold text-tower-400">#{m.id.slice(0, 8)}</span>
                  {m.tripType && (
                    <StatusBadge label={tripTypeLabels[m.tripType] ?? m.tripType} tone={m.tripType === 'DELIVERY' ? 'success' : 'info'} />
                  )}
                  <StatusBadge label={statusLabels[m.status] ?? m.status} tone={manifestTone[m.status] ?? 'neutral'} />
                  <span className="font-bold text-tower-900 dark:text-tower-50">{m.origin} → {m.destination}</span>
                  {m.vehicleType && <span className="text-sm text-tower-500">({m.vehicleType.name})</span>}
                  {m.link && <span className="text-sm text-tower-600 dark:text-tower-300">· Motorista: {m.link.name}</span>}
                </div>
                <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">Ver detalhes →</span>
              </div>
              <div className="mt-2 text-xs text-tower-500 dark:text-tower-400">
                {(m.demands?.length ?? 0)} pedido(s){(m.tripStops?.length ?? 0) > 0 ? ` · ${m.tripStops!.length} parada(s)` : ''}
              </div>
            </RouterLink>
          ))}
        </div>
```

Precisa importar `Link as RouterLink` de `react-router-dom` no topo do arquivo. Remover o JSX antigo dos 6 painéis condicionais (`showAddDemand`, `showAddStop`, `showAssign`, `showCapa`, `showFreightAgreement`, `showDriverAssign`, `showCiotForm` — linhas 805-1178) — o único painel condicional que sobra é `showCreate` (linhas 709-803, inalterado).

- [ ] **Step 5: Rodar typecheck**

Run: `npm run typecheck:web`
Expected: sem erros — conferir que não sobrou nenhuma referência a state/função removida (o compilador aponta se sobrar)

- [ ] **Step 6: Testar manualmente no navegador**

Run: `npm run dev`, logar como ADMIN, ir em Gestão → Transporte → Viagens
Expected: lista mostra cards enxutos, clicar em um navega pra `/#/manifests/:id` e mostra as seções da Task 5-7; criar viagem nova continua funcionando

- [ ] **Step 7: Commit**

```bash
git add components/admin/ManifestsTab.tsx
git commit -m "refactor(admin): ManifestsTab vira lista enxuta, acoes migram para ManifestDetailPage"
```

---

## Task 10: `HubHome.tsx` — bipagem na seleção de pedidos + navegação pro detalhe

**Files:**
- Modify: `components/operacao/HubHome.tsx`

- [ ] **Step 1: Adicionar `OrderScanInput` na aba "pedidos"**, logo após a barra de busca (linha 613-616), pra bipar/digitar e marcar o pedido como selecionado direto (sem precisar rolar a lista e clicar no checkbox):

```typescript
import OrderScanInput from '../ui/OrderScanInput';
import type { ResolvedOrderSummary } from '../../types/index';
```

```tsx
            <div className="flex items-center gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar pedidos..." className="h-11 w-full rounded-xl border border-tower-300 bg-white px-3 text-sm text-tower-900 placeholder:text-tower-500 ring-brand-500/30 focus:border-brand-500 focus:outline-none focus:ring-2 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100 dark:placeholder:text-tower-400" />
              <button type="button" onClick={() => setTab('entrada')} className="h-11 min-w-11 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white">+ Nova entrada</button>
            </div>
            <OrderScanInput
              onResolved={(resolved: ResolvedOrderSummary) => {
                setSelectedOrderIds((prev) => new Set(prev).add(resolved.id));
                setTab('pedidos');
              }}
            />
```

Isso reaproveita o `selectedOrderIds`/`toggleOrder` que já existem (linha 396-398) — bipar só adiciona ao mesmo Set que os checkboxes já usam, então o botão "Criar manifesto" com `selectedOrders` (linha 731) continua funcionando sem mudança.

- [ ] **Step 2: Adicionar link "Ver detalhes" no `ManifestCard`** (linha 259-292), pra dar acesso às ações completas (Carta Frete, motorista, CIOT, MDF-e) que hoje o Hub não tem:

```typescript
const ManifestCard: React.FC<{ m: any; children?: React.ReactNode }> = ({ m, children }) => (
  <div className="card-surface p-4">
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-tower-800 dark:text-tower-100">{m.link?.name ?? 'Sem motorista'}</p>
        <p className="text-xs text-tower-600 dark:text-tower-400">{m.origin} → {m.destination}</p>
      </div>
      <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${toneClassMap[MANIFEST_STATUS_TONE[m.status] ?? 'neutral']}`}>{MANIFEST_STATUS_LABEL[m.status] ?? m.status}</span>
    </div>
    {m.tripStops && m.tripStops.length > 0 && (
      <ul className="mt-2 space-y-1 text-xs text-tower-600 dark:text-tower-300">
        {m.tripStops.map((s: any) => (
          <li key={s.id}>
            #{s.sequence} — {s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel ?? s.destCity ?? 'Parada')}
            {s.completedAt ? ' · Concluída' : ' · Pendente'}
          </li>
        ))}
      </ul>
    )}
    <div className="mt-3 flex items-center justify-between text-xs pt-2 border-t border-tower-100 dark:border-tower-800">
      <span className="text-tower-500 dark:text-tower-400">Margem:</span>
      {m.costComplete ? (
        <span className={`font-semibold ${(m.margin ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(m.margin ?? 0)} ({m.marginPercent?.toFixed(1) ?? '0.0'}%)
        </span>
      ) : (
        <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">Custo não definido</span>
      )}
    </div>
    <button
      type="button"
      onClick={() => { window.location.hash = `#/manifests/${m.id}`; }}
      className="mt-3 w-full rounded-lg border border-tower-300 py-2 text-sm font-semibold text-tower-700 hover:bg-tower-50 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
    >
      Ver detalhes →
    </button>
    {children}
  </div>
);
```

(O botão "Marcar recebido" continua vindo via `children`, como já é hoje — fica antes ou depois do "Ver detalhes" dependendo da ordem de composição no `manifestosChegando.map`, sem mudança ali.)

- [ ] **Step 3: Rodar typecheck**

Run: `npm run typecheck:web`
Expected: sem erros novos

- [ ] **Step 4: Testar manualmente no navegador**

Run: `npm run dev`, logar como HUB, ir na aba Pedidos, bipar/digitar um código de um pedido `AT_HUB` do próprio hub
Expected: pedido some da lista de "não selecionados" / aparece marcado; ir na aba Manifestos e clicar "Ver detalhes →" abre `/manifests/:id` com todas as seções, incluindo CIOT e MDF-e

- [ ] **Step 5: Commit**

```bash
git add components/operacao/HubHome.tsx
git commit -m "feat(hub): bipagem na selecao de pedidos + acesso a tela de detalhe completa do manifesto"
```

---

## Task 11: Smoke test ponta a ponta

**Files:** nenhum (verificação manual, mesmo padrão usado na Fatia 1.5)

- [ ] **Step 1: Rodar toda a suíte automatizada**

Run: `cd server && npm test`
Expected: todos os testes verdes, incluindo `orderResolve.test.ts` (Task 1) e os já existentes (`manifestLifecycle.test.ts`, `manifests.lifecycle.test.ts`)

Run: `npm run typecheck:web` (raiz, frontend) e `cd server && npm run typecheck`
Expected: ambos limpos

- [ ] **Step 2: Smoke test manual (dev local)**

1. Logar como HUB → aba Pedidos → bipar (digitar manualmente simulando leitor) a chave de 44 dígitos de uma `OrderInvoice.nfKey` de um pedido `AT_HUB` real do seed/dev DB → confirmar que ele é selecionado.
2. Bipar também um pedido usando só o **sufixo do `Order.id`** (últimos 8 caracteres) → confirmar que resolve o mesmo tipo de resultado.
3. Criar manifesto com os 2 pedidos selecionados (fluxo existente do `ManifestModal`, inalterado).
4. Ir em Manifestos → "Ver detalhes →" → abrir `ManifestDetailPage` → conferir que aparecem as seções Pedidos, Paradas, Capa, Motorista, Carta Frete e Fiscal (CIOT/MDF-e visíveis, "Cancelar CIOT" ausente por não ser ADMIN).
5. Logar como ADMIN → Gestão → Transporte → Viagens → abrir o mesmo manifesto → conferir que "Cancelar CIOT" aparece (se houver CIOT autorizado) e que criar viagem nova ainda funciona.
6. No detalhe (como ADMIN ou HUB), usar `OrderScanInput` na seção Pedidos pra adicionar mais um pedido `AT_HUB` bipando a **chave de CT-e** (`cteAccessKey`) de um pedido que já tenha `OrderFreightCalculation` — confirmar que resolve e adiciona.
7. Testar viewport mobile (DevTools, 375px de largura) na tela de detalhe — confirmar que nada estoura horizontalmente (era o problema original dos 8 botões).

- [ ] **Step 3: Reportar ao usuário**

Sem commit neste task — é checagem. Se algum passo falhar, criar um task de correção antes de considerar o plano concluído.

---

## Nota separada (fora deste plano): bug pré-existente encontrado

`ManifestsTab.tsx` (antes do Task 9) tinha um botão "Iniciar viagem" para status `PENDING_ACCEPT`/`ACCEPTED` chamando `manifestsApi.start`, que bate em `PATCH /manifests/:id/start` — **essa rota é `authorize('LINK')` apenas** (`server/src/routes/manifests.ts:819`). Ou seja, hoje, se um ADMIN clicasse nesse botão, recebe 403. Este plano **remove esse botão** da lista/detalhe (não estava no escopo pedido — decisão #16/#20 do NORTE tratam início/conclusão como fluxo do Link), mas é uma inconsistência pré-existente que vale decidir separadamente: abrir o backend pra ADMIN também, ou remover de vez a intenção de "Admin força início" do produto.
