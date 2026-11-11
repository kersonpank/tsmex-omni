# Liberação de viagem pela operação

Na revisão, ADMIN ou HUB de origem pode usar **Liberar viagem pela operação**. O transportador precisa estar aprovado e o motorista deve estar cadastrado e vinculado. Conta no aplicativo e aceite externo são opcionais. As oito etapas existentes foram preservadas e as etapas de planejamento podem ser consultadas mesmo com pendências.

A liberação valida o planejamento, a composição e os vínculos, grava seu retrato e mantém o estado interno `ACCEPTED`. A interface diferencia **Liberada pela operação** do aceite pelo transportador. Isso não autoriza documentos fiscais: a saída continua dependendo dos CT-es, MDF-e e CIOT exigidos, ou dispensa justificada de CIOT.

## Interfaces e autoria

- `POST /api/manifests/:id/release`: ADMIN ou HUB de origem; aceita `DRAFT` e `PENDING_ACCEPT`.
- `PATCH /api/manifests/:id/accept`: mantém o aceite pelo LINK atribuído, usando a mesma transição transacional.
- `PATCH /api/manifests/:id/start`: ADMIN, HUB de origem ou LINK atribuído; valida documentos antes de iniciar.
- `POST /api/manifests/:id/reconcile-ciot`: ADMIN ou HUB de origem; consulta tentativa com resultado desconhecido ou PDF pendente, sem enviar nova operação.
- Prontidão: `canRelease`, `canSendOffer`, `canEmitCiot`, `canEmitMdfe` e `actionIssues` por ação. `canOffer` permanece como compatibilidade para envio de oferta.
- `Manifest.releaseSource`, `releasedByUserId`, `releasedAt` e `startedByUserId` registram autoria. `acceptedAt` permanece por compatibilidade. Viagens antigas continuam com os campos novos vazios.

## Correções e processamento fiscal

Rejeição confirmada permite correção quando não existem documentos ativos/autorizados ou outras restrições fiscais. Ao reabrir, o retrato é limpo; a próxima liberação registra a composição corrigida. A correção preserva a autoria da liberação anterior no histórico.

Resultado desconhecido permanece protegido. A consulta por `IdOperacaoCliente` recupera o CIOT encontrado e seu PDF, ou confirma ausência e disponibiliza uma nova tentativa. Repetições mantêm a identificação idempotente; a fila remove somente jobs concluídos/falhos para permitir sua execução novamente. Documento autorizado nunca é sobrescrito por uma edição de planejamento.

## Banco e validação

A migração aditiva é `server/prisma/migrations/20261005120000_manifest_operator_release/migration.sql`. Aplicar pelo fluxo normal de migrações do ambiente e gerar o Prisma Client antes de executar esta versão. Não há preenchimento presumido de autoria em registros existentes.

Na base local consultada durante a implementação, havia 21 migrações anteriores pendentes, inclusive estruturas de veículos e múltiplos motoristas ainda ausentes. O lote não foi aplicado nesta tarefa. A nova migração foi validada em tabela temporária PostgreSQL, preservando estados existentes e deixando os novos campos nulos.

Foram verificados liberação sem conta, oferta pendente, permissões entre unidades, registro de saída com evidência fiscal, fluxo completo de transferência, correção de rejeições, consulta após timeout, reutilização da chave idempotente, fila, cadastro público pelo convite, tipos e builds. As respostas fiscais foram simuladas nos testes; não houve emissão real em homologação ou produção.

## Ajustes cirúrgicos — 05/10/2026

Transportador contratado continua obrigatório: Link fornece CPF/CNPJ e RNTRC do contratado; Driver identifica quem conduz; FiscalEmitter identifica a TSM contratante. Login do transportador no aplicativo e aceite externo são opcionais. A autenticação na eFrete é da integração.

O bloco Contratado do CIOT usa o documento e RNTRC do transportador, separados dos proprietários e titulares RNTRC da composição. Salvar a composição não sobrescreve o RNTRC do contratado. O atalho de tipo/RNTRC abre a ficha do contratado; pendência do titular abre a Person indicada, com seu documento e endereço.

CT-e autorizado não impede reabrir a viagem antes da saída se não há CIOT/MDF-e ativo ou autorizado. Depois de reabrir, pedidos, rota fiscal e emitente que já sustentam CT-e ficam protegidos; motorista, composição e Carta Frete podem ser conferidos e corrigidos. A primeira consolidação do rascunho continua permitindo vários pedidos já documentados. Alteração de composição exige nova liberação e novo retrato. Capa e Carta Frete agora exigem rascunho e compartilham bloqueio transacional com a liberação. Correções guardam autoria, motivo e antes/depois; alterações de cadastros em viagens já ofertadas/liberadas exigem justificativa. Cadastros compartilhados são protegidos enquanto a operação fiscal está ativa ou inconclusiva.

### Contrato confirmado com a eFrete em homologação

Manual v8.2, seção 2.5.3: consulta por IdOperacaoCliente usa MatrizCNPJ, identificação original, autenticação e versão 1. A chamada GET existente retornava Requisicao.Nula; POST versão 1 confirmou Operacao.Nao.Localizada para uma identificação inexistente. A implementação passou a usar POST e esse código explícito. Resposta vazia, código/situação ausentes, HTTP 404 de infraestrutura, falha de autenticação e timeout não confirmam ausência.

MatrizCNPJ fica registrada no requestData de novas tentativas, junto do ambiente original. Repetições da mesma operação preservam essa identidade. Tentativas antigas sem identificação verificável da matriz permanecem protegidas e exigem verificar o emitente original antes da reconciliação; não se presume ausência. Consulta a CIOT cancelado/encerrado atualiza o histórico. CIOT encontrado com PDF pendente fica READY, com código conhecido e ação de recuperar arquivo, sem nova emissão. ObterOperacaoTransportePdf também usa POST versão 1, conforme seção 2.5.4. A autorização local completa permanece dependente do arquivamento real do PDF.

CiotEmissionAttempt guarda a entrada e os payloads/respostas de cada execução. Repetir um job não elimina a entrada anterior. Migração aditiva: 20261005140000_ciot_attempt_history. Recusas anteriores aparecem no histórico; a pendência atual fica separada.

### Disponibilização e limites da validação

A configuração disponível aponta para PostgreSQL local tsmex e API 3002; essa API não respondeu durante a revisão. O ambiente usado pelo usuário ainda precisa ser identificado. Foi criado backup e restaurada uma cópia local; as 23 migrações pendentes foram aplicadas nela com sucesso. A viagem existente manteve ID/estado; não houve atribuição presumida de autoria. A base original não foi migrada.

O relatório reproduzível está em manifest-release-migration-review.json, com identificação da cópia e backup. A autenticação e a consulta real por identificador inexistente foram validadas em homologação. Emissão completa de CIOT/MDF-e e recuperação de um PDF real continuam pendentes de uma viagem de teste com todos os cadastros válidos. Nenhum documento foi emitido em produção; os cenários de emissão, recusa, timeout e execução usam provedores simulados nos testes automatizados.
