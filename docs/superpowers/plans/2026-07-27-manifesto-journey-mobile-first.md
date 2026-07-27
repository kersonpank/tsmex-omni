# Jornada de criação de Viagem e Manifesto, mobile-first

**Data:** 2026-07-27
**Status:** implementada
**Registro:** product
**Direção:** Torre Serena, operação clara sob pressão
**Superfícies:** ADMIN e HUB, com componente compartilhado e permissões por capacidade

### Premissas operacionais confirmadas

- o Manifesto registra uma viagem, não gera uma rota de entregas;
- o destino principal é informado manualmente;
- múltiplos destinos de pedidos não criam paradas;
- a origem começa com o Hub atual, mas pode ser trocada;
- coleta é um marcador independente da natureza da viagem;
- percurso/paradas são opcionais no MVP e existem principalmente para necessidades operacionais e do MDF-e;
- Link é a identidade operacional de quem executa a viagem no app;
- Driver guarda os dados fiscais de motorista ligados a esse mesmo responsável;
- liberação e observações ficam recolhidas em `+ Dados opcionais`.

## 1. Resultado esperado

Transformar a criação de Viagem em um rascunho persistente, guiado por etapas derivadas do próprio domínio. Cada etapa:

- mostra o que já foi concluído;
- explica o que falta;
- libera a próxima etapa quando os pré-requisitos reais forem satisfeitos;
- continua editável enquanto a viagem estiver em planejamento;
- salva antes de qualquer navegação externa;
- reutiliza dados canônicos já existentes;
- oferece cadastro contextual e retorna ao mesmo Manifesto, na mesma etapa, com o novo registro selecionado quando permitido.

O envio da oferta ao Link será uma ação final explícita. Selecionar o responsável operacional no app e completar seus dados fiscais de motorista não deve, por si só, mudar o status ou bloquear o planejamento.

## 2. Evidências do fluxo atual

### HUB

O modal `ManifestModal` em `components/operacao/HubHome.tsx`:

- deriva `origin` apenas do primeiro pedido selecionado;
- concatena destinos de pedidos numa única string, sem permitir ao operador definir manualmente o destino real da viagem;
- renderiza origem e destino como `readOnly`;
- permite abrir uma viagem vazia, mas deixa os dois campos vazios e impossíveis de preencher;
- pede tipo de veículo antes de mostrar qualquer sugestão de capacidade;
- mistura criação, inclusão sequencial de pedidos e atribuição de Link em uma submissão;
- usa `window.alert` quando uma chamada intermediária falha;
- chama `assignLink` logo após criar, ação que já envia a oferta e muda o status.

### ADMIN

`components/admin/ManifestsTab.tsx` possui `CityAutocomplete`, mas:

- Hub origem, Hub destino, origem textual e destino textual pedem informação parcialmente duplicada;
- escolher um Hub não preenche automaticamente sua cidade;
- depois de criar, a tela fecha o formulário e recarrega a lista, sem abrir o Manifesto criado;
- não existe edição da rota base, tipo de viagem ou tipo de veículo no detalhe;
- a jornada de criação e a jornada do HUB são implementações diferentes.

### Detalhe compartilhado

`components/manifest/ManifestDetailPage.tsx` mostra seis accordions sem modelo explícito de progresso:

- Pedidos;
- Paradas;
- Capa da viagem;
- Motorista;
- Carta Frete;
- Fiscal.

O booleano `canEditOrders` é reutilizado para Pedidos, Paradas, Capa e atribuição de Link. Como depende de `status === DRAFT`, a interface esconde edição da Capa após a oferta, embora o backend permita editar Capa até a viagem ser concluída ou cancelada.

Não existem endpoints para:

- editar a configuração base da Viagem;
- editar, remover ou reordenar paradas;
- selecionar Link sem enviar oferta;
- validar prontidão antes da oferta;
- retirar uma oferta e reabrir o planejamento.

### Domínio e fiscal

