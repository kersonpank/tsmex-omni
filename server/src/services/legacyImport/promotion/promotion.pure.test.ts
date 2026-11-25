import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cnpjFrom, cpfFrom } from './promotion.testkit.js';
import { driverRow, personRow, vehicleRow } from './adapters.js';
import { contactsFromFields, extractEmails, extractPhones, normalizeLegacyPhone, resolveLegacyDocument } from './documents.js';
import { mapLegacyPricing } from './pricingMap.js';
import { formatSummary, summarize, toCsv } from './report.js';
import { selectSteps } from './run.js';

describe('documentos do legado', () => {
    const cnpj = cnpjFrom('012345670001'); // começa com zero
    const cpf = cpfFrom('012345678'); // começa com zero

    it('restaura zeros à esquerda e confere o DV conforme o tipo', () => {
        assert.deepEqual(resolveLegacyDocument(String(Number(cnpj)), '1'), { document: cnpj, kind: 'CNPJ' });
        assert.deepEqual(resolveLegacyDocument(String(Number(cpf)), '2'), { document: cpf, kind: 'CPF' });
        assert.equal(resolveLegacyDocument(cnpj.slice(0, 13) + '0', '1'), null, 'DV errado');
        assert.equal(resolveLegacyDocument('123456', '3'), null, 'tipodoc 3 não é CPF/CNPJ');
        assert.equal(resolveLegacyDocument(''), null);
    });

    it('sem tipodoc (coluna de cotação) tenta CPF e depois CNPJ', () => {
        assert.equal(resolveLegacyDocument(String(Number(cpf)))?.kind, 'CPF');
        assert.equal(resolveLegacyDocument(String(Number(cnpj)))?.kind, 'CNPJ');
    });

    it('telefones e e-mails: só válidos, vários por campo', () => {
        assert.equal(normalizeLegacyPhone('+55 (98) 99999-1234'), '98999991234');
        assert.equal(normalizeLegacyPhone('098 3222-1111'), '9832221111');
        assert.equal(normalizeLegacyPhone('3222-1111'), null, 'sem DDD');
        assert.equal(normalizeLegacyPhone('98 8888-0000'), '9888880000');
        assert.deepEqual(extractPhones('(98) 3222-1111 / 98 99999-0000'), ['9832221111', '98999990000']);
        assert.deepEqual(extractEmails('Fulano@Exemplo.com.br; outro@exemplo.com, lixo, a@b'), ['fulano@exemplo.com.br', 'outro@exemplo.com']);
        const c = contactsFromFields('~ ana  souza', 'ana@exemplo.com;b@exemplo.com', '(98) 3222-1111', 'Contato');
        assert.deepEqual(c, [{ name: 'ana souza', email: 'ana@exemplo.com', phone: '9832221111' }, { name: 'ana souza', email: 'b@exemplo.com', phone: null }]);
        assert.deepEqual(contactsFromFields('', '', '', 'X'), []);
    });
});

describe('adaptadores do legado → importador de cadastros', () => {
    it('pessoa: documento com zeros restaurados, bairro vem de endereco2, UF inválida some', () => {
        const row = personRow({ documento: '1234567000123', tipodoc: '1', nome: 'ACME LTDA', fantasia: 'ACME', uf: '??', cidade: 'SAO LUIS', endereco2: 'CENTRO' });
        assert.deepEqual(row, { cnpj_cpf: '01234567000123', nome: 'ACME LTDA', fantasia: 'ACME', cidade: 'SAO LUIS', uf: '', bairro: 'CENTRO' });
        assert.deepEqual(driverRow({ documento: '123456789', tipodoc: '2', nome: 'JOSE' }), { cpf: '00123456789', nome: 'JOSE' });
    });

    it('veículo: ano do modelo ou fabricação, zeros viram vazio, peso pequeno não é confiável', () => {
        const owner = cnpjFrom('112223330001');
        const row = vehicleRow({ placa: 'ABC1D23', tipvei: 'S.REBQ. 3 EIXOS', anomod: '0', anofab: '2011', eixos: '0', tara: '9', capacidade_kgs: '25000', renavam: '00123', proprietario: String(Number(owner)), nome: 'DONO', uf_reg: 'MA' });
        assert.deepEqual([row.ano, row.eixos, row.tara, row.capacidade_kgs, row.proprietario_cpf_cnpj, row.uf_reg], ['2011', '', '', '25000', owner, 'MA']);
    });
});

