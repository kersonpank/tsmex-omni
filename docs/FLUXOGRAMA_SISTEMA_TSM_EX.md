# Fluxograma do Sistema TSM EX

## 1. Visão geral dos atores e painéis

```mermaid
flowchart TB
    subgraph Atores [Atores do Sistema]
        Admin[Admin]
        Hub[Hub - Operador do Depósito]
        Link[Link - Motorista]
        Cliente[Cliente]
    end

    subgraph Painéis [Painéis / Rotas]
        Gestao[/gestao - Torre de Controle]
        LinkApp[/link - Minha Carga]
        Client[/client - Dashboard Cliente]
    end

    Admin --> Gestao
    Hub --> Gestao
    Link --> LinkApp
    Cliente --> Client
```

---

## 2. Fluxo de autenticação e rotas

```mermaid
flowchart TB
    Start([Acessa Sistema]) --> Login{Está autenticado?}
    Login -->|Não| LoginPage[Página de Login]
    Login -->|Sim| CheckRoles{Quais papéis?}

    LoginPage --> CadastroLink[Cadastro Link - /link/cadastro]
    LoginPage --> CadastroHub[Cadastro Hub - /hub/cadastro?hubId=xxx]
    LoginPage --> Onboarding[Conta Empresarial - /onboarding]

    CadastroLink --> Login
    CadastroHub --> Login
    LoginPage -->|Login OK| CheckRoles

    CheckRoles -->|CLIENT| Client[/client]
    CheckRoles -->|ADMIN ou HUB| Gestao[/gestao]
    CheckRoles -->|LINK| LinkApp[/link]

    Client --> DemandaClient[Demandas, Cotação, Coleta]
    Gestao --> DemandaAdmin[Demandas, Viagens, Pedidos, Hubs, Links]
    LinkApp --> ManifestoLink[Manifestos designados, Pedidos]
```

---

## 3. Ciclo operacional completo (demanda → entrega)

```mermaid
flowchart LR
    subgraph Origem [Origem da Demanda]
        C1[Cliente - Cotação/Coleta]
        Chat[Chat IA]
        Form[Formulário]
    end

    subgraph AdminFlow [Admin - Orquestração]
        O1[Oportunidade]
        O2[Converte em Demanda]
        O3[Aprova / Cotação]
        O4[Cria Manifesto]
        O5[Atribui Link]
    end

    subgraph HubFlow [Hub - Depósito]
        H1[Entrada de mercadoria]
        H2[Pedidos no hub]
        H3[Carregamento]
        H4[Saiu para entrega]
    end

    subgraph LinkFlow [Link - Transporte]
        L1[Aceita Manifesto]
        L2[Coleta]
        L3[Em trânsito]
        L4[Entrega]
    end

    C1 --> O1
    Chat --> O1
    Form --> O1
    O1 --> O2 --> O3 --> O4 --> O5
    O5 --> L1
    H1 --> H2
    O3 --> H1
    L1 --> L2 --> L3 --> H2
    H2 --> H3 --> H4
    H4 --> L3
    L3 --> L4
```

---

## 4. Cadastros e onboarding

```mermaid
flowchart TB
    subgraph LinkCadastro [Cadastro Link]
        LC1[Intro] --> LC2[Documentação]
        LC2 --> LC3[E-mail, Senha, WhatsApp]
        LC3 --> LC4[Cria User + Link]
        LC4 --> LC5[Aguarda aprovação]
    end

    subgraph HubCadastro [Cadastro Hub]
        HC1[Admin cria Hub]
        HC2[Admin copia link]
        HC2 --> HC3[Parceiro acessa link]
        HC3 --> HC4[CPF/CNPJ, Nome, E-mail, Senha]
        HC4 --> HC5[Cria User HUB ou adiciona papel]
    end

    subgraph ClienteCadastro [Cadastro Cliente]
        CC1[Onboarding Empresarial]
        CC2[Account + Companies]
        CC3[User CLIENT]
    end
```

---

## 5. Estrutura de dados (simplificada)

```mermaid
erDiagram
    User ||--o| Client : has
    User ||--o| Link : has
    User ||--o| Admin : has
    User }o--o| Hub : "opera"

    Account ||--o{ Client : contains
    Account ||--o{ AccountCompany : has

    Demand ||--o| Manifest : "em"
    Demand ||--o| Order : generates
    Order }o--o| Hub : "em"

    Manifest ||--o{ Demand : contains
    Manifest }o--o| Link : "atribuído"
    Manifest }o--o| Hub : "origem"
```

---

## 6. Próximos passos para o MVP

| # | Item | Prioridade | Descrição |
|---|------|------------|-----------|
| 1 | **Multi-conta por email** | Alta | Mesmo email pode ter Link, Hub, Admin, Cliente. Ao cadastrar novo papel, atribuir em vez de bloquear. |
| 2 | **Seletor de painel na UI** | Alta | Quando usuário tem múltiplos papéis, mostrar opção para trocar entre painéis (ex: "Ver como Admin", "Ver como Link"). |
| 3 | **Seleção de Hub no Link** | Média | Ao marcar "Chegou no hub", substituir prompt por dropdown de Hubs. |
| 4 | **Tracking público** | Média | Permitir link compartilhável de tracking sem login para o cliente acompanhar. |
| 5 | **Fluxo completo de demanda** | Alta | Validar ciclo: Cliente cria demanda → Admin aprova/cota → Cria manifesto → Atribui Link → Link confirma → Hub registra entrada/saída. |
| 6 | **Permissões HUB na UI** | Média | Interface para Admin definir permissões por usuário do Hub (entrada, manifestos, pedidos, demandas). |
| 7 | **Link app simplificado** | Média | Remover "Ofertas"; focar em manifesto designado, confirmação e documentação da viagem. |

---

## 7. Dependências entre itens

```mermaid
flowchart LR
    MC[1. Multi-conta] --> SP[2. Seletor painel]
    MC --> FH[5. Fluxo demanda]
    SP --> FH
    FH --> SH[3. Seleção Hub]
    FH --> TP[4. Tracking público]
```

---

*Documento gerado em fev/2026 - TSM EX v2.0*