- A origem de uma nova viagem criada pelo HUB deve iniciar preenchida com o Hub atual, mas continuar editável.
- O destino principal é uma decisão manual do operador. Destinos diferentes dos pedidos não geram paradas nem definem a rota automaticamente.
- O manifesto não é um roteirizador de entregas. Ele representa uma viagem que pode ser transferência entre filiais/Hubs, entrega direta, transferência seguida de entrega ou uma viagem iniciada por coleta.
- Paradas ou pontos de percurso são opcionais no MVP e servem principalmente para registrar trajetos longos e os dados necessários ao MDF-e.
- `ManifestFreightAgreement` é a fonte oficial do custo real quando existir.
- CIOT e MDF-e pertencem ao Manifesto.
- Dados fiscais de origem, destino e percurso devem vir da rota informada, do Hub e das cidades selecionadas. Pessoas e pedidos continuam como fonte dos dados da carga e das partes fiscais, evitando novo preenchimento manual.
- Encerramento fiscal continua best-effort e não bloqueia a conclusão operacional.

## 3. Avaliação heurística atual

**Usabilidade geral:** 4,2 de 10.

| Problema | Severidade | Motivo |
|---|---:|---|
| Viagem vazia no HUB gera origem/destino vazios e bloqueados | 4 | Impede concluir a tarefa |
| Origem usa a origem original do pedido em vez de sugerir o Hub atual | 4 | Pode registrar uma viagem logisticamente incorreta |
| Destino é inferido dos pedidos e fica bloqueado | 4 | Retira do operador a decisão sobre o destino real da viagem |
| Selecionar Link envia oferta e bloqueia edição | 3 | Transição de estado acontece antes da revisão |
| Criação depende de várias chamadas sequenciais e pode ficar parcial | 3 | Usuário precisa reconstruir o que funcionou |
| Etapas não indicam concluído, pendente ou bloqueado | 3 | Aumenta carga cognitiva e erro |
| Rota base e veículo não podem ser editados no detalhe | 3 | Obriga abandonar ou recriar a viagem |
| Cidades já informadas na rota, percurso e CIOT voltam a ser digitadas | 3 | Duplica dados e aumenta erro fiscal |
| Cadastro contextual não retorna ao ponto de origem | 3 | Quebra o loop de trabalho |
| Modal de criação ocupa uma superfície extensa sem ser uma tarefa curta | 2 | Dificulta leitura e navegação no mobile |
| Link e Driver aparecem como atores independentes | 2 | Na operação atual são duas representações do mesmo responsável: acesso ao app e dados fiscais |
| Usuários com ADMIN e HUB podem ser tratados como HUB por presença de role | 2 | Capacidade depende da lista de papéis, não do workspace ativo |

## 4. Modelo de progresso

O progresso não será persistido como checkboxes soltos. Será calculado a partir dos dados reais por um serviço compartilhado de prontidão.

```text
Rota e veículo
  -> Pedidos e capacidade
  -> Percurso e paradas, quando necessário
  -> Capa e programação
  -> Responsável pela viagem
  -> Carta Frete
  -> Revisão e oferta
  -> Documentos e execução
```

Cada etapa recebe um estado:

- `complete`: requisitos satisfeitos;
- `current`: próxima ação recomendada;
- `attention`: existe dado, mas há conflito ou pendência;
- `locked`: pré-requisito anterior ausente;
- `read_only`: status operacional não permite alteração estrutural.

Etapa bloqueada permanece visível. Ela informa o motivo e oferece ação para ir ao pré-requisito. Nada importante desaparece silenciosamente.

## 5. Etapas propostas

### Etapa 1: Rota e veículo

**Objetivo:** criar o rascunho com a estrutura mínima necessária para validar capacidade.

Campos:

- tipo de viagem em controle segmentado, sem tentar gerar a rota:
  - Transferência entre filiais/Hubs;
  - Entrega direta;
  - Transferência + entrega;
- marcador independente `Esta viagem começa com uma coleta`;
- unidade responsável:
  - no workspace HUB, usa o Hub atual para permissão, custódia e gestão;
  - no ADMIN, é pesquisável;
- origem:
  - preenchida inicialmente com a cidade/UF da unidade responsável;
  - sempre editável por `CityAutocomplete`;
  - ação `Trocar origem` permite selecionar outro Hub/filial ou uma cidade externa sem confundir isso com a unidade responsável;
  - quando `Esta viagem começa com uma coleta` estiver marcado, o rótulo passa a ser `Local de coleta` e aceita Hub, filial ou cidade externa;
- destino:
  - sempre definido manualmente pelo operador;
  - Transferência: pode escolher Hub/filial destino e derivar cidade, UF e IBGE;
  - Entrega direta: escolher cidade por `CityAutocomplete`;
  - Transferência + entrega: informar o Hub de transferência e o destino final sem inferir ambos pelos pedidos;
  - destinos dos pedidos podem aparecer apenas como referência, nunca preencher ou bloquear o campo automaticamente;
