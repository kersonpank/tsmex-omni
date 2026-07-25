# 🧭 TSM EX OMNI — Documento-Norte

> **Fonte única da verdade** do produto e da estratégia. Tudo que foi decidido vive aqui.
> Em conflito entre código, README ou opinião: **este documento + o código real** mandam.
> Última consolidação: **2026-06-02**.

---

## 1. Visão e modelo de negócio

**O que somos:** uma **transportadora tech-enabled** que lucra preenchendo **espaço ocioso** em rotas consolidadas. Não somos marketplace, não somos SaaS fiscal. Somos a transportadora — e o software é a alavanca de margem e escala.

**Como o dinheiro entra:** receita = **frete cobrado do cliente**. Hub, Link e fiscal são **custos operacionais**. O lucro nasce do *spread* entre o frete cobrado e o custo de mover a carga — maximizado por **ocupação** (encaixar carga no espaço vago de viagens que já vão rodar).

**Teia logística:**

```text
[Coleta OU drop no Hub origem] → consolida → [complemento/lotação → Hub destino] → [entrega final]
        perna 1                                  perna 2                              perna 3
```

**Clientes:** lojistas, distribuidoras, indústrias, varejo (recorrentes) + **redespacho** (consignatário = outras transportadoras, com CT-e próprio). Modalidades: **CIF** (remetente paga), **FOB** (destinatário paga), **REDESPACHO** (consignatário paga).

**Operação real hoje (corredor SP↔MA):** CD próprio em GRU-SP; hubs em Imperatriz-MA (parceiro), São Mateus-MA (próprio), São Luís-MA (parceiro). Movimentação nacional via complemento (paga por m³ ocupado) ou lotação (carga fechada). Anúncio de capacidade em Fretebras/Frete.com; gerenciamento de risco via Buonny/GR.

**Visão de "grande":** IA orquestra a teia — primeiro **copiloto** (sugere, humano decide), depois aproximando-se de **piloto** (executa quase sozinha), aprendendo por acerto/erro. O algoritmo de consolidação por margem é o ativo de longo prazo.

**Fosso competitivo:** ninguém une **posse da carga + operação de hubs + consolidação por ociosidade + fiscal próprio**, focado em corredor de interior do Nordeste, onde os grandes (Frete.com, Loggi, CargoX) não vão por baixa densidade.

---

## 2. Decisões fechadas (com o porquê)

