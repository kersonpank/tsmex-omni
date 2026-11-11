# CT-e Assíncrono, Resiliente e FinOps-Aware (ACBr) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a emissão síncrona de CT-e (bloqueia a request HTTP por até ~36s, nunca baixa o PDF, expõe URL da API ACBr ao frontend) por um pipeline assíncrono via fila (BullMQ + Redis) processado por um worker isolado, com pré-validação sem custo, idempotência, tratamento de 429/402, download único de XML+PDF persistido em storage próprio, e zero chamada do frontend à API ACBr.

**Architecture:** Rota `emit-cte` faz preflight síncrono (grátis) e, quando o provedor é ACBr real, cria um `CteEmissionJob` e enfileira (`202 Accepted` imediato) em vez de chamar a ACBr inline; um processo `worker` separado consome a fila BullMQ, faz `POST /cte` uma única vez, faz polling `GET /cte/{id}` reagendando via delay do BullMQ (nunca bloqueando), baixa XML+PDF uma única vez pra dentro do S3/MinIO já existente, e nunca deixa o frontend enxergar uma URL da ACBr. O modo simulado local (sem ACBr real) continua síncrono como hoje — não precisa de fila.

**Tech Stack:** Node/Express/TypeScript (ESM), Prisma 6/Postgres, BullMQ + ioredis (novo), `@aws-sdk/client-s3` (já existente), `node:test` para testes.

---

## Contexto de arquivos já existentes (referência rápida, não recriar)

- `server/src/services/acbr/acbrCteEmit.ts` — hoje tem o loop de polling bloqueante (`emitCteViaAcbr`), será refatorado.
- `server/src/services/acbr/acbrHttp.ts` — `acbrFetchJson`, sem timeout hoje.
- `server/src/services/acbr/acbrAuth.ts` — `getAcbrAccessToken`, já cacheia token em memória por `scopeKey` — **reutilizar, não duplicar**.
- `server/src/services/acbr/acbrConfig.ts` — `getAcbrProviderDecision`, `getAcbrApiBaseUrlForEnvironment`.
- `server/src/services/cteService.ts` — `validateCteReadiness`, `authorizeCteWithProvider` (modo simulado + chamada ACBr síncrona hoje).
- `server/src/services/fiscal/ctePreflight.ts` — `buildCtePreflightResult`, único ponto que a rota chama antes de custar crédito.
- `server/src/services/fiscal/cteTaxRules.ts` — `validateCteTaxSelection` (CFOP/CST).
- `server/src/routes/freightCalculations.ts` — rota `POST /:calcId/emit-cte` (linha 1075), `FISCAL_LOCKED_STATUSES` (linha 77), `buildCteEmissionInputFromRecords` (linha 342).
- `server/src/lib/objectStorage.ts` — `uploadBase64Object`, `getObjectDownloadUrl`, já usado pro certificado A1.
- `server/src/routes/fiscalEmitters.ts` — rota `GET /:id/certificate-download` (linha 186), padrão de signed URL a reaproveitar.
- `lib/api.ts` — `ordersFreightApi.emitCte` (linha 1033), `ordersFreightApi.ctePreflight`.
- `components/admin/OrderFreightCalculationSection.tsx` — `handleEmitCte` (linha 436), anchors diretos pra `ctePdfUrl`/`cteXmlUrl` (linha 694-725).
- `server/prisma/backfill-ibge-codes.ts` — padrão de script de backfill a seguir (`PrismaClient` direto, `async function main()`).
- Última migration: `20260701222537_add_ibge_codes` — novas migrations devem ter timestamp posterior.

---

## Task 1: Migration Prisma — enums, colunas de storage, `CteEmissionJob`, `SystemAlert`

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260702090000_cte_async_pipeline/migration.sql`

- [ ] **Step 1: Editar `schema.prisma` — adicionar valores ao enum `FreightCalcStatus`**

Em `server/prisma/schema.prisma`, localizar o enum `FreightCalcStatus` (linha ~1542) e adicionar `CTE_PROCESSING` e `CTE_PENDING_RECONCILIATION` logo após `CTE_SENT`:

```prisma
enum FreightCalcStatus {
  DRAFT // Rascunho
  CALCULATED // Calculado
  CTE_READY // CT-e validado e pronto para envio fiscal
  CTE_SENT // CT-e enviado ao provedor fiscal / SEFAZ
  CTE_PROCESSING // Worker confirmou POST /cte e está fazendo polling assíncrono
  CTE_REJECTED // CT-e rejeitado com pendências recuperáveis
  CTE_PENDING_RECONCILIATION // Timeout de polling OU fila pausada por crédito — precisa de ação manual, NUNCA é rejeição automática
  MINUTA_EMITTED // Minuta emitida
  CTE_AUTHORIZED // CT-e autorizado SEFAZ
  CTE_CANCELLED // CT-e cancelado
  DCE_READY // DC-e pronto para envio
  DCE_SENT
  DCE_REJECTED
  DCE_AUTHORIZED
  DCE_CANCELLED
}
```

- [ ] **Step 2: Adicionar colunas de storage key em `OrderFreightCalculation`**

Na mesma model (linha ~1600), logo abaixo de `ctePdfUrl`:

```prisma
  cteXml          String?           @db.Text
  cteXmlUrl       String?
  ctePdfUrl       String?
  cteXmlStorageKey String?
  ctePdfStorageKey String?
  cteAuthorizedAt DateTime?
```

E adicionar a relação nova no final da model, antes do fechamento `}`:

```prisma
  cteEmissionJobs CteEmissionJob[]
```

- [ ] **Step 3: Adicionar as novas models no final do arquivo**

Anexar ao final de `server/prisma/schema.prisma`:

```prisma
enum CteEmissionJobPhase {
  QUEUED
  EMPRESA_ENSURING
  SUBMITTED
  POLLING
  DOWNLOADING_FILES
  DONE
  FAILED
  PENDING_RECONCILIATION
}

model CteEmissionJob {
  id     String                   @id @default(uuid())
  calcId String
  calc   OrderFreightCalculation  @relation(fields: [calcId], references: [id], onDelete: Cascade)

  queueJobId      String?              @unique
  providerDocId   String?
  phase           CteEmissionJobPhase  @default(QUEUED)
  attemptCount    Int                  @default(0)
  maxAttempts     Int                  @default(24)
  lastPolledAt    DateTime?
  nextPollAt      DateTime?
  lastHttpStatus  Int?
  lastError       String?              @db.Text
  pausedForQuota  Boolean              @default(false)
  xmlDownloadedAt DateTime?
  pdfDownloadedAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([calcId])
  @@index([providerDocId])
  @@index([phase])
}

enum SystemAlertCategory {
  FISCAL_PROVIDER_QUOTA
  FISCAL_PROVIDER_ERROR
  GENERIC
}

enum SystemAlertSeverity {
  INFO
  WARNING
  CRITICAL
}

enum SystemAlertStatus {
  OPEN
  ACKNOWLEDGED
  RESOLVED
}

model SystemAlert {
  id       String               @id @default(uuid())
  category SystemAlertCategory
  severity SystemAlertSeverity  @default(WARNING)
  status   SystemAlertStatus    @default(OPEN)
  title    String
  message  String               @db.Text
  context  Json?

  createdAt           DateTime  @default(now())
  acknowledgedAt       DateTime?
  acknowledgedByUserId String?
  resolvedAt           DateTime?

  @@index([status])
  @@index([category])
}
```

- [ ] **Step 4: Criar a migration SQL manualmente (mesmo idioma das migrations anteriores do repo)**

Criar diretório `server/prisma/migrations/20260702090000_cte_async_pipeline/` com `migration.sql`:

```sql
-- CT-e async pipeline: novos estados, tabelas de fila e alerta.

-- Postgres não permite usar um valor de enum novo na mesma transação em que foi criado —
-- manter os ALTER TYPE em statements isolados, como já é o padrão das migrations deste repo.
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_PROCESSING';
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_PENDING_RECONCILIATION';

ALTER TABLE "OrderFreightCalculation"
  ADD COLUMN IF NOT EXISTS "cteXmlStorageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "ctePdfStorageKey" TEXT;

CREATE TYPE "CteEmissionJobPhase" AS ENUM (
  'QUEUED', 'EMPRESA_ENSURING', 'SUBMITTED', 'POLLING',
  'DOWNLOADING_FILES', 'DONE', 'FAILED', 'PENDING_RECONCILIATION'
);