- tipo de veículo:
  - lista pesquisável;
  - sugestão baseada no peso e volume dos pedidos pré-selecionados;
  - mostra capacidade de peso, volume e valor;
- resumo de rota:
  - `HUB Imperatriz, Imperatriz/MA -> HUB São Luís, São Luís/MA`;
  - sem campos duplicados de origem e destino.

Conclusão:

- rota operacional válida;
- quando origem e destino forem Hubs/filiais, eles precisam ser diferentes em transferência;
- origem e destino selecionados de fonte válida;
- local de coleta válido quando o marcador estiver ativo;
- tipo de veículo ativo.

Ao concluir, `POST /manifests` cria o `DRAFT` e redireciona para `/manifests/:id?step=orders`.

Edição:

- livre em `DRAFT`;
- se alterar veículo, revalidar todos os pedidos;
- se alterar tipo ou rota, apenas revalidar os pontos de percurso já informados;
- após oferta, exige retirar a oferta e voltar a rascunho;
- após início, fica somente leitura.

### Etapa 2: Pedidos e capacidade

**Objetivo:** montar a carga usando reconhecimento e ação em lote.

Entradas:

- pedidos pré-selecionados no HUB;
- bipagem NF-e, CT-e, DC-e, Minuta ou pedido;
- pesquisa por cliente, NF, origem e destino;
- botão `Adicionar pedido`.

Comportamento:

- cada pedido mostra destino, peso, volume, valor e custódia;
- seleção múltipla possui barra fixa `Adicionar N pedidos`;
- a composição mostra ocupação por peso, volume e valor;
- duplicidade, custódia incorreta, manifesto ativo e capacidade excedida aparecem na linha afetada;
- pedidos válidos permanecem selecionados após corrigir uma linha inválida;
- pedido novo usa o fluxo canônico de Entrada e retorna ao Manifesto.

Conclusão:

- ao menos um pedido;
- todos os pedidos estão elegíveis para a unidade responsável conforme as regras de custódia, coleta e perna ativa;
- nenhum pedido está em outra perna ativa;
- limites do veículo não foram excedidos.

Edição:

- adicionar e remover em `DRAFT`;
- após oferta, requer retirar oferta;
- após início, somente leitura.

### Etapa 3: Percurso e paradas, opcional

**Objetivo:** registrar manualmente somente os pontos intermediários que façam parte da viagem ou sejam necessários à declaração fiscal, especialmente em deslocamentos interestaduais longos.

Princípios do MVP:

- não gerar rota a partir dos pedidos;
- não criar uma parada por destinatário;
- não obrigar cada pedido a pertencer a uma parada;
- não substituir origem e destino principal;
- não otimizar sequência, distância ou melhor caminho;
- manter a etapa como `Não necessária` em viagens simples.

Interação:

- pergunta inicial curta: `Esta viagem possui parada ou ponto de percurso?`;
- se `Não`, a etapa é concluída como não aplicável;
- se `Sim`, `Adicionar ponto` permite informar manualmente Hub/filial ou cidade com UF e IBGE;
- cada ponto recebe uma finalidade simples:
  - passagem/percurso;
  - parada operacional;
  - transferência;
  - carregamento/coleta;
  - descarga/entrega;
- lista ordenada com botões `Subir` e `Descer` no mobile;
- ações `Editar`, `Remover` e `Reordenar`;
- a interface explica quais informações serão reaproveitadas pelo MDF-e, sem afirmar que toda parada operacional é automaticamente um evento fiscal.

Conclusão:

- `Não possui pontos intermediários`; ou
- todos os pontos adicionados possuem cidade, UF, IBGE, finalidade e ordem válidos.

Edição:

- livre em `DRAFT`;
- após oferta, requer retirar oferta quando a mudança afetar rota ou documento;
- em execução, somente registro operacional permitido pela regra de negócio, sem alterar silenciosamente um MDF-e já emitido.

### Etapa 4: Capa e programação

**Objetivo:** complementar a viagem sem pedir novamente dados da rota.

Preenchimento automático:

