# Evidência — Smoke PR002 (Entrada universal / intake)

**Data (ambiente do agente):** 2026-05-15  

## Preparação (`smoke-prep`)

1. **Migrations**

   ```bash
   cd server
   npx prisma migrate deploy
   npx prisma generate
   ```

   Use `DATABASE_URL` apontando para o Postgres (ex.: Docker Compose: host `localhost`, porta **5440**, DB `tsmex`).

2. **Seed (inclui operador HUB + pessoas para `/orders/entrada`)**

   ```bash
   cd server
   npx prisma db seed
   ```

   Credenciais úteis para o smoke:

   | Papel  | Email                 | Senha     |
   |--------|------------------------|-----------|
   | ADMIN  | admin@tsmex.com        | admin123  |
   | CLIENT | cliente@exemplo.com    | cliente123|
   | HUB    | hub.spgru@tsmex.com    | hub123    |

   O seed passa a criar:

   - Usuário **HUB** vinculado ao hub **SP-GRU** (`hubId`).
   - **Pessoas** com documentos normalizados `12345678000190` (remetente com `Client`) e `98765432000199` (destinatário), para o passo legado `POST /api/orders/entrada`.

3. **API**

   ```bash
   cd server
   # Alinhar PORT ao BASE_URL do script (ex.: 3002)
   $env:PORT=3002   # PowerShell
   npm run dev
   ```

## Execução dos 12 critérios (`smoke-api`)

Script automatizado (mesmos passos do plano PR002):

```bash
cd server
# opcional: SMOKE_FETCH_TIMEOUT_MS=15000
npm run smoke:pr002-intake
# ou: BASE_URL=http://localhost:3002/api node scripts/smoke-pr002-intake.mjs
```

O script valida, nesta ordem:

| #   | Critério |
|-----|----------|
| 1–3 | POST intake manual, `AWAITING_ARRIVAL`, GET sem `order` |
| 4   | `DECLARATION` + status |
| 5–6 | `POST /intake/demands/from-nfe-key`, `missingFields`, idempotência pela mesma chave |
| 7–8 | Listagem HUB (só o próprio `expectedHubId`) vs ADMIN (todas + filtro `?expectedHubId=`) |
| 9–10| PATCH `AT_HUB`: HUB → 403 “order status…”; ADMIN → 403 com `confirm-arrival` |
| 11  | `POST /api/orders/entrada` → `Order` com `demandId` |
| 12  | `GET /api/demands/pending` sem `AWAITING_ARRIVAL` |

Chave NF-e de teste no script: 44 dígitos com modelo **55** nas posições corretas (`CHAVE_NFE_SMOKE` ou env homônima).

## Resultado neste ambiente

- **Docker Desktop** ao subir `postgres:16-alpine` retornou erro **500** no engine (`docker compose up -d postgres`), portanto **migrate/seed/API não foram reproduzidos aqui com banco vivo**.
- **Execução do script** sem API em `localhost:3002` falhou no passo **health** com timeout (`This operation was aborted`), como esperado.

Saída típica sem servidor:

```text
❌ SMOKE FALHOU: API não respondeu em /health (...). Suba o server (PORT alinhado ao BASE_URL).
```

Com Docker/Postgres e API ativos, o mesmo comando deve imprimir `✅ Smoke PR002 intake concluído com sucesso` ao final.

## Artefatos

- `server/scripts/smoke-pr002-intake.mjs` — roteiro reproduzível.
- `server/package.json` — script `smoke:pr002-intake`.
- `server/prisma/seed.ts` — usuário HUB + pessoas para entrada manual.
