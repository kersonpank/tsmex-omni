# Mapa de Integração ACBR Fiscal

## Objetivo

Este mapa orienta o fluxo fiscal do TSM EX OMNI com ACBR API. A regra central: pedido guarda documentos originários, cálculo de frete emite CT-e/DC-e, manifesto emite MDF-e.

## Autenticação e Ambientes

- Autenticação: OAuth2 `client_credentials`.
- Token: `https://auth.acbr.api.br/realms/ACBrAPI/protocol/openid-connect/token`.
- Homologação: `https://hom.acbr.api.br`.
- Produção: `https://prod.acbr.api.br`.
- Tokens, certificados e senhas ficam só no backend.
- Token deve ser cacheado até próximo do `expires_in`.

## Pré-Requisitos por Emitente

1. Pessoa jurídica completa no TSM: CNPJ, razão social, IE quando aplicável, endereço, município, UF e CEP.
2. `FiscalEmitter` ativo, ambiente, provider `ACBR`, série/numeração, CRT/regime, RNTRC e vínculo com hub quando necessário.
3. Empresa cadastrada na ACBR: `POST /empresas`.
4. Certificado A1 enviado: `PUT /empresas/{cpf_cnpj}/certificado`.
5. Serviço configurado por documento: `/cte`, `/dce`, `/mdfe`, `/nfe`, `/distnfe`.

## CT-e

No TSM:

- Origem: `OrderFreightCalculation` com `documentType = CTE`.
- Documento originário: `OrderInvoice` tipo `NFE` com chave 44 dígitos.
- Emissão: `POST /api/orders/:orderId/freight-calculations/:calcId/emit-cte`.
- Preflight: validar CFOP, CST, emitente, tomador, RNTRC, endereço, valor de frete e NF-e.
- Autorizado só com chave, protocolo, XML e data.

Na ACBR:

- Emitir: `POST /cte`.
- Consultar: `GET /cte/{id}`.
- Sincronizar: `POST /cte/{id}/sincronizar`.
- XML/PDF: endpoints `/xml` e `/pdf`.
- Eventos: cancelamento e carta de correção.

## DC-e

No TSM:

- Origem: `OrderFreightCalculation` com `documentType = DCE`.
- Documento originário: declaração em `OrderInvoice` tipo `OUTRAS`.
- Usar quando não há NF-e válida para CT-e.

Na ACBR:

- Emitir: `POST /dce`.
- Consultar/listar: `GET /dce` e `GET /dce/{id}`.
- XML/PDF: endpoints `/xml` e `/pdf`.
- Evento principal: cancelamento.

## MDF-e

No TSM:

- Origem: `Manifest`.
- Depende de CT-es autorizados nos pedidos do manifesto.
- Não nasce do cálculo de frete.

Na ACBR:

- Emitir: `POST /mdfe`.
- Consultar: `GET /mdfe/{id}`.
- Encerrar: `POST /mdfe/{id}/encerramento`.
- Cancelar: `POST /mdfe/{id}/cancelamento`.
- Incluir DF-e/condutor quando necessário.

## NF-e e Distribuição DF-e

- NF-e emitida por terceiros entra no pedido como documento originário.
- Distribuição NF-e/DF-e serve para buscar XML, consultar NSU e manifestar ciência/confirmação.
- Distribuição não autoriza CT-e sozinha; o pedido ainda precisa guardar chave NF-e 44 dígitos.

## Estados Fiscais TSM

- `DRAFT` / `CALCULATED`: cálculo editável.
- `CTE_READY`: pronto para envio.
- `CTE_SENT`: enviado ao provider, aguardando retorno.
- `CTE_REJECTED`: rejeição fiscal do provider/SEFAZ.
- `CTE_AUTHORIZED`: autorizado com chave, protocolo, XML e data.
- `CTE_CANCELLED`: cancelado por evento fiscal.

Pendências de preenchimento não devem virar rejeição fiscal persistida. Preflight deve mostrar pendências antes do envio.

## CFOP e CST

- CFOP vai em `infCte.ide.CFOP`.
- CST vai dentro do grupo `infCte.imp.ICMS`.
- Catálogo MVP deve ser explícito e auditável.
- Se o CST não é suportado pelo mapper, bloquear no preflight.
- Não trocar CST do operador por fallback silencioso.

## Operação Assistida

Antes de emitir CT-e em homologação:

1. Pedido tem NF-e com chave 44 dígitos.
2. Frete está calculado e total maior que zero.
3. Cálculo tem `CFOP` e `CST`.
4. Emitente ACBR está ativo e pronto.
5. Preflight retorna `ok = true`.
6. Emissão retorna chave, protocolo e XML.
