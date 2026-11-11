# Integração com a AT&M (averbação eletrônica) para o TSM EX OMNI

Data da pesquisa: 2026-11-10. Somente leitura; nenhuma API da AT&M foi chamada.

Legenda de confiança: ALTA = manual oficial AT&M (v3.0) ou código de cliente open source funcional; MÉDIA = fonte secundária coerente; BAIXA = relato isolado/inferência.

Fontes primárias baixadas (copiadas só para leitura local, em `.../scratchpad/atm/dl/`):
- Manual oficial AT&M "Integração WebService v3.0" (PDF, 78 págs.), hospedado no repo da NFePHP: https://github.com/nfephp-org/sped-averbacao/blob/master/examples/docs/ATM/Manual_AT%26M_Integracao_WebService_v30_1.pdf
- Cliente PHP: https://github.com/nfephp-org/sped-averbacao/blob/master/src/Atm.php (e `examples/fixtures/Atm/response.xml`, `examples/docs/ATM/xmlErros.xml`)
- Cliente Harbour/ACBr-like: https://github.com/JoseQuintas/sefazclass/blob/master/source/ze_atmseguroclass.prg
- Cliente PHP/Laminas (parse do MDF-e): https://github.com/paseto/atm-api/blob/master/src/ATMAverba.php
- Cliente TS de terceiro (campos `DadosSeguro`, `AverbadoRCV`): https://github.com/Marcelo-Rosas/cargo-flow-navigator/blob/main/supabase/functions/_shared/averba-client.ts

---------------------------------------------------------------------
## 1. FATOS COM FONTE
---------------------------------------------------------------------

### 1.1 O que é averbado e quando
- A averbação é a declaração das mercadorias em risco ao seguro. A AT&M oferece "Integração WebService" para averbar online, em tempo real, e síncrona ("Na mesma sessão, de modo síncrono receberá o XML de retorno"). (Manual AT&M §2 e §10.) ALTA
- Documentos averbáveis no webservice: CT-e (`averbaCTe`), NF-e (`averbaNFe`) e "outros documentos" (layout AT&M próprio, §14). Cancelamento de CT-e e de NF-e é feito reenviando o XML de cancelamento protocolado na mesma operação (§13, §22). ALTA
- Exigência: o XML de CT-e/NF-e enviado deve estar protocolado (autorizado) pela SEFAZ. (Manual §10.) ALTA
- Se o XML tiver `tpAmb=2` (homologação SEFAZ), a AT&M devolve protocolo literal `TESTE` e avisa que seguradora pode não considerar (Manual §11). ALTA
- MDF-e: existe operação `declaraMDFe` (campo `xmlMDFe`), SOAPAction `urn:ATMWebSvr#declaraMDFe`. Fontes: Atm.php (NFePHP), ze_atmseguroclass.prg, ATMAverba.php (links acima). ALTA para existência/assinatura; o Manual v3.0 oficial NÃO documenta `declaraMDFe` (grep por "MDF" = 0 ocorrências). A Senior descreve que a declaração do MDF-e é enviada à AT&M após autorização, cancelamento ou encerramento, e exige o endereço `/20/index.soap`, pois o endereço antigo não tinha a chamada: https://documentacao.senior.com.br/gestaodetransportestms/3.33/tms/mdfe/mdfe-averbada.htm (MÉDIA/ALTA)
- Resposta do `declaraMDFe` (parse do ATMAverba.php): nós `Declarado/Protocolo` e `Declarado/dhChancela` (em vez de `Averbado/...`). MÉDIA (código de terceiro, não manual).
- O artigo de Flademir Lausino de Almeida (sócio-diretor da AT&M) diz que, pelas resoluções ANTT/Sefaz, a averbação eletrônica é feita "no ato da viagem", e que o MDF-e 3.00 passou a exigir o registro do seguro (CNPJ + nome da seguradora, apólice, número de averbação) e "não permitirá o registro do seguro em momento posterior ao início da viagem": https://mundologistica.com.br/artigos/transporte-de-cargas-e-as-novas-regras-do-mdf-e-300 (MÉDIA; é artigo de opinião do próprio fornecedor)
- Blog de software (bsoft): averbação sempre antes do início do transporte; averba-se primeiro o CT-e e depois emite-se o MDF-e porque este precisa do número da averbação: https://bsoft.com.br/blog/?p=2041 (MÉDIA/BAIXA; blog comercial)
- Regra de embarque da apólice: erros 010/011 da AT&M indicam "Obrigatório o averbamento antes do embarque" e "quantidade máxima de horas para averbamento após embarque" (tabela de erros, `xmlErros.xml`). Cada apólice pode ter regra diferente. ALTA
- CT-e complementar é consistido com valor averbado 0,01; CT-e de subcontratação (tpServ=1) idem se a flag do segurado marcar "não paga subcontratação" (Manual §25 FAQ). ALTA