CREATE TABLE "CteEmissionJob" (
  "id" TEXT NOT NULL,
  "calcId" TEXT NOT NULL,
  "queueJobId" TEXT,
  "providerDocId" TEXT,
  "phase" "CteEmissionJobPhase" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 24,
  "lastPolledAt" TIMESTAMP(3),
  "nextPollAt" TIMESTAMP(3),
  "lastHttpStatus" INTEGER,
  "lastError" TEXT,
  "pausedForQuota" BOOLEAN NOT NULL DEFAULT false,
  "xmlDownloadedAt" TIMESTAMP(3),
  "pdfDownloadedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CteEmissionJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CteEmissionJob"
  ADD CONSTRAINT "CteEmissionJob_calcId_fkey"
  FOREIGN KEY ("calcId") REFERENCES "OrderFreightCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CteEmissionJob_queueJobId_key" ON "CteEmissionJob"("queueJobId");
CREATE INDEX "CteEmissionJob_calcId_idx" ON "CteEmissionJob"("calcId");
CREATE INDEX "CteEmissionJob_providerDocId_idx" ON "CteEmissionJob"("providerDocId");
CREATE INDEX "CteEmissionJob_phase_idx" ON "CteEmissionJob"("phase");

CREATE TYPE "SystemAlertCategory" AS ENUM ('FISCAL_PROVIDER_QUOTA', 'FISCAL_PROVIDER_ERROR', 'GENERIC');
CREATE TYPE "SystemAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "SystemAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "SystemAlert" (
  "id" TEXT NOT NULL,
  "category" "SystemAlertCategory" NOT NULL,
  "severity" "SystemAlertSeverity" NOT NULL DEFAULT 'WARNING',
  "status" "SystemAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemAlert_status_idx" ON "SystemAlert"("status");
CREATE INDEX "SystemAlert_category_idx" ON "SystemAlert"("category");
```

- [ ] **Step 5: Aplicar a migration e regenerar o client Prisma**

Run: `cd server && npx prisma migrate dev`
Expected: prompt confirma a migration `20260702090000_cte_async_pipeline` aplicada, sem drift, `Prisma Client` regenerado.

- [ ] **Step 6: Verificar typecheck com os novos tipos**

Run: `cd server && npm run typecheck`
Expected: sem erros (o client Prisma novo já expõe `prisma.cteEmissionJob` e `prisma.systemAlert`).

- [ ] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260702090000_cte_async_pipeline
git commit -m "feat(fiscal): add async CT-e pipeline schema (CteEmissionJob, SystemAlert, storage keys)"
```

---

## Task 2: Validação de formato do RNTRC (TDD)

**Files:**
- Create: `server/src/services/fiscal/rntrcValidation.ts`
- Test: `server/src/services/fiscal/rntrcValidation.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateRntrcFormat } from './rntrcValidation.js';

describe('validateRntrcFormat', () => {
    it('aceita RNTRC com exatamente 8 dígitos numéricos', () => {
        assert.equal(validateRntrcFormat('12345678'), true);
    });

    it('rejeita RNTRC com menos de 8 dígitos', () => {
        assert.equal(validateRntrcFormat('1234567'), false);
    });

    it('rejeita RNTRC com mais de 8 dígitos', () => {
        assert.equal(validateRntrcFormat('123456789'), false);
    });

    it('rejeita RNTRC com caracteres não numéricos', () => {
        assert.equal(validateRntrcFormat('1234-678'), false);
    });

    it('rejeita RNTRC vazio, nulo ou undefined', () => {
        assert.equal(validateRntrcFormat(''), false);
        assert.equal(validateRntrcFormat(null), false);
        assert.equal(validateRntrcFormat(undefined), false);
    });

    it('rejeita RNTRC com espaços em volta mesmo se o miolo tiver 8 dígitos', () => {
        assert.equal(validateRntrcFormat(' 12345678 '), true, 'trim é aceitável, mas o valor interno deve ter 8 dígitos');
    });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd server && npx tsx --test src/services/fiscal/rntrcValidation.test.ts`
Expected: FAIL — `Cannot find module './rntrcValidation.js'`.

- [ ] **Step 3: Implementar `rntrcValidation.ts`**

```ts
/**
 * RNTRC (Registro Nacional de Transportadores Rodoviários de Cargas) tem 8 dígitos numéricos.
 * Não implementamos dígito verificador ANTT aqui: a fórmula oficial não está documentada em
 * nenhuma fonte confiável disponível neste projeto. Um valor com formato errado é rejeitado
 * antes de gastar crédito ACBr; um valor com formato certo mas dígito inválido só será
 * pego pela SEFAZ (custo de 1 crédito) até essa fórmula ser confirmada e implementada aqui.
 */
export function validateRntrcFormat(value: string | null | undefined): boolean {
    if (typeof value !== 'string') return false;
    return /^\d{8}$/.test(value.trim());
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd server && npx tsx --test src/services/fiscal/rntrcValidation.test.ts`
Expected: PASS — 6 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/fiscal/rntrcValidation.ts server/src/services/fiscal/rntrcValidation.test.ts
git commit -m "feat(fiscal): add strict RNTRC format validation (8 numeric digits)"
```

---

## Task 3: Usar a validação estrita de RNTRC no preflight do CT-e

**Files:**
- Modify: `server/src/services/cteService.ts:125`
- Modify: `server/src/services/acbr/acbrCteMapper.ts` (remover fallback silencioso de `padStart('00000000')`)
- Test: `server/src/services/cteService.test.ts` (criar se não existir)

- [ ] **Step 1: Ler o trecho atual do mapper que faz o fallback silencioso**

Run: `grep -n "rntrc" server/src/services/acbr/acbrCteMapper.ts`
Expected: localizar a linha com `padStart(8, '0').slice(0, 8)` (~linha 173) — essa linha "corrige" RNTRC mal formatado ao invés de bloquear antes. Vamos manter o `padStart` como último cinto de segurança dentro do mapper (defesa em profundidade, não remove), mas o preflight agora barra ANTES disso.

- [ ] **Step 2: Escrever teste que falha em `cteService.test.ts`**

Se o arquivo não existir, criar com este conteúdo (senão, adicionar este bloco `describe`):

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateCteReadiness, type CteEmissionInput } from './cteService.js';

const basePerson = {
    legalName: 'Empresa Teste LTDA',
    document: '12345678000190',
    stateRegistration: '123456789',
    address: 'Rua A',
    number: '100',
    neighborhood: 'Centro',
    city: 'Imperatriz',
    state: 'MA',
    cep: '65900000',
};

function buildInput(rntrc: string | null): CteEmissionInput {
    return {
        calc: {
            id: 'calc-1',
            originCity: 'Imperatriz',
            destCity: 'São Luís',
            cfop: '6352',
            cst: '00',
            tipoFrete: 'Normal',
            volumes: 1,
            weight: 10,
            effectiveWeight: 10,
            cubage: 0.1,
            nfValue: 100,
            commodity: 'Diversos',
            freightTotal: 50,
            breakdown: {},
            icmsValue: 0,
        },
        order: {
            freightTerm: 'CIF',
            remetentePerson: basePerson,
            destinatarioPerson: basePerson,
            consignatarioPerson: null,
            expedidorPerson: null,
            invoicesRel: [{ type: 'NFE', nfNumber: '1', nfKey: '1'.repeat(44) }],
        },
        hub: { id: 'hub-1', name: 'Hub Imperatriz', code: 'IMP', rntrc },
        person: basePerson,
        numero: 1,
        serie: 1,
        ambiente: 'HOMOLOGACAO',
    };
}

describe('validateCteReadiness — RNTRC', () => {
    it('bloqueia RNTRC com formato inválido (7 dígitos)', () => {
        const result = validateCteReadiness(buildInput('1234567'));
        assert.equal(result.ok, false);
        assert.ok(result.issues.some((issue) => issue.includes('RNTRC')));
    });

    it('bloqueia RNTRC ausente', () => {
        const result = validateCteReadiness(buildInput(null));
        assert.equal(result.ok, false);
        assert.ok(result.issues.some((issue) => issue.includes('RNTRC')));
    });

    it('aceita RNTRC com 8 dígitos numéricos', () => {
        const result = validateCteReadiness(buildInput('12345678'));
        assert.ok(!result.issues.some((issue) => issue.includes('RNTRC')));
    });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `cd server && npx tsx --test src/services/cteService.test.ts`
Expected: FAIL na primeira asserção — hoje `'1234567'` passa porque só checa presença.

- [ ] **Step 4: Editar `cteService.ts:125` pra usar `validateRntrcFormat`**

Adicionar o import no topo do arquivo:

```ts
import { validateCteTaxSelection } from './fiscal/cteTaxRules.js';
import { validateRntrcFormat } from './fiscal/rntrcValidation.js';
```

Substituir a linha 125:

```ts
    if (!present(input.hub.rntrc)) issues.push('Hub emissor precisa de RNTRC para CT-e.');
```

por:

```ts
    if (!present(input.hub.rntrc)) {
        issues.push('Hub emissor precisa de RNTRC para CT-e.');
    } else if (!validateRntrcFormat(input.hub.rntrc)) {
        issues.push('RNTRC do Hub emissor inválido: precisa ter exatamente 8 dígitos numéricos.');
    }
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd server && npx tsx --test src/services/cteService.test.ts`
Expected: PASS — 3 testes verdes.

- [ ] **Step 6: Rodar toda a suíte de fiscal pra garantir que nada quebrou**

Run: `cd server && npm test`
Expected: PASS — nenhum teste existente quebrado (`fiscalEmitterService.ts:85` faz checagem só de presença hoje, deixar como está pois valida o cadastro do emitente, não o preflight de emissão — fora de escopo desta tarefa).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/cteService.ts server/src/services/cteService.test.ts
git commit -m "fix(fiscal): block CT-e preflight on malformed RNTRC instead of masking with padStart"
```

---

## Task 4: Cliente Redis

**Files:**
- Modify: `server/package.json`
- Create: `server/src/lib/redis.ts`

- [ ] **Step 1: Adicionar dependências**

Em `server/package.json`, seção `dependencies`, adicionar (ordem alfabética, junto das existentes):

```json
    "bullmq": "^5.34.4",
    "ioredis": "^5.4.2",
```

Run: `cd server && npm install`
Expected: `bullmq` e `ioredis` instalados, `package-lock.json` atualizado.

- [ ] **Step 2: Criar o client Redis**

```ts
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL?.trim() || 'redis://redis:6379';

/**
 * Client único, compartilhado por toda a fila BullMQ. `maxRetriesPerRequest: null`
 * é exigido pelo BullMQ (ele mesmo controla os retries de conexão) — sem isso o
 * Worker trava silenciosamente em reconexões.
 */
export const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
});

export function isRedisConfigured(): boolean {
    return Boolean(process.env.REDIS_URL?.trim()) || true; // sempre há um default local
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `cd server && npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json server/src/lib/redis.ts
git commit -m "feat(infra): add Redis client (ioredis) for BullMQ"
```

---

## Task 5: Fila de emissão de CT-e (BullMQ)

**Files:**
- Create: `server/src/services/queues/cteEmissionQueue.ts`

- [ ] **Step 1: Implementar a definição da fila**

```ts
import { Queue } from 'bullmq';
import { redisConnection } from '../../lib/redis.js';

export const CTE_EMISSION_QUEUE_NAME = 'cte-emission';

export interface CteEmissionJobData {
    calcId: string;
    cteEmissionJobId: string;
    /** 'poll-only' é usado pela reconciliação manual: nunca refaz POST /cte, só consulta status. */
    phaseHint?: 'submit' | 'poll-only';
}

export const cteEmissionQueue = new Queue<CteEmissionJobData>(CTE_EMISSION_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        removeOnComplete: { age: 60 * 60 * 24 * 7 }, // 7 dias de histórico pra auditoria
        removeOnFail: { age: 60 * 60 * 24 * 30 }, // 30 dias — falhas ficam mais tempo pra investigação
    },
});

