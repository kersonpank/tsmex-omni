# Hub: Pedidos e entrada de carga unificados, mobile-first

**Data:** 2026-07-28
**Status:** implementado e validado em 2026-07-28
**Registro:** product
**Direção:** Torre Serena, operação clara sob pressão
**Superfície:** `/hub`
**Papéis:** HUB; ADMIN apenas para suporte e teste quando possuir contexto de Hub

## 1. Decisão de produto

O `/hub` deixará de obrigar o operador a escolher antecipadamente entre `Receber`, `Entrada` e `Pedidos`.

A navegação principal passa a ter:

- **Início**
- **Pedidos**
- **Viagens**

`Manifestos` será chamado de **Viagens** somente na linguagem operacional. Entidades, APIs, MDF-e e demais conceitos fiscais continuam usando `Manifest`/Manifesto quando tecnicamente necessário.

A aba **Pedidos** será uma central de carga com duas formas equivalentes de operação:

1. **Navegação visual:** o operador escolhe o que deseja consultar, como carga no Hub, carga a caminho ou materiais aguardando entrada.
2. **Bipagem/busca direta:** o operador lê ou digita um código e o sistema determina o estado e as ações permitidas.

Nenhuma das formas depende da outra. O operador não precisa possuir um código para descobrir o que está chegando, nem navegar por filas antes de bipar uma carga em mãos.

## 2. Objetivos verificáveis

- Reduzir a navegação inferior de cinco para três destinos.
- Manter estoque, carga a caminho, pré-entrada e pendências fiscais visualmente acessíveis.
- Fazer uma única busca aceitar pedido, NF-e, CT-e, DC-e, Minuta, chave, QR Code e identificador interno.
- Reaproveitar `Person`, `Hub`, `Demand`, `Order`, XML da NF-e e dados da Distribuição NF-e antes de pedir digitação.
- Separar documento encontrado, chegada física confirmada e pedido disponível em estoque.
- Impedir no frontend e no backend a inclusão indevida de carga em uma viagem.
- Preservar filtros, rolagem, seleção e resultado ao abrir detalhes, cadastrar dados ou retornar de uma viagem.
- Manter o fluxo de viagem iniciada por coleta funcional por meio de regra própria, sem tratá-lo como estoque do Hub.

## 3. Fora de escopo

- Criar um roteirizador automático de entregas.
- Gerar paradas a partir dos destinos dos pedidos.
- Renomear tabelas, modelos Prisma ou APIs de `Manifest` para `Trip`.
- Criar um novo cadastro completo de cliente, pessoa ou pedido quando um editor canônico já existir.
- Alterar a verdade fiscal de CT-e, MDF-e, DACTE, Minuta ou CIOT.
- Criar telemetria persistida em banco no primeiro corte.

## 4. Evidências do estado atual

### 4.1 Navegação e superfícies duplicadas

`components/operacao/HubHome.tsx` mantém cinco estados de navegação:

```ts
type Tab = 'inicio' | 'recebimento' | 'entrada' | 'pedidos' | 'manifestos';
```

Na mesma tela:

- `HubAwaitingArrivalTab` resolve chave e confirma chegada;
- `NfeDistribuicaoTriagemTab` trata NF-e descobertas;
- `EntradaTab` lista, cria e edita pedidos;
- a seção `pedidos` possui outra busca, outra bipagem e outra lista.

O operador escolhe uma arquitetura interna do sistema, em vez de informar sua intenção operacional.

### 4.2 Resumo incorreto para o conceito de estoque

O carregamento atual usa:

```ts
statuses: 'AT_HUB,IN_TRANSIT,PENDING,OUT_FOR_DELIVERY'
```

Esses estados são válidos para visibilidade operacional, mas não para o total de estoque. Estoque do Hub deve significar:

```text
Order.status = AT_HUB
AND Order.currentHubId = hub atual
```

### 4.3 Seleção e custódia

A lista atual oferece seleção para todos os pedidos carregados. `addOrderToManifest` verifica capacidade e alguns conflitos, mas não aplica uma matriz completa de custódia:

- viagem comum originada no Hub;
- viagem iniciada por coleta;
- pedido já alocado a outro rascunho ou viagem ativa;
- pedido em trânsito;
- pedido fisicamente em outro Hub.