### 1.2 API (SOAP) e endpoints
- Protocolo: SOAP 1.1 RPC, namespace `urn:ATMWebSvr`. ALTA
- Produção: `http://webserver.averba.com.br/20/index.soap` (WSDL: `...index.soap?wsdl`). Homologação: `http://homologaws.averba.com.br/20/index.soap`. Fonte: Atm.php (NFePHP) e ze_atmseguroclass.prg. Senior confirma `webserver.averba.com.br/20/index.soap?wsdl`. ALTA. (O cliente de terceiro usa https no mesmo caminho; o Manual §25 menciona uma URL antiga de teste "homologacao.averba.com.br/webserver" - provavelmente defasada; fórum ACBr relata `testewebserver.averba.com.br` fora do ar: https://www.projetoacbr.com.br/forum/topic/50003-averba%C3%A7%C3%A3o-de-ct-e/ - BAIXA.)
- Operações vistas: `averbaCTe` (param `xmlCTe`), `averbaNFe` (`xmlNFe`), `declaraMDFe` (`xmlMDFe`), `listaErros`. O Manual nomeia `averbaCTe20`/`averbaNFe20` e `listaErros`; os clientes funcionais usam `averbaCTe`/`averbaNFe`. ALTA (divergência de nome entre manual e código: testar contra o WSDL).
- Autenticação: sem token; os três campos vão em todo request no corpo: `<usuario>`, `<senha>`, `<codatm>` (todos string). Manual §11 e Atm.php. ALTA
- XML do documento: enviado como string XML inteira (autorizada, com protocolo), recomendado dentro de CDATA: `<xmlCTe><![CDATA[...]]></xmlCTe>` (Manual §11). Não é base64. ALTA
- Envelope (Atm.php): header `SOAPAction: urn:ATMWebSvr#averbaCTe` (ou averbaNFe/declaraMDFe), `Content-Type: text/xml;charset=UTF-8`.
- Homologação: "solicite o login para o suporte técnico da AT&M" (Manual §25). Contato do manual: sac@atmtec.com.br, (19) 3885-2000. Na homologação "todas as regras expostas são válidas" e corretora/seguradora não recebe os dados. ALTA
- Não encontrei REST/JSON público da AT&M. Um relato de 2020 em fórum ACBr menciona "token" e endpoint de homologação da Averba, mas sem documentação: https://www.projetoacbr.com.br/forum/topic/56049-averba%C3%A7%C3%A2o-atm-cte/ (BAIXA; ver seção 3).

### 1.3 Resposta
Há DOIS formatos documentados.
(a) Manual v3.0 (formato legado `MSGS`): `<MSGS><AVERBADO><NUMDOC/><SERIEDOC/><FILIALDOC/><CNPJEMISSOR/><LINHAARQ/><PROTOCOLO><DATA/><HORA/><PROTOCOLONUMERO/></PROTOCOLO></AVERBADO></MSGS>`; erro em `<ERRO><ERRODETALHE><CODIGO/><VALORENVIADO/><VALORESPERADO/><LIMITE/><DESCCOMPLETA/>`; teste em `<TESTE>` com protocolo "TESTE". ALTA (manual).
(b) Formato atual real, visto nas fixtures do NFePHP (respostas de produção de 2022): `Response` com `Numero`, `Serie`, `Filial`, `CNPJCli`, `TpDoc`, e:
```
<Averbado>
  <dhAverbacao>2022-06-10T12:04:25</dhAverbacao>
  <Protocolo>CUE4FQ52NI4XN47D18518D9Y6QQXS</Protocolo>
  <DadosSeguro><NumeroAverbacao>0651310222812515300018457001000000083120</NumeroAverbacao></DadosSeguro>
</Averbado>
<Infos><Info><Codigo>001</Codigo><Descricao>Documento ja averbado</Descricao></Info></Infos>
```
Erro: `<Erros><Erro><Codigo>904</Codigo><Descricao>Acesso nao autorizado</Descricao>[<ValorInformado/>]</Erro></Erros>`. (https://github.com/nfephp-org/sped-averbacao/blob/master/examples/fixtures/Atm/response.xml e `xmlErros.xml`) ALTA
- `DadosSeguro` com `NumeroAverbacao`, `CNPJSeguradora`, `NomeSeguradora`, `NumApolice`, `TpMov`, `TpDDR`, `ValorAverbado`, `RamoAverbado` (repetível: pode haver N apólices) e bloco `AverbadoRCV` (`Protocolo`, `IdViagem`, `dhAverbacao`) + `ErroRCV`: só aparece no parser de terceiro (averba-client.ts). MÉDIA. Nas fixtures públicas só veio `NumeroAverbacao` dentro de DadosSeguro; os outros campos podem depender da configuração do cliente/versão.
- Protocolo AT&M: "até 40 caracteres, alfanumérico" (Manual §10). ALTA
- Códigos de erro: lista completa pelo método `listaErros` e em `xmlErros.xml` (~100 códigos). Exemplos: 000 erro de sistema; 001 documento já cadastrado/averbado; 002 erro na inclusão; 010/011 janela de embarque; 033 CNPJ emissor não autorizado; 904 acesso não autorizado; 908 CT-e não localizado (cancelamento sem averbação prévia); 912 XML inválido. ALTA
- Retry: só reenviar automaticamente se erro 000, 002, 907, 910, branco, congestionamento ou timeout. Demais recusas: não reenviar antes de corrigir o documento. (Manual §10 e §26) ALTA
- Idempotência: reenviar o mesmo XML devolve erro/info 001 "Documento já averbado" COM o protocolo/NumeroAverbacao originais (fixtures: `Infos/Info 001` + `Averbado` preenchido; manual §11 "Documento já cadastrado" traz o protocolo). ALTA
- Cancelamento: reenvio do XML de cancelamento do CT-e à mesma operação; retorna o protocolo da averbação original + "Cancelamento Registrado com sucesso"; sem averbação prévia = erro 908. (Manual §13) ALTA
- Guardar o retorno: "O retorno do WebService deve ser guardado, juntamente com o protocolo". (Manual §26) ALTA
- Limites/timeouts: não encontrei valores publicados. Manual só cita "congestionamento, lentidão, timeout" como retriable.

### 1.4 Formato do número de averbação
- `DadosSeguro/NumeroAverbacao` das fixtures tem 40 dígitos. Decomposição que verifiquei nas duas amostras: 9 dígitos de prefixo + CNPJ emitente (14) + "57" (modelo CT-e) + série (3) + número do CT-e (9) + 3 dígitos finais.
  - `0651310222812515300018457001000000083120` = `065131022` | `28125153000184` | `57` | `001` | `000000083` | `120` (Numero=83, Serie=1, CNPJ=28125153000184 na mesma resposta).
  - `0660212222991780900016457002000006340112` = `066021222` | `29917809000164` | `57` | `002` | `000006340` | `112` (Numero=6340, Serie=2).
  Isso é observação minha sobre as fixtures; o significado do prefixo de 9 e do sufixo de 3 dígitos NÃO está documentado (INFERÊNCIA, MÉDIA).
- Campo `Protocolo` é diferente: alfanumérico até 40 (ex.: `CUE4FQ52NI4XN47D18518D9Y6QQXS`, 29 chars).
- Layout MDF-e: `MDFe/infMDFe/seg/nAver`, tipo texto, 0-N ocorrências (unbounded), até 40 caracteres, pattern `[!-ÿ]{1}[ -ÿ]{0,}[!-ÿ]{1}|[!-ÿ]{1}`: https://buscadorncm.com.br/mdfe/tags-xml/naver (agregador que reproduz o leiaute; confirmar no MOC/Anexo I oficial). MÉDIA/ALTA
- Grupo `seg` no MDF-e: `infResp` (respSeg + CNPJ/CPF do responsável quando não é o emitente), `infSeg` (xSeg nome, CNPJ da seguradora), `nApol`, `nAver` (N). Fonte secundária: https://www.projetoacbr.com.br/forum/topic/39407-dados-do-seguro-na-mdf-e/ e https://www.projetoacbr.com.br/forum/topic/34319-mdf-e-erro-seguro-da-carga/ (MÉDIA).
- Prática relatada: "em caso de sucesso na comunicação entre transportador e seguradora, o campo nAver poderá ser preenchido com o protocolo gerado pela seguradora" (relato em compilado de fóruns/ERPs; fonte exata não confirmada em página oficial) - BAIXA/MÉDIA. A Senior diz que, com integração eletrônica, o sistema preenche automaticamente "os protocolos de averbação retornados" (busca não abriu página específica; tratar como MÉDIA/BAIXA).

### 1.5 SEFAZ / ANTT
- Rejeição 698 (MDF-e): quando `tpEmit` = 1 (prestador de serviço de transporte) ou 3 (CT-e globalizado) é obrigatório informar dados do seguro da carga; "para esta regra de validação não há exceções" segundo OOBJ: https://oobj.com.br/bc/rejeicao-698-como-resolver-2/ (MÉDIA/ALTA). Exemplo corrigido: `<seg><infResp><respSeg>1</respSeg></infResp><infSeg><xSeg>..</xSeg><CNPJ>..</CNPJ></infSeg>...`. Carga própria (`tpEmit=2`) fica fora da regra (INFERÊNCIA a partir de a regra citar só 1 e 3).
- Rejeição 699: dados do seguro incompletos (se qualquer campo do grupo seg faltar): https://ajuda.webmania.com.br/pt-BR/articles/12680428-rejeicao-699-dados-do-seguro-de-carga-incompletos-para-o-modal-rodoviario (MÉDIA). Há relatos antigos (2017) de rejeição 218 mesmo com só respSeg; recomendação prática: preencher infSeg+nApol+nAver completos (fórum ACBr acima).
- Lei 14.599/2023 (altera Lei 11.442/2007): tornou obrigatórios RCTR-C, RC-DC (antes facultativo) e RC-V; RCTR-C e RC-DC devem ser contratados pela empresa que emite CT-e e MDF-e (segundo resumo secundário): https://legismap.com.br/conteudos/artigos-e-noticias/sobre-a-lei-n-14-599-2023 e https://setcesp.org.br/noticias/seguros-obrigatorios-no-transporte-de-cargas-o-que-muda-com-as-novas-regras/ (MÉDIA).
- ANTT/Susep: webservice seguradora → RNTRC; homologação 10/03/2026 a 30/06/2026; produção em 01/07/2026, verificação automática das apólices como condição para registro/manutenção do RNTRC: https://revistaapolice.com.br/2026/03/setor-segurador-e-antt-iniciam-integracao-digital/ e https://revistaapolice.com.br/2026/07/transporte-de-cargas-ja-opera-sob-novas-regras-do-seguro-obrigatorio/ (MÉDIA). Esses artigos NÃO mencionam averbação/MDF-e: não alteram, por si, o dever de averbar por documento.
- Resolução ANTT 6.068/2025 e Portaria SUROC 27/2025 aparecem em resumo secundário; não li o texto.

### 1.6 Flags "Rastreado" e "Carga e Descarga"
- Na AT&M são "coberturas adicionais" informadas por `compl/ObsCont` no CT-e (e NF-e/outros docs): `xCampo`=`RASTREADO` com `xTexto`=`S`; `xCampo`=`OCD` (Operação de Carga e Descarga) `S`; default "N" quando a tag não é enviada. Sintaxe: `<ObsCont><xCampo>RASTREADO</xCampo><xTexto>S</xTexto></ObsCont>` ou alternativa `<ObsCont xCampo="RASTREADO"><xTexto>S</xTexto></ObsCont>`. (Manual §17, págs. 30-33.) ALTA
- Outros campos do mesmo mecanismo (úteis): `MeiosProprios`, `RCFDC` (só ramo 32 viagem internacional), `UFFRONTEIRA`, `MERCESPECIFICA`, `DHEMB` (data/hora de embarque, senão assume data da averbação), `ESCOLTA`, `RGMOTORISTA`, `CODMOTORISTA`, `CPFMOTORISTA`, `PLACA` (usar a da carreta), `TranspProprio`, `PercCompl` (tipo;UFini;UFfim), `RAMO`, `RESPSEG` (CNPJ do responsável, para DDR/apólice estipulada), `CODOPEREMB` (código de operação, apólice estipulante). (Manual §17.) ALTA
- Consequência para o TMS: as flags do cadastro do Lonngren devem virar `ObsCont` no CT-e (campo `compl`) ANTES de averbar. Elas vão dentro do XML do CT-e assinado, não são parâmetros separados da chamada. Isto implica configurá-las no CT-e emitido via ACBr.
- Para CT-e 3.00 a AT&M lê placa/CPF motorista/respSeg dos ObsCont porque `placa`, `moto`, `respSeg`, `nApol`, `nAver` foram removidos do CT-e 3.00 (Manual §19). `vCargaAverb` (em `infCTeNorm`) é o valor averbado; na falta, lê `vCarga`. (Manual §19 e §25.) ALTA
- Ramo: sem indicar, AT&M usa o ramo de maior cobertura cadastrado. Para forçar ramo 54 RCTRC, usar ObsCont `RAMO` (CT-e 3.00) ou, no CT-e 2.0, `nAver` = `RCTRC===============` (20 chars exatos). (Manual §18-19.) ALTA
- DDR: com DDR total, averba no ramo de maior cobertura com valor 0,01 e TpMov=4; DDR parcial vai no ramo 54 com valor total e TpMov=1. Exige `respSeg`/`RESPSEG` com CNPJ do cliente e DDR cadastrada no site da AT&M. (Manual §25.) ALTA
- "RCTR-C/RCF-DC" no seu cadastro: o manual lista ramo 54 = RCTRC e ramo 55 = RCFDC (facultativo). (Manual §24.) ALTA

### 1.7 Alternativas (só o essencial)
- NFePHP `sped-averbacao` (PHP, LGPL/MIT, v1.0.0) suporta AT&M, ELTSEG e Porto Seguro: https://packagist.org/packages/nfephp-org/sped-averbacao e https://github.com/nfephp-org/sped-averbacao. ACBr tem componente ACBrANe (AT&M, `DeclararMDFe` com `TipoDoc=tdMDFe`): https://www.projetoacbr.com.br/forum/topic/43011-acbrane-declarar-mdf-e-atm/ (MÉDIA).
- Porto Seguro (AverbePorto): API tipo REST/JSON via POST em `http://www.averbeporto.com.br/websys/php/conn.php`; login com `mod=login` (usuário/senha do sistema web), cookie de sessão, depois envio do arquivo; retorno traz o "Número de Averbação ANTT". Fonte: `examples/docs/PortoSeguro/PortoSeguro.txt` no repo sped-averbacao. ALTA (para o que está escrito; documento é do repo, pode ter anos).
- ELT (ELTSeg): WebService WCF `ELTAverbaService.svc`, operação `FileUpload` (WSDL no repo). ALTA para a existência; não li o manual.
- "Via e-mail": não encontrei especificação; costuma ser envio do XML a uma caixa da averbadora/seguradora (INFERÊNCIA, sem fonte).

---------------------------------------------------------------------
## 2. INFERÊNCIAS (não confirmadas por documento oficial)
---------------------------------------------------------------------
1. O `nAver` do MDF-e deve conter UM valor por CT-e da viagem: o `NumeroAverbacao` (40 dígitos) de cada CT-e (a tag é repetível 0-N, limite 40 chars, e o `NumeroAverbacao` cabe exatamente em 40). Alternativa vista em relatos: o `Protocolo` (até 40 alfanum). Os dois cabem. Qual a seguradora/SEFAZ espera: não confirmado. Recomendo começar com `NumeroAverbacao` de cada CT-e e validar com a AT&M/corretora. (Confiança BAIXA/MÉDIA.)
2. `infResp/respSeg=1` (emitente) quando a TransMesquita contrata o RCTR-C em seu nome; `infSeg/xSeg` + CNPJ = seguradora (HDI), `nApol` = apólice RCTR-C. `respSeg=2` (contratante) só se a apólice for do embarcador/DDR. (BAIXA/MÉDIA: coerente com Lei 14.599 que põe o seguro RCTR-C/RC-DC a cargo de quem emite CT-e/MDF-e.)
3. A AT&M recebe o MDF-e (`declaraMDFe`) para controle de viagem/DDR/gerenciamento de risco e vincular placa/motorista; não é ela que gera o número do `nAver`. O MDF-e é declarado depois de autorizado (evidência Senior), logo é um passo pós-MDF-e, separado do preenchimento do `seg`. (MÉDIA.)
4. Sequência: autorizar CT-e → averbar CT-e (AT&M) → compor `seg` → emitir MDF-e → `declaraMDFe`. A parte "MDF-e depois" tem apoio da Senior; a parte "CT-e antes do MDF-e" decorre de o MDF-e precisar do `nAver`.
5. Se a AT&M estiver fora: não há fonte que diga se o MDF-e passa sem `nAver`. Pela regra 699 ("rejeitar se alguma informação do grupo seguro não estiver informada") a SEFAZ pode rejeitar; mas um relato isolado de uso de valor "99999" em falha de integração foi contestado (validação de dígitos). Tratar como risco: NÃO usar número falso (também é fiscalmente e contratualmente perigoso, pois a averbação é que ativa a cobertura). (BAIXA.)

---------------------------------------------------------------------
## 3. O QUE NÃO CONSEGUI CONFIRMAR
---------------------------------------------------------------------
- WSDL atual completo e lista exata de operações (só tenho nomes via clientes open source e o manual v3.0 de data antiga; os nomes `averbaCTe20`/`averbaNFe20` do manual divergem dos usados pelos clientes). Não consultei o WSDL ao vivo (instrução: sem chamadas).
- Formato exato da resposta de `declaraMDFe` e se devolve algum "número de averbação" próprio (só vi `Declarado/Protocolo` + `dhChancela` num parser de terceiro).
- Se existe API REST/JSON oficial da AT&M hoje (houve menção a token em fórum e à geração de credenciais de API em um MCP de terceiros sobre Porto, não da AT&M).
- Limites de taxa, timeout recomendado, tamanho máximo de XML, SLA.
- Texto oficial do MOC MDF-e 3.00b (a tabela de leiaute veio de agregador; o PDF do TOTVS/TDN que tentei devolveu HTML). Confirmar `seg`/`nAver` (1-40), regras 698/699/218 e a exceção para `tpEmit=2` no Anexo I e no MOC oficiais (portal nacional do MDF-e).
- O que a SEFAZ efetivamente valida em `nAver` (formato, DV, existência na seguradora): não há evidência de validação cruzada com a seguradora; o relato de "validação dos DVs" é de comentário de fórum.
- Significado dos 9 dígitos iniciais e 3 finais do `NumeroAverbacao`.
- Texto da Resolução ANTT 6.068/2025 e se ela muda o dever de averbar por CT-e (as fontes lidas só tratam de comprovação de apólice ao RNTRC).
- Especificação de "Via E-mail" e do que o Lonngren faz por baixo para "Integração AT&M" (se usa `averbaCTe` por CT-e e `declaraMDFe`).
- O Manual v3.0 define apenas o webservice; o seguro de transportadora com `RCTR-C` apenas por CT-e vs. também por MDF-e é a regra da apólice e deve ser confirmada com a corretora.

---------------------------------------------------------------------
## 4. PERGUNTAS PARA FAZER À AT&M E À CORRETORA
---------------------------------------------------------------------
AT&M (sac@atmtec.com.br, (19) 3885-2000):
1. Enviar WSDL atual e manual vigente que inclua `declaraMDFe`; confirmar nomes (`averbaCTe` vs `averbaCTe20`) e se há REST/JSON.
2. Liberar login de homologação (`homologaws.averba.com.br/20`) e o código ATM (`codatm`) de teste; as chaves de produção ficam como as do Lonngren ou serão novas?
3. Em `declaraMDFe`: o que é obrigatório, o que volta, e ele gera algum número a ser colocado no `nAver`?
4. Qual valor a AT&M recomenda no `nAver` do MDF-e: `NumeroAverbacao` de cada CT-e ou `Protocolo`? Um por CT-e?
5. O que muda para o CT-e 4.00 (usado pelo ACBr hoje?) em relação a ObsCont RASTREADO/OCD/RAMO/RESPSEG/PLACA/CPFMOTORISTA/DHEMB?
6. Janela de averbação da apólice HDI (antes do embarque? máximo de horas depois?) e qual data de embarque a AT&M considera.
7. O CNPJ da TransMesquita (matriz e filiais) está habilitado para averbar (erro 033)? As filiais usam o mesmo `codatm`?
8. SLA/timeout/limites; reenvio de CT-e já averbado devolve sempre o mesmo número (idempotência)?
9. Cancelamento de CT-e e de MDF-e: confirmar o fluxo, e se o MDF-e cancelado/encerrado também deve ser declarado.
10. Retorno de `DadosSeguro` completo (apólice, seguradora, ramo, TpMov) vem habilitado na nossa conta?
Corretora/HDI:
11. Apólice RCTR-C e RC-DC: número a colocar em `nApol` (por ramo?), CNPJ e nome da seguradora exatos como a SEFAZ aceita (`xSeg`).
12. O que "Rastreado" e "Carga e Descarga" implicam na apólice (cobertura/taxa/exigência de rastreador) e quando marcar `S`.
13. Como a corretora/HDI quer que o seguro de MDF-e (e RC-V para TAC) seja declarado, e se a averbação do CT-e basta para a cobertura.
14. Em caso de AT&M fora do ar, qual o procedimento aceito pela seguradora (averbação manual no site depois? prazo?).

---------------------------------------------------------------------
## 5. DESENHO RECOMENDADO (resumo, derivado dos fatos acima)
---------------------------------------------------------------------
1. Fila BullMQ `averbacao` disparada quando o CT-e fica AUTORIZADO (XML com protocolo, `tpAmb=1`). Job: `averbaCTe(xmlAutorizado)`. Não averbar CT-e de homologação (AT&M devolve "TESTE").
2. Chave de idempotência = chave de acesso do CT-e. Tabela `cte_averbacao`: chave, status (PENDING/AVERBADO/ERRO/CANCELADO), `numero_averbacao` (40), `protocolo` (≤40), `dh_averbacao`, `dados_seguro` JSON (N apólices), `erros` JSON, resposta SOAP crua (sem credenciais), `tentativas`, `ambiente`. Tratar resposta "001 já averbado" como sucesso.
3. Retry automático só para 000/002/907/910, branco, timeout (backoff). Demais erros: status ERRO visível ao operador com `Codigo/Descricao` (ex.: 010/011 janela, 033 CNPJ, 005 ramo fora da vigência).
4. Antes do CT-e: gerar `ObsCont` (RASTREADO, OCD, DHEMB, PLACA, CPFMOTORISTA, RAMO, RESPSEG) conforme configuração, porque entram no XML assinado. Se a averbação precisar de placa e ela só é conhecida ao montar a viagem, o manual sugere "reter" a averbação até designar a placa.
5. Composição do `seg` do MDF-e: bloqueio de emissão enquanto algum CT-e da viagem estiver sem averbação OK; `nAver[]` = lista dos `numero_averbacao` (ou protocolo, conforme resposta da AT&M) de todos os CT-es do MDF-e (≤40 chars cada, sem espaços); `infSeg` = seguradora e CNPJ; `nApol` do cadastro (ou `DadosSeguro.NumApolice`); `infResp.respSeg` conforme apólice. Depois de autorizar o MDF-e, enfileirar `declaraMDFe` (e também em cancelamento/encerramento, conforme Senior).
6. Cancelamento de CT-e: após o evento de cancelamento autorizado, enviar o XML do evento ao mesmo método; status CANCELADO. Erro 908 se nunca foi averbado (tratar como já ok).
7. AT&M fora: não travar o CT-e (autorização fiscal independe). Operação da viagem: deixar MDF-e em "aguardando averbação" com alerta, retries e contingência manual (averbar no site averba.com.br e registrar manualmente o número no TMS, com usuário/justificativa/auditoria). Não inventar `nAver`.
8. Cadastro do emitente (por CNPJ/filial): seguradora (nome ≤30 e CNPJ), apólice(s) por ramo (RCTR-C, RC-DC), responsável do seguro (`respSeg`), provedor de averbação (ATM/Porto/ELT/e-mail/nenhum), `codatm`, usuário, senha (cifrados, mesmo padrão do `FISCAL_SECRET_KEY`), ambiente (produção/homologação com URLs distintas), flags `rastreado` e `carga_descarga` (e `ramo` preferencial, `meios próprios`), `modo_averbacao` (obrigatória/ best effort). Nunca registrar credenciais em logs/JSON de auditoria.
9. Teste: pedir login de homologação à AT&M; os XMLs devem ser CT-e `tpAmb=2` apenas para ver o retorno "TESTE"; para testar fluxo real completo usa-se o ambiente de testes AT&M (não afeta seguradora).
