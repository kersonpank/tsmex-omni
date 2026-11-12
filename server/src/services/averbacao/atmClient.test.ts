import test from 'node:test';
import assert from 'node:assert/strict';
import {
    averbarCte,
    buildAtmEnvelope,
    cancelarAverbacaoCte,
    declararMdfe,
    atmEndpoint,
    ATM_SOAP_URL_DEFAULT,
    parseMdfeResponse,
    ATM_OPERATIONS,
    parseAtmResponse,
    type AtmHttpRequest,
    type AtmTransport,
} from './atmClient.js';

const creds = { codigo: 'COD1', usuario: 'user-x', senha: 'p&ss<1>' };

const soap = (inner: string) => `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

// Estrutura das fixtures públicas do NFePHP (examples/fixtures/Atm/response.xml), valores fictícios.
const averbadoXml = '<Response><Numero>83</Numero><Serie>1</Serie><Averbado><dhAverbacao>2022-06-10T12:04:25</dhAverbacao><Protocolo>CUE4FQ52NI4XN47D18518D9Y6QQXS</Protocolo><DadosSeguro><NumeroAverbacao>0651310222812515300018457001000000083120</NumeroAverbacao></DadosSeguro></Averbado></Response>';
const jaAverbadoXml = averbadoXml.replace('</Response>', '<Infos><Info><Codigo>001</Codigo><Descricao>Documento ja averbado</Descricao></Info></Infos></Response>');
const erroXml = (codigo: string, desc: string) => `<Response><Erros><Erro><Codigo>${codigo}</Codigo><Descricao>${desc}</Descricao></Erro></Erros></Response>`;
const escaped = (xml: string) => xml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wrapReturn = (xml: string) => soap(`<ns1:averbaCTeResponse xmlns:ns1="urn:ATMWebSvr"><return xsi:type="xsd:string">${escaped(xml)}</return></ns1:averbaCTeResponse>`);

function fakeTransport(body: string, status = 200) {
    const calls: AtmHttpRequest[] = [];
    const transport: AtmTransport = async (req) => { calls.push(req); return { status, body }; };
    return { calls, transport };
}

test('envelope: operação, credenciais escapadas e XML em CDATA', () => {
    const env = buildAtmEnvelope(ATM_OPERATIONS.averbaCTe, '<cteProc>a]]>b</cteProc>', creds);
    assert.match(env, /<averbaCTe>/);
    assert.match(env, /<usuario>user-x<\/usuario>/);
    assert.match(env, /<senha>p&amp;ss&lt;1&gt;<\/senha>/);
    assert.match(env, /<codatm>COD1<\/codatm>/);
    assert.match(env, /<xmlCTe><!\[CDATA\[<cteProc>a\]\]\]\]><!\[CDATA\[>b<\/cteProc>\]\]><\/xmlCTe>/);
    assert.match(env, /xmlns:urn="urn:ATMWebSvr"/);
});

test('averbarCte: usa endpoint por ambiente, SOAPAction e interpreta sucesso (retorno escapado)', async () => {
    const { calls, transport } = fakeTransport(wrapReturn(averbadoXml));
    const r = await averbarCte('<cteProc/>', creds, 'HOMOLOGACAO', transport);
    assert.equal(calls[0]!.url, 'http://webserver.averba.com.br/20/index.soap');
    assert.equal(calls[0]!.soapAction, 'urn:ATMWebSvr#averbaCTe');
    assert.equal(calls[0]!.timeoutMs, 30_000);
    assert.equal(r.kind, 'AVERBADO');
    if (r.kind === 'AVERBADO') {
        assert.equal(r.numeroAverbacao, '0651310222812515300018457001000000083120');
        assert.equal(r.protocolo, 'CUE4FQ52NI4XN47D18518D9Y6QQXS');
        assert.equal(r.dhAverbacao, '2022-06-10T12:04:25');
    }
});

test('resposta com nós inline (sem string escapada) também é lida', () => {
    const r = parseAtmResponse(soap(averbadoXml));
    assert.equal(r.kind, 'AVERBADO');
});

test('documento já averbado devolve JA_AVERBADO com número original', () => {
    const r = parseAtmResponse(wrapReturn(jaAverbadoXml));
    assert.equal(r.kind, 'JA_AVERBADO');
    if (r.kind === 'JA_AVERBADO') assert.equal(r.protocolo, 'CUE4FQ52NI4XN47D18518D9Y6QQXS');
});

test('erros definitivos (904, 033, 912) não são repetíveis', () => {
    for (const code of ['904', '033', '912', '010']) {
        const r = parseAtmResponse(wrapReturn(erroXml(code, 'x')));
        assert.equal(r.kind, 'ERRO_DEFINITIVO', code);
    }
});

test('erros transitórios (000, 002, 907, 910) e SOAP Fault/HTTP 5xx repetem', () => {
    for (const code of ['000', '002', '907', '910']) {
        assert.equal(parseAtmResponse(wrapReturn(erroXml(code, 'x'))).kind, 'ERRO_TRANSITORIO', code);
    }
    assert.equal(parseAtmResponse(soap('<SOAP-ENV:Fault><faultcode>x</faultcode><faultstring>boom</faultstring></SOAP-ENV:Fault>')).kind, 'ERRO_TRANSITORIO');
    assert.equal(parseAtmResponse('<html>502</html>', 502).kind, 'ERRO_TRANSITORIO');
});

test('formato legado MSGS/ERRODETALHE é classificado', () => {
    const legacy = '<MSGS><ERRO><ERRODETALHE><CODIGO>904</CODIGO><DESCCOMPLETA>Acesso nao autorizado</DESCCOMPLETA></ERRODETALHE></ERRO></MSGS>';
    const r = parseAtmResponse(wrapReturn(legacy));
    assert.equal(r.kind, 'ERRO_DEFINITIVO');
    if (r.kind === 'ERRO_DEFINITIVO') assert.equal(r.codigo, '904');
});

test('falha de rede e timeout viram transitório', async () => {
    const boom: AtmTransport = async () => { throw new Error('ECONNRESET'); };
    assert.equal((await averbarCte('<x/>', creds, 'PRODUCAO', boom)).kind, 'ERRO_TRANSITORIO');
    const abort: AtmTransport = async () => { const e = new Error('t'); e.name = 'AbortError'; throw e; };
    const r = await averbarCte('<x/>', creds, 'PRODUCAO', abort);
    assert.equal(r.kind === 'ERRO_TRANSITORIO' && r.codigo, 'TIMEOUT');
});

test('cancelarAverbacaoCte reenvia o evento pela mesma operação', async () => {
    const { calls, transport } = fakeTransport(wrapReturn(averbadoXml));
    await cancelarAverbacaoCte('<procEventoCTe/>', creds, 'HOMOLOGACAO', transport);
    assert.equal(calls[0]!.soapAction, 'urn:ATMWebSvr#averbaCTe');
    assert.match(calls[0]!.body, /<procEventoCTe\/>/);
});

test('endpoint único para teste e produção, sobreponível por ATM_SOAP_URL', async () => {
    assert.equal(ATM_SOAP_URL_DEFAULT, 'http://webserver.averba.com.br/20/index.soap');
    assert.equal(atmEndpoint({}), ATM_SOAP_URL_DEFAULT);
    assert.equal(atmEndpoint({ ATM_SOAP_URL: ' http://x.test/soap ' }), 'http://x.test/soap');
    const h = fakeTransport(wrapReturn(averbadoXml));
    const p = fakeTransport(wrapReturn(averbadoXml));
    await averbarCte('<x/>', creds, 'HOMOLOGACAO', h.transport);
    await averbarCte('<x/>', creds, 'PRODUCAO', p.transport);
    assert.equal(h.calls[0]!.url, p.calls[0]!.url);
});

// Resposta real da homologação AT&M (2026-11-11), documentos mascarados.
const realAverbaCte = '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns1:averbaCTeResponse xmlns:ns1="http://schemas.xmlsoap.org/soap/envelope/"><Response><Numero>21813</Numero><Serie>1</Serie><Filial></Filial><CNPJCli>00000000000000</CNPJCli><TpDoc>6</TpDoc><Averbado><dhAverbacao>2026-11-11T22:28:26</dhAverbacao><Protocolo>TESTE</Protocolo><DadosSeguro><NumeroAverbacao>0000011272687982000027057001000021813000</NumeroAverbacao><CNPJSeguradora>00000000000000</CNPJSeguradora><NomeSeguradora>HOMOLOGACAO WS</NomeSeguradora><NumApolice>PROVISORIA</NumApolice><TpMov>1</TpMov><TpDDR></TpDDR><ValorAverbado>598.80</ValorAverbado><RamoAverbado>55</RamoAverbado></DadosSeguro></Averbado></Response></ns1:averbaCTeResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>';

test('resposta real de averbaCTe: guarda DadosSeguro normalizado', () => {
    const r = parseAtmResponse(realAverbaCte);
    assert.equal(r.kind, 'AVERBADO');
    if (r.kind !== 'AVERBADO') return;
    assert.equal(r.protocolo, 'TESTE');
    assert.equal(r.numeroAverbacao, '0000011272687982000027057001000021813000');
    assert.equal(r.dhAverbacao, '2026-11-11T22:28:26');
    assert.deepEqual(r.dadosSeguro, [{
        numeroAverbacao: '0000011272687982000027057001000021813000',
        cnpjSeguradora: '00000000000000',
        nomeSeguradora: 'HOMOLOGACAO WS',
        numApolice: 'PROVISORIA',
        ramo: '55',
        valorAverbado: '598.80',
        tpMov: '1',
    }]);
});

test('dois DadosSeguro (ramos 54 e 55) viram dois itens; o primeiro alimenta numeroAverbacao', () => {
    const two = realAverbaCte.replace('</DadosSeguro></Averbado>', '</DadosSeguro><DadosSeguro><NumeroAverbacao>0000011272687982000027054001000021813000</NumeroAverbacao><CNPJSeguradora>11222333000181</CNPJSeguradora><NomeSeguradora>SEG REAL</NomeSeguradora><NumApolice>AP-77</NumApolice><TpMov>1</TpMov><ValorAverbado>100.00</ValorAverbado><RamoAverbado>54</RamoAverbado></DadosSeguro></Averbado>');
    const r = parseAtmResponse(two);
    assert.equal(r.kind, 'AVERBADO');
    if (r.kind !== 'AVERBADO') return;
    assert.equal(r.dadosSeguro.length, 2);
    assert.deepEqual(r.dadosSeguro.map((d) => d.ramo), ['55', '54']);
    assert.equal(r.dadosSeguro[1]!.cnpjSeguradora, '11222333000181');
    assert.equal(r.numeroAverbacao, r.dadosSeguro[0]!.numeroAverbacao);
});

const realMdfe = '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns1:declaraMDFeResponse xmlns:ns1="http://schemas.xmlsoap.org/soap/envelope/"><Response><Numero>15</Numero><Serie>1</Serie><Filial>0002</Filial><Declarado><dhChancela>2026-11-11T22:29:49</dhChancela><Protocolo>TESTE</Protocolo></Declarado><ErroRCV><Codigo>006</Codigo><Descricao>Data de embarque fora dos limites da apolice. Deve-se averbar antes do embarque. Consulte a corretora ou a seguradora.</Descricao></ErroRCV></Response></ns1:declaraMDFeResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>';

test('declararMdfe usa declaraMDFe/xmlMDFe; resposta real: Declarado + ErroRCV recusado', async () => {
    const { calls, transport } = fakeTransport(realMdfe);
    const r = await declararMdfe('<mdfeProc/>', creds, 'HOMOLOGACAO', transport);
    assert.equal(calls[0]!.soapAction, 'urn:ATMWebSvr#declaraMDFe');
    assert.match(calls[0]!.body, /<xmlMDFe>/);
    assert.equal(r.kind, 'DECLARADO');
    if (r.kind !== 'DECLARADO') return;
    assert.equal(r.dhChancela, '2026-11-11T22:29:49');
    assert.equal(r.rcv.status, 'RECUSADO');
    if (r.rcv.status === 'RECUSADO') {
        assert.equal(r.rcv.codigo, '006');
        assert.match(r.rcv.mensagem, /averbar antes do embarque/);
    }
});

test('MDF-e: nó RCV que não é ErroRCV conta como RC-V averbado (conteúdo bruto guardado)', () => {
    const ok = realMdfe.replace(/<ErroRCV>.*<\/ErroRCV>/, '<AverbadoRCV><Protocolo>R1</Protocolo></AverbadoRCV>');
    const r = parseMdfeResponse(ok);
    assert.equal(r.kind, 'DECLARADO');
    if (r.kind === 'DECLARADO') {
        assert.equal(r.rcv.status, 'AVERBADO');
        if (r.rcv.status === 'AVERBADO') assert.deepEqual(r.rcv.conteudo, { Protocolo: 'R1' });
    }
});

test('MDF-e: Declarado sem retorno RC-V é AUSENTE; erro de nível raiz e 5xx seguem as regras', () => {
    const none = parseMdfeResponse(realMdfe.replace(/<ErroRCV>.*<\/ErroRCV>/, ''));
    assert.equal(none.kind === 'DECLARADO' && none.rcv.status, 'AUSENTE');
    assert.equal(parseMdfeResponse(wrapReturn(erroXml('904', 'x'))).kind, 'ERRO_DEFINITIVO');
    assert.equal(parseMdfeResponse(wrapReturn(erroXml('907', 'x'))).kind, 'ERRO_TRANSITORIO');
    const e522 = parseMdfeResponse('<html>522</html>', 522);
    assert.equal(e522.kind === 'ERRO_TRANSITORIO' && e522.codigo, 'HTTP_522');
});
