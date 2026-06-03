---
name: goal
description: Use SEMPRE que perguntarem "qual a próxima implementação", ao planejar, priorizar ou implementar qualquer feature, ou ao receber um brief de desenvolvimento neste projeto. Ancora a decisão no documento-norte do projeto (o plano/fonte da verdade), garante que o trabalho pertence à fase atual e respeita o anti-escopo. Use mesmo que o pedido pareça simples.
---

# goal — Foco no Norte do projeto

Skill da metodologia DeVibeee. Garante que toda implementação siga o **documento-norte** do
projeto (a fonte única da verdade) e que o trabalho avance na ordem certa, sem inflar escopo.

> Projetos podem ter uma camada específica (ex.: `tsm-next` no TSM EX OMNI) com regras de modelo
> e anti-escopo próprios. Quando existir, leia-a também: `goal` dá o processo, a camada do
> projeto dá as regras inegociáveis daquele negócio.

## Passo 0 — Ache e leia o norte (sempre, antes de tudo)

Procure na raiz do projeto o documento-norte. Nomes comuns: `*_NORTE.md`, `NORTE.md`,
`PLANO*.md`, `PLAN.md`. Se houver mais de um candidato, use o mais específico do projeto.
**Leia-o inteiro.** Não confie em memória — o norte evolui a cada decisão.

Se não existir norte, **pare e avise**: "Este projeto ainda não tem documento-norte. Antes de
implementar, precisamos defini-lo (visão, decisões, modelo, roadmap por fases, anti-escopo)."

## Quando perguntarem "qual a próxima implementação?"

1. Abra o **Roadmap por fases** do norte. Ache a primeira fase com itens `[ ]` (não concluídos).
2. Pegue o **primeiro `[ ]` da fase atual**, na ordem. Não pule itens nem fases.
3. Responda com: (a) o item exato, (b) por que é o próximo, (c) o que ele toca (entidades,
   endpoints, telas), (d) critério de "pronto".
4. Se o item depende de algo não feito, sinalize a dependência primeiro.

## Quando receber um brief para implementar

1. Leia o norte (Passo 0).
2. Confirme que o brief **pertence à fase atual** (ou à fundação). Se for de fase futura, avise
   e proponha o item correto da fase atual.
3. Cheque o brief contra o **anti-escopo** do norte. Se violar, **PARE** — não implemente.
   Explique qual regra viola e ofereça a alternativa alinhada.
4. Implemente seguindo as **regras inegociáveis** do norte (modelo de negócio, segurança,
   dinheiro). Não invente além do brief.

## Regras de disciplina (valem em todo trabalho relevante)

- **O norte manda no O QUE.** Conflito entre pedido e norte → o norte vence; sinalize o conflito.
- **Um item por vez.** Não avance para o próximo sem concluir e validar o atual.
- **Dinheiro e segurança são sagrados.** Fluxos com dinheiro usam guarda de concorrência
  (compare-and-swap, idempotência); segredos nunca vazam em API/log; dados sensíveis fora de
  telemetria.
- **Escopo enxuto.** Bloqueie complexidade prematura. "Já que estamos aqui…" é red flag.

## Checklist de verificação ao concluir (autoauditoria antes de devolver)

- [ ] Build/typecheck limpo; sem drift de migração (se houver banco).
- [ ] Nenhum dado sensível/segredo/economia vaza em rota pública.
- [ ] Fluxos de dinheiro: 2 chamadas concorrentes → 1 efeito só (sem duplicar).
- [ ] O fluxo funciona rodando o app (não só compila) — quando houver UI.
- [ ] Marque `[x]` no item do roadmap e referencie o commit.
- [ ] Decisão nova ou mudança de plano → **atualize o norte** (e a skill, se for regra).

## Red flags (pare e reconsidere)

- "É só uma adição simples, não preciso ler o norte." → Leia. Sempre.
- "Isso é de outra fase, mas já faço aproveitando." → Não. Fase atual primeiro.
- "Compilou, está pronto." → Compilar ≠ funcionar. Valide o fluxo real.
- "O pedido contradiz o norte, mas é o que pediram." → Sinalize o conflito antes de codar.
