# Manifesto: consolidação por bipagem + tela de detalhe mobile + paridade Hub

**Data:** 2026-07-25
**Fase no NORTE:** Contínuo (refatoração de UI orientada a experiência) — ver `TSM_NORTE.md` §5/§6.
**Anti-escopo confirmado:** não toca modelo de negócio, não cria endpoint de lote, não migra schema, não quebra HashRouter, não é refactor arquitetural por si — é consequência direta da funcionalidade pedida.

## Contexto

O fluxo de criação de manifesto no Admin (`components/admin/ManifestsTab.tsx`, 1447 linhas) e no Hub (`components/operacao/HubHome.tsx`) hoje obriga o operador a adicionar pedidos **um por um via `<select>` dropdown**, sem busca por identificador. Isso é inviável em operação de hub com volume (dezenas de pedidos por viagem). Além disso:

- O card de manifesto expõe **até 8 botões de ação lado a lado sem `flex-wrap`**, quebrando o layout mobile.
- O Hub já tem RBAC liberado no backend para quase todas as ações de manifesto (`server/src/routes/manifests.ts`), mas o frontend do Hub (`HubHome.tsx`) só expõe criação simplificada + "marcar recebido" — faltam telas para as demais ações.
- Já existe um componente de câmera pronto (`components/ui/QRCodeScanner.tsx`, lê `CODE_128`/`CODE_39`/QR) mas não está plugado no fluxo de manifesto.

Objetivo: permitir que o operador **bipe a NF-e/CT-e/Minuta (ou digite o número do pedido)** e o sistema já reconheça e adicione o pedido ao manifesto, e organizar as ações do manifesto numa tela de detalhe que funcione bem no mobile — com paridade total de função entre Admin e Hub.

## Decisões confirmadas com o usuário

1. Bipagem suporta **as 3 formas**: câmera do celular, leitor físico USB/Bluetooth (emula teclado + Enter), digitação manual.
2. Busca aceita **chave de CT-e, NF-e, número do pedido ou minuta** — cascata por força de unicidade (ver abaixo), nunca adivinha em caso de ambiguidade.
3. Hub recebe **todas** as ações que o backend já autoriza, incluindo emissão manual de CIOT/MDF-e.
4. Ações do manifesto migram para uma **tela de detalhe dedicada** (drill-down), não um menu "⋮" no card.

## Modelo de dados — nenhuma migração necessária

Todos os identificadores já existem:

| Identificador | Campo | Unicidade |
|---|---|---|
| Chave NF-e (44 díg.) | `OrderInvoice.nfKey` | Global |
| Chave de acesso CT-e (44 díg.) | `OrderFreightCalculation.cteAccessKey` | Global |
| Chave de acesso DC-e (44 díg.) | `OrderFreightCalculation.dceAccessKey` | Global |
| Número da NF | `OrderInvoice.nfNumber` (também espelhado em `Order.nfNumber`) | **Não** global — pode colidir entre clientes/CNPJs diferentes |
| Número do CT-e | `OrderFreightCalculation.cteNumber` | Não global |
| Número da Minuta | `OrderFreightCalculation.minutaNumber` | Não global |
| Número do pedido | `Order.id` (UUID) — não existe campo dedicado hoje | Global (é PK) |

**Regra de negócio importante:** como NF/CT-e/Minuta "número" não são globalmente únicos (a unicidade real da NF-e é CNPJ emitente + série + número, ou a chave de 44 dígitos), a busca por número **nunca pode devolver o primeiro que achar silenciosamente** — se resolver mais de um pedido candidato, o sistema mostra a lista pro operador escolher.

## Backend

### Novo endpoint: `GET /api/orders/resolve?code=<string>&manifestId=<uuid>`

Local: `server/src/routes/orders.ts` (novo handler) + nova função de serviço (ex: `server/src/services/orderResolve.ts`).

RBAC: `authenticate` + `authorize(['ADMIN', 'HUB'])`. Se o usuário for HUB, o hub do manifesto (`manifest.hubId`) tem que bater com `req.user.hubId` — mesma checagem já usada em `manifests.ts:393`.

**Lógica em cascata** (para no primeiro nível que resolver):