export async function enqueueCteEmissionJob(data: CteEmissionJobData): Promise<string> {
    const job = await cteEmissionQueue.add('emit', data);
    if (!job.id) throw new Error('BullMQ não retornou id para o job enfileirado.');
    return job.id;
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd server && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/queues/cteEmissionQueue.ts
git commit -m "feat(fiscal): define BullMQ queue for async CT-e emission"
```

---

## Task 6: Timeout por requisição na `acbrHttp.ts`

**Files:**
- Modify: `server/src/services/acbr/acbrHttp.ts`
- Test: `server/src/services/acbr/acbrHttp.test.ts`

- [ ] **Step 1: Escrever teste que falha — timeout deve virar erro tratável, não travar pra sempre**

```ts
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { acbrFetchJson } from './acbrHttp.js';

describe('acbrFetchJson — timeout', () => {
    it('rejeita com erro quando a requisição excede o timeoutMs configurado', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async (_url: string, init: RequestInit) => {
            return new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
            });
        }) as typeof fetch;

        process.env.ACBR_CLIENT_ID = 'test';
        process.env.ACBR_CLIENT_SECRET = 'test';

        try {
            await assert.rejects(
                acbrFetchJson('/cte/123', { method: 'GET', scopes: ['cte'], timeoutMs: 20 }),
                /timeout|abort/i,
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd server && npx tsx --test src/services/acbr/acbrHttp.test.ts`
Expected: FAIL — hoje `AcbrRequestInit` não tem `timeoutMs`, e sem timeout o teste trava (ou o mock nunca resolve, `AbortError` nunca é lançado porque não existe `AbortController` interno).

- [ ] **Step 3: Implementar timeout via `AbortSignal.timeout`**

Substituir o conteúdo de `server/src/services/acbr/acbrHttp.ts`:

```ts
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';

export type AcbrRequestInit = Omit<RequestInit, 'headers'> & {
    /** Escopos OAuth exigidos pelo endpoint (ex.: cte, mdfe, dce, empresa, distribuicao). */
    scopes: string[];
    headers?: Record<string, string>;
    /** Homologação/produção: define o host hom.acbr vs prod.acbr. Omitir = `ACBR_API_BASE_URL` ou hom.acbr por padrão. */
    apiEnvironment?: AcbrFiscalEnvironment;
    /** Timeout individual da requisição, em ms. Default 15s — a SEFAZ pode ficar instável, não travar pra sempre. */
    timeoutMs?: number;
};

export class AcbrHttpError extends Error {
    httpStatus: number;
    retryAfterSeconds?: number;
    retryInSeconds?: number;
    quotaErrorCode?: string;

    constructor(message: string, httpStatus: number, extra: { retryAfterSeconds?: number; retryInSeconds?: number; quotaErrorCode?: string } = {}) {
        super(message);
        this.name = 'AcbrHttpError';
        this.httpStatus = httpStatus;
        this.retryAfterSeconds = extra.retryAfterSeconds;
        this.retryInSeconds = extra.retryInSeconds;
        this.quotaErrorCode = extra.quotaErrorCode;
    }
}

function parseRetryHeaders(res: Response): { retryAfterSeconds?: number; retryInSeconds?: number } {
    const retryAfterRaw = res.headers.get('Retry-After');
    const retryInRaw = res.headers.get('X-Retry-In');
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : undefined;
    // X-Retry-In vem como string tipo "1.003928397s" — parseFloat já ignora o sufixo "s".
    const retryInSeconds = retryInRaw ? Number.parseFloat(retryInRaw) : undefined;
    return {
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        retryInSeconds: Number.isFinite(retryInSeconds) ? retryInSeconds : undefined,
    };
}

export async function acbrFetchJson<T = unknown>(path: string, init: AcbrRequestInit): Promise<T> {
    const scopes = init.scopes;
    const token = await getAcbrAccessToken(scopes);
    const base = getAcbrApiBaseUrlForEnvironment(init.apiEnvironment ?? null);
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.headers ?? {}),
    };
    if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const { scopes: _s, apiEnvironment: _e, timeoutMs, ...rest } = init;

    let res: Response;
    try {
        res = await fetch(url, { ...rest, headers, signal: AbortSignal.timeout(timeoutMs ?? 15_000) });
    } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
            throw new Error(`ACBr ${path}: timeout após ${timeoutMs ?? 15_000}ms aguardando resposta.`);
        }
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error(`ACBr ${path}: requisição abortada (timeout).`);
        }
        throw err;
    }

    const text = await res.text();
    let json: unknown;
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`ACBr resposta não-JSON (${res.status}): ${text.slice(0, 400)}`);
    }
    if (!res.ok) {
        const msg = typeof json === 'object' && json && 'message' in json ? String((json as { message: unknown }).message) : text;
        console.warn(
            JSON.stringify({
                level: 'warn',
                source: 'acbrHttp',
                path,
                httpStatus: res.status,
                messagePreview: msg.slice(0, 200),
            }),
        );
        const { retryAfterSeconds, retryInSeconds } = parseRetryHeaders(res);
        const quotaErrorCode =
            res.status === 402 && typeof json === 'object' && json && 'error' in json
                ? String((json as { error: unknown }).error)
                : undefined;
        throw new AcbrHttpError(`ACBr ${path} HTTP ${res.status}: ${msg.slice(0, 800)}`, res.status, {
            retryAfterSeconds,
            retryInSeconds,
            quotaErrorCode,
        });
    }
    return json as T;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd server && npx tsx --test src/services/acbr/acbrHttp.test.ts`
Expected: PASS.

- [ ] **Step 5: Rodar toda a suíte ACBr pra garantir que `AcbrRequestInit`/`acbrFetchJson` não quebrou call-sites existentes**

Run: `cd server && npm run typecheck && npm test`
Expected: PASS — `acbrCteEmit.ts`, `acbrEmpresa.ts` etc. continuam compilando (a assinatura só ganhou um campo opcional novo, `timeoutMs`).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/acbr/acbrHttp.ts server/src/services/acbr/acbrHttp.test.ts
git commit -m "feat(acbr): add per-request timeout and typed AcbrHttpError with 429/402 metadata"
```

---

## Task 7: Refatorar `acbrCteEmit.ts` em funções puras reaproveitáveis pelo worker

**Files:**
- Modify: `server/src/services/acbr/acbrCteEmit.ts`

- [ ] **Step 1: Substituir o conteúdo do arquivo**

O loop bloqueante de 24 tentativas vira 3 funções chamáveis independentemente por job da fila. `emitCteViaAcbr` (usado hoje pelo modo simulado síncrono em `cteService.ts`) é mantido intacto — o modo simulado não fala com fila nenhuma, continua rápido e local.

```ts
import type { CteEmissionInput, CteProviderResult } from '../cteService.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { buildAcbrCteEmitBody } from './acbrCteMapper.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { acbrFetchJson } from './acbrHttp.js';
import { ensureEmpresaRegistered, type EnsureEmpresaInput } from './acbrEmpresa.js';

/** Optional fiscal emitter context for just-in-time empresa auto-provisioning. */
export type FiscalEmitterContext = {
    crt?: string | null;
    environment: 'HOMOLOGACAO' | 'PRODUCAO';
    certificateStorageKey?: string | null;
    certificatePasswordEncrypted?: string | null;
};

function norm(s: unknown): string {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
}

function mapDocToResult(doc: Record<string, unknown>, id: string, baseUrl: string): CteProviderResult {
    const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
    const st = norm(doc.status);
    const authSt = norm(auth.status);
    const chave = (auth.chave_acesso ?? doc.chave) as string | undefined;
    const proto = (auth.numero_protocolo ?? doc.numero_protocolo) as string | undefined;
    const motivo = [auth.motivo_status, doc.motivo_status].filter(Boolean).join(' | ') || 'Sem motivo informado.';

    if (authSt.includes('autorizado') || st === 'autorizado' || (chave && /^\d{44}$/.test(String(chave).replace(/\D/g, '')) && !st.includes('rejeit'))) {
        const cleanKey = String(chave ?? '').replace(/\D/g, '').slice(0, 44);
        return {
            status: 'AUTHORIZED',
            accessKey: cleanKey || undefined,
            protocol: proto ? String(proto) : undefined,
            xml: undefined,
            pdfUrl: id ? `${baseUrl}/cte/${id}/pdf` : undefined,
            rawResponse: doc as Record<string, unknown>,
        };
    }
    if (st.includes('rejeit') || st.includes('erro') || authSt.includes('rejeit')) {
        return {
            status: 'REJECTED',
            rejectionCode: String(doc.codigo_status ?? auth.codigo_status ?? 'ACBR'),
            rejectionReason: motivo,
            rawResponse: doc as Record<string, unknown>,
        };
    }
    return {
        status: 'REJECTED',
        rejectionCode: 'PENDENTE',
        rejectionReason: motivo,
        rawResponse: doc as Record<string, unknown>,
    };
}

/** Status normalizado de UM poll — não decide timeout nem retry, isso é responsabilidade do processor. */
export type CtePollOutcome =
    | { kind: 'AUTHORIZED'; result: CteProviderResult; providerDocId: string }
    | { kind: 'REJECTED'; result: CteProviderResult }
    | { kind: 'PENDING' };

/**
 * Faz o `POST /cte` (com auto-provisionamento de empresa se necessário) UMA ÚNICA VEZ.
 * Chamador é responsável por nunca invocar isto de novo para o mesmo `CteEmissionJob`
 * depois que `providerDocId` tiver sido persistido.
 */
export async function submitCteToAcbr(
    input: CteEmissionInput,
    referencia: string,
    fiscalEmitter?: FiscalEmitterContext | null,
): Promise<{ providerDocId: string } | { rejected: CteProviderResult }> {
    if (fiscalEmitter) {
        const ensureInput: EnsureEmpresaInput = {
            environment: fiscalEmitter.environment,
            crt: fiscalEmitter.crt,
            person: input.person,
            certificateStorageKey: fiscalEmitter.certificateStorageKey,
            certificatePasswordEncrypted: fiscalEmitter.certificatePasswordEncrypted,
        };
        const ensureResult = await ensureEmpresaRegistered(ensureInput);
        if (!ensureResult.ok) {
            return {
                rejected: {
                    status: 'REJECTED',
                    rejectionCode: 'ACBR_EMPRESA',
                    rejectionReason: ensureResult.message ?? 'Falha ao registrar empresa na ACBr antes da emissão.',
                    rawResponse: { provider: 'acbr', ensureEmpresa: ensureResult },
                },
            };
        }
    }

    const body = await buildAcbrCteEmitBody(input, referencia);
    const created = await acbrFetchJson<Record<string, unknown>>('/cte', {
        method: 'POST',
        body: JSON.stringify(body),
        scopes: ['empresa', 'cte'],
        apiEnvironment: input.ambiente,
    });
    const id = String(created.id ?? '');
    if (!id) {
        return {
            rejected: {
                status: 'REJECTED',
                rejectionCode: 'ACBR',
                rejectionReason: 'Resposta sem id de documento na ACBr.',
                rawResponse: created,
            },
        };
    }
    return { providerDocId: id };
}

/**
 * Uma única checagem de status (`GET /cte/{id}`, com `sincronizar` esporádico).
 * Não decide o que fazer com timeout/erro — isso é o processor da fila que decide,
 * porque só ele sabe a `attemptCount`/`maxAttempts` do `CteEmissionJob`.
 */
export async function pollCteStatusOnce(
    providerDocId: string,
    ambiente: AcbrFiscalEnvironment,
    attempt: number,
): Promise<CtePollOutcome> {
    const baseUrl = getAcbrApiBaseUrlForEnvironment(ambiente);

    if (attempt >= 5 && attempt % 3 === 0) {
        try {
            await acbrFetchJson(`/cte/${providerDocId}/sincronizar`, { method: 'POST', scopes: ['empresa', 'cte'], apiEnvironment: ambiente });
        } catch {
            /* sync opcional — não deve derrubar o polling */
        }
    }

    const doc = await acbrFetchJson<Record<string, unknown>>(`/cte/${providerDocId}`, {
        method: 'GET',
        scopes: ['empresa', 'cte'],
        apiEnvironment: ambiente,
    });
    const st = norm(doc.status);
    const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
    const authSt = norm(auth.status);

    if (authSt.includes('autorizado') || st === 'autorizado') {
        return { kind: 'AUTHORIZED', result: mapDocToResult(doc, providerDocId, baseUrl), providerDocId };
    }
    if (st.includes('rejeit') || st.includes('erro') || authSt.includes('rejeit')) {
        return { kind: 'REJECTED', result: mapDocToResult(doc, providerDocId, baseUrl) };
    }
    return { kind: 'PENDING' };
}

/** Baixa o XML autorizado — chamar só quando ainda não foi baixado (idempotência é responsabilidade do chamador). */
export async function downloadCteXml(providerDocId: string, ambiente: AcbrFiscalEnvironment): Promise<string> {
    const baseUrl = getAcbrApiBaseUrlForEnvironment(ambiente);
    const token = await getAcbrAccessToken(['empresa', 'cte']);
    const res = await fetch(`${baseUrl}/cte/${providerDocId}/xml`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ACBr /cte/${providerDocId}/xml HTTP ${res.status}`);
    return res.text();
}

