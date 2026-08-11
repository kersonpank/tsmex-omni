import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseNfeProcXml } from './nfeXmlParser.js';

function buildNfeProcXml(opts: { multiplosItens?: boolean; multiplosVolumes?: boolean; comIe?: boolean; comTransportador?: boolean; comEnderDest?: boolean } = {}): string {
    const det1 = `
      <det nItem="1">
        <prod>
          <cProd>001</cProd>
          <xProd>Caixa de parafusos M6</xProd>
          <NCM>73181500</NCM>
          <qCom>10.0000</qCom>
          <vUnCom>25.5000000000</vUnCom>
          <vProd>255.00</vProd>
        </prod>
      </det>`;
    const det2 = `
      <det nItem="2">
        <prod>
          <cProd>002</cProd>
          <xProd>Chapa de aço 2mm</xProd>
          <NCM>72091700</NCM>
          <qCom>2.0000</qCom>
          <vUnCom>450.0000000000</vUnCom>
          <vProd>900.00</vProd>
        </prod>
      </det>`;
    const det = opts.multiplosItens ? `${det1}${det2}` : det1;

    const vol1 = `<vol><qVol>3</qVol><pesoL>118.500</pesoL><pesoB>125.000</pesoB></vol>`;
    const vol2 = `<vol><qVol>1</qVol><pesoL>10.000</pesoL><pesoB>11.000</pesoB></vol>`;
    const vol = opts.multiplosVolumes ? `${vol1}${vol2}` : vol1;

    return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260712345678000199550010000012345678901234" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <nNF>1234</nNF>
        <dhEmi>2026-07-08T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>FORNECEDOR EXEMPLO LTDA</xNome>
        <enderEmit>
          <xMun>Sao Paulo</xMun>
          <UF>SP</UF>
        </enderEmit>
        ${opts.comIe ? '<IE>110042490114</IE>' : ''}
      </emit>
      <dest>
        <CNPJ>10256071000103</CNPJ>
        <xNome>F C C ABREU LTDA</xNome>
        ${opts.comIe ? '<IE>206283703315</IE>' : ''}
        ${opts.comEnderDest ? `<enderDest>
          <xLgr>Rua das Industrias</xLgr>
          <nro>500</nro>
          <xBairro>Centro</xBairro>
          <xMun>Diadema</xMun>
          <UF>SP</UF>
          <CEP>09950000</CEP>
        </enderDest>` : ''}
      </dest>
      ${det}
      <total>
        <ICMSTot>
          <vNF>1155.00</vNF>
        </ICMSTot>
      </total>
      <transp>
        ${opts.comTransportador ? `<transporta>
          <CNPJ>26879820000270</CNPJ>
          <xNome>L.M. DA SILVA TRANSPORTES</xNome>
        </transporta>` : ''}
        ${vol}
      </transp>
    </infNFe>
  </NFe>
  <protNFe>
    <infProt>
      <chNFe>35260712345678000199550010000012345678901234</chNFe>
      <cStat>100</cStat>
    </infProt>
  </protNFe>
</nfeProc>`;
}

describe('parseNfeProcXml', () => {
    it('extrai chave, emitente, destinatário e valor total com 1 produto e 1 volume', () => {
        const result = parseNfeProcXml(buildNfeProcXml());

        assert.equal(result.chave, '35260712345678000199550010000012345678901234');
        assert.deepEqual(result.emitente, {
            cnpj: '12345678000199',
            razaoSocial: 'FORNECEDOR EXEMPLO LTDA',
            municipio: 'Sao Paulo',
            uf: 'SP',
            ie: undefined,
        });
        assert.deepEqual(result.destinatario, {
            cnpj: '10256071000103',
            razaoSocial: 'F C C ABREU LTDA',
            ie: undefined,
            municipio: undefined,
            uf: undefined,
            cep: undefined,
            logradouro: undefined,
            numero: undefined,
            bairro: undefined,
        });
        assert.equal(result.valorTotalNota, 1155.0);
    });

    it('extrai endereço completo do destinatário quando <dest><enderDest> está presente no XML', () => {
        const result = parseNfeProcXml(buildNfeProcXml({ comEnderDest: true }));

        assert.deepEqual(result.destinatario, {
            cnpj: '10256071000103',
            razaoSocial: 'F C C ABREU LTDA',
            ie: undefined,
            municipio: 'Diadema',
            uf: 'SP',
            cep: '09950000',
            logradouro: 'Rua das Industrias',
            numero: '500',
            bairro: 'Centro',
        });
    });

    it('extrai IE do emitente e do destinatário quando presentes no XML', () => {
        const result = parseNfeProcXml(buildNfeProcXml({ comIe: true }));

        assert.equal(result.emitente.ie, '110042490114');
        assert.equal(result.destinatario.ie, '206283703315');
    });

    it('ie fica undefined quando ausente (indIEDest=2 isento ou 9 não contribuinte)', () => {
        const result = parseNfeProcXml(buildNfeProcXml());

        assert.equal(result.emitente.ie, undefined);
        assert.equal(result.destinatario.ie, undefined);
    });

    it('normaliza um único <det> em array de 1 produto', () => {
        const result = parseNfeProcXml(buildNfeProcXml());
        assert.equal(result.produtos.length, 1);
        assert.deepEqual(result.produtos[0], {
            descricao: 'Caixa de parafusos M6',
            ncm: '73181500',
            quantidade: 10,
            valorUnitario: 25.5,
            valorTotal: 255.0,
        });
    });

    it('extrai múltiplos produtos quando há mais de um <det>', () => {
        const result = parseNfeProcXml(buildNfeProcXml({ multiplosItens: true }));
        assert.equal(result.produtos.length, 2);
        assert.equal(result.produtos[1].descricao, 'Chapa de aço 2mm');
        assert.equal(result.produtos[1].valorTotal, 900.0);
    });

    it('normaliza um único <vol> em peso/quantidade agregados', () => {
        const result = parseNfeProcXml(buildNfeProcXml());
        assert.equal(result.pesoBruto, 125.0);
        assert.equal(result.pesoLiquido, 118.5);
        assert.equal(result.quantidadeVolumes, 3);
    });

    it('soma peso e quantidade quando há múltiplos <vol>', () => {
        const result = parseNfeProcXml(buildNfeProcXml({ multiplosVolumes: true }));
        assert.equal(result.pesoBruto, 136.0);
        assert.equal(result.pesoLiquido, 128.5);
        assert.equal(result.quantidadeVolumes, 4);
    });

    it('transportador fica undefined quando <transp> não tem <transporta> (frete próprio/sem transportador formal)', () => {
        const result = parseNfeProcXml(buildNfeProcXml());
        assert.equal(result.transportador, undefined);
    });

    it('extrai CNPJ/razão social do transportador quando <transp><transporta> está presente', () => {
        const result = parseNfeProcXml(buildNfeProcXml({ comTransportador: true }));
        assert.deepEqual(result.transportador, {
            cnpj: '26879820000270',
            razaoSocial: 'L.M. DA SILVA TRANSPORTES',
            ie: undefined,
        });
    });

    it('lança erro claro quando o XML não tem nfeProc/NFe/infNFe', () => {
        assert.throws(
            () => parseNfeProcXml('<algumaCoisa><outraTag/></algumaCoisa>'),
            /nfeProc/i,
        );
    });
});
