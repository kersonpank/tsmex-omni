---
name: tsmex-acbr-fiscal
description: Guia integrações ACBR API no TSM EX OMNI. Use quando trabalhar com CT-e, DC-e, MDF-e, NF-e, distribuição DF-e/NF-e, emitente fiscal, certificado A1, homologação, SEFAZ, CFOP, CST, XML, DACTE, DAMDFE ou provider ACBR. Para fluxo ponta a ponta homologação, console ACBr vazio e checklist env/runtime, usar também a skill `tsmex-acbr-api-definitivo`.
---

# TSM EX ACBR Fiscal

## Verdade Fiscal

- XML autorizado pela SEFAZ/provider é o documento oficial.
- DACTE, DANFE, DAMDFE e impressões equivalentes são auxiliares do XML.
- Minuta é operacional e deve ser marcada como sem valor fiscal quando não houver autorização.
- Nunca gravar status autorizado sem chave, protocolo, XML bruto e data de autorização.
- Homologação deve ficar clara na UI, impressão e logs operacionais.

## Fluxos TSM

- NF-e originária pertence ao pedido, em `OrderInvoice`; CT-e usa chave NF-e 44 dígitos como documento originário.
- CT-e nasce em `OrderFreightCalculation` e depende de frete calculado, emitente credenciado, CFOP, CST, RNTRC, partes e endereços fiscais.
- DC-e nasce em `OrderFreightCalculation` quando o pedido usa declaração em `OUTRAS`, não NF-e.
- MDF-e nasce no `Manifest`, após CT-es autorizados das demandas consolidadas.
- Distribuição NF-e/DF-e consulta documentos contra SEFAZ/ACBR; não substitui emissão.

## ACBR API

- Fluxo operacional homologação, diagnóstico “sem requisição no console” e prompt de contexto: skill **`tsmex-acbr-api-definitivo`** (`.cursor/skills/tsmex-acbr-api-definitivo/SKILL.md`).
- Autenticação: OAuth2 `client_credentials` no backend, nunca no frontend.
- Base homologação: `https://hom.acbr.api.br`.
- Base produção: `https://prod.acbr.api.br`.
- Pré-requisitos por CNPJ: `POST /empresas`, certificado A1 via `/certificado`, configuração do serviço fiscal.
- CT-e: `POST /cte`, `GET /cte/{id}`, `POST /cte/{id}/sincronizar`, XML/PDF, cancelamento e carta de correção.
- DC-e: `POST /dce`, consulta, sincronização quando disponível, XML/PDF e cancelamento.
- MDF-e: `POST /mdfe`, consulta, encerramento, cancelamento e inclusão de DF-e/condutor.
- NF-e: emissão, consulta, inutilização, cancelamento, carta de correção, XML/PDF.
- Distribuição NF-e: solicita distribuição, lista documentos, baixa XML/PDF e manifesta eventos.

## Segurança

- Não logar token, certificado, senha do certificado, XML sensível completo ou documentos pessoais quando não necessário.
- Certificado A1 só por ADMIN, storage privado, senha criptografada, fingerprint e validade quando conhecidos.
- Tratar `402` como crédito/cota; tratar `429` com backoff respeitando headers de retry.
- Usar `referencia` idempotente por documento interno para conciliar tentativas.

## CT-e Preflight

Antes de chamar ACBR:

1. Validar emitente CNPJ, IE quando aplicável, CRT/regime, RNTRC, endereço completo e ambiente.
2. Validar tomador conforme CIF/FOB/consignatário.
3. Validar remetente, destinatário, início/fim prestação, frete maior que zero.
4. Validar NF-e originária com chave 44 dígitos.
5. Validar CFOP e CST pelo catálogo fiscal suportado.
6. Mostrar pendências na UI antes de emitir.

## CFOP/CST MVP

- Não inventar regra fiscal automática quando depender de contador/operação.
- Catálogo local deve listar opções suportadas e labels de operação.
- Mapper ACBR não deve trocar CST escolhido por fallback silencioso.
- CST não suportado deve falhar no preflight, não virar XML divergente.

## Verificação

- Teste backend fiscal focado antes de concluir: `npm test --prefix server -- src/services/cteService.test.ts`.
- Typecheck backend: `npm run typecheck:server`.
- Build frontend quando mexer na UI: `npm run build`.