describe('tabela de preço do legado', () => {
    const base = { fr_tipo: 'K', fr_valor: '1.100000', fr_min_tipo: 'M', fr_min_valor: '170.00', adv_1000: '10.0000', gris_1000: '0.0000', despacho: '35.00', outros: '0.00', icms: 'N', cubar: 'S', cubagem: 300, pedagio_pkg: '0.0000', pedagio_fixo: '0.00', liberada: 'S', ademe: '0.00', peso1: 0, valor1: '0.00', faixas_mais_taxas: 'N', descricao: 'TABELA TESTE' };

    it('JSON de tarifas: unidade, mínimo, ad valorem, cubagem e ICMS', () => {
        const r = mapLegacyPricing(base);
        assert.ok(r.ok);
        assert.deepEqual(
            [r.value.freightUnit, r.value.freightValue, r.value.minFreightValue, r.value.minFreightUnit, r.value.adValoremPercent, r.value.grisPercent, r.value.dispatchFee, r.value.otherFees, r.value.cubeEnabled, r.value.cubeFactor, r.value.icmsIncluded, r.value.active],
            ['RS_KG', 1.1, 170, 'RS', 10, null, 35, null, true, 300, false, true],
        );
        assert.deepEqual(r.value.unmapped, []);
    });

    it('CSV por cliente usa outros nomes de coluna', () => {
        const r = mapLegacyPricing({ frete_tipo: '%', frete: '15.000000', frete_min_tipo: 'R$', frete_min: '198.00', advalor_p_1000: '0.0000', gris: '1.5000', pedagio_p_kg: '0.0500', cubar: 'N', cubagem: '300', icms_incluso: 'S', liberada: 'S', descricao: '', divisao: '2', somar_todas_taxas: 'N', kgs_faixa_1: '0', valor_1: '0.00' });
        assert.ok(r.ok);
        assert.deepEqual([r.value.freightUnit, r.value.freightValue, r.value.minFreightValue, r.value.grisPercent, r.value.tollUnit, r.value.tollValue, r.value.cubeEnabled, r.value.cubeFactor, r.value.icmsIncluded], ['PERCENT', 15, 198, 1.5, 'RS_KG', 0.05, false, null, true]);
        assert.equal(r.value.description, 'Divisão 2 (legado)');
    });

    it('faixas de peso, ademe e valores implausíveis não têm equivalente: tabela fica inativa e o motivo é listado', () => {
        const r = mapLegacyPricing({ ...base, peso1: 100, valor1: '50.00', ademe: '1.5', adv_1000: '2000.0000' });
        assert.ok(r.ok);
        assert.equal(r.value.active, false);
        assert.ok(r.value.review.some((x) => x.startsWith('faixas de peso')) && r.value.review.includes('ademe'));
        assert.ok(r.value.unmapped.some((x) => x.includes('implausível')));
    });

    it('não liberada no legado → inativa; tipo de frete desconhecido → recusa', () => {
        const off = mapLegacyPricing({ ...base, liberada: 'N' });
        assert.ok(off.ok && !off.value.active && off.value.review.length === 0);
        const bad = mapLegacyPricing({ ...base, fr_tipo: 'X' });
        assert.ok(!bad.ok);
    });
});

describe('relatório da promoção', () => {
    it('resume por etapa, agrupa motivos sem números e gera CSV com aspas', () => {
        const outcomes = [
            { entity: 'pessoas', legacyKey: '1', key: 'a', result: 'created' as const },
            { entity: 'pessoas', legacyKey: '2', key: 'b', result: 'rejected' as const, detail: 'DV inválido' },
            { entity: 'pessoas', legacyKey: '3', key: 'c', result: 'rejected' as const, detail: 'DV inválido' },
            { entity: 'tarifas', legacyKey: '4', key: 'd', result: 'created' as const, detail: 'inativa, revisar: ademe | sem equivalente: ademe=1.5' },
        ];
        const s = summarize(outcomes);
        assert.deepEqual(s[0].counts, { created: 1, updated: 0, unchanged: 0, rejected: 2 });
        assert.equal(s[0].reasons[0].count, 2);
        assert.match(formatSummary(s), /2x \[rejected\] DV inválido/);
        assert.equal(s[1].reasons[0].reason, 'inativa, revisar: ademe');
        assert.match(toCsv([{ ...outcomes[3], detail: 'a;"b"' }]), /"a;""b"""/);
    });

    it('etapa desconhecida em --only é erro; agentes é reconhecido como não promovido', () => {
        assert.throws(() => selectSteps(['clientez']), /desconhecida/);
        assert.deepEqual(selectSteps(['agentes']), []);
        assert.deepEqual(selectSteps(['tarifas', 'clientes']).map((s) => s.name), ['clientes', 'tarifas']);
    });
});