- origem, destino principal, tipo de viagem, marcador de coleta e veículo vêm das etapas anteriores;
- pontos intermediários aparecem apenas quando tiverem sido informados manualmente;
- emitente fiscal sugerido pela unidade responsável;
- saída prevista pode usar o horário atual arredondado ou a última preferência do Hub;
- chegada prevista pode ser sugerida pela rota, quando existir distância/duração;
- resumo de carga vem dos pedidos;
- documentos originários vêm das NF-e e CT-e já vinculadas.

Campos realmente próprios da Capa:

- emitente fiscal;
- saída prevista;
- chegada prevista;
- lacres;

Divulgação progressiva por `+ Dados opcionais`:

- liberação;
- observações.

Conclusão:

- saída válida;
- chegada posterior à saída quando informada;
- emitente pronto quando a viagem exigir emissão fiscal;
- pendências fiscais são visíveis, mas fechamento continua best-effort.

Edição:

- Capa operacional pode ser alterada até `IN_PROGRESS`, conforme regra de campo;
- mudanças estruturais continuam condicionadas ao status;
- alterações após aceite geram histórico e notificação ao Link.

### Etapa 5: Responsável pela viagem

**Objetivo:** escolher quem executará a viagem e completar, na mesma experiência, os dados exigidos pelos documentos fiscais.

Modelo semântico:

- `Link` representa o responsável operacional que usa o app para acompanhar a viagem, acessar documentos e dar baixa nas entregas;
- `Driver` representa os dados fiscais do motorista ligados a esse mesmo responsável;
- a interface não apresenta Link e Driver como duas contratações ou dois atores desconectados;
- a separação técnica continua existindo apenas porque acesso ao app e documentação fiscal possuem necessidades diferentes.

Interação:

- campo principal `Responsável pela viagem`, com busca de Link por nome, documento, base e placa;
- ao escolher o Link, carregar automaticamente seus dados de Driver;
- quando houver um único Driver vinculado ou um registro espelhado, selecioná-lo sem uma segunda decisão;
- se faltarem dados fiscais, mostrar `Completar dados do motorista` em bottom sheet curto;
- ao salvar, voltar à etapa com o mesmo Link e os dados fiscais atualizados;
- Link pendente aparece como não selecionável, com motivo `Aguardando aprovação`;
- selecionar o responsável não envia a oferta.

Conclusão:

- Link operacional aprovado;
- Driver fiscal correspondente resolvido;
- dados mínimos para a viagem completos;
- pendências adicionais de CIOT aparecem como prontidão fiscal, não como um segundo cadastro de responsável.

Edição:

- livre em `DRAFT`;
- trocar após oferta exige retirar oferta;
- após aceite, exige reabrir planejamento com confirmação e histórico;
- após início, fica bloqueado.

### Etapa 6: Carta Frete

**Objetivo:** registrar o custo contratado com o mínimo de digitação.

Preenchimento automático:

- sugestão do `LinkPricingAgreement` pela rota e veículo;
- frete bruto, pedágio e modelo de custo;
- valores já registrados na negociação;
- CIOT reaproveita esses valores sem solicitar novamente.

Campos principais:

- frete bruto;
- pedágio;
- adiantamento.

Divulgação progressiva:

- IRRF;
- INSS;
- ISSQN;
- SEST/SENAT;
- outros descontos e descrição.

Controles booleanos ou opções curtas:

- `Tem adiantamento`;
- `Tem outros descontos`;
- tipo de pagamento em opções marcáveis;
- entrega de documentação em opções marcáveis;
- `Retorno vazio`;
- `Composição veicular`.

Conclusão:

- frete bruto informado;
- saldo líquido calculado no backend;
- nenhuma entrada manual para valores calculáveis;
- margem atualizada.

### Etapa 7: Revisão e oferta

**Objetivo:** apresentar uma única decisão segura: enviar a viagem ao Link.

Resumo:

- rota principal e pontos intermediários, quando informados;
- pedidos e ocupação;
- programação;
- responsável operacional, dados fiscais do motorista e veículo;
- Carta Frete;
- prontidão fiscal;
- margem e alertas de capacidade.

Ações:

- `Editar` em cada bloco leva à etapa correspondente;
- `Salvar e sair` mantém `DRAFT`;
- `Enviar oferta ao Link` chama endpoint próprio;
- nenhuma seleção anterior muda o status.

O endpoint de oferta executa a mesma prontidão mostrada pela UI. Se houver bloqueio, retorna lista estruturada com `step`, `field`, `code` e mensagem.