`assertOrderNotInOtherActiveManifest` considera apenas manifesto `IN_PROGRESS`, permitindo que o mesmo pedido seja preparado em mais de um rascunho ou oferta.

### 4.4 Resolvedores fragmentados

Há resoluções distintas em:

- `server/src/services/orderResolve.ts`;
- `server/src/services/intake/resolveIntakeByNfeKey.ts`;
- `hooks/useNfeLookup.ts`;
- `components/operacao/HubAwaitingArrivalTab.tsx`;
- `components/ui/OrderScanInput.tsx`.

Cada fluxo normaliza códigos, restringe Hub e trata “não encontrado” de forma diferente.

### 4.5 Formulário grande reutilizado como uma aba

`components/admin/EntradaTab.tsx` reúne:

- lista de pedidos;
- resumo;
- criação;
- edição;
- pessoas;
- coleta;
- notas;
- cálculo;
- evolução;
- anexos.

O Hub precisa reutilizar o editor de entrada, não a lista e o shell administrativo completos.

## 5. Avaliação heurística

**Usabilidade atual:** 6,0 de 10.
**Meta após implementação e validação:** 10 de 10.

| Problema | Severidade | Correção |
|---|---:|---|
| Receber, Entrada e Pedidos competem pela mesma intenção | 3 | Uma central de Pedidos com estados visuais e busca única |
| Resumo mistura estoque com carga em trânsito | 4 | Agregação por custódia real |
| Pedido inelegível pode ser selecionado | 4 | Política compartilhada no frontend e backend |
| Código não encontrado termina em fluxo sem próxima ação consistente | 3 | Resolvedor com `allowedActions` e recuperação contextual |
| Lista de Entrada duplica Pedidos | 2 | Separar editor canônico do shell/lista |
| Destinatário conhecido pode ser solicitado novamente | 3 | Resolver `Person` por documento e pedir apenas ambiguidades |
| Estado visual se perde ao navegar | 3 | URL canônica e store de sessão por Hub |
| Card atual contém checkbox dentro de botão | 3 | Estrutura sem controles interativos aninhados |
| Busca carrega até 200 pedidos antes de filtrar localmente | 2 | Paginação e filtro no servidor |

## 6. Modelo operacional canônico

### 6.1 Estados visuais

| Chave da visão | Rótulo | Fonte de verdade | Pode selecionar para viagem comum |
|---|---|---|---|
| `stock` | No Hub | `Order.status = AT_HUB` e `currentHubId = hub atual` | Sim, se não houver conflito |
| `incoming` | A caminho | `OrderLeg` ativa cuja viagem chega ao Hub atual | Não |
| `awaiting` | Aguardando entrada | `Demand.status = AWAITING_ARRIVAL`, `expectedHubId = hub atual`, sem `Order` | Não, antes da entrada |
| `triage` | Pendências | NF-e da Distribuição em estado pronto para triagem e vinculada ao contexto fiscal do Hub | Não |
| `other` | Outros | Carga visível ao Hub que não pertence aos grupos anteriores | Não por padrão |

### 6.2 Verdades que não podem ser confundidas

```text
NF-e descoberta
  != demanda de pré-entrada criada
  != chegada física confirmada
  != pedido disponível no estoque
  != pedido alocado a uma viagem
```

Uma única interação pode conduzir o operador por mais de uma transição, mas o backend deve registrar cada transição real separadamente.

### 6.3 Elegibilidade para viagem

Criar `getManifestOrderEligibility(manifest, order)` como fonte compartilhada da regra.

#### Viagem sem coleta inicial

O pedido só é elegível quando:

- manifesto está em `DRAFT`;
- pedido está `AT_HUB`;
- `currentHubId` corresponde ao `manifest.hubId`;
- não existe `OrderLeg` em outro manifesto com status ativo;
- pedido não está cancelado ou entregue;
- capacidade de peso, cubagem e valor será respeitada.

#### Viagem iniciada por coleta

Não aplicar uma regra cega de `AT_HUB`.

O pedido pode ser elegível quando:

- `manifest.startsWithCollection = true`;
- está no estado de pré-coleta aceito pela política existente;
- não possui custódia incompatível nem perna ativa;
- `expectedHubId`, quando existir, corresponde ao Hub que receberá a coleta;
- o tipo de `OrderLeg` representa corretamente a coleta para pedidos ainda fora do Hub.

