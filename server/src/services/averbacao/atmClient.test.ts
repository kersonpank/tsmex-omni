import test from 'node:test';
import assert from 'node:assert/strict';
import {
    averbarCte,
    buildAtmEnvelope,
    cancelarAverbacaoCte,
    declararMdfe,
    ATM_ENDPOINTS,
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
    assert.equal(calls[0]!.url, ATM_ENDPOINTS.HOMOLOGACAO);
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

test('declararMdfe usa declaraMDFe/xmlMDFe e lê Declarado/Protocolo', async () => {
    const declarado = '<Response><Declarado><Protocolo>PROT123</Protocolo><dhChancela>2026-11-11T10:00:00</dhChancela></Declarado></Response>';
    const { calls, transport } = fakeTransport(wrapReturn(declarado));
    const r = await declararMdfe('<mdfeProc/>', creds, 'HOMOLOGACAO', transport);
    assert.equal(calls[0]!.soapAction, 'urn:ATMWebSvr#declaraMDFe');
    assert.match(calls[0]!.body, /<xmlMDFe>/);
    assert.equal(r.kind, 'AVERBADO');
    if (r.kind === 'AVERBADO') assert.equal(r.protocolo, 'PROT123');
});