### Etapa 8: Documentos e execução

Após a oferta:

- `PENDING_ACCEPT`: acompanhar aceite, retirar oferta ou tratar recusa;
- `ACCEPTED`: mostrar preparação fiscal e próxima ação do Link;
- `IN_PROGRESS`: foco em execução, eventuais pontos de percurso, evidências e conclusão;
- `COMPLETED`: leitura, comprovantes, margem e recuperação fiscal.

CIOT e MDF-e não aparecem como mais um formulário genérico. A tela mostra:

- dados já preenchidos;
- dados derivados;
- pendências reais;
- ações de emissão;
- progresso assíncrono;
- rejeição recuperável;
- ambiente de homologação ou produção.

## 6. Regras de edição por status

| Área | DRAFT | PENDING_ACCEPT | ACCEPTED | IN_PROGRESS | COMPLETED |
|---|---|---|---|---|---|
| Rota, tipo, veículo | Editável | Retirar oferta | Reabrir planejamento | Leitura | Leitura |
| Pedidos | Editável | Retirar oferta | Reabrir planejamento | Leitura | Leitura |
| Percurso/paradas opcionais | Editável ou não aplicável | Retirar oferta | Reabrir planejamento | Registro operacional controlado | Leitura |
| Capa e programação | Editável | Editável com histórico | Editável com histórico | Campos operacionais | Leitura |
| Responsável e seus dados fiscais | Editável | Retirar oferta | Reabrir planejamento | Leitura | Leitura |
| Carta Frete | Editável | Editável com histórico | Editável com confirmação | Leitura | Leitura |
| Fiscal | Prontidão | Emitir/acompanhar | Emitir/acompanhar | Acompanhar | Encerrar/recuperar |

`Reabrir planejamento` nunca apaga dados. Ele registra o ator, motivo, estado anterior e notifica o Link.

## 7. Cadastro contextual e retorno exato

### Regra

Antes de sair de uma etapa para cadastrar outra entidade:

1. salvar a etapa atual;
2. criar uma URL interna de retorno;
3. navegar ao fluxo canônico;
4. concluir ou cancelar;
5. voltar para o mesmo Manifesto e etapa;
6. atualizar a lista;
7. selecionar automaticamente o registro recém-criado quando permitido.

### Contrato sugerido

```text
returnTo=/manifests/{id}
resumeStep=responsible
returnIntent=complete-driver-data
parentId={linkId}
```

O retorno deve ser validado como rota interna. Não aceitar URL externa.

### Estratégia por entidade

| Entidade | Estratégia | Retorno |
|---|---|---|
| Pedido | Fluxo canônico de Entrada | Anexa automaticamente ao Manifesto |
| Dados fiscais do motorista | Bottom sheet curto | Atualiza o Driver ligado ao Link e mantém o responsável selecionado |
| Link | Onboarding completo | Retorna à busca; seleciona apenas se aprovado |
| Tipo de veículo | Cadastro de Frota, ADMIN | Seleciona o tipo criado |
| Hub | Cadastro de Hubs, ADMIN | Seleciona o Hub criado |
| Pessoa/CNPJ | `PersonAutocomplete` e importação existentes | Seleciona a Person criada |
| Cidade | `CityAutocomplete` | Guarda cidade, UF e IBGE |

No HUB, botões sem permissão não devem levar a erro 403. A UI explica quem pode cadastrar e oferece alternativa operacional.

## 8. Arquitetura de frontend

### Componente compartilhado

Criar `ManifestJourneyBuilder`, usado pelo ADMIN e HUB.

Responsabilidades:

- carregar Manifesto e prontidão;
- controlar a etapa pela URL;
- renderizar um único conteúdo por vez no mobile;
- autosave controlado;
- registrar dirty state;
- oferecer `Salvar e sair`;
- respeitar capacidades do workspace ativo;
- preservar foco e scroll ao retornar.

Componentes sugeridos:

- `ManifestJourneyShell`;
- `ManifestProgress`;
- `ManifestRouteStep`;
- `ManifestOrdersStep`;
- `ManifestRoutePointsStep`;
- `ManifestCoverStep`;
- `ManifestResponsibleStep`;
- `ManifestFreightStep`;
- `ManifestReviewStep`;
- `ManifestExecutionStep`;
- `ContextualCreateLink`;
- `DriverFiscalDataSheet`;
- `ManifestReadinessSummary`.

