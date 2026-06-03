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

### Fatia 1 — Jornada da Demanda (multi-perna) + fonte única + captura IA
- [ ] Migração schema: `OrderLeg`, enums `LegType`/`ExecutedBy`/`HubRole`
- [ ] Fronteira de posse: `DemandStatus` restrito ao pré-posse; `Demand.manifestId` removido
- [ ] `Pedido` = fonte única; lifecycle para de escrever `demand.status`
- [ ] Invariante "uma perna `IN_PROGRESS` por pedido"
- [ ] Refactor `manifestLifecycle` para operar sobre `OrderLeg`
- [ ] Gravar `ConsolidationFeedback` em toda consolidação
- [ ] Backfill idempotente, testado em cópia da base real
- [ ] Testes de lifecycle adaptados e verdes
- [ ] Toques no /hub (receber, custódia, consolidar)

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