Pedidos já no estoque podem continuar sendo aceitos apenas quando a viagem suportar composição mista de forma explícita. Não inferir composição mista silenciosamente.

#### Conflito de viagem

Considerar conflito qualquer `OrderLeg` em outro manifesto com status:

- `DRAFT`;
- `PENDING_ACCEPT`;
- `ACCEPTED`;
- `IN_PROGRESS`.

O resultado deve trazer o motivo e, quando autorizado, o identificador da viagem conflitante.

### 6.4 Permissões preservadas

Unificar a superfície não significa ampliar permissões.

| Permissão existente | Capacidade na nova central |
|---|---|
| `pedidos` | Ver, buscar e abrir pedidos autorizados |
| `entrada` | Ver pré-entradas, confirmar chegada, converter NF-e e criar/editar entrada |
| `manifestos` | Selecionar carga elegível e criar/abrir Viagens |

Regras:

- a aba `Pedidos` aparece quando o usuário possui ao menos `pedidos` ou `entrada`;
- ações de mutação aparecem somente com a capacidade correspondente;
- sem `manifestos`, checkboxes e barra `Criar viagem` não são renderizados;
- badges contabilizam apenas filas que o usuário pode abrir;
- o backend continua sendo a autoridade, mesmo quando a UI esconde a ação;
- no workspace `/hub`, usuário com múltiplos papéis opera explicitamente como HUB e precisa de `hubId`; não inferir capacidade apenas porque a lista de papéis também contém `ADMIN`.

## 7. Arquitetura de API

### 7.1 Novo módulo de leitura operacional

Criar:

```text
server/src/routes/hubCargo.ts
server/src/services/hubCargo/hubCargoPolicy.ts
server/src/services/hubCargo/hubCargoSummary.ts
server/src/services/hubCargo/listHubCargoItems.ts
server/src/services/hubCargo/resolveHubCargoCode.ts
server/src/services/hubCargo/normalizeHubCargoCode.ts
```

Montagem sugerida:

```ts
app.use('/api/hub/cargo', hubCargoRouter);
```

Rotas:

```text
GET  /api/hub/cargo/summary
GET  /api/hub/cargo/items?bucket=stock|incoming|awaiting|triage|other
POST /api/hub/cargo/resolve
```

As mutações canônicas permanecem nas rotas existentes:

- criar pré-entrada por NF-e;
- confirmar chegada;
- converter/descartar NF-e descoberta;
- editar pedido;
- adicionar pedido à viagem.

O novo módulo orquestra leitura e decisão. Não duplica transações fiscais ou de intake.

### 7.2 Contrato de resumo

```ts
interface HubCargoSummary {
  stock: {
    orders: number;
    invoices: number;
    units: number;
    realWeightKg: number;
    cubedWeightKg: number;
    effectiveWeightKg: number;
    volumeM3: number;
    fiscalValueBRL: number;
    withoutActiveTrip: number;
  };
  incoming: { orders: number; trips: number };
  awaiting: { demands: number };
  triage: { documents: number };
}
```

`effectiveWeightKg` deve usar a mesma regra de capacidade do manifesto:

```text
max(peso real, peso cubado)
```

Somatórios não podem multiplicar peso ou valor ao juntar várias notas do mesmo pedido. A quantidade de NF deve ser agregada separadamente.

### 7.3 Contrato de item

Usar união discriminada:

```ts
type HubCargoItem =
  | { kind: 'order'; bucket: 'stock' | 'incoming' | 'other'; ... }
  | { kind: 'intake'; bucket: 'awaiting'; ... }
  | { kind: 'fiscal_document'; bucket: 'triage'; ... };
```

Todo item deve retornar:

- identidade operacional;
- remetente e destinatário quando conhecidos;
- origem e destino;
- NF e chave mascarada quando aplicável;
- peso, peso cubado, cubagem, volumes e valor;
- estado e localização;
- `allowedActions`;
- `blockingReasons`.

### 7.4 Contrato do resolvedor

Entrada:

```ts
interface ResolveHubCargoRequest {
  code: string;
}
```

Saída:

```ts
type HubCargoResolution =
  | { resolution: 'order_at_hub'; item: HubOrderItem; allowedActions: ... }
  | { resolution: 'order_incoming'; item: HubOrderItem; allowedActions: ... }
  | { resolution: 'order_elsewhere'; safeSummary: ...; allowedActions: ... }
  | { resolution: 'already_in_trip'; item: HubOrderItem; trip: ... }
  | { resolution: 'awaiting_arrival'; item: HubIntakeItem; ... }
  | { resolution: 'fiscal_document_found'; item: HubFiscalItem; ... }
  | { resolution: 'valid_nfe_not_registered'; lookup: ... }
  | { resolution: 'multiple'; candidates: HubCargoCandidate[] }
  | { resolution: 'invalid'; message: string; preservedCode: string }
  | { resolution: 'not_found'; message: string; preservedCode: string };
```

### 7.5 Normalização

Centralizar:

- chave de 44 dígitos;
- URL de QR Code com `chNFe` ou `p`;
- espaços, hífens e caracteres de leitor;
- número inteiro de pedido;
- UUID ou sufixo permitido;
- número de NF, CT-e, DC-e ou Minuta.

Não duplicar a extração existente em `useNfeLookup`. Mover a regra compartilhável para funções testáveis de cada camada.

### 7.6 Segurança

- HUB sempre usa `req.user.hubId`; ignorar `hubId` arbitrário enviado pelo cliente.
- ADMIN precisa informar um Hub explicitamente para usar a superfície de suporte.
- Uma chave global encontrada em outro Hub não pode retornar dados completos a um HUB sem acesso.
- Logs não devem armazenar XML, QR bruto ou chave completa; usar tipo, hash e últimos dígitos.
- `allowedActions` é informativo para a UI. Toda mutação valida novamente no servidor.

## 8. Arquitetura frontend

### 8.1 Componentes

Criar:

```text
components/operacao/hub/HubOrdersWorkspace.tsx
components/operacao/hub/HubCargoSummary.tsx
components/operacao/hub/HubCargoFilters.tsx
components/operacao/hub/HubCargoSearch.tsx
components/operacao/hub/HubCargoList.tsx
components/operacao/hub/HubCargoRow.tsx
components/operacao/hub/HubCargoResolutionPanel.tsx
components/operacao/hub/HubIntakeSheet.tsx
components/operacao/hub/HubCargoSelectionBar.tsx
store/hubCargoStore.ts
```

`HubHome.tsx` permanece como shell e coordenador de navegação, sem concentrar todas as regras e renderizações.

### 8.2 Reutilização do scanner

Extrair de `OrderScanInput` apenas a captura:

```text
components/ui/CodeCaptureInput.tsx
```

Responsabilidades:

- entrada física por teclado/leitor;
- botão de câmera;
- retorno do valor bruto;
- loading, foco e acessibilidade.

Resolução continua contextual:

- manifesto usa `ordersApi.resolve`;
- central do Hub usa `hubCargoApi.resolve`.

Isso evita modificar o fluxo de bipagem dentro do manifesto além do necessário.

### 8.3 Reutilização do editor de Entrada

Separar `EntradaTab` em:

```text
components/admin/entrada/OrdersEntryManagement.tsx
components/admin/entrada/OrderEntryEditor.tsx
```

`OrdersEntryManagement` mantém a lista administrativa.
`OrderEntryEditor` recebe:

```ts
interface OrderEntryEditorProps {
  orderId?: string;
  initialNfeCode?: string;
  initialData?: Partial<...>;
  mode: 'create' | 'edit';
  onCompleted: (orderId: string) => void;
  onCancel: () => void;
}
```

No Hub:

- mobile: fluxo de tela cheia dentro do shell;
- desktop: painel lateral amplo ou área de detalhe;
- salvar retorna ao mesmo bucket, filtro e rolagem;
- o pedido criado fica destacado;
- seleção automática só ocorre se estiver elegível e a ação de origem era “criar para viagem”.

### 8.4 Estado e URL

URL canônica:

```text
#/hub?tab=orders&bucket=stock&q=
```

Persistir por sessão e por Hub:

- bucket atual;
- texto de busca;
- IDs selecionados;
- posição aproximada da lista;
- resultado de retorno;
- intenção de origem (`browse`, `receive`, `create_trip`).

Filtros secundários também devem permanecer na URL quando aplicados:

```text
status, withoutTrip, documentReadiness, destination, sender, enteredFrom, enteredTo, sort
```

Ao recarregar:

- revalidar pedidos selecionados;
- remover apenas os que ficaram inelegíveis;
- explicar quais foram removidos e por quê.

## 9. Design da superfície

### 9.1 Cena

Operador de Hub usa o celular com uma mão em um galpão iluminado, alternando entre observar filas, conferir carga física e preparar expedição com atenção fragmentada.

Tema claro é a prioridade física. Tema escuro mantém paridade para turnos noturnos.

### 9.2 Direção visual

- Estratégia de cor **restrained**.
- Azul apenas para ação primária, foco e seleção.
- Estados sempre têm rótulo, nunca apenas cor.
- Sem grade de cards de KPI.
- Sem cards aninhados.
- Sem tabela desktop comprimida no celular.
- Animações entre 150 e 250 ms, somente para confirmar mudança de estado.

### 9.3 Hierarquia mobile

```text
Pedidos do Hub

[ Bipar ou buscar pedido, NF-e, CT-e... ] [Câmera]

[No Hub 32] [A caminho 7] [Aguardando 4] [Pendências 2]

32 pedidos · 48 NFs · 8.420 kg · 31,5 m³
[Ver mais indicadores]

Lista orientada à visão escolhida

3 selecionados · 1.240 kg · 5,3 m³
[Criar viagem]
```

Os filtros são roláveis horizontalmente no mobile, com o estado atual sempre visível. No desktop podem ocupar uma única linha.

### 9.4 Conteúdo dos itens

Prioridade mobile:

1. pedido/NF e status;
2. remetente → destinatário;
3. origem → destino;
4. peso, cubagem e quantidade de NFs;
5. localização ou chegada prevista;
6. ação contextual.

Detalhes fiscais, anexos, histórico e dados secundários ficam em detalhe progressivo.

### 9.5 Barra de seleção

Só aparece com pelo menos um pedido elegível selecionado:

- quantidade de pedidos;
- quantidade de NFs;
- peso real;
- peso efetivo;
- cubagem;
- valor fiscal;
- ação `Criar viagem`.

Se um item ultrapassar capacidade apenas depois que o veículo for escolhido, a etapa de pedidos da viagem deve apontar exatamente qual limite foi excedido.

### 9.6 Filtros sem poluição

Os buckets `No Hub`, `A caminho`, `Aguardando entrada` e `Pendências` são o primeiro nível de filtro visual.

Filtros secundários ficam em `Filtros` com contador de critérios ativos:

- sem viagem ativa;
- selecionados;
- prontidão documental;
- remetente;
- destino;
- período de entrada;
- faixa de peso ou cubagem quando necessário.

Ordenações:

- entrada mais recente;
- entrada mais antiga;
- chegada prevista;
- destino;
- maior peso.

No desktop, os critérios mais usados podem permanecer na barra. No mobile, somente busca, buckets e filtros ativos ficam sempre visíveis. O restante abre por divulgação progressiva e retorna com `Aplicar filtros`.

## 10. Fluxos funcionais

### 10.1 Consulta visual

```text
Pedidos
  -> escolher visão
  -> carregar resumo e primeira página
  -> pesquisar ou filtrar
  -> abrir detalhe
  -> voltar ao mesmo ponto
```

### 10.2 Bipar pedido no estoque

```text
bipar
  -> resolver
  -> mostrar pedido + "No Hub"
  -> oferecer Abrir ou Selecionar para viagem
  -> confirmar seleção sem retirar o operador da lista
```

### 10.3 Bipar demanda aguardando entrada

```text
bipar
  -> resolver AWAITING_ARRIVAL
  -> preview dos dados conhecidos
  -> resolver remetente/destinatário por documento
  -> pedir somente dado ausente ou ambíguo
  -> confirmar chegada física
  -> criar Order AT_HUB
  -> registrar DemandEvent e OrderHistory
  -> mostrar sucesso + Abrir/Selecionar/Continuar
```

### 10.4 Bipar NF-e conhecida pela Distribuição

```text
bipar
  -> localizar documento/XML
  -> mostrar emitente, destinatário e carga disponíveis
  -> perguntar "Esta carga chegou ao Hub?"
  -> Converter em pré-entrada
  -> Confirmar chegada física
```