### URL como estado de navegação

```text
/#/manifests/{id}?step=orders
/#/manifests/{id}?step=route-points
/#/manifests/{id}?step=responsible
```

Isso permite:

- refresh sem perder etapa;
- browser back previsível;
- deep link;
- retorno contextual;
- suporte e diagnóstico reproduzíveis.

### Workspace ativo

Capacidades devem usar `currentRole` e a rota atual, não apenas `user.roles.includes(...)`.

Exemplo:

- usuário ADMIN + HUB em `/gestao`: capacidades ADMIN;
- mesmo usuário em `/hub`: capacidades HUB.

## 9. Arquitetura de backend

### Serviço de prontidão

Criar `manifestReadinessService`.

Saída proposta:

```ts
type ManifestStepState = 'complete' | 'current' | 'attention' | 'locked' | 'read_only';

interface ManifestReadinessIssue {
  step: 'route' | 'orders' | 'route_points' | 'cover' | 'responsible' | 'freight' | 'fiscal';
  field?: string;
  code: string;
  severity: 'blocking' | 'warning';
  message: string;
}

interface ManifestReadiness {
  canOffer: boolean;
  currentStep: string;
  steps: Record<string, { state: ManifestStepState; issues: ManifestReadinessIssue[] }>;
}
```

A mesma função alimenta:

- resposta do detalhe;
- indicadores da UI;
- validação do endpoint de oferta;
- testes de negócio.

### Endpoints

Adicionar ou ajustar:

- `PATCH /manifests/:id/setup`
  - edita tipo, marcador de coleta, origem, destino principal, Hubs relacionados e veículo em `DRAFT`;
- `PATCH /manifests/:id/stops/:stopId`
  - edita cidade, finalidade, ordem e programação do ponto manual;
- `DELETE /manifests/:id/stops/:stopId`
  - remove o ponto de percurso sem exigir realocação de pedidos;
- `PATCH /manifests/:id/stops/reorder`
  - reordena em transação;
- `PATCH /manifests/:id/assignment`
  - seleciona o Link responsável e resolve seu Driver fiscal sem mudar status;
- `POST /manifests/:id/offer`
  - executa prontidão e muda `DRAFT -> PENDING_ACCEPT`;
- `POST /manifests/:id/withdraw-offer`
  - volta `PENDING_ACCEPT -> DRAFT`;
- `POST /manifests/:id/reopen-planning`
  - transição controlada de `ACCEPTED -> DRAFT`;
- `GET /manifests/:id/readiness`
  - opcional se a prontidão não vier no detalhe.

O endpoint atual `PATCH /:id/assign` deve ser deprecado ou passar a delegar para `assignment` e `offer` de forma explícita. Não manter duas semânticas divergentes.

### Dados estruturados de cidade

No mínimo, toda seleção deve preservar:

- cidade;
- UF;
- código IBGE;
- vínculo com Hub ou Person quando existir.

Origem e destino principal precisam preservar cidade, UF e IBGE diretamente no Manifesto ou por referência canônica equivalente. Pontos de percurso opcionais preservam os mesmos dados quando existirem. O CIOT e o MDF-e devem consumir esses valores sem solicitar o código IBGE novamente.

### Composição de pedidos

Substituir o loop sequencial do modal por uma ação de composição controlada:

- preflight de todos os pedidos;
- validação de custódia e capacidade;
- resposta estruturada por pedido;
- transação quando a regra exigir atomicidade;
- nunca depender de `alert` para explicar estado parcial.

## 10. Layout mobile

### Superfície

O fluxo completo deixa de ser modal. Usa página de altura total.

Topo fixo:

- voltar;
- `Viagem #1234`;
- status `Rascunho`;
- ação `Salvar e sair`.

Corpo:

- `Etapa 2 de 8`;
- título e instrução curta;
- conteúdo em uma coluna;
- resumo progressivo sem cards aninhados.

Rodapé fixo:

- ação secundária `Voltar`;
- ação primária `Continuar`;
- altura mínima de 52px;
- respeita safe area.

Etapas concluídas:

- acessíveis por `Ver etapas`;
- mostram resumo compacto;
- ação `Editar`.

Desktop:

- rail de etapas à esquerda;
- etapa atual ao centro;
- resumo da viagem à direita quando houver espaço;
- mesma lógica e mesmos componentes.

### Medidas