1. Se `code` tem 44 dígitos numéricos → tenta, nessa ordem: `OrderInvoice.nfKey` exato → `OrderFreightCalculation.cteAccessKey` exato → `OrderFreightCalculation.dceAccessKey` exato. Chave de 44 dígitos é única globalmente, não precisa escopo de hub.
2. Senão → busca em paralelo por `nfNumber` (`OrderInvoice` e `Order.nfNumber`), `cteNumber`, `minutaNumber`, `dceNumber`, **restrito a `Order.status = 'AT_HUB'` e `Order.currentHubId = manifest.hubId`** (mesmo filtro que `ManifestsTab.tsx` já usa hoje pro dropdown — reduz colisão a pedidos realmente candidatos naquele hub).
3. Senão → tenta `Order.id` exato ou por sufixo (últimos 8 caracteres, para digitação manual do "número do pedido" curto exibido na UI).

**Resposta:**
```jsonc
// 1 pedido encontrado
{ "success": true, "match": "single", "order": { "id", "nfNumber", "originCity", "destCity", "weight", "volumes", "status", "currentHubId" } }

// Ambíguo (2+ candidatos) — front mostra lista, operador escolhe
{ "success": true, "match": "multiple", "candidates": [ { ...mesmos campos... } ] }

// Nada encontrado
{ "success": false, "match": "none", "message": "Nenhum pedido AT_HUB neste hub com esse código" }
```

Erros de negócio que o front trata na hora de tentar adicionar (via `addOrderToManifest`, já existe, sem mudança): pedido já no manifesto, pedido em outro manifesto ativo, capacidade excedida (peso/volume/valor) — todos já lançam `AppError` com mensagem clara hoje (`manifestLifecycle.ts:121-177`).

### Endpoint de adicionar pedido — sem mudança

`POST /:id/demands` (`manifests.ts:373`) já aceita `{ orderId }` e roda toda a validação de negócio. O fluxo de bipagem chama esse endpoint **uma vez por pedido resolvido** — sem endpoint de lote, sem mudança de contrato, risco baixo.

## Frontend

### 1. Componente novo: `components/ui/OrderScanInput.tsx`

Reutilizável no Admin e no Hub. Combina:
- Input de texto com **auto-foco e debounce curto de submit no Enter** (cobre leitor físico USB/Bluetooth, que digita o código e manda Enter sozinho).
- Botão de câmera que abre o `QRCodeScanner` já existente (`components/ui/QRCodeScanner.tsx`) — `onScan` alimenta o mesmo input.
- Chama `GET /orders/resolve` a cada submit; em `match: "single"` dispara callback `onResolved(order)`; em `"multiple"` mostra modal de escolha; em erro, toast com a mensagem.

Interface:
```ts
interface OrderScanInputProps {
  manifestId: string;
  onResolved: (order: ResolvedOrder) => void;
  disabled?: boolean;
}
```

### 2. Tela de detalhe do manifesto (drill-down) — `components/manifest/ManifestDetailScreen.tsx` (novo, compartilhado)

Rota nova `/#/manifests/:id`, acessível tanto de `/gestao` (Admin) quanto de `/hub` (Hub). RBAC controla **visibilidade de seção**, não a existência da tela:

| Seção | Admin | Hub | Fonte (lógica já existe em `ManifestsTab.tsx`) |
|---|---|---|---|
| Resumo/Capa (datas, lacre, liberação, km) | ✅ | ✅ | linhas ~712 (form) |
| Pedidos (bipar pra adicionar, remover) | ✅ | ✅ | `OrderScanInput` + `manifestsApi.addDemand/removeDemand` |
| Parada(s) (`ManifestStop`) | ✅ | ✅ | `createStop`, linha 477 backend |
| Carta Frete / Custo | ✅ | ✅ | `updateCapa`, `upsertFreightAgreement` |
| Motorista (atribuir/trocar) | ✅ | ✅ | `assignLink`, `setDriver` |
| Fiscal — CIOT (sugestão, emitir, status) | ✅ | ✅ (decisão do usuário) | `ciotSuggestion`, `emitCiot`, `ciotStatus` |
| Fiscal — MDF-e (emitir) | ✅ | ✅ (decisão do usuário) | `emitMdfe` |
| Cancelar CIOT | ✅ | ❌ (ADMIN-only no backend) | `cancelCiotTrip` |
| Aceitar/Recusar/Iniciar viagem | ❌ (papel do Link) | ❌ | `accept`/`reject`/`start` — exclusivo LINK |