Se a primeira transação concluir e a segunda falhar:

- a pré-entrada permanece salva;
- a interface informa o ponto exato;
- nova tentativa resolve como `awaiting_arrival`;
- nenhum registro é duplicado.

### 10.5 Bipar chave válida ainda não registrada

```text
bipar
  -> validar chave
  -> consultar fontes disponíveis
  -> identificar emitente/destinatário
  -> localizar Person/Client por CNPJ
  -> preencher dados conhecidos
  -> oferecer Dar entrada
```

Se cliente/pessoa não existir:

- abrir cadastro contextual preenchido;
- retornar ao mesmo resultado;
- continuar sem nova bipagem.

### 10.6 Pedido em outro Hub ou em trânsito

- mostrar somente informações autorizadas;
- informar onde está ou para onde segue;
- remover ação de entrada e seleção;
- oferecer abrir viagem associada quando o usuário possuir acesso.

### 10.7 Criar viagem

```text
selecionar carga em stock
  -> barra fixa mostra totais
  -> Criar viagem
  -> /manifests/new?orders=...
  -> criar rascunho
  -> adicionar pedidos
  -> reportar anexados e rejeitados individualmente
  -> manter rejeitados selecionados com motivo
```

O rótulo operacional do botão será `Criar viagem`, nunca `Manifesto (N)`.

## 11. Plano de implementação por fatias

### Fatia 0: testes de caracterização

**Objetivo:** congelar regras atuais que não podem regredir.

**Modificar/criar:**

- `server/src/services/orderResolve.test.ts`
- `server/src/services/intake/resolveIntakeByNfeKey.test.ts`
- `server/src/services/intake/confirmIntakeArrival.test.ts`
- `server/src/services/manifestLifecycle.test.ts`
- `server/src/routes/orders.aggregate.test.ts`

**Cobrir:**

- ordem da cascata de resolução;
- isolamento por Hub;
- chegada idempotente;
- somatórios sem multiplicação por NF;
- viagem comum;
- viagem com coleta inicial;
- conflito com rascunho, oferta, aceita e em andamento.

**Gate:** nenhum refactor antes dos testes passarem.

### Fatia 1: política de custódia e elegibilidade

**Objetivo:** corrigir a regra crítica antes de mudar a interface.

**Criar/modificar:**

- `server/src/services/hubCargo/hubCargoPolicy.ts`
- `server/src/services/manifestLifecycle.ts`
- `server/src/routes/manifests.ts`
- testes correspondentes.

**Entregas:**

- `getManifestOrderEligibility`;
- conflito contra todos os status ativos;
- regra separada para coleta;
- erros estáveis com código, mensagem e ação de recuperação;
- revalidação no `POST /manifests/:id/demands`.

**Gate:** pedido em trânsito ou em outro Hub falha no servidor mesmo com requisição manual.

### Fatia 2: resolvedor unificado

**Objetivo:** uma decisão read-only para qualquer código.

**Criar/modificar:**

- módulo `hubCargo`;
- `server/src/index.ts`;
- `types/index.ts`;
- `lib/api.ts`;
- testes de serviço e rota.

**Gate:** matriz completa de resolução passa, inclusive wrong Hub sem vazamento de dados.

### Fatia 3: resumo e listas por visão

**Objetivo:** oferecer navegação visual correta e performática.

**Entregas:**

- resumo do estoque real;
- quantidade de NF separada;
- buckets `stock`, `incoming`, `awaiting`, `triage`, `other`;
- paginação, ordenação e busca no servidor;
- chegada prevista de `Manifest.plannedArrivalAt` ou `ManifestStop.plannedArrivalAt`;
- abortar requisição anterior ao mudar rapidamente filtro/busca.

**Gate:** nenhuma lista depende de carregar 200 pedidos e filtrar no navegador.

### Fatia 4: workspace novo, ainda sem remover o legado

**Objetivo:** construir e testar a nova superfície isoladamente.

**Entregas:**

- `HubOrdersWorkspace`;
- filtros;
- resumo;
- listas responsivas;
- estados loading, vazio, erro e retry;
- URL e store de sessão;
- feature flag temporária `VITE_HUB_CARGO_V2` para staging;
- fallback de diagnóstico `?hubCargo=legacy` restrito à janela de rollout.