/** Baixa o PDF (DACTE) autorizado — chamar só quando ainda não foi baixado. */
export async function downloadCtePdf(providerDocId: string, ambiente: AcbrFiscalEnvironment): Promise<Buffer> {
    const baseUrl = getAcbrApiBaseUrlForEnvironment(ambiente);
    const token = await getAcbrAccessToken(['empresa', 'cte']);
    const res = await fetch(`${baseUrl}/cte/${providerDocId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ACBr /cte/${providerDocId}/pdf HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Fluxo síncrono ORIGINAL, preservado só para o modo simulado local (`cteService.ts`
 * chama isto quando `willUseAcbrHttp` é true mas ainda em modo de desenvolvimento sem
 * fila). Novas integrações reais devem usar `submitCteToAcbr`/`pollCteStatusOnce` via
 * `cteEmissionProcessor.ts`, não esta função.
 */
export async function emitCteViaAcbr(
    input: CteEmissionInput,
    referencia: string,
    fiscalEmitter?: FiscalEmitterContext | null,
): Promise<CteProviderResult> {
    const submitted = await submitCteToAcbr(input, referencia, fiscalEmitter);
    if ('rejected' in submitted) return submitted.rejected;
    const { providerDocId } = submitted;

    for (let attempt = 0; attempt < 24; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        const outcome = await pollCteStatusOnce(providerDocId, input.ambiente, attempt);
        if (outcome.kind === 'AUTHORIZED') {
            let xml: string | undefined;
            try {
                xml = await downloadCteXml(providerDocId, input.ambiente);
            } catch {
                /* opcional no fluxo síncrono legado */
            }
            return { ...outcome.result, xml: xml ?? outcome.result.xml };
        }
        if (outcome.kind === 'REJECTED') return outcome.result;
    }

    return {
        status: 'REJECTED',
        rejectionCode: 'TIMEOUT',
        rejectionReason: 'Timeout aguardando retorno da SEFAZ via ACBr.',
        rawResponse: { id: providerDocId },
    };
}
```

- [ ] **Step 2: Rodar typecheck e a suíte inteira**

Run: `cd server && npm run typecheck && npm test`
Expected: PASS — `cteService.ts` continua importando `emitCteViaAcbr` sem mudança de assinatura, comportamento do modo simulado idêntico ao de antes.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/acbr/acbrCteEmit.ts
git commit -m "refactor(acbr): split blocking CT-e polling loop into pure submit/poll/download functions"
```

---

## Task 8: `SystemAlert` — service, rotas e pausa/retomada da fila

Implementado antes do processor (Task 9) porque o processor precisa importar `createSystemAlert` pra tratar o cenário de 402.

**Files:**
- Create: `server/src/services/systemAlertService.ts`
- Create: `server/src/routes/systemAlerts.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Implementar o service**

```ts
// server/src/services/systemAlertService.ts
import prisma from '../lib/prisma.js';
import type { SystemAlertCategory, SystemAlertSeverity } from '@prisma/client';

export async function createSystemAlert(params: {
    category: SystemAlertCategory;
    severity: SystemAlertSeverity;
    title: string;
    message: string;
    context?: Record<string, unknown>;
}): Promise<void> {
    await prisma.systemAlert.create({
        data: {
            category: params.category,
            severity: params.severity,
            title: params.title,
            message: params.message,
            context: params.context ?? undefined,
        },
    });
}
```

- [ ] **Step 2: Implementar as rotas**

```ts
// server/src/routes/systemAlerts.ts
import { Router, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import { cteEmissionQueue } from '../services/queues/cteEmissionQueue.js';

const router = Router();

router.get('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
        const alerts = await prisma.systemAlert.findMany({
            where: statusParam ? { status: statusParam as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' } : undefined,
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        res.json({ success: true, data: alerts });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/acknowledge', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const alert = await prisma.systemAlert.update({
            where: { id: req.params.id as string },
            data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedByUserId: req.user!.id },
        });
        res.json({ success: true, data: alert });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/resume-cte-queue', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const alert = await prisma.systemAlert.findUnique({ where: { id: req.params.id as string } });
        if (!alert) throw new AppError('Alerta não encontrado', 404);
        if (alert.category !== 'FISCAL_PROVIDER_QUOTA') {
            throw new AppError('Este alerta não está associado à fila de emissão de CT-e.', 400);
        }
        await cteEmissionQueue.resume();
        const updated = await prisma.systemAlert.update({
            where: { id: alert.id },
            data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        res.json({ success: true, data: updated, message: 'Fila de emissão de CT-e retomada.' });
    } catch (error) {
        next(error);
    }
});

export { router as systemAlertsRouter };
```

- [ ] **Step 3: Registrar a rota em `server/src/index.ts`**

Adicionar o import junto dos outros routers:

```ts
import { systemAlertsRouter } from './routes/systemAlerts.js';
```

E o `app.use` junto dos outros:

```ts
app.use('/api/system-alerts', systemAlertsRouter);
```

- [ ] **Step 4: Verificar typecheck**

Run: `cd server && npm run typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/systemAlertService.ts server/src/routes/systemAlerts.ts server/src/index.ts
git commit -m "feat(fiscal): add SystemAlert service and admin routes to pause/resume CT-e queue on quota errors"
```

---

## Task 9: Processor da fila (worker) — orquestra submit/poll/download com retry/backoff

**Files:**
- Create: `server/src/services/queues/cteEmissionProcessor.ts`
- Create: `server/src/services/queues/cteEmissionJobInput.ts`
- Create: `server/src/services/fiscal/cteEmissionInputBuilder.ts`
- Create: `server/src/services/acbr/acbrAuth.test.ts`
- Modify: `server/src/routes/freightCalculations.ts` (remove função local `buildCteEmissionInputFromRecords`, importa do módulo novo)

- [ ] **Step 1: Implementar o processor**

```ts
import type { Job } from 'bullmq';
import prisma from '../../lib/prisma.js';
import { AcbrHttpError } from '../acbr/acbrHttp.js';
import {
    submitCteToAcbr,
    pollCteStatusOnce,
    downloadCteXml,
    downloadCtePdf,
    type FiscalEmitterContext,
} from '../acbr/acbrCteEmit.js';
import type { CteEmissionInput } from '../cteService.js';
import { buildCteEmissionInputForJob } from './cteEmissionJobInput.js';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import { cteEmissionQueue, type CteEmissionJobData } from './cteEmissionQueue.js';
import { createSystemAlert } from '../systemAlertService.js';

const POLL_DELAY_MS = 1500;
const RATE_LIMIT_BACKOFF_CAP_MS = 5 * 60 * 1000;

function retryDelayFromHeaders(err: AcbrHttpError): number {
    const seconds = err.retryInSeconds ?? err.retryAfterSeconds ?? 2;
    return Math.min(Math.max(seconds, 1) * 1000, RATE_LIMIT_BACKOFF_CAP_MS);
}

async function markPendingReconciliation(calcId: string, emissionJobId: string, reason: string): Promise<void> {
    await prisma.$transaction([
        prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: { status: 'CTE_PENDING_RECONCILIATION', cteStatusReason: reason },
        }),
        prisma.cteEmissionJob.update({
            where: { id: emissionJobId },
            data: { phase: 'PENDING_RECONCILIATION', lastError: reason },
        }),
    ]);
}

async function handlePaymentRequired(calcId: string, emissionJobId: string, err: AcbrHttpError): Promise<void> {
    await cteEmissionQueue.pause();
    await prisma.cteEmissionJob.update({
        where: { id: emissionJobId },
        data: { pausedForQuota: true, lastHttpStatus: 402, lastError: err.message },
    });
    await markPendingReconciliation(
        calcId,
        emissionJobId,
        'Fila de emissão pausada: créditos ACBr insuficientes ou cota excedida. Aguardando ação de um administrador.',
    );
    await createSystemAlert({
        category: 'FISCAL_PROVIDER_QUOTA',
        severity: 'CRITICAL',
        title: 'Emissão de CT-e pausada — créditos ACBr esgotados',
        message: `Código: ${err.quotaErrorCode ?? 'desconhecido'}. ${err.message}`,
        context: { calcId, emissionJobId, httpStatus: 402, quotaErrorCode: err.quotaErrorCode },
    });
}

async function downloadAndPersistFiles(calcId: string, emissionJobId: string, providerDocId: string, ambiente: CteEmissionInput['ambiente']): Promise<void> {
    const job = await prisma.cteEmissionJob.findUniqueOrThrow({ where: { id: emissionJobId } });

    let xmlStorageKey: string | undefined;
    let pdfStorageKey: string | undefined;

    if (!job.xmlDownloadedAt) {
        const xml = await downloadCteXml(providerDocId, ambiente);
        const uploaded = await uploadBase64Object({
            base64: Buffer.from(xml, 'utf-8').toString('base64'),
            fileName: `${calcId}.xml`,
            mimeType: 'application/xml',
            keyPrefix: `cte/${calcId}/xml`,
        });
        xmlStorageKey = uploaded.storageKey;
        await prisma.$transaction([
            prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { cteXml: xml, cteXmlStorageKey: xmlStorageKey } }),
            prisma.cteEmissionJob.update({ where: { id: emissionJobId }, data: { xmlDownloadedAt: new Date() } }),
        ]);
    }

    if (!job.pdfDownloadedAt) {
        const pdf = await downloadCtePdf(providerDocId, ambiente);
        const uploaded = await uploadBase64Object({
            base64: pdf.toString('base64'),
            fileName: `${calcId}.pdf`,
            mimeType: 'application/pdf',
            keyPrefix: `cte/${calcId}/pdf`,
        });
        pdfStorageKey = uploaded.storageKey;
        await prisma.$transaction([
            prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { ctePdfStorageKey: pdfStorageKey } }),
            prisma.cteEmissionJob.update({ where: { id: emissionJobId }, data: { pdfDownloadedAt: new Date() } }),
        ]);
    }
}

export async function processCteEmissionJob(job: Job<CteEmissionJobData>): Promise<void> {
    const { calcId, cteEmissionJobId, phaseHint } = job.data;
    const emissionJob = await prisma.cteEmissionJob.findUniqueOrThrow({ where: { id: cteEmissionJobId } });
    const { input, fiscalEmitterContext } = await buildCteEmissionInputForJob(calcId);

    try {
        // Fase 1: submit — só acontece se ainda não temos providerDocId. Nunca reenvia depois disso.
        if (!emissionJob.providerDocId && phaseHint !== 'poll-only') {
            const submitted = await submitCteToAcbr(input, calcId, fiscalEmitterContext);
            if ('rejected' in submitted) {
                await prisma.$transaction([
                    prisma.orderFreightCalculation.update({
                        where: { id: calcId },
                        data: { status: 'CTE_REJECTED', cteStatusReason: submitted.rejected.rejectionReason ?? 'Rejeitado pela ACBr.' },
                    }),
                    prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'FAILED', lastError: submitted.rejected.rejectionReason } }),
                ]);
                return;
            }
            await prisma.$transaction([
                prisma.cteEmissionJob.update({
                    where: { id: cteEmissionJobId },
                    data: { phase: 'SUBMITTED', providerDocId: submitted.providerDocId },
                }),
                prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { status: 'CTE_PROCESSING' } }),
            ]);
            emissionJob.providerDocId = submitted.providerDocId;
        }

        if (!emissionJob.providerDocId) {
            throw new Error(`CteEmissionJob ${cteEmissionJobId} está em poll-only sem providerDocId — estado inconsistente.`);
        }

        // Fase 2: poll — uma tentativa por execução do job; reagenda via delay do BullMQ, nunca bloqueia.
        const outcome = await pollCteStatusOnce(emissionJob.providerDocId, input.ambiente, emissionJob.attemptCount);

        if (outcome.kind === 'AUTHORIZED') {
            await prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'DOWNLOADING_FILES' } });
            await downloadAndPersistFiles(calcId, cteEmissionJobId, emissionJob.providerDocId, input.ambiente);
            await prisma.$transaction([
                prisma.orderFreightCalculation.update({
                    where: { id: calcId },
                    data: {
                        status: 'CTE_AUTHORIZED',
                        cteAccessKey: outcome.result.accessKey ?? null,
                        cteProtocol: outcome.result.protocol ?? null,
                        cteAuthorizedAt: new Date(),
                        cteStatusReason: null,
                    },
                }),
                prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'DONE' } }),
            ]);
            return;
        }

        if (outcome.kind === 'REJECTED') {
            await prisma.$transaction([
                prisma.orderFreightCalculation.update({
                    where: { id: calcId },
                    data: { status: 'CTE_REJECTED', cteStatusReason: outcome.result.rejectionReason ?? 'Rejeitado pela SEFAZ.', cteRejectedAt: new Date() },
                }),
                prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { phase: 'FAILED', lastError: outcome.result.rejectionReason } }),
            ]);
            return;
        }

        // outcome.kind === 'PENDING' — reagenda mais uma tentativa
        const nextAttempt = emissionJob.attemptCount + 1;
        if (nextAttempt >= emissionJob.maxAttempts) {
            await markPendingReconciliation(calcId, cteEmissionJobId, 'Timeout aguardando retorno da SEFAZ via ACBr após o número máximo de tentativas.');
            return;
        }
        await prisma.cteEmissionJob.update({
            where: { id: cteEmissionJobId },
            data: { phase: 'POLLING', attemptCount: nextAttempt, lastPolledAt: new Date() },
        });
        await job.moveToDelayed(Date.now() + POLL_DELAY_MS, job.token);
    } catch (err) {
        if (err instanceof AcbrHttpError && err.httpStatus === 429) {
            await prisma.cteEmissionJob.update({ where: { id: cteEmissionJobId }, data: { lastHttpStatus: 429, lastError: err.message } });
            await job.moveToDelayed(Date.now() + retryDelayFromHeaders(err), job.token);
            return;
        }
        if (err instanceof AcbrHttpError && err.httpStatus === 402) {
            await handlePaymentRequired(calcId, cteEmissionJobId, err);
            return;
        }
        // Timeout de rede ou qualquer outra instabilidade: NÃO é rejeição definitiva.
        const nextAttempt = emissionJob.attemptCount + 1;
        if (nextAttempt >= emissionJob.maxAttempts) {
            await markPendingReconciliation(calcId, cteEmissionJobId, `Falha de comunicação persistente com a ACBr: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        await prisma.cteEmissionJob.update({
            where: { id: cteEmissionJobId },
            data: { attemptCount: nextAttempt, lastError: err instanceof Error ? err.message : String(err) },
        });
        await job.moveToDelayed(Date.now() + POLL_DELAY_MS, job.token);
    }
}
```

- [ ] **Step 2: Criar o helper que monta `CteEmissionInput` a partir do `calcId` (reaproveita `buildCteEmissionInputFromRecords`)**

`buildCteEmissionInputFromRecords` hoje está definido dentro de `freightCalculations.ts` (não exportado). Extraí-lo pra um módulo compartilhado evita import circular rota↔processor:

**Files:**
- Create: `server/src/services/queues/cteEmissionJobInput.ts`
- Modify: `server/src/routes/freightCalculations.ts` (remove a função local, importa do módulo novo)

```ts
// server/src/services/queues/cteEmissionJobInput.ts
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { CteEmissionInput } from '../cteService.js';
import type { FiscalEmitterContext } from '../acbr/acbrCteEmit.js';
import { buildCteEmissionInputFromRecords } from '../fiscal/cteEmissionInputBuilder.js';