- input mobile com pelo menos 48px de altura;
- texto de input com 16px para evitar zoom automático no iOS;
- toque mínimo de 44 por 44px;
- botões primários de largura total no mobile;
- sem dois campos críticos lado a lado abaixo de 640px;
- feedback próximo da ação;
- skeleton de estrutura no carregamento;
- transições de estado entre 150 e 250ms;
- `prefers-reduced-motion` respeitado.

## 11. Reutilização obrigatória

| Informação | Fonte canônica | Onde reutilizar |
|---|---|---|
| Unidade responsável | workspace ativo ou Hub escolhido | gestão, capa, fiscal e custódia |
| Cidade/UF/IBGE do Hub | `Hub` | origem ou destino, percurso opcional, MDF-e, CIOT |
| Destinatário e endereço | `Order.destinatarioPerson` | referência dos pedidos e CIOT, sem definir a rota automaticamente |
| NF-e e chaves | `OrderInvoice` | pedidos, documentos originários, fiscal |
| Peso, volume e valor | `Order/Demand` | ocupação, veículo, capa, CIOT |
| Link e veículo | `Link` | responsável no app, placas, execução e acesso futuro a documentos |
| Driver ligado ao Link | `Driver` | dados fiscais do mesmo responsável para CIOT e MDF-e |
| Frete contratado | `ManifestFreightAgreement` | margem e CIOT |
| Emitente | `FiscalEmitter` ligado ao Hub | capa, MDF-e |
| Preferências repetidas | configuração por Hub/usuário | defaults marcáveis |

Nenhum campo da tabela deve ser solicitado novamente sem explicar por que o valor canônico não serve.

## 12. Ordem de implementação

### Fase 0: segurança e testes de caracterização

- cobrir criação ADMIN e HUB;
- cobrir atribuição atual e transição para `PENDING_ACCEPT`;
- cobrir permissões por Hub;
- cobrir pedidos, percurso opcional e lifecycle;
- registrar fixtures de transferência, entrega direta, transferência + entrega e início por coleta.

### Fase 1: separar seleção de oferta

- implementar prontidão;
- criar `assignment`;
- criar `offer`;
- criar retirada/reabertura;
- adaptar testes;
- manter compatibilidade temporária do endpoint antigo.

### Fase 2: configuração e percurso opcional

- `setup`;
- origem sugerida pelo Hub, mas editável;
- marcador de coleta e variações de tipo de viagem;
- adicionar/editar/remover/reordenar pontos manuais de percurso;
- cidade estruturada e IBGE;
- derivação Hub -> cidade;
- testes fiscais de origem, destino e percurso.

### Fase 3: shell da jornada

- rota por etapa;
- progresso calculado;
- mobile full-page;
- desktop rail;
- edição de etapas completas;
- redirecionar criação ADMIN e HUB para o mesmo builder.

### Fase 4: pedidos e capacidade

- seleção e bipagem unificadas;
- composição controlada;
- ocupação em tempo real;
- retorno do fluxo de Entrada;
- sugestão de veículo.

### Fase 5: responsável, dados fiscais e Carta Frete

- unificar Link e Driver na experiência como duas representações do mesmo responsável;
- completar/editar dados fiscais do Driver ligado ao Link;
- retorno do onboarding de Link;
- defaults de Carta Frete;
- campos opcionais em divulgação progressiva.

### Fase 6: fiscal sem repetição

- preencher CIOT e MDF-e com rota principal, pontos de percurso quando existirem, Hub, Person, pedidos, responsável e Carta Frete;
- eliminar código IBGE manual quando já resolvido;
- booleanos e opções curtas como controles marcáveis;
- prontidão e recuperação fiscal.

### Fase 7: remoção do legado

- remover `ManifestModal` do HUB;
- remover criação duplicada do ADMIN;
- transformar `ManifestDetailPage` no builder compartilhado;
- retirar semântica antiga de `assign`;
- limpar estados e formulários duplicados.

## 13. Critérios de aceite

### Fluxo