**Gate:** navegação visual funciona em 360 px, 390 px, tablet e desktop.

### Fatia 5: busca, câmera e entrada contextual

**Objetivo:** concluir a cascata de bipagem.

**Entregas:**

- `CodeCaptureInput`;
- painel de resolução inline;
- bottom sheet curto para confirmar chegada;
- editor contextual para dados ausentes;
- cadastro de pessoa/cliente com retorno;
- falha parcial recuperável;
- foco devolvido ao campo para operação contínua.

**Gate:** dez bipagens consecutivas podem ser processadas sem recarregar a página.

### Fatia 6: seleção e handoff para Viagem

**Objetivo:** consolidar estoque com segurança.

**Entregas:**

- seleção apenas quando `allowedActions.selectForTrip`;
- totais em tempo real;
- persistência por sessão;
- revalidação antes da navegação;
- retorno de anexados/rejeitados;
- rótulos `Viagem/Viagens`.

**Gate:** UI e API rejeitam a mesma carga pelos mesmos motivos.

### Fatia 7: substituir a navegação

**Objetivo:** remover a decisão duplicada do operador.

**Entregas:**

- navegação `Início`, `Pedidos`, `Viagens`;
- badges de ação pendente em `Pedidos`;
- atalhos do Início para cada bucket;
- aliases de retorno para estados antigos durante transição;
- mapeamento de intenção legado: `recebimento → orders/awaiting`, `entrada → orders/manual-entry`, `pedidos → orders/stock`, `manifestos → trips`;
- remover `EntradaTab` completo do shell Hub;
- manter editor de Entrada no Admin.

**Gate:** nenhum deep link, voltar do navegador ou retorno de cadastro perde contexto.

### Fatia 8: hardening e acabamento

**Objetivo:** tornar o fluxo apto a staging e produção.

**Cobrir:**

- WCAG 2.2 AA;
- foco e teclado;
- leitor físico enviando Enter;
- câmera com permissão negada;
- tema claro/escuro;
- `prefers-reduced-motion`;
- textos longos;
- 0, 1, 50 e mais de 500 registros;
- rede lenta, timeout e retry;
- permissões HUB sem `entrada`;
- usuário com múltiplos papéis;
- concorrência entre dois operadores;
- atualização de elegibilidade enquanto item está selecionado.

### Fronteiras de commit

Cada fatia deve ser revisável e reversível sem depender de alterações locais não commitadas:

1. `test(hub-cargo): caracteriza custodia intake e alocacao`
2. `fix(manifests): aplica elegibilidade contextual da carga`
3. `feat(hub-cargo): adiciona resolvedor operacional unificado`
4. `feat(hub-cargo): adiciona resumo e listas por custodia`
5. `feat(hub): cria workspace visual de pedidos`
6. `refactor(intake): extrai editor reutilizavel de entrada`
7. `feat(hub): integra bipagem entrada e recuperacao`
8. `feat(hub): integra selecao segura com viagens`
9. `refactor(hub): simplifica navegacao para inicio pedidos e viagens`
10. `test(hub): cobre fluxo operacional mobile de ponta a ponta`

Não misturar migração, refatoração fiscal não relacionada ou limpeza ampla de `HubHome` no mesmo commit de uma regra de custódia.

## 12. Matriz mínima de testes

| Caso | Resultado esperado |
|---|---|
| Abrir `No Hub` | Somente `AT_HUB` do Hub atual |
| Abrir `A caminho` | Viagens/pernas destinadas ao Hub, com previsão quando houver |
| Abrir `Aguardando entrada` | Demandas esperadas sem Order |
| Abrir `Pendências` | NF-e prontas para triagem no contexto autorizado |
| Bipar pedido no estoque | Mostrar e permitir seleção |
| Bipar pedido em trânsito | Mostrar estado e bloquear seleção |
| Bipar pedido de outro Hub | Não expor dados indevidos nem permitir ação |
| Bipar pedido já em viagem ativa | Mostrar conflito e link autorizado |
| Bipar demanda aguardando | Confirmar chegada sem duplicar |
| Bipar NF-e descoberta | Reutilizar XML e pedir confirmação física |
| Bipar NF-e desconhecida | Consultar, preencher e oferecer entrada |
| Cliente não existe | Cadastrar e retornar ao mesmo fluxo |
| Duas correspondências | Exigir escolha explícita |
| Falha depois de criar pré-entrada | Retomar de `awaiting_arrival` |
| Selecionar carga e atualizar página | Restaurar e revalidar seleção |
| Criar viagem comum | Aceitar apenas estoque do Hub |
| Criar viagem com coleta | Aplicar política de coleta, sem exigir `AT_HUB` cegamente |
| Pedido em outro rascunho | Rejeitar no servidor e informar viagem |
| Permissão de entrada ausente | Consulta permitida; mutação removida e bloqueada no servidor |
| Câmera negada | Digitação/leitor continuam disponíveis |

