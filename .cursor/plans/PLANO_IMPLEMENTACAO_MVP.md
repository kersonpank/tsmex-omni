# Plano de Implementação MVP – TSM EX Omni

> Documento liberado para implementação. Executar as fases na ordem indicada.

---

## Resumo Executivo

**Objetivo:** Fechar gaps do painel de gestão (`/gestao`) para que o fluxo operacional e as permissões Hub funcionem de ponta a ponta.

**Arquitetura:** Admin e Hub usam o mesmo painel; a diferença são as permissões que o Admin concede a cada operador Hub.

**Esforço total estimado:** 7–10h

---

## Fase 1 – Correções Rápidas (Base) | ~30min

| # | Tarefa | Arquivo | Critério de aceite |
|---|--------|---------|--------------------|
| 1.1 | **Fallback de permissions** – Usar `user?.profile?.hub?.permissions ?? user?.permissions ?? []` | AdminDashboard.tsx L56 | Hub com permissions vazias ou no profile vê o menu correto |
| 1.2 | **PersonAutocomplete onFocus** – Ao focar, se `inputValue.trim().length >= 2`, chamar `search(inputValue)` | PersonAutocomplete.tsx L144 | Ao focar em campo com texto digitado, dropdown reabre |
| 1.3 | **FaturasTab labels** – Alinhar status com schema: PENDING, PAID, OVERDUE, CANCELLED | FaturasTab.tsx | Labels na tabela refletem o schema do banco |

---

## Fase 2 – Fluxo Operacional (Crítico) | ~3–4h

| # | Tarefa | Arquivo | Critério de aceite |
|---|--------|---------|--------------------|
| 2.1 | **PedidosTab – Ações de status** – Botões: "Chegou no hub" (IN_TRANSIT→AT_HUB), "Saiu para entrega" (AT_HUB→OUT_FOR_DELIVERY), "Entregue" (OUT_FOR_DELIVERY→DELIVERED). Usar `ordersApi.updateStatus`. Para "Chegou no hub": Admin escolhe hub em dropdown; Hub usa `user.hubId` | PedidosTab.tsx | Operador consegue avançar status do pedido |
| 2.2 | **ManifestsTab – Iniciar/Concluir** – Botões "Iniciar viagem" e "Concluir viagem". Chamar `manifestsApi.start` e `manifestsApi.complete` | ManifestsTab.tsx | Viagem pode ser iniciada e concluída |
| 2.3 | **FaturasTab – Ações básicas** – Botão "Marcar como paga" (PENDING→PAID) | FaturasTab.tsx | Admin pode marcar fatura como paga |

---

## Fase 3 – Permissões Hub (Admin define o que Hub vê) | ~2–3h

| # | Tarefa | Arquivo | Critério de aceite |
|---|--------|---------|--------------------|
| 3.1 | **Checkboxes de permissions** – Ao adicionar usuário ao hub, checkboxes: `entrada`, `pedidos`, `manifestos`, `demandas` | HubsTab.tsx, PessoasTab.tsx (AddHubModal) | Admin marca permissões; backend persiste |
| 3.2 | **Listar usuários do hub** – Mostrar usuários vinculados ao hub e permitir editar permissions (PATCH /users/:id/permissions) | HubsTab.tsx | Admin vê usuários do hub e altera permissões |

---

## Fase 4 – Melhorias de UX | ~1–2h

| # | Tarefa | Arquivo | Critério de aceite |
|---|--------|---------|--------------------|
| 4.1 | **Link para tracking** – Botão "Ver tracking" → `/tracking/:orderId` ou `/tracking/:demandId` | PedidosTab.tsx | Usuário acessa tracking pela lista de pedidos |
| 4.2 | **Expedidor/Redespachante – showAddClientHint** (opcional) – Paridade com Remetente/Destinatário | EntradaTab.tsx | Mesma dica de "adicionar como Cliente" |

---

## Arquivos Envolvidos

| Componente | Arquivo |
|------------|---------|
| Painel Gestão | components/AdminDashboard.tsx |
| Pedidos | components/admin/PedidosTab.tsx |
| Viagens | components/admin/ManifestsTab.tsx |
| Faturas | components/admin/FaturasTab.tsx |
| Hubs | components/admin/HubsTab.tsx |
| Pessoas | components/admin/PessoasTab.tsx |
| PersonAutocomplete | components/ui/PersonAutocomplete.tsx |
| Entrada | components/admin/EntradaTab.tsx |

---

## Fora do Escopo MVP

- Sub-aba Usuários do sistema em Pessoas
- ClientesTab – edição (manter fluxo via PessoasTab)
- Demandas – filtros e paginação
- MotoristasTab – editar motorista
- FaturasTab – criar fatura, PDF

---

*Documento gerado em 19/02/2026. Referência: ANALISE_ADMIN_COMPLETA.md*