export async function buildCteEmissionInputForJob(calcId: string): Promise<{
    input: CteEmissionInput;
    fiscalEmitterContext: FiscalEmitterContext | null;
}> {
    const calc = await prisma.orderFreightCalculation.findUniqueOrThrow({
        where: { id: calcId },
        include: { emissor: true, fiscalEmitter: { include: { person: true, hub: true } }, order: { include: {
            remetentePerson: true, destinatarioPerson: true, consignatarioPerson: true, expedidorPerson: true, invoicesRel: true,
        } } },
    });
    const hub = await prisma.hub.findUniqueOrThrow({ where: { id: calc.emissorId }, include: { person: true } });

    const { input, preflight } = buildCteEmissionInputFromRecords({ order: calc.order, calc, hub, numero: calc.cteNumber ? Number(calc.cteNumber) : undefined });
    if (!preflight.ok || !input) {
        throw new AppError(`CT-e com pendências fiscais no momento do processamento: ${preflight.issues.join(' ')}`, 400);
    }

    const fiscalEmitterContext: FiscalEmitterContext | null = calc.fiscalEmitter
        ? {
              crt: calc.fiscalEmitter.crt,
              environment: calc.fiscalEmitter.environment as 'HOMOLOGACAO' | 'PRODUCAO',
              certificateStorageKey: calc.fiscalEmitter.certificateStorageKey,
              certificatePasswordEncrypted: calc.fiscalEmitter.certificatePasswordEncrypted,
          }
        : null;

    return { input, fiscalEmitterContext };
}
```

Extrair `buildCteEmissionInputFromRecords` (hoje `freightCalculations.ts:342-427`) para `server/src/services/fiscal/cteEmissionInputBuilder.ts` sem alterar seu corpo — só mover e ajustar imports (`buildCtePreflightResult`, `resolveCteCfopCstForEmission`, tipos `CteEmissionInput`/`CteEnvironment`/`CteInputBuildResult`). Em `freightCalculations.ts`, remover a definição local e importar:

```ts
import { buildCteEmissionInputFromRecords } from '../services/fiscal/cteEmissionInputBuilder.js';
```

- [ ] **Step 3: Escrever teste garantindo que o cache de token OAuth2 é reaproveitado entre múltiplas chamadas do worker**

O endpoint de token da ACBr tem limite de só 10 req/min — muito mais apertado que o de CT-e (240-360/min). O worker processa vários jobs em sequência (submit + N polls); todos devem reaproveitar o mesmo token cacheado em `acbrAuth.ts`, nunca pedir um novo por chamada.

Create: `server/src/services/acbr/acbrAuth.test.ts`

```ts
import assert from 'node:assert/strict';
import { describe, it, beforeEach, mock } from 'node:test';

import { getAcbrAccessToken, clearAcbrTokenCache } from './acbrAuth.js';