A lista de manifestos (`ManifestsTab.tsx` listagem, `HubHome.tsx` aba "manifestos") vira **cards enxutos** (status, rota, ocupação, "Ver detalhes →") sem os 8 botões — só navegação pra tela de detalhe.

### 3. Fluxo de criação com bipagem

1. Form rápido de criação (veículo, origem/destino, hub — já existe, `ManifestsTab.tsx:709+` / `ManifestModal` no Hub) → `POST /` cria manifesto `DRAFT` vazio (sem mudança de contrato).
2. Redireciona direto pra `ManifestDetailScreen` na seção Pedidos, com `OrderScanInput` em foco.
3. Operador bipa/digita em sequência — cada resolução bem-sucedida chama `addDemand` e o card aparece na lista instantaneamente (otimista ou via refetch curto). Contadores de peso/volume/valor vs capacidade do veículo atualizam a cada adição (dado que `addOrderToManifest` já retorna `utilization`).
4. Quando termina de bipar, segue pras outras seções (parada, motorista, carta frete) na mesma tela.

### 4. Impacto em arquivos existentes

- `components/admin/ManifestsTab.tsx`: perde o bloco de `<select>` de adicionar pedido e o bloco de botões de ação por linha — vira lista de cards + link para `ManifestDetailScreen`. Toda a lógica de state (`showAddDemand`, `showCapa`, `showFreightAgreement`, `showCiotForm`, etc.) migra pra dentro de `ManifestDetailScreen`.
- `components/operacao/HubHome.tsx`: `ManifestModal` (criação) fica só com o form rápido; `ManifestCard` vira card enxuto; todas as ações pós-criação passam a viver em `ManifestDetailScreen`.
- `App.tsx` / roteamento: nova rota `/#/manifests/:id` com `ProtectedRoute allowedRoles={['ADMIN','HUB']}`.
- `lib/api.ts`: novo método `ordersApi.resolve(code, manifestId)`.

## Tratamento de erro / casos de borda

- **Câmera sem permissão**: `QRCodeScanner` já mostra erro e permite fechar — usuário cai pro input manual, que continua funcional.
- **Código ambíguo** (2+ pedidos): modal lista candidatos com origem/destino/peso pra desambiguar visualmente; nunca escolhe sozinho.
- **Código não encontrado**: toast com a mensagem exata do backend (ex.: "Nenhum pedido AT_HUB neste hub com esse código") — orienta a checar se o pedido já não está `AT_HUB` no hub certo.
- **Pedido já em outro manifesto ativo / capacidade excedida**: mensagem já vem pronta do `AppError` existente em `addOrderToManifest` — só precisa ser exibida (toast), sem lógica nova de validação no front.
- **Leitor físico bipando rápido demais**: debounce no submit do `OrderScanInput` evita disparo duplicado do mesmo código colado.

## Testes

- Unitário (backend): cascata de resolução em `orderResolve.ts` — 44 dígitos por tipo de chave, número não-global com e sem ambiguidade, sufixo de `Order.id`, escopo por hub. Seguir padrão de `manifestLifecycle.test.ts`.
- Smoke test ponta a ponta (como o já feito na Fatia 1.5): Hub cria manifesto → bipa 2+ pedidos (um por chave NF-e, outro por número de pedido) → confere card aparece → abre seção Parada/Motorista/Carta Frete → Admin abre a mesma tela de detalhe e vê as mesmas seções.
- Manual: testar em mobile real (viewport estreito) que a tela de detalhe não estoura horizontalmente e que o input de bipagem funciona com leitor físico (colar texto + Enter simulando o scanner).

## Riscos / notas

- `nfNumber`/`cteNumber`/`minutaNumber` não serem globalmente únicos é uma característica do modelo real de NF-e (não um bug) — a UI de desambiguação é obrigatória, não opcional.
- Nenhuma migração de banco. Risco de regressão concentra-se no refactor de `ManifestsTab.tsx`/`HubHome.tsx` (mover lógica de ação pra tela nova) — plano de implementação deve migrar seção por seção, mantendo o comportamento atual até a tela nova substituir de fato.
