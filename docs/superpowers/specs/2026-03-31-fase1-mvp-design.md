# TSM EX OMNI — Fase 1 MVP: Operação Básica

**Data:** 2026-03-31  
**Status:** Aprovado  
**Escopo:** Operação Hub/CD → Manifesto → Link → Entrega (mobile-first)

---

## Contexto e Modelo de Negócio

TSM EX opera uma **rede de hubs** (transportadores regionais parceiros) conectados por **Links** (motoristas/transportadores autônomos encontrados em plataformas de anúncio de carga).

O diferencial central é o **complemento**: alocar espaço em caminhões que já vão para o destino, sem pagar pelo caminhão inteiro — maior margem do que carga fechada.

```
[Cliente] → NF ou Declaração → [Hub/CD]
[Hub/CD]  → consolida por destino → [Manifesto]
[Link]    → aceita Manifesto (complemento ou fechado) → [Hub Destino]
[Hub Destino] → entrega final ao cliente
```

**Premissa operacional:** Hubs não são próprios — são transportadores regionais parceiros que replicam o padrão TSM. Cada Hub novo = mais cobertura sem capex.

---

## O que Está Fora do Escopo da Fase 1

- CT-e (integração SEFAZ fiscal completa) → Fase 2
- Onboarding self-service de Hub parceiro → Fase 2
- Notificações automáticas (WhatsApp/email) → Fase 2
- IA de matching Link+rota → Fase 3
- App mobile nativo → Fase 3 (PWA via browser resolve Fase 1)

---

## Prioridade 1 — Entrada de Pedido Inteligente (Mobile-First)

### Contexto
A entrada de pedidos é a operação mais frequente e hoje é feita manualmente. Otimizar aqui é o maior ganho de tempo operacional imediato.

### Fluxo NF-e
1. Usuário abre tela de entrada de pedido (Hub)
2. Três opções de input da chave NF-e (44 dígitos):
   - **Digitar** o número manualmente
   - **Colar** da área de transferência
   - **Câmera** — abre câmera do dispositivo para ler QR Code da DANFE
     - QR Code da NF-e contém a URL com a chave de acesso embutida
     - Sistema extrai a chave de 44 dígitos da URL lida
3. Com a chave, sistema consulta API pública (SEFAZ ou agregador como NFe.io / SPED) para buscar XML
4. XML parseado pré-preenche automaticamente:
   - CNPJ/CPF e razão social do Remetente
   - CNPJ/CPF e razão social do Destinatário
   - Peso bruto, volumes, espécie (det > prod)
   - Valor total da NF
   - CEP de origem e destino
5. Usuário revisa campos pré-preenchidos, corrige se necessário
6. Usuário informa apenas o que falta: tipo de serviço (complemento/fechado), observações
7. Pedido criado — entra na fila do Hub

### Fluxo Declaração (sem NF)
- Ativado quando cliente quer transportar itens pessoais ou mercadorias sem NF
- Formulário simplificado: descrição dos itens, peso estimado, valor declarado, origem, destino
- Gera documento interno de Declaração (não fiscal)
- Mesmo fluxo de manifesto depois

### API de Consulta NF-e
- **Opção preferencial:** API pública da SEFAZ (consulta por chave de acesso)
  - Endpoint: `https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx` (web) ou webservice SOAP
  - Alternativa REST: agregadores como NFe.io, BHub, ou SEFAZ Virtual
- Implementar com fallback: se API falhar → usuário preenche manualmente (sem bloquear operação)
- Cache de chaves já consultadas para evitar re-fetch

---

## Prioridade 2 — Dashboard Hub (Operação do Dia)

### Visão Geral (tela inicial do Hub)
- Cards de resumo: pedidos aguardando, pedidos prontos para manifesto, manifestos em andamento
- Lista de pedidos no Hub agrupados por destino/UF (facilita consolidação visual)
- Ação rápida: "Criar Manifesto" com N pedidos selecionados

### Criação de Manifesto
- Selecionar pedidos (checkbox na lista, filtro por destino)
- Informar: Link (motorista), tipo de veículo, data de saída, tipo (complemento/fechado)
- Sistema calcula: peso total, volume total, valor total vs capacidade do veículo
- Alerta visual se ultrapassar capacidade
- Emitir Minuta de frete ao criar manifesto

### Estados visuais dos pedidos
- **Aguardando entrada** (NF registrada, aguarda chegada física)
- **No Hub** (chegou fisicamente)
- **No Manifesto** (em rota)
- **Entregue**

---

## Prioridade 3 — Dashboard Link (Mobile-First)

