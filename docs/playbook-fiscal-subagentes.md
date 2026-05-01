# Playbook: subagentes em integração fiscal (TSM EX)

Use este roteiro em tarefas grandes que cruzem **API fiscal (ACBr)**, **Prisma/jobs** e **telas de gestão** (`/gestao`), para reduzir conflitos de merge e acelerar revisão.

## Quando paralelizar

Paralelize quando a entrega envolver **mais de ~5 arquivos** entre `server/src` e `components/admin` (ou equivalente), especialmente se houver:

- novos endpoints ou alteração de contratos Zod;
- enums Prisma / migração;
- labels de produto (“Minuta e Doc Fiscal”, CT-e vs DC-e);
- fluxos de manifesto (MDF-e, CIOT placeholder).

## Trilha A — Fiscal / backend

| Escopo | Exemplos |
|--------|----------|
| Serviços | `server/src/services/acbr/*`, `cteService`, `dceService`, `freightEmission`, `ciotService` |
| Rotas | `server/src/routes/freightCalculations.ts`, `fiscalDistribuicao.ts`, `manifests.ts`, `orders.ts` |
| Dados | `server/prisma/schema.prisma`, migrações, checkpoints DF-e |

**Entregáveis:** contratos HTTP estáveis, persistência de chave/XML/status, tratamento de erros SEFAZ/ACBr, testes de serviço onde couber.

## Trilha B — Gestão / frontend

| Escopo | Exemplos |
|--------|----------|
| Cálculo de frete / pedido | `components/admin/OrderFreightCalculationSection.tsx` |
| Viagens | `components/admin/ManifestsTab.tsx` |
| API cliente | `lib/api.ts`, `types/index.ts` |
| Identidade / emitentes | `components/admin/IdentidadeVisualTab.tsx` |

**Entregáveis:** UX alinhada à regra **CT-e (com NF-e)** vs **DC-e (declaração sem NF-e completa)**, feedback de rejeição, estados de badge e bloqueio de edição.

## Regras de coordenação

1. **Um dono por arquivo** quando possível; se dois agentes precisam do mesmo arquivo, sequencie ou divida por commit pequeno.
2. **Tipos compartilhados primeiro** (`types/index.ts`, `lib/api.ts`) ou combinar ordem explícita na tarefa.
3. **Variáveis de ambiente** documentadas em `server/.env.example` na mesma sprint que a feature.
4. **Não misturar** spike de CIOT com fluxo crítico de CT-e/MDF-e na mesma PR, salvo alterações mínimas de placeholder.

## Referência de negócio (resumo)

- **Onda 1:** CT-e real + Distribuição DF-e + infra ACBr.
- **Onda 2:** DC-e + modelo/UX “Doc Fiscal”.
- **Onda 3:** MDF-e no manifesto.
- **Onda 4+:** CIOT / compliance (validação jurídica antes de escopo definitivo).