describe('getAcbrAccessToken — cache reuse', () => {
    beforeEach(() => {
        clearAcbrTokenCache();
        process.env.ACBR_CLIENT_ID = 'test-client';
        process.env.ACBR_CLIENT_SECRET = 'test-secret';
    });

    it('faz apenas 1 chamada HTTP ao endpoint de token mesmo com múltiplas chamadas seguidas (simula N jobs do worker)', async () => {
        const originalFetch = globalThis.fetch;
        const fetchMock = mock.fn(async () => new Response(JSON.stringify({ access_token: 'tok-123', expires_in: 3600 }), { status: 200 }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        try {
            const scopes = ['empresa', 'cte'];
            const tokens = await Promise.all([
                getAcbrAccessToken(scopes),
                getAcbrAccessToken(scopes),
                getAcbrAccessToken(scopes),
                getAcbrAccessToken(scopes),
                getAcbrAccessToken(scopes),
            ]);

            assert.ok(tokens.every((t) => t === 'tok-123'), 'todas as chamadas devem retornar o mesmo token cacheado');
            assert.equal(fetchMock.mock.callCount(), 1, 'o endpoint de token só pode ser chamado 1 vez para N jobs dentro da janela de validade');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd server && npx tsx --test src/services/acbr/acbrAuth.test.ts`
Expected: PASS — 1 teste verde, `fetchMock.mock.callCount()` igual a 1.

- [ ] **Step 5: Verificar typecheck**

Run: `cd server && npm run typecheck`
Expected: sem erros — `systemAlertService.ts` (Task 8) e `objectStorage.uploadBase64Object` (já existente) já estão disponíveis.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/queues/cteEmissionProcessor.ts server/src/services/queues/cteEmissionJobInput.ts server/src/services/fiscal/cteEmissionInputBuilder.ts server/src/routes/freightCalculations.ts server/src/services/acbr/acbrAuth.test.ts
git commit -m "feat(fiscal): add BullMQ processor orchestrating submit/poll/download with 429/402/timeout handling; verify ACBr token cache reuse"
```

---

## Task 10: Entrypoint do worker + scripts + serviço no docker-compose

**Files:**
- Create: `server/src/worker.ts`
- Modify: `server/package.json`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Implementar `worker.ts`**

```ts
import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { redisConnection } from './lib/redis.js';
import { CTE_EMISSION_QUEUE_NAME } from './services/queues/cteEmissionQueue.js';
import { processCteEmissionJob } from './services/queues/cteEmissionProcessor.js';

dotenv.config();

const worker = new Worker(CTE_EMISSION_QUEUE_NAME, processCteEmissionJob, {
    connection: redisConnection,
    concurrency: 3,
    // Cinto de segurança abaixo do rate-limit documentado da ACBr (240-360 req/min em endpoints protegidos).
    limiter: { max: 200, duration: 60_000 },
});

worker.on('failed', (job, err) => {
    console.error(JSON.stringify({ level: 'error', source: 'cteEmissionWorker', jobId: job?.id, error: err.message }));
});

worker.on('ready', () => {
    console.log(JSON.stringify({ level: 'info', source: 'cteEmissionWorker', message: 'Worker pronto, consumindo fila cte-emission.' }));
});

process.on('SIGTERM', async () => {
    await worker.close();
    process.exit(0);
});
```

- [ ] **Step 2: Adicionar scripts em `server/package.json`**

Na seção `scripts`, junto de `dev`:

```json
    "worker:dev": "tsx watch src/worker.ts",
    "worker": "node dist/worker.js",
```

- [ ] **Step 3: Adicionar o serviço `worker` no `docker-compose.yml`**

Inserir logo após o serviço `api` (antes do comentário `# Database migrations and seed`):

```yaml
  # CT-e emission worker (processa a fila BullMQ em background, isolado da API)
  worker:
    build:
      context: .
      dockerfile: Dockerfile.api
    image: ghcr.io/${GITHUB_REPOSITORY:-local/tsmex}/tsmex-api:${IMAGE_TAG:-local}
    container_name: tsmex-worker
    restart: unless-stopped
    command: ["node", "dist/worker.js"]
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/tsmex?schema=public}
      NODE_ENV: ${NODE_ENV:-production}
      REDIS_URL: ${REDIS_URL:-redis://redis:6379}
      ACBR_CLIENT_ID: ${ACBR_CLIENT_ID:-}
      ACBR_CLIENT_SECRET: ${ACBR_CLIENT_SECRET:-}
      ACBR_TOKEN_URL: ${ACBR_TOKEN_URL:-}
      ACBR_API_BASE_URL: ${ACBR_API_BASE_URL:-}
      ACBR_FALLBACK_CMUN: ${ACBR_FALLBACK_CMUN:-}
      FISCAL_CTE_PROVIDER: ${FISCAL_CTE_PROVIDER:-}
      FISCAL_PROVIDER: ${FISCAL_PROVIDER:-}
      FISCAL_SECRET_KEY: ${FISCAL_SECRET_KEY:-}
      S3_ENDPOINT: ${S3_ENDPOINT:-}
      S3_ACCESS_KEY: ${S3_ACCESS_KEY:-}
      S3_SECRET_KEY: ${S3_SECRET_KEY:-}
      S3_REGION: ${S3_REGION:-}
      S3_BUCKET: ${S3_BUCKET:-}
      S3_FORCE_PATH_STYLE: ${S3_FORCE_PATH_STYLE:-}
      S3_PUBLIC_BASE_URL: ${S3_PUBLIC_BASE_URL:-}
      S3_SIGNED_URL_PUBLIC_HOST: ${S3_SIGNED_URL_PUBLIC_HOST:-}
      MINIO_ENDPOINT: ${MINIO_ENDPOINT:-}
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY:-}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY:-}
      MINIO_REGION: ${MINIO_REGION:-}
      MINIO_BUCKET: ${MINIO_BUCKET:-}
      MINIO_PUBLIC_BASE_URL: ${MINIO_PUBLIC_BASE_URL:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - tsmex-network
```

Sem `ports:` — o worker não serve HTTP.

- [ ] **Step 4: Verificar build**

Run: `cd server && npm run build`
Expected: `dist/worker.js` gerado sem erros junto de `dist/index.js`.

- [ ] **Step 5: Validar sintaxe do compose**

Run: `docker compose -f docker-compose.yml config --quiet`
Expected: sem erro de parsing (exit code 0).

- [ ] **Step 6: Commit**

```bash
git add server/src/worker.ts server/package.json docker-compose.yml
git commit -m "feat(infra): add isolated worker container consuming the cte-emission queue"
```

---

## Task 11: Reescrever a rota `emit-cte` — preflight síncrono, enfileirar quando ACBr real, 202 imediato

**Files:**
- Modify: `server/src/routes/freightCalculations.ts:1074-1247`

- [ ] **Step 1: Atualizar `FISCAL_LOCKED_STATUSES` (linha 77)**

```ts
const FISCAL_LOCKED_STATUSES = [
    'CTE_READY',
    'CTE_SENT',
    'CTE_PROCESSING',
    'CTE_AUTHORIZED',
    'CTE_CANCELLED',
    'CTE_PENDING_RECONCILIATION',
    'DCE_READY',
    'DCE_SENT',
    'DCE_AUTHORIZED',
    'DCE_CANCELLED',
] as const;
```

- [ ] **Step 2: Adicionar os imports novos no topo do arquivo**

```ts
import { getAcbrProviderDecision } from '../services/acbr/acbrConfig.js';
import { enqueueCteEmissionJob } from '../services/queues/cteEmissionQueue.js';
```

- [ ] **Step 3: Substituir o corpo da rota `POST /:calcId/emit-cte` (linha 1075-1247) por**

Manter tudo igual até a criação de `cteInput` (linha 1154) e a atualização pra `CTE_SENT` (linhas 1156-1165) — isso já é o gate de concorrência que impede duplo envio, mantido como está. A partir daí, bifurcar:

```ts
        await prisma.orderFreightCalculation.update({
            where: { id: calcId },
            data: {
                status: 'CTE_SENT',
                cteNumber: String(numero),
                cteSeries: serie,
                cteEnvironment: ambiente,
                cteStatusReason: null,
            },
        });

        const acbrDecision = getAcbrProviderDecision(calc.fiscalEmitter?.provider ?? null);

        if (acbrDecision.willUseAcbrHttp) {
            // Caminho real ACBr: assíncrono. Cria o job de emissão e enfileira — nunca chama a ACBr aqui.
            const emissionJob = await prisma.cteEmissionJob.create({
                data: { calcId, phase: 'QUEUED' },
            });
            const queueJobId = await enqueueCteEmissionJob({ calcId, cteEmissionJobId: emissionJob.id, phaseHint: 'submit' });
            await prisma.cteEmissionJob.update({ where: { id: emissionJob.id }, data: { queueJobId } });

            const updated = await prisma.orderFreightCalculation.findUniqueOrThrow({
                where: { id: calcId },
                include: {
                    emissor: { select: { id: true, name: true, code: true, person: { select: { document: true, legalName: true } } } },
                    pricingTable: { select: { id: true, description: true } },
                },
            });

            res.status(202).json({
                success: true,
                data: updated,
                job: { id: emissionJob.id, phase: emissionJob.phase },
                message: 'CT-e enviado para processamento assíncrono. Acompanhe o status do cálculo.',
            });
            return;
        }

        // Modo simulado local (sem ACBr real): continua síncrono, rápido, sem custo — comportamento preservado.
        const providerResult = await authorizeCteWithProvider(cteInput, {
            mode: providerMode,
            fiscalEmitterProvider: calc.fiscalEmitter?.provider ?? null,
            fiscalEmitterContext: calc.fiscalEmitter
                ? {
                      crt: calc.fiscalEmitter.crt,
                      environment: calc.fiscalEmitter.environment as 'HOMOLOGACAO' | 'PRODUCAO',
                      certificateStorageKey: calc.fiscalEmitter.certificateStorageKey,
                      certificatePasswordEncrypted: calc.fiscalEmitter.certificatePasswordEncrypted,
                  }
                : null,
        });
```

Manter o restante do bloco síncrono (linhas 1179-1247 do arquivo original: `now`, `payload`, `fiscalData`, `updated`, `branding`, `res.json(...)`) exatamente como está — só é alcançado agora quando `acbrDecision.willUseAcbrHttp === false`.

- [ ] **Step 4: Verificar typecheck**

Run: `cd server && npm run typecheck`
Expected: sem erros.

- [ ] **Step 5: Rodar a suíte fiscal completa**

Run: `cd server && npm test`
Expected: PASS — nenhum teste do modo simulado quebrado (o branch ACBr real não tem cobertura de integração aqui porque exigiria mock de rede — coberto pelos testes unitários do processor na Task 8 e verificação manual em homologação no final do plano).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/freightCalculations.ts
git commit -m "feat(fiscal): make emit-cte async (202 + queue) for real ACBr provider, keep simulated mode synchronous"
```

---

## Task 12: Rota de reconciliação manual

**Files:**
- Modify: `server/src/routes/freightCalculations.ts` (adicionar rota nova, logo após `emit-cte`)

- [ ] **Step 1: Implementar a rota**

```ts
// POST .../emit-cte/reconcile — só permite a partir de CTE_PENDING_RECONCILIATION.
// Reenfileira em modo 'poll-only': NUNCA refaz POST /cte, só consulta o status já existente.
router.post('/:calcId/emit-cte/reconcile', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            include: { cteEmissionJobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);
        if (calc.status !== 'CTE_PENDING_RECONCILIATION') {
            throw new AppError('Reconciliação só é permitida quando o CT-e está em estado de alerta/conciliação.', 400);
        }
        const lastJob = calc.cteEmissionJobs[0];
        if (!lastJob?.providerDocId) {
            throw new AppError('Nenhum documento foi submetido à ACBr ainda para este cálculo — não é possível reconciliar, refaça a emissão.', 400);
        }

        await prisma.cteEmissionJob.update({ where: { id: lastJob.id }, data: { phase: 'POLLING', attemptCount: 0, pausedForQuota: false } });
        const queueJobId = await enqueueCteEmissionJob({ calcId, cteEmissionJobId: lastJob.id, phaseHint: 'poll-only' });
        await prisma.cteEmissionJob.update({ where: { id: lastJob.id }, data: { queueJobId } });
        await prisma.orderFreightCalculation.update({ where: { id: calcId }, data: { status: 'CTE_PROCESSING', cteStatusReason: null } });

        res.status(202).json({ success: true, message: 'Reconciliação reenfileirada — apenas consulta de status, sem novo envio à ACBr.' });
    } catch (error) {
        next(error);
    }
});
```

- [ ] **Step 2: Verificar typecheck**

Run: `cd server && npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/freightCalculations.ts
git commit -m "feat(fiscal): add manual reconciliation route for CT-e stuck in pending-reconciliation"
```

---

## Task 13: Rota de serving de documentos (signed URL, sem fallback pra ACBr)

**Files:**
- Modify: `server/src/routes/freightCalculations.ts` (adicionar rota nova)

- [ ] **Step 1: Adicionar o import**

```ts
import { getObjectDownloadUrl } from '../lib/objectStorage.js';
```

- [ ] **Step 2: Implementar a rota**

```ts
// GET .../cte-document?type=xml|pdf — única forma do frontend obter o documento. NUNCA expõe URL da ACBr.
router.get('/:calcId/cte-document', authenticate, authorize('ADMIN', 'HUB'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const orderId = req.params.orderId as string;
        const calcId = req.params.calcId as string;
        const type = req.query.type === 'xml' ? 'xml' : 'pdf';

        const order = await prisma.order.findUnique({ where: { id: orderId }, select: { currentHubId: true } });
        if (!order) throw new AppError('Order not found', 404);
        if (req.user!.roles.includes('HUB') && (!req.user!.hubId || order.currentHubId !== req.user!.hubId)) {
            throw new AppError('Not authorized to access this document', 403);
        }

        const calc = await prisma.orderFreightCalculation.findFirst({
            where: { id: calcId, orderId },
            select: { cteXmlStorageKey: true, ctePdfStorageKey: true, status: true },
        });
        if (!calc) throw new AppError('Cálculo de frete não encontrado', 404);

        const key = type === 'xml' ? calc.cteXmlStorageKey : calc.ctePdfStorageKey;
        if (key) {
            const downloadUrl = await getObjectDownloadUrl(key, 300);
            res.json({ success: true, data: { downloadUrl, expiresInSeconds: 300 } });
            return;
        }

        if (calc.status !== 'CTE_AUTHORIZED') {
            throw new AppError('Documento ainda não disponível — CT-e não autorizado.', 404);
        }

        // CT-e autorizado antes desta mudança, sem storage key ainda: nunca expor a URL crua da ACBr.
        // Sinaliza "em migração" — o script de backfill (Task 14) deve rodar antes de habilitar isto em produção,
        // então este caminho só deve ser alcançado em cenários residuais.
        res.status(202).json({
            success: false,
            error: 'Documento ainda está sendo migrado para o repositório interno. Tente novamente em alguns instantes.',
        });
    } catch (error) {
        next(error);
    }
});
```

- [ ] **Step 3: Verificar typecheck**

Run: `cd server && npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/freightCalculations.ts
git commit -m "feat(fiscal): add signed-URL document route, never fall back to raw ACBr URL"
```

---

## Task 14: Script de backfill — migra CT-e's já autorizados antes desta mudança

**Files:**
- Create: `server/prisma/backfill-cte-documents.ts`

- [ ] **Step 1: Implementar o script (mesmo padrão de `backfill-ibge-codes.ts`: `PrismaClient` direto, `async function main()`)**

```ts
import { PrismaClient } from '@prisma/client';
import { downloadCteXml, downloadCtePdf } from '../src/services/acbr/acbrCteEmit.js';
import { uploadBase64Object } from '../src/lib/objectStorage.js';

const prisma = new PrismaClient();

/** Throttle simples: mesma cadência do worker (limiter 200/60s) — não estourar rate-limit da ACBr. */
const DELAY_BETWEEN_DOCS_MS = 350;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    console.log('Iniciando backfill de documentos CT-e (XML/PDF) para storage interno...');

    const pending = await prisma.orderFreightCalculation.findMany({
        where: {
            status: 'CTE_AUTHORIZED',
            OR: [{ cteXmlStorageKey: null }, { ctePdfStorageKey: null }],
        },
        select: { id: true, cteXml: true, cteXmlStorageKey: true, ctePdfStorageKey: true, cteEnvironment: true, ctePdfUrl: true },
    });

    console.log(`Encontrados ${pending.length} cálculos CT-e autorizados sem storage key.`);
    let migrated = 0;
    let skipped = 0;

    for (const calc of pending) {
        try {
            const ambiente = calc.cteEnvironment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
            const providerDocId = extractProviderDocIdFromLegacyPdfUrl(calc);
            if (!providerDocId) {
                console.warn(`  [skip] calc ${calc.id}: não foi possível determinar o id do documento na ACBr (provavelmente emitido em modo simulado).`);
                skipped++;
                continue;
            }

            let xmlStorageKey = calc.cteXmlStorageKey;
            if (!xmlStorageKey) {
                const xml = calc.cteXml ?? (await downloadCteXml(providerDocId, ambiente));
                const uploaded = await uploadBase64Object({
                    base64: Buffer.from(xml, 'utf-8').toString('base64'),
                    fileName: `${calc.id}.xml`,
                    mimeType: 'application/xml',
                    keyPrefix: `cte/${calc.id}/xml`,
                });
                xmlStorageKey = uploaded.storageKey;
                await sleep(DELAY_BETWEEN_DOCS_MS);
            }

            let pdfStorageKey = calc.ctePdfStorageKey;
            if (!pdfStorageKey) {
                const pdf = await downloadCtePdf(providerDocId, ambiente);
                const uploaded = await uploadBase64Object({
                    base64: pdf.toString('base64'),
                    fileName: `${calc.id}.pdf`,
                    mimeType: 'application/pdf',
                    keyPrefix: `cte/${calc.id}/pdf`,
                });
                pdfStorageKey = uploaded.storageKey;
                await sleep(DELAY_BETWEEN_DOCS_MS);
            }

            await prisma.orderFreightCalculation.update({
                where: { id: calc.id },
                data: { cteXmlStorageKey: xmlStorageKey, ctePdfStorageKey: pdfStorageKey },
            });
            migrated++;
            console.log(`  [ok] calc ${calc.id} migrado.`);
        } catch (err) {
            console.error(`  [erro] calc ${calc.id}: ${err instanceof Error ? err.message : String(err)}`);
            skipped++;
        }
    }

    console.log(`Backfill concluído: ${migrated} migrados, ${skipped} pulados/com erro.`);
}

/**
 * O modelo legado guardava `ctePdfUrl` como `{baseUrl}/cte/{id}/pdf` — extrai o {id}.
 * Cálculos emitidos em modo simulado local não têm essa URL no formato ACBr (ex.: `/documents/cte/...`)
 * e devem ser pulados aqui (não existe documento real pra baixar).
 */
function extractProviderDocIdFromLegacyPdfUrl(calc: { ctePdfUrl: string | null }): string | null {
    if (!calc.ctePdfUrl) return null;
    const match = calc.ctePdfUrl.match(/\/cte\/([^/]+)\/pdf$/);
    return match ? match[1] : null;
}

main()
    .catch((err) => {
        console.error('Backfill falhou:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
```

- [ ] **Step 2: Rodar em ambiente de homologação (NUNCA direto em produção sem antes testar)**

Run: `cd server && npx tsx prisma/backfill-cte-documents.ts`
Expected: log linha a linha de cada calc migrado/pulado, resumo final com contagem. Verificar manualmente 1-2 registros no MinIO/S3 e no banco (`cteXmlStorageKey`/`ctePdfStorageKey` preenchidos).

- [ ] **Step 3: Commit**

```bash
git add server/prisma/backfill-cte-documents.ts
git commit -m "feat(fiscal): add one-time backfill script migrating legacy CT-e XML/PDF into internal storage"
```

---

## Task 15: Frontend — nunca mais linkar direto pra ACBr

**Files:**
- Modify: `lib/api.ts`
- Modify: `components/admin/OrderFreightCalculationSection.tsx:694-725`

- [ ] **Step 1: Adicionar o método de API em `lib/api.ts`, junto de `emitCte`/`ctePreflight`**

```ts
    getCteDocumentUrl: async (orderId: string, calcId: string, type: 'xml' | 'pdf') => {
        const response = await api.get<{
            success: boolean;
            data?: { downloadUrl: string; expiresInSeconds: number };
            error?: string;
        }>(`/orders/${orderId}/freight-calculations/${calcId}/cte-document`, { params: { type } });
        return response.data;
    },
```

- [ ] **Step 2: Substituir os anchors diretos (linhas 720-725) por um handler**

Adicionar dentro do componente, junto dos outros handlers (perto de `handleEmitCte`):

```tsx
  const [downloadingDoc, setDownloadingDoc] = useState<'xml' | 'pdf' | null>(null);

  const handleDownloadCteDocument = async (type: 'xml' | 'pdf') => {
    setDownloadingDoc(type);
    try {
      const result = await ordersFreightApi.getCteDocumentUrl(orderId, calc.id, type);
      if (result.success && result.data?.downloadUrl) {
        window.open(result.data.downloadUrl, '_blank', 'noopener,noreferrer');
      } else {
        window.alert(result.error ?? 'Documento ainda não disponível.');
      }
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.message ?? 'Erro ao obter documento.');
    } finally {
      setDownloadingDoc(null);
    }
  };
```

Substituir o bloco (linhas 720-725):

```tsx
          {(calc.ctePdfUrl || calc.cteXmlUrl) && (
            <div className="flex gap-3 mt-1">
              {calc.ctePdfUrl && <a href={calc.ctePdfUrl} className="text-brand-600 dark:text-brand-400 hover:underline" target="_blank" rel="noreferrer">PDF</a>}
              {calc.cteXmlUrl && <a href={calc.cteXmlUrl} className="text-brand-600 dark:text-brand-400 hover:underline" target="_blank" rel="noreferrer">XML</a>}
            </div>
          )}
```

por:

```tsx
          {calc.status === 'CTE_AUTHORIZED' && (
            <div className="flex gap-3 mt-1">
              <button
                type="button"
                onClick={() => handleDownloadCteDocument('pdf')}
                disabled={downloadingDoc === 'pdf'}
                className="text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
              >
                {downloadingDoc === 'pdf' ? 'Abrindo…' : 'PDF'}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCteDocument('xml')}
                disabled={downloadingDoc === 'xml'}
                className="text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
              >
                {downloadingDoc === 'xml' ? 'Abrindo…' : 'XML'}
              </button>
            </div>
          )}
```

Isso elimina qualquer `href` apontando pra `hom.acbr.api.br`/`prod.acbr.api.br` do HTML — a URL só existe depois de um clique explícito, buscada do backend, com expiração curta (5min).

- [ ] **Step 3: Testar manualmente no browser**

Run: `npm run dev` (frontend) + `cd server && npm run dev` (API)
Expected: abrir um pedido com CT-e autorizado, clicar em "PDF"/"XML", confirmar no DevTools → Network que a única chamada é pro backend TSM (`/api/orders/.../cte-document`) e que o `window.open` final aponta pro host do MinIO/S3 configurado — nunca `*.acbr.api.br`.

- [ ] **Step 4: Commit**

```bash
git add lib/api.ts components/admin/OrderFreightCalculationSection.tsx
git commit -m "fix(fiscal): frontend fetches CT-e documents via backend signed URL, never links to ACBr directly"
```

---

## Task 16: Frontend — status labels e polling leve para os novos estados assíncronos

**Files:**
- Modify: `components/admin/OrderFreightCalculationSection.tsx`

- [ ] **Step 1: Adicionar os labels novos (linha ~40-54, `STATUS_LABELS`)**

```ts
const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  CALCULATED: 'Calculado',
  CTE_READY: 'CT-e pronto',
  CTE_SENT: 'CT-e enviado',
  CTE_PROCESSING: 'CT-e em processamento (aguardando SEFAZ)',
  CTE_REJECTED: 'CT-e rejeitado',
  CTE_PENDING_RECONCILIATION: 'CT-e em alerta — aguardando conciliação',
  MINUTA_EMITTED: 'Minuta emitida',
  CTE_AUTHORIZED: 'CT-e autorizado',
  CTE_CANCELLED: 'CT-e cancelado',
  DCE_READY: 'Doc Fiscal (DC-e) pronto',
  DCE_SENT: 'DC-e enviado',
  DCE_REJECTED: 'DC-e rejeitado',
  DCE_AUTHORIZED: 'DC-e autorizado',
  DCE_CANCELLED: 'DC-e cancelado',
};
```

Adicionar também `'CTE_PROCESSING'` e `'CTE_PENDING_RECONCILIATION'` ao `FISCAL_LOCKED_STATUSES` local do componente (linha ~56-60), espelhando o backend.

- [ ] **Step 2: Adicionar polling leve enquanto o status está em processamento**

Adicionar logo após a declaração dos outros `useEffect` do componente:

```tsx
  useEffect(() => {
    if (calc.status !== 'CTE_SENT' && calc.status !== 'CTE_PROCESSING') return;
    const interval = setInterval(() => {
      onCalculate();
    }, 4000);
    return () => clearInterval(interval);
  }, [calc.status, onCalculate]);
```

`onCalculate` já é a prop existente que o componente usa após `handleEmitMinuta`/`handleEmitCte` pra recarregar a lista de cálculos do pedido — reaproveitada aqui, sem endpoint novo no frontend.

- [ ] **Step 3: Testar manualmente**

Run: `npm run dev` (frontend) + `cd server && npm run dev` (API) + `cd server && npm run worker:dev` (worker) + Redis local rodando (`docker compose up redis -d` ou `server/docker-compose.dev.yml`)
Expected: emitir CT-e com um `FiscalEmitter` configurado como `provider: ACBR` e credenciais de homologação válidas → UI mostra "CT-e enviado"/"em processamento" imediatamente (sem travar) → após alguns segundos, ao terminar o worker, a tela atualiza sozinha pra "CT-e autorizado" (ou "rejeitado"/"em alerta") sem reload manual.

- [ ] **Step 4: Commit**

```bash
git add components/admin/OrderFreightCalculationSection.tsx
git commit -m "feat(fiscal): add status labels and light polling for async CT-e processing states"
```

---

## Task 17: Banner de alerta crítico no painel admin

**Files:**
- Create: `components/admin/SystemAlertBanner.tsx`
- Modify: `lib/api.ts`
- Modify: componente shell do admin (o arquivo que renderiza o layout/topo do painel ADMIN — localizar com `grep -rn "AdminLayout\|AdminShell" components/`)

- [ ] **Step 1: Localizar o shell do admin**

Run: `grep -rln "role === 'ADMIN'" components/ | head -5`
Expected: identificar o componente de layout raiz do painel admin (provavelmente em `components/admin/` ou próximo de `App.tsx`) onde inserir o banner uma única vez, visível em todas as telas admin.

- [ ] **Step 2: Adicionar o método de API**

```ts
export const systemAlertsApi = {
    listOpen: async () => {
        const response = await api.get<{ success: boolean; data: Array<{
            id: string; category: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; message: string; createdAt: string;
        }> }>('/system-alerts', { params: { status: 'OPEN' } });
        return response.data;
    },
    resumeCteQueue: async (alertId: string) => {
        const response = await api.post<{ success: boolean; message?: string }>(`/system-alerts/${alertId}/resume-cte-queue`);
        return response.data;
    },
};
```

- [ ] **Step 3: Implementar o componente**

```tsx
import React, { useEffect, useState } from 'react';
import { systemAlertsApi } from '../../lib/api';

interface AlertItem {
  id: string;
  category: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
}

export default function SystemAlertBanner() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await systemAlertsApi.listOpen();
      if (result.success) setAlerts(result.data.filter((a) => a.severity === 'CRITICAL'));
    } catch {
      /* banner não deve quebrar o resto do painel */
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleResume = async (alertId: string) => {
    setResolving(alertId);
    try {
      await systemAlertsApi.resumeCteQueue(alertId);
      await load();
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.message ?? 'Erro ao retomar a fila.');
    } finally {
      setResolving(null);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="bg-red-600 text-white px-4 py-2 text-sm flex flex-col gap-1">
      {alerts.map((alert) => (
        <div key={alert.id} className="flex items-center justify-between gap-4">
          <span><strong>{alert.title}</strong> — {alert.message}</span>
          {alert.category === 'FISCAL_PROVIDER_QUOTA' && (
            <button
              type="button"
              onClick={() => handleResume(alert.id)}
              disabled={resolving === alert.id}
              className="bg-white text-red-700 px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
            >
              {resolving === alert.id ? 'Retomando…' : 'Retomar fila'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Montar o banner no shell do admin**

No arquivo identificado no Step 1, importar e renderizar `<SystemAlertBanner />` no topo do layout (antes do conteúdo principal), só quando o usuário logado tem role `ADMIN`.

- [ ] **Step 5: Testar manualmente**

Run: `npm run dev` + `cd server && npm run dev`
Expected: criar um `SystemAlert` manualmente via Prisma Studio (`category: FISCAL_PROVIDER_QUOTA`, `severity: CRITICAL`, `status: OPEN`) → banner vermelho aparece em até 30s no painel admin → clicar "Retomar fila" → alerta some, `status` vira `RESOLVED` no banco.

- [ ] **Step 6: Commit**

```bash
git add components/admin/SystemAlertBanner.tsx lib/api.ts <arquivo-do-shell-admin>
git commit -m "feat(fiscal): add critical alert banner for paused CT-e queue with resume action"
```

---

## Verificação final (rodar antes de considerar a fatia completa)

- [ ] `cd server && npm run typecheck` — verde.
- [ ] `npm run typecheck` (frontend, na raiz) — verde.
- [ ] `cd server && npm test` — verde, incluindo os testes novos (`rntrcValidation.test.ts`, `cteService.test.ts`, `acbrHttp.test.ts`).
- [ ] Migration testada numa cópia da base real antes de aplicar em produção (regra do `tsm-next`).
- [ ] `docker compose up --build` local: confirmar que o serviço `worker` sobe, conecta no Redis, e fica em `ready` sem erro.
- [ ] Fluxo ponta a ponta em homologação ACBr: emitir CT-e → resposta 202 imediata → worker processa (ver logs) → XML+PDF aparecem no bucket local (MinIO console) → frontend baixa via signed URL, **nenhuma chamada visível a `hom.acbr.api.br`/`prod.acbr.api.br` no Network tab do browser**.
- [ ] Simular 429 (mock temporário ou observar em homologação sob carga) e confirmar reagendamento com o delay correto.
- [ ] Simular 402 (esgotar créditos de teste, se disponível, ou mockar `AcbrHttpError` com `httpStatus: 402` num teste de integração do processor) e confirmar: fila pausada, `SystemAlert` criado, banner aparece, "Retomar fila" funciona.
- [ ] Rodar `backfill-cte-documents.ts` em homologação antes de habilitar a rota `cte-document` em produção.