## 13. Verificações automatizadas

Executar por fatia:

```powershell
npm run typecheck:web
npm run typecheck:server
npm test
npm run test:server
npm run build
```

Executar testes isolados durante desenvolvimento:

```powershell
npm test --prefix server -- src/services/hubCargo
npm test --prefix server -- src/services/manifestLifecycle.test.ts
npm test --prefix server -- src/services/intake
```

Validação E2E:

- viewport 360 × 800;
- viewport 390 × 844;
- tablet;
- desktop;
- tema claro e escuro;
- teclado;
- câmera simulada;
- leitor físico simulado com entrada + Enter.

## 14. Performance

- Primeira página com no máximo 50 itens.
- Busca com debounce entre 200 e 300 ms.
- Cancelamento de requisições obsoletas.
- Scanner/câmera carregado sob demanda.
- Resumo independente da paginação.
- Skeleton estável para listas.
- Nenhum refetch completo de viagens, pedidos e intake após uma mutação pequena; atualizar cache local e revalidar apenas os buckets afetados.

## 15. Observabilidade e auditoria

Usar logs estruturados inicialmente:

- `hub_cargo_resolved`;
- `hub_cargo_resolution_failed`;
- `hub_arrival_confirmed`;
- `hub_arrival_partial`;
- `hub_trip_selection_rejected`.

Campos:

- Hub;
- usuário;
- tipo de código;
- resolução;
- duração;
- ação;
- motivo de bloqueio.

Não registrar chave completa, XML ou dados pessoais desnecessários.

Eventos de domínio continuam em:

- `DemandEvent`;
- `OrderHistory`;
- `OrderLeg`;
- histórico do Manifesto quando aplicável.

## 16. Rollout e rollback

1. Implementar backend compatível sem remover endpoints atuais.
2. Publicar em staging com workspace novo sob feature flag.
3. Rodar matriz automatizada e smoke operacional.
4. Comparar totais antigos e novos, explicando diferenças legítimas de custódia.
5. Validar com conta HUB real em staging.
6. Ativar nova navegação.
7. Manter fallback legado durante uma janela curta.
8. Remover fallback somente após métricas e operação estáveis.

Rollback:

- desativar workspace novo;
- rotas antigas continuam disponíveis;
- nenhuma migração destrutiva;
- transações de intake permanecem canônicas e idempotentes.

## 17. Migração de banco

**Não prevista para o primeiro corte.**

As entidades atuais já representam:

- NF-e descoberta;
- pré-entrada;
- chegada física;
- custódia do pedido;
- viagem;
- perna;
- parada;
- eventos e histórico.

Criar migração somente se a implementação provar a ausência de uma verdade necessária. Não adicionar coluna apenas para guardar estado visual derivável.

## 18. Critérios de aceite final

- O operador encontra visualmente o que está no Hub e o que está para chegar.
- O operador também pode bipar diretamente sem escolher um fluxo antes.
- Estoque nunca inclui pedido fora do Hub.
- Documento localizado nunca vira entrada física silenciosamente.
- Dados conhecidos não são solicitados novamente.
- Pedido inelegível não pode entrar em viagem nem pela UI nem pela API.
- Viagem iniciada por coleta não é quebrada pela regra de estoque.
- Cadastrar ou editar retorna ao mesmo contexto.
- Seleção e filtros sobrevivem à navegação.
- “Manifestos” aparece como “Viagens” na operação.
- O fluxo principal funciona com uma mão em 360 px, teclado e leitor físico.
- Todos os testes, typechecks e build passam antes de deploy.