### Tela principal
- Lista de manifestos disponíveis para aceitar (por rota compatível com cobertura do Link)
- Card do manifesto: origem → destino, peso, tipo (complemento/fechado), valor estimado de frete
- Botão "Aceitar" com 1 toque — confirmação simples

### Execução da viagem
- Manifesto aceito mostra lista de NFs/pedidos
- Botões de status: "Saí do Hub", "Cheguei no destino", "Entregue"
- Campo de observação/foto opcional em cada etapa
- Histórico de viagens anteriores

---

## Prioridade 4 — Minuta de Frete

- Emitida automaticamente ao criar Manifesto
- Cálculo baseado na tabela de preços do Hub (PricingTable já existe no backend)
- Documento interno (não fiscal) imprimível/compartilhável via WhatsApp
- Campos: remetente, destinatário, NFs incluídas, peso, valor total, valor do frete

### CT-e (fora da Fase 1)
- Integração SEFAZ é complexa (certificado digital, ambiente de homologação/produção)
- Minuta cobre a operação internamente até Fase 2

---

## Prioridade 5 — Mobile Experience

### Princípios
- **Mobile-first:** projetado para celular, não adaptado depois
- **Touch targets:** botões e áreas clicáveis ≥ 48px
- **Bottom navigation** para roles operacionais (Hub, Link) — não sidebar
- **Formulários verticais** com campos grandes, teclado numérico onde aplicável
- **Dark mode** já suportado — manter
- **PWA:** adicionar manifest.json e service worker básico para instalação na home screen

### Por role
- **Hub:** Entrada de pedidos, lista do dia, criar manifesto
- **Link:** Ver manifestos, aceitar, atualizar status — uso 100% no celular durante viagem
- **Admin:** Dashboard completo, mantém desktop como primário mas funcional no mobile
- **Cliente:** Tracking de pedidos — mobile-first

---

## Arquitetura Técnica

### Frontend (ajustes)
- Substituir layout desktop-centric por bottom-tab navigation para Hub e Link
- Componente `QRCodeScanner` usando `jsQR` ou `html5-qrcode` (biblioteca leve, sem dependência nativa)
- Componente `NFeLookup` — encapsula o fetch da API + parsing do XML
- Redesign dos forms de entrada com `react-hook-form` + validação Zod no cliente

### Backend (ajustes)
- Nova rota: `GET /api/nfe/:chave` — proxy para API SEFAZ + cache Redis
- Endpoint retorna objeto normalizado (não o XML bruto) com os campos necessários
- Evitar expor chave da API SEFAZ no frontend

### Dados
- Nenhuma mudança de schema necessária para Fase 1 — tudo já existe no Prisma
- `Demand` + `Order` + `OrderInvoice` + `Manifest` cobrem todo o fluxo

---

## Gaps Identificados no Código Atual (a corrigir)

| Gap | Onde | Ação |
|-----|------|------|
| QR Code scanner ausente | EntradaTab / OrderNFForm | Implementar com `html5-qrcode` |
| Consulta NF-e API ausente | Backend routes/nfe | Nova rota proxy |
| Declaração não ativada | OrderNFForm | Ativar branch de Declaração |
| Dashboard Hub incompleto | HubHome.tsx | Reescrever mobile-first |
| Dashboard Link incompleto | LinkHome.tsx | Reescrever mobile-first |
| Sem bottom navigation | App.tsx | Adicionar para roles Hub/Link |
| Minuta não emite de fato | freightEmission.ts | Completar emissão e PDF |
| Forms não mobile-first | components/admin/* | Refatorar layout responsivo |

---

## Critérios de Sucesso da Fase 1

1. Hub consegue registrar uma NF em menos de 60 segundos via QR Code
2. Hub consegue criar um Manifesto com N pedidos em menos de 3 minutos
3. Link consegue aceitar manifesto e atualizar status pelo celular sem assistência
4. Minuta de frete gerada automaticamente ao criar manifesto
5. Todo o fluxo funciona bem em tela de 375px (iPhone SE)

---

## Ordem de Implementação

1. **Backend:** rota `/api/nfe/:chave` (proxy SEFAZ + Redis cache)
2. **Frontend:** componente QRCodeScanner + NFeLookup
3. **Frontend:** EntradaTab/OrderNFForm — refatorar mobile-first + integrar leitura NF-e
4. **Frontend:** ativar fluxo Declaração
5. **Frontend:** HubHome — redesign mobile-first (lista pedidos + criar manifesto)
6. **Frontend:** LinkHome — redesign mobile-first (aceitar manifesto + status)
7. **Backend:** completar emissão de Minuta (PDF)
8. **Frontend:** bottom navigation para Hub e Link
9. **PWA:** manifest.json + service worker básico
10. **QA:** testar fluxo completo em mobile (375px e 390px)
