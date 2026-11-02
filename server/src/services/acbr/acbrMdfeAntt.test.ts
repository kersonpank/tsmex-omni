import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildMdfeAntt, persistedCiotContratante } from './acbrMdfeAntt.js';
import type { CiotPagamentoInfo } from '../efrete/efreteCiotMapper.js';

const base = {
    rntrc: '55887888',
    ciot: { number: '123456789012', contratanteDocument: '12345678000195' },
    contratante: { document: '26879820000270', name: 'TransMesquita' },
    agreement: { freteBruto: 1000, adiantamento: 0, pedagio: 100, saldoLiquido: 1100 },
    account: { pixKey: 'frete@example.com' },
};

it('infANTT mantém gerador CIOT, pagador e conta recebedora distintos', () => {
    assert.deepEqual(buildMdfeAntt(base), {
        RNTRC: '55887888',
        infCIOT: [{ CIOT: '123456789012', CNPJ: '12345678000195' }],
        infContratante: [{ CNPJ: '26879820000270' }],
        infPag: [{ xNome: 'TransMesquita', CNPJ: '26879820000270', Comp: [{ tpComp: '01', vComp: 100 }, { tpComp: '04', vComp: 1000 }], vContrato: 1100, indPag: '0', infBanc: { PIX: 'frete@example.com' } }],
    });
});
it('adiantamento e saldo geram prazo com parcela e data sem hora', () => {
    const payments: CiotPagamentoInfo[] = [{ idPagamentoCliente: 'saldo', dataLiberacao: '2026-11-08T12:00:00Z', valor: 800, tipoPagamento: 'TransferenciaBancaria', categoria: 'Quitacao', cpfCnpjCreditado: '48384601000171', indicadorPagamento: 'Aprazo', numeroParcela: 1 }];
    const result = buildMdfeAntt({ ...base, agreement: { ...base.agreement, adiantamento: 300, saldoLiquido: 800 }, payments });
    assert.equal(result.infPag![0].vContrato, 1100);
    assert.equal(result.infPag![0].vAdiant, 300);
    assert.equal(result.infPag![0].indPag, '1');
    assert.deepEqual(result.infPag![0].infPrazo, [{ nParcela: '001', dVenc: '2026-11-08', vParcela: 800 }]);
});
it('descontos e pedágio são contabilizados uma única vez', () => {
    const result = buildMdfeAntt({ ...base, agreement: { ...base.agreement, saldoLiquido: 1050 } });
    assert.equal(result.infPag![0].Comp[1].vComp, 950);
    assert.equal(result.infPag![0].vContrato, 1050);
});
it('CIOT consolidado SemCategoria gera só o saldo líquido como parcela', () => {
    const result = buildMdfeAntt({ ...base, agreement: { ...base.agreement, adiantamento: 300, saldoLiquido: 750 }, payments: [{ categoria: 'SemCategoria', indicadorPagamento: 'Avista', valor: 1000, dataLiberacao: '2026-11-08T12:00:00Z' } as CiotPagamentoInfo] });
    assert.equal(result.infPag![0].vContrato, 1050);
    assert.equal(result.infPag![0].indPag, '1');
    assert.equal(result.infPag![0].infPrazo![0].vParcela, 750);
    assert.equal(result.infPag![0].infPrazo![0].dVenc, '2026-11-08');
});
it('sem Carta Frete não inclui infPag; sem CIOT não inventa infCIOT', () => {
    const result = buildMdfeAntt({ ...base, agreement: null, ciot: null });
    assert.ok(!('infPag' in result));
    assert.ok(!('infCIOT' in result));
});
it('CPF e banco/agência usam os nomes XML sem PIX simultâneo', () => {
    const result = buildMdfeAntt({ ...base, contratante: { document: '12345678901', name: 'Pessoa' }, account: { bankCode: '001', agency: '1234' }, agreement: { ...base.agreement, pedagio: 0, saldoLiquido: 1000 } });
    assert.deepEqual(result.infContratante, [{ CPF: '12345678901' }]);
    assert.deepEqual(result.infPag![0].infBanc, { codBanco: '001', codAgencia: '1234' });
    assert.equal(result.infPag![0].Comp.length, 1);
});
it('reutiliza PIX ou banco do CIOT quando não há conta primária', () => {
    const payment = { pix: { valorChave: 'pix-ciot' } } as CiotPagamentoInfo;
    assert.deepEqual(buildMdfeAntt({ ...base, account: null, payments: [payment] }).infPag![0].infBanc, { PIX: 'pix-ciot' });
    assert.deepEqual(buildMdfeAntt({ ...base, account: null, payments: [{ informacoesBancarias: { instituicaoBancaria: '001', agencia: '1234' } } as CiotPagamentoInfo] }).infPag![0].infBanc, { codBanco: '001', codAgencia: '1234' });
});
it('bloqueia dados de pagamento ausentes antes de consumir numeração', () => {
    assert.throws(() => buildMdfeAntt({ ...base, account: null }), /chave PIX/);
    assert.throws(() => buildMdfeAntt({ ...base, agreement: { ...base.agreement, adiantamento: 300, saldoLiquido: 800 } }), /parcelas/);
});
it('prefere Contratante persistido, depois MatrizCNPJ, sem usar CNPJ inválido', () => {
    assert.equal(persistedCiotContratante({ Contratante: { CpfOuCnpj: '12345678901' }, MatrizCNPJ: '12345678000195' }), '12345678901');
    assert.equal(persistedCiotContratante({ MatrizCNPJ: '12345678000195' }), '12345678000195');
    assert.equal(persistedCiotContratante(null), null);
    assert.equal(persistedCiotContratante({ Contratante: { CpfOuCnpj: '123' } }), null);
});
