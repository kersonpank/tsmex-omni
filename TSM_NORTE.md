# 🧭 TSM EX OMNI — Documento-Norte

> **Fonte única da verdade** do produto e da estratégia. Em conflito entre código, README, spec antigo
> ou opinião: **este documento + o código real** mandam.
> Reescrito em **2026-10-20** consolidando a estratégia definida com o fundador (histórico completo e
> pesquisa de mercado em `kersonpank/ex`: TESE-TECHLOG, PLANO-EXECUTAVEL, AUDITORIA-TSMEX-OMNI,
> RODA-OPERACIONAL, TEIA-E-RODA, PLANO-TSM-OS-HUB).
> Desenho das estações: [docs/superpowers/specs/2026-10-20-tsm-os-estacoes-design.md](docs/superpowers/specs/2026-10-20-tsm-os-estacoes-design.md).

---

## 1. Tese — o que somos

**A TransMesquita não é "transportadora com sistema" nem "software house com caminhões".** É uma
**operadora de rede logística orquestrada por sistema**:

- **O produto** é o compromisso logístico cumprido com comprovação (prazo, integridade, custo previsível).
  O frete é uma das formas de executar a promessa.
- **A rede** (hubs próprios e parceiros, links/transportadores) é o corpo.
- **O sistema** é o sistema nervoso: executa o fluxo padrão; pessoas tratam exceção, relacionamento e expansão.

**Onde está o fosso (e onde não está).** Software virou copiável (agentes reproduzem qualquer tela).
Não é fosso: telas, módulos, "ter IA". **É fosso, porque acumula e não se copia:**
1. a **malha medida** — cada hub/link com histórico real de prazo, custo, confiabilidade, trecho a trecho;
2. o **grafo de eventos com porquê** — cada decisão registrada (o que o sistema sugeriu, o que a pessoa fez, por quê);
3. a **confiança B2B** baseada em evidência (OTIF, divergências, comprovação);
4. o **custo estrutural menor** quando o sistema executa o padrão.

**Regras de sobrevivência:**
- **Não replicar outros sistemas.** O desenho é nosso. Fluxo validado de transporte é o esqueleto (não se
  reinventa a roda), mas a organização, a experiência e a inteligência são próprias.
- **Anti-Convoy:** tecnologia nunca anda na frente do caixa. Cada entrega se paga reduzindo trabalho/custo
  ou destravando receita na operação real — testada na doca, não em demo.

**Regra de decisão para qualquer feature:** *isso acumula dado proprietário da malha ou reduz custo/trabalho
por pedido?* Se não, é distração.

---

## 2. Modelo mental: Teia e Roda

### 2.1 Teia (o espaço)
A operação **não é ponto-a-ponto** (não é Uber). É uma malha de nós conectados por capacidades, e a jornada
de cada pedido é construída **salto a salto** — uma transferência deriva outras:

```text
GRU ══ tronco (30+ pedidos de vários destinos) ══▶ IMPERATRIZ
                                                     ├─ regional ▶ AÇAILÂNDIA (manifesto novo)
                                                     ├─ regional ▶ SÃO MATEUS
                                                     └─ entrega local (última perna)
```

Funciona como **roteamento de pacotes**: hub = roteador, link = enlace com capacidade, pedido = pacote
(sabe só onde está e o destino final), manifesto = muitos pacotes num enlace, **cobertura = tabela de
roteamento** (`HubCoverage`). **Nenhum nó precisa conhecer o caminho inteiro:** cada hub responde só
*"dado o destino final, qual o melhor próximo salto a partir daqui, agora?"*. Expandir a teia = adicionar
linhas na tabela de roteamento, nunca redesenhar fluxo.

### 2.2 Roda (o tempo)
O ciclo que gira **dentro de cada nó** — receber → conferir → estocar/etiquetar → consolidar → carregar →
despachar → (outro nó recebe) → entregar → comprovar → fechar/aprender. **Todo nó roda a mesma roda, nas
mesmas telas** — do CD de Guarulhos à loja-ponto-de-coleta. Nó novo = mesma roda em outro ponto.