- ADMIN e HUB usam o mesmo builder.
- HUB cria viagem vazia informando cidade quando necessário.
- Origem do HUB começa preenchida com o Hub atual, mas pode ser trocada.
- `Esta viagem começa com uma coleta` altera a origem esperada sem criar uma rota automaticamente.
- Destino principal é informado manualmente e não é concatenado a partir dos pedidos.
- Selecionar Hub preenche cidade, UF e IBGE.
- Tipo de viagem usa opção marcável, não dropdown.
- Criar rascunho abre imediatamente a etapa Pedidos.
- Cada etapa mostra estado e motivo.
- Etapa concluída pode ser reaberta em `DRAFT`.
- Selecionar Link não envia oferta.
- Oferta só é enviada após revisão e prontidão.
- Recusa preserva todo o rascunho.

### Cadastro contextual

- `Adicionar pedido` retorna e anexa o pedido criado.
- `Completar dados do motorista` retorna ao mesmo Link com o Driver fiscal atualizado.
- cancelar cadastro retorna sem perder o Manifesto.
- refresh e browser back preservam a etapa.
- usuário sem permissão não recebe CTA que termina em 403.

### Reutilização

- cidade de Hub não é digitada novamente;
- destinos dos pedidos aparecem apenas como referência e não geram paradas;
- pontos de percurso são informados manualmente somente quando necessários;
- endereço do destinatário preenche CIOT;
- Carta Frete preenche valores fiscais;
- código IBGE selecionado não é solicitado novamente;
- defaults repetidos viram opções marcáveis ou preferências.

### Mobile e acessibilidade

- fluxo completo utilizável em 320px sem scroll horizontal;
- controles críticos têm 44px ou mais;
- input tem 16px ou mais;
- teclado virtual não cobre a ação atual;
- rodapé respeita safe area;
- todos os estados têm texto, não apenas cor;
- foco retorna ao controle que abriu bottom sheet;
- redução de movimento funciona.

### Integridade

- um pedido não entra em duas pernas ativas;
- capacidade é revalidada ao trocar veículo;
- pedidos não dependem de vínculo com parada para compor o Manifesto;
- ponto de percurso não altera automaticamente a origem ou o destino principal;
- mudanças após oferta exigem transição controlada;
- documentos fiscais preservam ambiente e estado reais;
- fechamento fiscal não reverte conclusão operacional.

## 14. Métricas de sucesso

- taxa de Manifestos abandonados em `DRAFT`;
- tempo entre `Nova viagem` e `Enviar oferta`;
- quantidade média de campos digitados por viagem;
- percentual de campos preenchidos automaticamente;
- erros por pedido ao compor carga;
- retornos concluídos de cadastro contextual;
- ofertas retiradas por erro de planejamento;
- emissões fiscais bloqueadas por dado ausente;
- conclusão mobile sem troca para desktop.

Meta inicial recomendada:

- reduzir em pelo menos 50% os campos digitados manualmente;
- eliminar dead ends no HUB;
- concluir viagem simples com registros existentes em até 90 segundos;
- zero alteração estrutural silenciosa após aceite;
- usabilidade heurística de pelo menos 9 de 10.

## 15. Fora do primeiro corte

- geração automática de paradas a partir dos pedidos;
- vínculo obrigatório entre pedido e parada;
- roteirização automática de melhor ordem de paradas;
- otimização por mapa e distância em tempo real;
- aprovação automática de Link;
- planejamento autônomo por IA;
- alteração estrutural de viagem já iniciada;
- refatoração completa dos painéis fora da jornada de Manifesto.

## 16. Decisões recomendadas para confirmação

1. **Carta Frete como gate da oferta:** recomendado quando existe Link contratado. Sem valor combinado, o Link não deveria receber uma oferta incompleta.
2. **Reabrir após aceite:** recomendado permitir apenas para ADMIN, com motivo obrigatório, histórico e notificação ao Link.
3. **Natureza da viagem:** recomendado usar Transferência, Entrega direta e Transferência + entrega, com `Inicia com coleta` como marcador independente.
4. **Novo Link no contexto:** recomendado abrir onboarding completo. Cadastro rápido não atende aprovação, acesso ao app e risco.
5. **Dados do motorista:** recomendado bottom sheet curto para completar o Driver fiscal ligado ao Link, sem apresentar um segundo responsável.
6. **Percurso no MVP:** recomendado manual, opcional e sem vínculo obrigatório com pedidos. Usar quando a operação ou o MDF-e exigir.
7. **Cidade estruturada:** recomendado persistir IBGE na origem, destino e pontos de percurso informados.
8. **Criação vazia:** recomendado permitir, desde que a Etapa 1 possua rota principal e veículo válidos antes de criar o `DRAFT`.
