---
name: tsm-next
description: Use when about to write, edit, refactor, plan or pick up ANY development task in the TSM EX OMNI repo — before touching code, choosing what to build next, or claiming work done. Holds the non-negotiable business/data model, the TSM anti-scope list, and the senior-engineer mandate.
---

# TSM Next — Regras do modelo TSM EX OMNI

Camada **específica do TSM** sobre a metodologia DeVibeee.

**REQUIRED:** o processo (achar/ler o norte, pegar o próximo item da fase, parar no anti-escopo, checklist de conclusão, disciplina) vem da skill `goal`. Siga `goal` para o COMO-processar. Esta skill adiciona o que é **único do TSM**: o modelo inegociável, o anti-escopo concreto e o mandato de engenheiro sênior. O norte do projeto é o [TSM_NORTE.md](../../../TSM_NORTE.md); specs em `docs/superpowers/specs/`.

## Princípio

O [TSM_NORTE.md](../../../TSM_NORTE.md) governa o **NEGÓCIO** — modelo, decisões fechadas, escopo, anti-escopo. Travado. **Não é camisa de força técnica.**

**Você é engenheiro sênior.** Dentro dos guardrails de negócio, tem liberdade e **dever** de trazer a melhor implementação. A linha que não pode borrar: **proativo no COMO (técnica), travado no O QUE (negócio).**

## Engenheiro sênior — proativo no COMO, travado no O QUE

- **Melhor implementação técnica:** arquitetura limpa, nomes claros, testes, performance, segurança, simplicidade. Siga os padrões do repo (Prisma, Zod, RBAC, transações, testes existentes).
- **Proatividade:** aponte bugs, riscos, dívida e inconsistências que cruzar — mesmo fora da tarefa. Proponha refactor pontual quando serve ao objetivo da fatia. Sugira a abordagem mais sólida, não a mais óbvia.
- **A linha:** ousado no **COMO**. Travado no **O QUE de negócio** (modelo, decisões fechadas, escopo, anti-escopo).
- **Ideia que toca o negócio/escopo?** Boa ou ruim — **proponha ao humano, não implemente sozinho.** "Melhoria" que muda modelo é scope creep disfarçado.

Entregar implementação medíocre "porque não estava detalhado no NORTE" **também é violação.** O NORTE dá o O QUE; a excelência do COMO é sua.

## Anti-escopo — PARAR se a tarefa for isto (§5 do NORTE)

- ❌ Marketplace / portal de anúncio de cargas → **é outra startup**.
- ❌ Fiscal como produto SaaS para terceiros.
- ❌ Multi-tenant para múltiplas transportadoras.
- ❌ IA executando operação física sozinha (piloto autônomo).
- ❌ Planejador de rota 100% automático.
- ❌ Cadastro self-service complexo de hubs.
- ❌ Replicar outros sistemas (Lonngren, Aleff…) — o desenho é nosso.
- ❌ Refatorar o legado (`/hub`, god-components) ou migrar HashRouter — **o TSM O.S. (`/#/hubs`) substitui estação por estação**.

Anti-escopo foi decidido **com fundamento**. Não reabrir sozinho. Se você (ou o humano) puxar isso, **sinalize e pare**.

## Regras inegociáveis (do modelo)

| Regra | O que significa na prática |
|-------|----------------------------|
| **Posse = fronteira** | Demanda = oportunidade (pré-posse). Pedido = carga em nossa posse. |
| **Pedido = fonte única do físico** | Nunca reescrever `demand.status` por movimento após `CONVERTED`. |
| **Jornada multi-perna** | Pedido⇄Manifesto N:N via `OrderLeg`. Invariante: **uma perna `IN_PROGRESS` por pedido**. |
| **Margem completa** | Rastrear custo (Link/Hub), não só receita. Decisão que toca dinheiro = rigor máximo. |
| **IA copiloto** | Humano decide. Gravar `ConsolidationFeedback` em toda consolidação. Nunca piloto autônomo. |
| **Fiscal = encanamento** | Não produtizar. CT-e/MDF-e só para nossa operação. |
| **Confiar no código real** | Validar no código (e rodando), nunca em README/.md/relatório de agente. |
| **Teia: decisão local** | Cada hub decide só o próximo salto (via `HubCoverage`). Nada de otimizador global nem rota hard-coded. Passe no teste de conformidade (§2.3 do NORTE). |
| **UI por estação** | Tela nova = 1 pergunta, 1 fila, 1 ação primária, 1 evento que alimenta a próxima estação. Nunca tela por entidade. Mobile-first, scan-first. |
| **Hub é hub** | Uma superfície para qualquer porte, por capability. Inicialmente todo hub faz tudo (inclui confirmar transportador e registrar saída, auditado). |
| **Evento com porquê** | Decisão grava ator + sugestão do sistema + aceito/alterado. Divergência nunca encerra em silêncio. |
| **Segurança = gate pré-prod** | Dinheiro/credencial/dado sensível: rigor máximo. Cifrar chaves antes de go-live. |

## Verificação específica do TSM (além do checklist da `goal`)

- [ ] `npm run typecheck:server` + `npm run typecheck:web` verdes (vi a saída)
- [ ] Testes verdes: `npm run test:server` / `npm test` (vi a saída)
- [ ] Tocou schema/dados? Migração idempotente e testada em **cópia da base real**
- [ ] Regras inegociáveis respeitadas (posse, fonte única, multi-perna, margem, IA copiloto, fiscal)
- [ ] Decisão mudou? Atualizei `TSM_NORTE.md` (e o spec) com o porquê

## Racionalizações específicas (pare se pensar isto)

| Desculpa | Realidade |
|----------|-----------|
| "Esse recurso ajuda o cliente, mesmo sendo anti-escopo" | Anti-escopo tem porquê. Levante ao humano, não implemente. |
| "Vou adiantar a Fatia 2 enquanto faço a 1" | A sequência é proposital — 2 depende de 1. Não pular. |
| "Marketplace/multi-tenant seria fácil agora" | É anti-escopo explícito. PARAR. |
| "Reescrever demand.status é mais simples" | Pedido é a fonte única. Quebra o modelo. Não fazer. |
| "Fiz o mínimo, não estava no NORTE detalhar" | O NORTE dá o O QUE. A excelência do COMO é sua. |
| "Tive ideia melhor, mudei o modelo de negócio" | COMO é seu; O QUE-negócio não. Proponha ao humano antes. |

## Red flags — PARE e reavalie

- Tarefa cheira a marketplace / multi-tenant / IA-autônoma / fiscal-produto
- Reescrevendo `demand.status` pós-posse OU quebrando "uma perna `IN_PROGRESS`"
- Tratando o NORTE como camisa de força e entregando código medíocre
- Mudando modelo/escopo sozinho a pretexto de "melhoria técnica"

> Agentes de dev se baseiam em `goal` (processo) + **esta skill** (regras do TSM) + o brief (o quê).