### 2.3 Teste de conformidade (todo plano técnico passa por ele)
1. O pedido conhece só posição atual + destino final (nunca "a sua viagem")?
2. A decisão de destino/agrupamento é tomada **no nó onde o pedido está**?
3. A chegada de um manifesto **alimenta automaticamente** as filas do nó de chegada?
4. Funciona igual com 3 hubs e com 300 (nada hard-coded por rota)?
5. Um salto direto (coleta → entrega) é só o caso de 1 perna do mesmo modelo?

Qualquer "não" = voltar ao desenho.

---

## 3. Régua de autonomia (o caminho até "trabalho pronto")

O sistema vende trabalho pronto (tese *service-as-software*), mas chega lá **em degraus, por rota**, nunca em salto.

| Nível | Quem decide | Estado |
|---|---|---|
| L0 Registro | Humano faz tudo; sistema anota | legado |
| L1 Sistematização | Sistema estrutura o fluxo: filas, estações, estados, status em lote | **agora** |
| L2 Assistência | Sistema **sugere** (próximo salto, agrupamento, link) com justificativa; humano aceita/altera | próxima |
| L3 Exceção | Sistema executa o padrão; humano só trata exceção | por rota, com gatilho |
| L4 Autopilot | Sistema opera a malha | horizonte |

- Sobe-se **por rota** e **por gatilho medido** (ex.: sugestões aceitas sem alteração > 90% por N semanas).
- **Todo aceite/alteração humana em L1/L2 é dado de treino de L3** — por isso o *evento com porquê* é inegociável.
- IA **propõe**; regras **verificam**; autorizações **limitam**; evidências **confirmam**. Nenhum modelo
  generativo tem autoridade final sobre fiscal, financeiro ou baixa de entrega.

---

## 4. Decisões fechadas (com o porquê)

