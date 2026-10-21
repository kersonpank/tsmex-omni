# TSM O.S. — Desenho das estações do hub

**Data:** 2026-10-20 · **Norte:** `TSM_NORTE.md` §2 (Teia e Roda), §4 (#21–#27), §7, Etapa A.
**Superfície:** `/#/hubs` (módulo `components/os/`). Mobile-first, scan-first, por capability; inicialmente todo hub faz tudo.

## Contrato de estação (vale para todas)

| Elemento | Regra |
|---|---|
| Pergunta | Uma só, em linguagem do operador |
| Fila | "O que precisa de mim agora", ordenada por urgência/idade — nunca lista de cadastro |
| Ação primária | Um botão dominante (faixa amarela, fixo ao alcance do polegar) que conclui o item |
| Evento | Ao concluir, grava evento com ator (e porquê, quando é decisão) e o item **aparece sozinho** na fila da próxima estação |
| Exceção | Divergência nunca encerra em silêncio: exige reconhecimento e vira evento |
| Orçamento | Toques por tarefa definidos e medidos |

O O.S. **não importa páginas/abas legadas**. Usa o backend existente. Onde um dado é de **cadastro** (dados fiscais do
veículo/motorista, RNTRC, endereços), a estação mostra a pendência em linguagem simples e, até existir versão O.S.,
abre o cadastro — isso é correção de cadastro (uma vez por link/motorista), não etapa do fluxo da viagem.

## A roda do hub

```
Entrada ─┐
Receber ─┴─▶ Pedido: Etiquetas + Documento do frete (CT-e/minuta) ─▶ Viagem (volumetria, carregamento por volume)
                                                                         └─▶ Preparar e despachar (MDF-e/CIOT) ─▶ (outro hub: Receber)
                                                                                                                  └─▶ Entregar ─▶ Comprovado
Exceções: transversal a todas · Aprendizado: torre
```

---

### 1. Hoje ✅
- **Pergunta:** o que precisa de mim agora?
- **Fila:** contadores que levam às filas (chegando, aguardando entrada, estoque sem viagem, triagem) + chegadas em rota.
- **Ação:** tocar leva à estação. Sem ação própria.

### 2. Receber ✅
- **Pergunta:** o que chegou e confere?
- **Fila:** viagens `IN_PROGRESS` com descarga pendente neste hub (parada ou destino).
- **Ação primária:** conferir pedido a pedido (Chegou / Avaria / Não chegou) → "Confirmar recebimento".
- **Evento:** divergência → `OrderHistory` NOTE com ator; parada/viagem concluída → pedidos `AT_HUB` aqui.
- **Próxima:** pedidos entram em Estoque e, por consequência, na fila de Consolidar.
- **Orçamento:** ≤ 6 toques para uma chegada sem divergência.

### 3. Entrada ✅
- **Pergunta:** o que está chegando no balcão e o que falta para virar pedido?
- **Fila:** bucket `awaiting` (NF-e descoberta / coleta anunciada).
- **Ação primária:** "Confirmar entrada" em 1 toque quando a NF-e já resolveu remetente/destinatário.
- **Pendente (A9):** completar partes quando a NF-e não resolve, sem sair do O.S.

### 4. Estoque e etiquetas ✅
- **Pergunta:** o que tenho aqui e está identificado?
- **Fila:** bucket `stock`, busca e scan (`/hub/cargo/resolve`).
- **Ação primária:** "Imprimir etiquetas" — uma por volume (VOL n/N), QR = número do pedido (resolvível no scan).

### 5. Consolidar ✅
- **Pergunta:** o que está pronto para viajar e para onde?
- **Fila:** `GET /hub/cargo/queues` — pedidos `AT_HUB` sem viagem ativa agrupados por **próximo salto**
  (TRANSFER → hub destino | LOCAL | UNROUTED). Agregados: pedidos, kg, m³, idade do mais antigo.
  UNROUTED fica visível em vermelho (buraco de cobertura).
- **Ação primária:** "Criar viagem com N pedidos" (escolher pedidos — todos por padrão — e tipo de veículo com "cabe/não cabe").
- **Evento:** `ConsolidationFeedback` com **sugerido (fila) × final (escolhido)**, ACCEPTED se igual, MODIFIED se alterado.
- **Próxima:** a viagem abre direto em **Preparar e despachar** (no O.S.).

### 6. Preparar e despachar (A5 — em construção)
- **Pergunta:** o que falta para esta viagem sair?
- **Rota:** `/#/hubs/viagens/:id`.
- **Cabeçalho:** origem → destino, situação em linguagem simples, ocupação (kg e m³ contra a capacidade).
- **Fila de pendências** (vem do `manifestReadinessService`, traduzida em grupos com uma ação cada):

  | Grupo | Pendências do motor | Ação na estação |
  |---|---|---|
  | Saída prevista | `DEPARTURE_REQUIRED`, `ARRIVAL_BEFORE_DEPARTURE` | campo de data/hora inline |
  | Responsável | `LINK_REQUIRED`, `LINK_NOT_APPROVED`, `DRIVER_*` (seleção) | folha: escolher transportador aprovado → motorista |
  | Carta Frete | `FREIGHT_AGREEMENT_REQUIRED` | folha: frete bruto (pré-preenchido pela estimativa), pedágio, adiantamento |
  | Emitente fiscal | `FISCAL_EMITTER_PENDING` (aviso) | seleção inline |
  | Cadastro | dados fiscais de veículo/motorista/RNTRC/endereços | mensagem simples + "Abrir cadastro" (transitório) |
  | Documentos | `CTE_AUTHORIZATION_REQUIRED`, `MDFE_*`, `CIOT_REQUIRED` | MDF-e: emitir aqui; CT-e/CIOT: transitório até A7 |
  | Carga | `ORDER_REQUIRED`, pedidos da viagem | lista; adicionar por scan; remover em rascunho |

- **Ação primária (muda com o estado):**
  - Rascunho e sem bloqueios → **"Confirmar transportador"** (o hub confirma em nome do Link: oferta + aceite, decisão #24).
  - Aguardando aceite → **"Confirmar pelo transportador"**.
  - Confirmada e sem bloqueios → **"Registrar saída"** (km opcional). A partir de A6, exige carregamento conferido ou reconhecimento da divergência.
  - Em rota → sem ação; o hub destino recebe na estação Receber.
- **Evento:** confirmação e saída gravam `OrderHistory` com **ator** e a indicação "pelo hub, em nome do transportador".
- **Regra de backend:** `PATCH /manifests/:id/accept` e `/start` aceitam também ADMIN e HUB dono da origem;
  `LINK_ACCESS_PENDING` deixa de bloquear (vira aviso), pois o hub pode operar a viagem.
- **Orçamento:** com cadastro em dia, da fila à saída ≤ 12 toques.

### 7. Viagem pela volumetria e carregamento por volume (A6, A6.1)
- **Viagem:** o estoque documentado em 3D (peso/m³) por destino; várias rotas no mesmo veículo; o sistema mostra quando
  precisa de mais um veículo. Só entra pedido conferido, em estoque e com documento do frete (NORTE #30, #36).
- **Carregamento:** QR por volume; conferência antes da saída (esperado × conferido); faltou/sobrou → reconhecimento
  obrigatório → exceção com dono. Doca offline-first (NORTE #35).

### 8. Documento do frete — no pedido (A7a ✅) e da viagem (A7b)
- **Pergunta:** este pedido tem CT-e/minuta?
- **Onde:** página do pedido (`/#/hubs/pedidos/:id`), logo depois da entrada e das etiquetas; fila `/#/hubs/documentos`
  ("Sem CT-e/minuta") para o lote.
- **Sugestão do sistema:** pagador (da NF-e `modFrete` ou informado na entrada), tipo (CT-e com NF-e; minuta sempre
  possível), emitente do hub, preço (especial do pagador → geral da rota → geral → informado), pendências do preflight com
  quem resolve (cadastro da parte aqui; emitente/hub na torre; CFOP/CST quando o emitente não tem padrão).
- **Ação primária:** "Emitir CT-e · R$ X" — prepara sem duplicar (trava por pedido) e emite (CAS); acompanha a SEFAZ;
  imprime DACTE/minuta.
- **Evento:** documento emitido → pedido "pronto para viajar"; frete informado e troca de pagador gravam ator e motivo.
- **Viagem (A7b):** MDF-e e CIOT (emitir ou **dispensar com motivo**) sem sair do O.S.

### 9. Entregar (A8)
- **Pergunta:** o que sai hoje para entrega e como comprovo?
- **Fila:** viagens DELIVERY do hub e suas paradas; **ação:** registrar tentativa (`DeliveryAttempt`: entregue / parcial /
  falhou + evidência + próxima ação).

### 10. Exceções (A10, transversal)
- Uma fila: divergências, falhas de entrega, encerramento fiscal pendente (`SystemAlert`). Cada item com dono, prazo, desfecho.

### 11. Aprendizado (Etapa C, torre)
- Planejado × realizado por viagem (custo, prazo, ocupação, margem) a partir do backend de margem existente.

## Testes
- Lógica pura de cada estação em `components/os/lib/*` com testes (padrão já usado em `arrival.ts`, `cargo.ts`).
- Backend: serviços puros com `node:test` (padrão `consolidationQueue.test.ts`); rotas novas com checagem de papel/dono.
- Campo: uma viagem real GRU → Imperatriz percorrendo Consolidar → Preparar → Receber, medindo toques e minutos.
