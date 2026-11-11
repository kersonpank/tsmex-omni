# Volta completa da roda em staging — resultado (2026-11-10 e 11)

Ambiente: `staging-tsmex-dev`, fiscal em homologação (ACBr e e-Frete). Todas as chamadas foram feitas na API
pública do staging com usuário operador de hub (SP-GRU e SLZ-MA); ADMIN só em cobertura, fatura e contas a pagar.

## O que foi provado

Duas remessas reais deram a volta. Cada linha foi executada, não lida no código.

| Passo | Resultado |
|---|---|
| Entrada de NF-e → pedido → volumes | OK |
| CT-e do pedido | Autorizado em cerca de 10 s |
| Fila de consolidação por próximo salto | OK, inclusive rota por hub intermediário |
| Viagem tronco SP-GRU → SLZ-MA: transportador, veículos, Carta Frete, oferta e aceite pelo hub | OK |
| CIOT | Autorizado, PDF arquivado |
| MDF-e | Autorizado |
| Saída registrada pelo hub | OK |
| Chegada em SLZ-MA com conferência (avaria registrada, alerta criado) | OK |
| MDF-e e CIOT encerrados ao concluir | OK |
| Pedido cai sozinho na fila de entrega do hub de chegada | OK |
| Viagem de entrega pelo hub (destino = cidade da entrega), CIOT, MDF-e, saída | OK |
| Entrega com comprovante registrada pelo hub; viagem concluída pelo hub | OK |
| Entrega que falha: carga volta ao estoque e reaparece na fila | OK |
| Fatura do pedido entregue, inclusive de pagador que não tinha conta | OK (`FAT-2026-001`, `FAT-2026-002`) |
| Título do transportador gerado sozinho ao concluir; pagamento registrado | OK |
| Fechamento da viagem (receita líquida, custo, margem, ocupação) | OK |

## Defeitos corrigidos (todos com teste, no `develop`)

**MDF-e** — nunca tinha sido autorizado:
1. Tipos do payload (`procEmi`, `indPag`, `nParcela`).
2. Configuração de MDF-e da empresa na ACBr.
3. UF do proprietário do veículo sem inscrição estadual.
4. Seguro da carga (grupo `seg`): seguradora, CNPJ e apólice no emitente; averbação na viagem.
5. CIOT com 12 dígitos, sem o verificador do e-Frete.
6. Produto predominante; em carga lotação, CEPs de carga/descarga e NCM.
7. Rejeição devolvida como "denegado" deixava o documento preso em envio.
8. Referência única por tentativa.
9. Encerramento: corpo no contrato da ACBr.

**CIOT** — nunca tinha sido autorizado:
10. Reenvio ficava preso na fila para sempre.
11. PDF por POST versão 1.
12. Protocolo numérico impedia marcar como autorizado.
13. Reenvio com PDF pendente emitia um segundo CIOT para a mesma viagem.
14. Encerramento: versão 2 e peso transportado.
15. Erro de cadastro aparecia como "falha de comunicação"; PDF que falha agora é repetido sozinho.
16. Mesmo município na origem e no destino: envia CEPs.

**Operação:**
17. Fatura devolvia erro 500 (nunca tinha funcionado).
18. Pedido recebido ficava preso a rascunho de viagem do hub de origem.
19. Conferência de chegada não tinha efeito: "não chegou" virava estoque.
20. Entrega só existia no app do transportador; hub não concluía viagem de entrega.
21. Entrega que falha travava viagem e carga para sempre.
22. Viagem de entrega nascia com destino na cidade do próprio hub.
23. CIOT e MDF-e exigiam CNPJ próprio do hub mesmo com emitente fiscal definido.
24. Trocar o transportador mantinha os veículos do anterior.
25. Sem jeito de repetir o encerramento fiscal que falhou.
26. Teia de um salto só: agora `Hub.gatewayHubId` ("abastecida por") define o caminho.

**Dinheiro:**
27. Pedido de pagador sem conta de cliente não era faturável (21 de 26).
28. Margem contava a receita em dobro em pedido multi-perna e incluía ICMS.
29. Acordos de custo (transportador e comissão do hub) sem tela.
30. Título do transportador dependia de alguém lembrar.

**Segurança (gate de pré-produção):** chave de LLM não é mais devolvida por HTTP e é cifrada em repouso; seed sem
senhas fracas em produção; rate limit, helmet, limites de corpo e upload seguro; IDOR em demandas, transportadores,
NF-e, chat e oportunidades; JWT com algoritmo fixo; validação de ambiente no boot; desligamento limpo.

## Regras de negócio que a SEFAZ e o e-Frete impuseram

- **Dispensa de CIOT só vale para frota própria.** Com transportador contratado a SEFAZ rejeita o MDF-e
  ("CIOT obrigatório para RNTRC informado"). O sistema agora bloqueia antes de reservar número.
- **Seguro da carga é obrigatório no MDF-e** de transportadora.
- **Viagem com um único CT-e é carga lotação**: exige NCM do produto predominante e CEPs.
- **Frete do CIOT abaixo do piso ANTT é rejeitado**; a distância informada é conferida contra origem e destino.

## Pendências

**Dados reais que só a operação tem:**
- Seguro: no staging ficaram valores fictícios. Cadastrar seguradora, CNPJ e apólice reais no emitente.
- Cobertura dos hubs e "abastecida por": no staging há uma cobertura de teste para SLZ-MA e IMP-MA.
- Tabelas de preço do corredor e acordos de custo de transportadores e hubs.

**Construir:**
- Averbação automática pela AT&M (pesquisa em `docs/fiscal/atm-averbacao-pesquisa.md`). Hoje a averbação é digitada
  na viagem. Falta pedir à AT&M o acesso de homologação.
- Cancelar e substituir CT-e.
- Fila de exceções para o hub (hoje os alertas só aparecem para ADMIN).
- Entrega parcial devolve o pedido inteiro ao estoque, com nota; não divide o pedido.
- Varredor de conciliação de CT-e pendente (9 presos desde julho no staging).

**Não verificado:**
- Telas no navegador. As telas novas (Entregar, conferência, fechamento, acordos de custo, faturas) passaram em
  typecheck e testes de componente; a volta foi executada pela API.
- Emissão com mais de um CT-e por viagem e viagem de entrega com várias cidades.
- Nada foi emitido em produção.

**Limpeza no staging:**
- CIOT `560000617005/6166` ficou aberto no e-Frete de homologação (duplicado antes da correção 13).
- Números 1 a 10 do MDF-e de homologação foram consumidos pelas tentativas rejeitadas.
- Aplicar no Portainer o `docker-stack.staging.yml` novo (`RUN_SEED: "false"`).