| # | Decisão | Por quê |
|---|---------|---------|
| 1 | Receita = frete; Hub/Link/fiscal = custo | Vendemos o compromisso cumprido, não software |
| 2 | **Margem completa** (rastrear custo, não só receita) | Lucro vem do spread no espaço ocioso; sem custo, margem é cega |
| 3 | Foco corredor SP↔MA, sistema **nasce escalável** p/ qualquer hub | Provar conta cheia antes de escalar; hub vazio = prejuízo fixo |
| 4 | Link = **pool fixo de confiança**, não marketplace | Não competir em liquidez; portal de anúncio é outra startup |
| 5 | Painel do Link = gestão de viagem/responsabilidade (não anúncio) — **opcional**: o hub pode operar a viagem inteira (ver #24) | Motorista sem app não pode travar a operação |
| 6 | Fiscal = **encanamento, não produto** | Foco no fosso real (consolidação/margem) |
| 7 | Redespacho/**consignatário = cliente de primeira classe** | Volume recorrente denso |
| 8 | Faturar = **duplicata/contas a receber primeiro**, gateway depois | Controle antes de automação |
| 9 | **Demanda ≠ Pedido; fronteira = POSSE** | Demanda = oportunidade; Pedido = já em nossa posse |
| 10 | **Pedido = fonte única do estado físico** | Acaba a dupla fonte de verdade |
| 11 | **Jornada multi-perna** (`OrderLeg`, Pedido⇄Manifesto N:N) | Carga atravessa vários trechos; custo por perna → margem por jornada |
| 12 | ~~Pernas emergem sem planejador~~ → **revista:** o sistema **sugere o próximo salto** (fila por destino via `HubCoverage`); o humano monta e decide | L1→L2 da régua; a fila é a decisão de próximo salto materializada |
| 13 | Manifesto contém **1+ pedidos** | Consolidação = agrupar pedidos numa viagem |
| 14 | IA **copiloto** + `ConsolidationFeedback` **desde o dia 1**, gravando **sugerido × final** | Corpus situação→decisão→resultado nasce com a operação |
| 15 | Segurança = **gate de pré-produção** | Corrigir antes do go-live |
| 16 | ~~/hub é a superfície principal~~ → **revista:** a superfície operacional é o **TSM O.S. (`/#/hubs`)**; o `/hub` legado convive até cada estação ser substituída com ganho medido, depois morre | UI por entidade travou a operação; ver #21–#23 |
| 17 | Acerto Hub = por manifesto/viagem; Link = ao concluir serviço | Rastreável/auditável |
| 18 | Viagem pode ter **N paradas/descargas** (`ManifestStop`) | Conclusão por parada |
| 19 | **Carta Frete real** é a fonte oficial de custo do Link quando existir | Custo real p/ margem |
| 20 | Encerramento fiscal automático e best-effort ao concluir; nunca gate | Falha vira `SystemAlert` |
| 21 | **UI organizada por estação, não por entidade.** Toda estação: 1 pergunta, 1 fila "o que precisa de mim agora", 1 ação primária, 1 evento emitido que alimenta a próxima estação | A roda fecha quando o item concluído aparece sozinho na próxima fila |
| 22 | **Hub é hub**: uma superfície só para qualquer porte, renderizada por *capability*. **Inicialmente todo hub pode fazer tudo**; a torre restringe por hub depois | Loja-ponto-de-coleta e CD usam o mesmo app; configuração é da torre |
| 23 | **Mobile-first, mínimo de interação, scan-first**; desktop é o mesmo app responsivo. Métrica: toques por tarefa | A teia é plugada na vida das pessoas; não pode dar trabalho receber e entregar |
| 24 | O hub de origem pode **confirmar o transportador e registrar a saída em nome do Link**, sempre auditado (quem fez) | Operação real não pode depender do motorista ter o app |
| 25 | **Evento com porquê**: eventos de decisão gravam ator, sugestão do sistema, aceito/alterado e motivo | É o dado que transforma L2 em L3 (fosso #2) |
| 26 | **Divergência nunca encerra em silêncio** (recebimento, carregamento, entrega) | Cadeia de custódia verificável |
| 27 | O.S. **não reconstrói o que o legado já faz equivalente** — constrói o que fecha a roda; reaproveita o motor (backend) existente | Evitar repintar o legado; o backend já é maduro |
| 28 | Lonngren será aposentado (2027): corte **por rota**; scraper é ponte de dados com log, idempotência e alarme | Prazo externo; dado divergente abre a roda |
| 29 | Design atual é **funcional, não final**: passe de design dedicado (moderno, com motion) depois que as estações rodarem | Operação primeiro, acabamento depois |

---

## 5. Modelo econômico (unit economics)

- **Receita** = Σ fretes da jornada → **1 fatura por pedido** (CT-e/minuta).
- **Custo** = Σ custo das pernas + comissão do Hub (Link: fixo | % | por m³ | carga fechada; Hub: % por demanda).
- **Margem bruta** = receita − custos. **Maximizada por load factor** (ocupação).
- **Alavanca:** demanda marginal encaixada em viagem já comprometida = quase margem pura.
- **Break-even por rota:** load factor mínimo abaixo do qual a viagem dá prejuízo → alerta/bloqueio.
- **Métricas-rainhas:** margem por viagem + % de ocupação + OTIF + minutos de coordenação por remessa.

---

## 6. Modelo de dados (núcleo)

| Entidade | É o quê | Rastreia |
|----------|---------|----------|
| **Demanda** | Oportunidade pré-posse | Status comercial até `CONVERTED` |
| **Pedido** (Order) | Carga física em nossa posse | **Fonte única** do estado físico + custódia |
| **Manifesto** | Viagem (1+ pedidos, 1 veículo, 1 Link ou hub) | Ocupação, fiscal de viagem |
| **OrderLeg** (perna) | Pedido viajando num manifesto | Custo do trecho, tipo, executor |
| **ManifestStop** (parada) | Descarga real da viagem | Conclusão por parada |
| **HubCoverage** (cobertura) | Tabela de roteamento: cidade (IBGE) que o hub atende, prioridade (menor vence), prazo | Próximo salto da teia; cidade-sede do hub vale implícita |

- **Custódia** = derivada (perna ativa → `IN_TRANSIT`; senão `AT_HUB` em `currentHubId`). Nunca campo solto.
- **Invariante:** no máximo **uma perna `IN_PROGRESS` por pedido**.
- **Fiscal:** `OrderFreightCalculation` (CT-e/minuta por pedido), `ManifestFiscalDocument` (MDF-e/CIOT por viagem).
- **IA:** `ConsolidationFeedback` (sugerido × final, utilização e margem antes/depois).
- **Identidade por volume:** etiquetas por volume já existem (QR = número do pedido); entidade `Volume` no
  banco entra quando a conferência por volume exigir (Etapa A).

---

## 7. As estações do TSM O.S. (a roda dentro do hub)

Detalhe completo, com fila, ação e evento de cada uma: spec
[2026-10-20-tsm-os-estacoes-design.md](docs/superpowers/specs/2026-10-20-tsm-os-estacoes-design.md).

| Estação | Pergunta | Estado |
|---|---|---|
| Hoje | O que precisa de mim agora? | ✅ |
| Receber | O que chegou e confere? | ✅ conferência por pedido + divergência |
| Entrada | O que está chegando no balcão e falta para virar pedido? | parcial (1 toque quando a NF-e resolve as partes) |
| Estoque e etiquetas | O que tenho aqui e está identificado? | ✅ busca, scan, etiqueta por volume |
| Consolidar | O que está pronto para viajar e para onde? | ✅ fila por próximo salto + montar viagem |
| Preparar e despachar | O que falta para esta viagem sair? | **em construção** (Etapa A5) |
| Documentos | Que CT-e/MDF-e/CIOT faltam? | dentro de "Preparar"; estação própria depois |
| Entregar | O que sai hoje para entrega e como comprovo? | pendente |
| Exceções (transversal) | O que travou, de quem é, até quando? | pendente |
| Aprendizado (torre) | O que o planejado × realizado ensinou? | backend de margem existe; estação pendente |

---

## 8. Escopo

### 🚫 Anti-escopo (bloquear se alguém puxar)
- ❌ Marketplace/portal de anúncio de cargas (é outra startup).
- ❌ Fiscal como produto SaaS para terceiros.
- ❌ Multi-tenant para múltiplas transportadoras.
- ❌ IA executando operação física sozinha (piloto autônomo) — a régua sobe por gatilho medido.
- ❌ Planejador de rota 100% automático / otimizador global — decisão é local, por nó.
- ❌ Cadastro self-service complexo de hubs.
- ❌ Replicar outros sistemas (Lonngren, Aleff etc.) — o desenho é nosso.
- ❌ Refatorar o legado (`/hub`, god-components) ou migrar HashRouter: **o O.S. substitui estação por estação**.

### ⏭️ Depois (importante, não agora)
- Passe de design moderno com motion (decisão #29).
- Gateway de pagamento integrado.
- Referência da chave do CT-e do consignatário no nosso CT-e.
- Jev/gates tipados no orquestrador v0 (classificar pedido→fila, risco de prazo) — Etapa F.

---

## 9. Roadmap por etapas

> Nomenclatura: **Etapas** (A, B, C…) com itens numerados. As antigas "Fatias 1/1.5" são a fundação.

### Fundação ✅ concluída (antigas Fatias 1 e 1.5)
Jornada multi-perna, fronteira de posse, pedido como fonte única, invariante de perna ativa,
`ConsolidationFeedback`, viagem multi-parada, capa, Carta Frete, MDF-e multi-descarga, encerramento fiscal
automático, autorização do hub no ciclo da própria viagem. (Detalhe: `docs/superpowers/specs/2026-06-02-*` e `2026-07-25-*`.)

### Etapa A — A roda do hub no TSM O.S. (`/#/hubs`) — **atual**
- [x] A1 Shell mobile isolado (chunk próprio) + estação Hoje
- [x] A2 Receber: conferência pedido a pedido; divergência exige reconhecimento e vira evento
- [x] A3 Estoque com busca e scan + etiquetas por volume (QR) + entrada em 1 toque (caminho feliz)
- [x] A4 Teia: `HubCoverage` + editor de cobertura (torre) + fila de consolidação por próximo salto + montar viagem
- [ ] A5 **Preparar e despachar** no O.S. (sem cair na tela antiga): pendências da viagem em linguagem simples,
      responsável, saída prevista, Carta Frete com sugestão, confirmar transportador e registrar saída **pelo hub** (#24)
- [ ] A6 Carregamento conferido por scan (custódia ponto 1); divergência nunca silenciosa
- [ ] A7 Documentos no fluxo: CT-e por pedido, MDF-e, CIOT (emitir/dispensar com motivo) sem sair do O.S.
- [ ] A8 Entregar: rota do dia + tentativa de entrega com comprovação (`DeliveryAttempt` já existe)
- [ ] A9 Entrada completa no balcão (quando a NF-e não resolve as partes)
- [ ] A10 Fila única de exceções (promover `SystemAlert`: dono, prazo, desfecho)
- [ ] A11 Corte do `/hub` legado: `/hubs` vira o destino padrão do papel HUB

### Etapa B — Evento com porquê (dados para L2)
- [x] B1 `ConsolidationFeedback` com sugerido (fila) × final ao montar viagem pela fila
- [ ] B2 Ator (`actorUserId`) em `OrderHistory`/`DemandEvent` em todos os pontos de escrita (hoje: parcial)
- [ ] B3 Motivo obrigatório quando o operador altera a sugestão do sistema

### Etapa C — Fechamento e Aprendizado (antigas Fatias 2/3)
> Backend já existe no código (custo por perna `allocateLegCosts`, margem por viagem, contas a pagar
> `payables`, recebimentos de fatura). Falta a estação na operação e a validação com dados reais.
- [ ] C1 Estação Aprendizado: planejado × realizado por viagem (custo, prazo, ocupação, margem)
- [ ] C2 Faturamento ligado ao frete calculado (sem digitação manual)
- [ ] C3 Acerto Hub/Link com máquina Em aberto → Solicitado → Conferido → Aceito → Pago

### Etapa D — Painel do Link (opcional, ver #5/#24)
- [ ] Viagem no app do motorista, check-in, comprovante, ganhos

### Etapa E — Corte do Lonngren por rota (prazo: aposentadoria em 2027)
- [ ] Inventário do que o scraper traz; shadow (OMNI espelha) → paridade medida → corte da rota piloto

### Etapa F — Orquestrador v0 (L2)
- [ ] Sugestões com justificativa (próximo salto, agrupamento, link elegível, risco de prazo); aceitar/alterar vira dado

### Pré-produção (gate de go-live)
- [ ] Cifrar `LLMApiKey.apiKey` (AES-256-GCM)
- [ ] Guard `NODE_ENV` no seed
- [ ] Revisar JWT, rate limiting, logs estruturados, health checks reais

### Regras de execução
- Uma etapa/item por vez; **nada avança porque o software ficou pronto** — avança com uso real e ganho medido.
- Arquivos novos do O.S. ≤ ~300 linhas; O.S. não importa páginas/abas legadas.
- Toda tela nova passa no contrato de estação (#21) e no teste de conformidade da teia (§2.3).

---

## 10. Glossário

| Termo | Significado |
|-------|-------------|
| **Hub** | Nó da teia: recebe, confere, estoca, consolida, despacha, pode entregar. Qualquer porte. |
| **Link** | Transportador (motorista/PJ). Pool fixo de confiança. |
| **Manifesto / Viagem** | Agrupa 1+ pedidos num veículo. TRANSFER (entre hubs) ou DELIVERY (entrega). |
| **Demanda** | Oportunidade pré-posse. Vira pedido ao entrar em posse. |
| **Pedido** | Carga física em nossa posse. Fonte única do estado físico. |
| **Perna** (`OrderLeg`) | Um trecho da jornada = pedido viajando num manifesto. Unidade de custo. |
| **Parada** (`ManifestStop`) | Uma descarga real dentro de uma viagem. |
| **Cobertura** (`HubCoverage`) | Tabela de roteamento: cidades que o hub atende como próximo salto. |
| **Próximo salto** | O hub para onde o pedido deve ir a partir daqui; decidido localmente pela cobertura. |
| **Estação** | Tela organizada por trabalho: pergunta, fila, ação primária, evento. |
| **TSM O.S.** | A superfície operacional nova (`/#/hubs`), organizada por estações. |
| **Torre** | Supervisão/configuração (admin): cobertura, permissões por hub, aprendizado. |
| **Carta Frete** | Valor real acordado com o Link para a viagem. Fonte oficial de custo. |
| **Custódia** | Onde a carga está agora. Derivada, nunca solta. |
| **Load factor** | % de ocupação do veículo. Direciona a margem. |
| **`ConsolidationFeedback`** | Registro sugerido × final de cada consolidação. Corpus de treino da IA. |
| **Régua L0–L4** | Níveis de autonomia do sistema, subidos por rota e por gatilho medido. |

---

*Documento vivo. Toda decisão nova entra aqui com o porquê.*