| # | Decisão | Por quê |
|---|---------|---------|
| 1 | Receita = frete; Hub/Link/fiscal = custo | Somos transportadora, não vendedor de software |
| 2 | **Margem completa** (rastrear custo, não só receita) | Lucro vem do spread no espaço ocioso; sem custo, margem é cega |
| 3 | Foco corredor SP↔MA, mas sistema **nasce escalável** p/ qualquer hub | Provar conta cheia antes de escalar; hub vazio = prejuízo fixo |
| 4 | Link = **pool fixo de confiança**, não marketplace | Não competir com Frete.com em liquidez; portal de anúncio é outra startup |
| 5 | Painel do Link = **gestão de viagem/responsabilidade** (não anúncio) | Motorista pronto, manifesto+fiscal, check-in localização, comprovante, ganhos |
| 6 | Fiscal = **encanamento, não produto** | Não virar concorrente de SSW/Brudam; foco no fosso real (consolidação/margem) |
| 7 | Redespacho/**consignatário = cliente de primeira classe** | Volume recorrente denso; chave do CT-e dele referenciada no nosso CT-e |
| 8 | Faturar = **duplicata/contas a receber primeiro**, gateway depois | Controle antes de automação; MVP gera fatura manual no módulo financeiro |
| 9 | **Demanda ≠ Pedido; fronteira = POSSE** | Demanda = oportunidade (cotação, NF, solicitado coleta); Pedido = já em nossa posse |
| 10 | **Pedido = fonte única do estado físico** | Acaba a dupla fonte de verdade (demand.status + order.status divergiam) |
| 11 | **Jornada multi-perna** (`OrderLeg`, Pedido⇄Manifesto N:N) | Carga atravessa vários trechos/Links; custo por perna → margem por jornada |
| 12 | Pernas **emergem na operação**, sem planejador automático | Humano monta como já faz; sistema só para de perder o rastro |
| 13 | Manifesto contém **1+ pedidos** | Consolidação = agrupar pedidos físicos numa viagem |
| 14 | IA **copiloto** + captura `ConsolidationFeedback` **desde o dia 1** | Humano decide; corpus de treino (situação→decisão→resultado) nasce com a operação |
| 15 | Segurança = **gate de pré-produção** | Sistema novo ainda sem usuários reais; corrigir antes do go-live |
| 16 | Frontend refatorar **depois**; **/hub é a superfície principal** | UIs soltas; foco experiência + automação operacional; não parar pra refatorar o que funciona |
| 17 | Acerto Hub = **por manifesto/viagem**; Link = ao concluir serviço | Hub: máquina Em aberto→Solicitado→Conferido→Aceito→Pago (rastreável/auditável) |
| 18 | Viagem pode ter **N paradas/descargas** (`ManifestStop`) | TRANSFER visitando vários hubs ou DELIVERY com vários clientes; conclusão é por parada, não em bloco |
| 19 | **Carta Frete real** (`ManifestFreightAgreement`) é a fonte oficial de custo do Link quando existir | `freteBruto + pedágio` = custo real da viagem p/ margem; `LinkPricingAgreement` vira só estimativa/fallback pré-Carta-Frete |
| 20 | Encerramento fiscal (CIOT/MDF-e) é **automático e best-effort ao concluir a viagem**, nunca um gate | Fiscal continua encanamento (decisão #6): falha no encerramento gera `SystemAlert`, nunca bloqueia nem reverte a conclusão |

---

## 3. Modelo econômico (unit economics)

- **Receita** = Σ fretes da jornada → **1 fatura por pedido** (CT-e/minuta).
- **Custo** = Σ custo das pernas + comissão do Hub.
  - Link: **FIXO** | **%** | **por m³** (complemento) | **carga fechada** (lotação).
  - Hub: **% por demanda** (já inclui entrega quando é hub de distribuição).
- **Margem bruta** = receita − custos. **Maximizada por load factor** (ocupação do veículo).
- **Alavanca:** demanda marginal encaixada em viagem já comprometida = **quase margem pura** (custo do Link já é afundado).
- **Break-even por rota:** load factor mínimo abaixo do qual a viagem dá prejuízo → sistema **alerta/bloqueia** caminhão vazio demais.
- **Métrica-rainha:** **margem por viagem** + **% de ocupação**.

> Exemplo: frete consolidado R$3.000 − coleta R$300 − handling hub R$150 − transferência R$1.500 − entrega R$450 = **margem R$600 (20%)**. A IA aprende a maximizar esse número, não só a ocupação.

---

## 4. Modelo de dados (núcleo)

**Quatro camadas (a fronteira é a POSSE):**

| Entidade | É o quê | Rastreia |
|----------|---------|----------|
| **Demanda** | Oportunidade pré-posse (cotação, NF com nosso CNPJ, solicitado coleta) | Status comercial até `CONVERTED` |
| **Pedido** (Order) | Carga física em nossa posse (coletada / deu entrada) | **Fonte única** do estado físico + custódia |
| **Manifesto** | Viagem (1+ pedidos, 1 veículo, 1 Link ou hub) | Ocupação, fiscal de viagem |
| **OrderLeg** (perna) | "Pedido viajando num manifesto" = um trecho da jornada | Custo do trecho (Fatia 2), tipo, executor |

**Chaves do modelo:**

- `OrderLeg`: `orderId`, `manifestId`, `sequence`, `legType` (COLETA\|TRANSFERENCIA\|ENTREGA), `executedBy` (HUB\|LINK), `originHubId`, `destHubId`. `allocatedCost` → Fatia 2.
- **Custódia** = derivada: perna ativa (manifesto `IN_PROGRESS`) → `IN_TRANSIT`; senão `AT_HUB` em `currentHubId`. Nunca campo solto.
- **Invariante:** um pedido tem N pernas, mas **no máximo uma perna `IN_PROGRESS`** (corpo não habita dois lugares).
- `Hub.roles[]` (RECEBIMENTO\|COLETA\|DISTRIBUICAO\|TRIAGEM) — entrega pode ser do próprio hub.
- **Custo/margem (Fatia 2):** `LinkPricingAgreement`, `HubCommissionAgreement`, rollup no manifesto, `ManifestSettlement` (contas a pagar).
- **Fiscal:** `OrderFreightCalculation` (CT-e/minuta por pedido), `ManifestFiscalDocument` (MDF-e/CIOT por viagem). Partes: remetente/destinatário/consignatário/expedidor/redespachante.
- **IA:** `ConsolidationFeedback` (gravado em toda consolidação; +margem na Fatia 2).
- **Multi-parada e capa (pós-Fatia 1):** `ManifestStop` (parada/descarga real da viagem — `destHubId` ou `destCity/destState`, `OrderLeg.stopId` aponta pra ela); `Manifest.fiscalEmitterId/plannedDepartureAt/plannedArrivalAt/notes/seloLacre/liberacao/kmSaida/kmChegada` (capa da viagem); `ManifestFreightAgreement` (Carta Frete estruturada 1:1 por manifesto — fonte de custo real do Link).

> Detalhe completo da Fatia 1: [docs/superpowers/specs/2026-06-02-jornada-demanda-multi-perna-design.md](docs/superpowers/specs/2026-06-02-jornada-demanda-multi-perna-design.md).

---

## 5. Escopo do MVP por fases

### ✅ Essencial (o ciclo tem que rodar na nossa stack)
- Demanda entra (cliente gera OU dá entrada no CD via chave NF-e).
- Pedido em posse, jornada multi-perna rastreada, custódia clara.
- Fiscal de transporte (CT-e/MDF-e/minuta) — já forte.
- Consolidar com visão de ocupação.
- Faturar (duplicata manual) + controle de contas a receber/pagar.
- Comprovantes de entrega/pagamento no sistema.
- Captura de dados de IA (`ConsolidationFeedback`).

### ⏭️ Depois (importante, não agora)
- Margem automática por viagem + alerta de break-even.
- Painel financeiro Hub/Link (carteira) com máquina de acerto.
- Sugestão de IA para consolidação (copiloto).
- Gateway de pagamento integrado + liberações.
- Referência da chave do CT-e do consignatário no nosso CT-e.
- Refatoração das UIs (foco experiência + automação).

### 🚫 NÃO agora (anti-escopo — bloquear se alguém puxar)
- ❌ Marketplace/portal de anúncio de cargas (é outra startup).
- ❌ Fiscal como produto SaaS para terceiros.
- ❌ Multi-tenant para múltiplas transportadoras.
- ❌ IA executando operação física sozinha (piloto autônomo).
- ❌ Planejador de rota 100% automático.
- ❌ Cadastro self-service complexo de hubs (cadastramos os primeiros na mão).
- ❌ Migrar HashRouter→BrowserRouter, quebrar god-components agora.

---

## 6. Roadmap por fases

### Fatia 1 — Jornada da Demanda (multi-perna) + fonte única + captura IA ✅ concluída

- [x] Migração schema: `OrderLeg`, enums `LegType`/`ExecutedBy`/`HubRole`
- [x] Fronteira de posse: `DemandStatus` restrito ao pré-posse; `Demand.manifestId` removido
- [x] `Pedido` = fonte única; lifecycle para de escrever `demand.status`
- [x] Invariante "uma perna `IN_PROGRESS` por pedido"
- [x] Refactor `manifestLifecycle` para operar sobre `OrderLeg`
- [x] Gravar `ConsolidationFeedback` em toda consolidação
- [x] Testes de lifecycle adaptados e verdes (`manifestLifecycle.test.ts`, `manifests.lifecycle.test.ts`)
- [x] Toques no /hub (receber, custódia, consolidar) — fluxo de criação/consolidação corrigido em 2026-07-25 (ver Fatia 1.5)

> Backfill de dados de manifestos pré-existentes não foi necessário nesta rodada — `Order.manifestId` seguiu mantido como coluna de compat, sem uso na lógica nova.

### Fatia 1.5 — Viagem multi-parada + Capa + Carta Frete + Encerramento fiscal (2026-07-25) ✅ concluída

- [x] Corrigido fluxo de consolidação quebrado: Hub (`HubHome.tsx`) não anexava pedidos/Link ao criar manifesto (zod descartava campos), Admin usava `Demand.manifestId` inexistente, botão "Enviar oferta" chamava rota 404 — todos corrigidos
- [x] `ManifestStop` (parada/descarga real da viagem): schema + `completeManifestStop`/`completeManifest` (conclusão por parada, não em bloco) + endpoints (`POST /:id/stops`, `PATCH /:id/stops/:stopId/complete`) + UI (Admin e Link)
- [x] Capa da viagem: `fiscalEmitterId`, datas previstas, observações, lacre, liberação, km saída/chegada (capturados em `startManifest`/conclusão)
- [x] Carta Frete estruturada (`ManifestFreightAgreement`): vira fonte real de custo do Link em `calculateLinkCost` (freteBruto + pedágio) quando preenchida; pré-preenche o formulário de emissão de CIOT
- [x] **Bug fiscal corrigido**: `emitMdfeViaAcbr` montava `infMunDescarga` com o município de **origem** (nunca lia o destino) e só suportava 1 descarga — agora agrupa por `ManifestStop`, resolve o município real de cada parada, suporta N descargas
- [x] Reboque 2 (`Link.trailer2Plate`) + `veicReboque[]` no XML do MDF-e (nenhum reboque era emitido antes, nem o já cadastrado)
- [x] Encerramento automático (best-effort, pós-conclusão, nunca gate) de CIOT (`encerrarCiot`, já existia sem consumidor) e MDF-e (`encerrarMdfeViaAcbr`, novo) ao concluir a viagem; falha gera `SystemAlert` categoria `FISCAL_ENCERRAMENTO_PENDENTE`
- [x] **Endpoint de encerramento do MDF-e corrigido**: era `/mdfe/{id}/encerrar` (chute), path real confirmado em `doc-llm-acbrapi` (raiz do repo) é `POST /mdfe/{id}/encerramento` (operationId `EncerrarMdfe`) — corrigido, campos do body (`cUF`/`cMun`/`dtEnc`/`nProt`) seguem o evento oficial MDF-e 110112; doc local não detalha o schema campo a campo, então **ainda testar em homologação** antes de confiar em produção
- [x] **3 bugs de autorização corrigidos via smoke test real** (`GET /hubs`, `DELETE /:id/demands/:demandId`, `PATCH /:id/assign`): Hub não conseguia ver outros hubs (só o próprio — quebrava escolher hub destino), não conseguia remover pedido do próprio manifesto, e não conseguia atribuir Link — todos ADMIN/LINK-only sem necessidade. Agora Hub opera o ciclo completo da própria viagem: cria manifesto TRANSFER pra outro hub, anexa pedidos, cria parada, atribui Link; Hub destino conclui a parada (`PATCH /:id/stops/:stopId/complete` e `/complete` agora aceitam HUB com checagem de ownership: só o hub que é destino daquela parada/viagem)
- [x] Smoke test ponta a ponta rodado no dev DB local (fixtures criados e removidos): Hub cria viagem → anexa pedido AT_HUB → cria parada → atribui Link → Link aceita/inicia (com kmSaída) → Hub destino conclui a parada (com kmChegada) → manifesto `COMPLETED`, pedido `AT_HUB` no hub certo. Zero erros no log do servidor.
- [ ] Migração de backfill de `Manifest.stops` (JSON legado nunca consumido) para `ManifestStop` não foi feita — campo continua morto, sem uso

### Fatia 2 — Margem & Faturamento
- [ ] `LinkPricingAgreement` + `HubCommissionAgreement`
- [ ] `OrderLeg.allocatedCost` (rateio por m³/kg) + rollup de margem no manifesto
- [ ] Frete (`freightTotal`) → duplicata (corrigir desconexão atual)
- [ ] Visão de contas a receber
- [ ] `marginBefore/After` no `ConsolidationFeedback`

### Fatia 3 — Acerto financeiro Hub/Link
- [ ] `ManifestSettlement` (contas a pagar)
- [ ] Máquina: Em aberto → Solicitado → Conferido → Aceito → Pago
- [ ] Aba Carteira nos painéis Hub e Link + comprovantes

### Fatia 4 — Painel do Link (viagem)
- [ ] Manifesto + dados fiscais no app
- [ ] Check-in de localização (3x/dia)
- [ ] Registro de entrega com comprovante
- [ ] Visão de ganhos + comprovantes de pagamento

### Pré-produção (gate de go-live)
- [ ] Cifrar `LLMApiKey.apiKey` (AES-256-GCM, como o cert fiscal já usa)
- [ ] Guard `NODE_ENV` no seed (bloquear senha fraca em prod)
- [ ] Revisar JWT (refresh/expiração), rate limiting, logs estruturados, health checks reais

### Contínuo
- [ ] Refatoração das UIs (god-components, `lib/api.ts`), foco experiência + automação

---

## 7. Telas e endpoints prioritários

**Telas (por prioridade):**
1. **/hub** (superfície principal) — entrada/intake, custódia da carga, consolidação.
2. **Admin** — manifestos (consolidar), faturas (contas a receber).
3. **/link** — viagem (manifesto, check-in, comprovante, ganhos).
4. **/client** — gerar demanda, acompanhar.

**Endpoints — existentes a evoluir:**
- `manifests POST /:id/demands` → migrar para lógica de pedido + `OrderLeg` (`addOrderToManifest`).
- `manifests /:id/start|/complete` → operar sobre pernas; parar de escrever `demand.status`.
- `orders /:id/status` → fonte única do físico; parar de escrever `demand.status`.
- `invoices POST` → ligar a `OrderFreightCalculation.freightTotal` (Fatia 2; hoje subtotal é digitado à mão).

**Endpoints — novos:**
- Consolidação ciente de perna + escrita de `ConsolidationFeedback`.
- Custo/margem (Fatia 2), settlement Hub/Link (Fatia 3), check-in/comprovante Link (Fatia 4).

---

## 8. Glossário

| Termo | Significado |
|-------|-------------|
| **Hub** | Filial/CD: recebe, tria, consolida, pode emitir fiscal e entregar. Tem papéis (`HubRole`). |
| **Link** | Transportador (motorista/PJ) que move carga. Pool fixo de confiança, não marketplace. |
| **Manifesto** | Viagem que agrupa 1+ pedidos num veículo. Tipos: TRANSFER, DELIVERY. |
| **Demanda** | Oportunidade pré-posse (cotação, NF, solicitado coleta). Vira pedido ao entrar em posse. |
| **Pedido** (Order) | Carga física em nossa posse. Fonte única do estado físico. |
| **Perna** (`OrderLeg`) | Um trecho da jornada = pedido viajando num manifesto. Unidade de custo. |
| **Parada** (`ManifestStop`) | Uma descarga real dentro de uma viagem — TRANSFER pode visitar N hubs, DELIVERY pode ter N clientes. Concluída individualmente; a viagem só fecha quando todas as paradas fecham. |
| **Carta Frete** (`ManifestFreightAgreement`) | Valor real acordado com o Link para aquela viagem (frete bruto, adiantamento, pedágio, deduções). Fonte oficial de custo na margem quando preenchida. |
| **Custódia** | Onde a carga está agora (em trânsito numa perna OU parada num hub). Derivada, nunca solta. |
| **Complemento** | Pagar por m³ ocupado (espaço ocioso). |
| **Lotação** | Carga fechada — pagar o frete cheio do veículo. |
| **Redespacho / Consignatário** | Terceiro (outra transportadora) que paga; tem CT-e próprio (chave referenciada no nosso). |
| **CIF / FOB** | Quem paga o frete: remetente (CIF) / destinatário (FOB). |
| **CT-e** | Conhecimento de Transporte eletrônico — documento fiscal oficial da carga. |
| **MDF-e** | Manifesto eletrônico de documentos fiscais — nível viagem. |
| **DC-e / Minuta** | Declaração de conteúdo / documento interno sem valor fiscal. |
| **Load factor** | % de ocupação do veículo (peso/volume / capacidade). Direciona a margem. |
| **GR** | Gerenciamento de Risco (ex.: Buonny) — checklist de documentos do motorista. |
| **`ConsolidationFeedback`** | Registro situação→decisão→resultado de cada consolidação. Corpus de treino da IA. |

---

*Este documento é vivo. Toda decisão nova entra aqui com o porquê. Specs detalhados em `docs/superpowers/specs/`.*
