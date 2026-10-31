import { describe, expect, it } from 'vitest';
import type { CiotTipoViagem, Manifest } from '../../../types/index';
import { buildCiotRequest, ciotDispensaError, ciotFixGroup, emptyCiotAddress, initialCiotForm, type CiotFormState } from './ciot';
import { CIOT_CARGO_TYPES, ciotNcmOptions, ciotPaymentFromAccount, ciotPaymentAccount, ciotRecipientFromHub, ciotRecipientFromPerson } from './ciot';

const now = new Date('2026-10-25T10:00:00Z');

describe('sugestões do CIOT', () => {
    it('conta todas as NFs e produtos por NCM4, sem duplicar produtos ou pernas', () => {
        const first = { id: 'd1', rawInputData: { nfeXmlData: { chave: 'nf1', produtos: [{ ncm: '87089990', descricao: 'Peças' }, { ncm: '87081000' }, { ncm: '73181500' }] } } };
        const second = { id: 'd2', rawInputData: { nfeXmlData: { chave: 'nf2', produtos: [{ ncm: '87089990', descricao: 'Peças' }] } } };
        expect(ciotNcmOptions({ demands: [first], legs: [{ order: { demand: first } }, { order: { demand: second } }] })).toEqual([
            { ncm4: '8708', description: 'Peças', count: 2 }, { ncm4: '7318', description: 'Natureza da carga', count: 1 },
        ]);
    });
    it('ignora NCM inválido e resolve empate por código para manter a sugestão estável', () => {
        expect(ciotNcmOptions({ demands: [{ rawInputData: { nfeXmlData: { produtos: [
            { ncm: '' }, { ncm: '123' }, { ncm: 'abcd1234' }, { ncm: '87089990' }, { ncm: '7318' },
        ] } } }] }).map((option) => option.ncm4)).toEqual(['7318', '8708']);
        expect(ciotNcmOptions({})).toEqual([]);
    });
    it('pré-preenche o NCM mais frequente entre todas as demandas', () => {
        const demands = ['73181500', '87089990', '87081000'].map((ncm, index) => ({ id: String(index), rawInputData: { nfeXmlData: { produtos: [{ ncm }] } } }));
        expect(initialCiotForm({ ...manifest, demands } as unknown as Manifest, now).form.codigoNcmNaturezaCarga).toBe('8708');
    });
    it('mantém os 12 códigos de tipo de carga e carga geral como padrão', () => {
        expect(CIOT_CARGO_TYPES.map((option) => option.value)).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 1)));
        expect(CIOT_CARGO_TYPES[4]).toEqual({ value: '5', label: 'Carga geral' });
        expect(CIOT_CARGO_TYPES[11].label).toBe('Granel pressurizada');
        expect(initialCiotForm(manifest, now).form.codigoTipoCarga).toBe('5');
    });
    it('preenche PIX com tipo e titular, e conta sem presumir chave PIX', () => {
        const pix = ciotPaymentFromAccount({ pixKey: 'email@example.com', pixKeyType: 'Email', holderName: 'Titular', holderDocument: '111.222.333-44' });
        expect(pix.paymentMethod).toBe('PIX');
        expect(pix.pixKeyType).toBe('Email');
        expect(ciotPaymentFromAccount({ pixKey: 'chave-sem-tipo' }).pixKeyType).toBe('');
        expect(ciotPaymentAccount(pix)).toMatchObject({ pixKey: 'email@example.com', pixKeyType: 'Email', holderName: 'Titular', holderDocument: '11122233344', bankCode: '' });
        expect(ciotPaymentFromAccount({ bankCode: '341', agency: '1234', account: '5678-9', accountType: 'ContaPoupanca' })).toMatchObject({
            paymentMethod: 'BANK', pixKey: '', paymentBankCode: '341', paymentAgency: '1234', paymentAccount: '5678-9', paymentAccountType: 'ContaPoupanca',
        });
    });
    it('preenche todos os campos de endereço da pessoa e usa o endereço do hub como fallback', () => {
        const person = { document: '11222333000181', legalName: 'Destino Ltda', cep: '01310930', address: 'Rua A', number: '10', complement: 'Sala 2', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' };
        expect(ciotRecipientFromPerson(person)).toEqual({ form: { destNome: person.legalName, destCpfCnpj: person.document }, address: {
            cep: person.cep, address: person.address, number: person.number, complement: person.complement, neighborhood: person.neighborhood, city: person.city, state: person.state, cityIbgeCode: person.cityIbgeCode,
        } });
        expect(ciotRecipientFromHub({ name: 'Hub destino', city: 'São Paulo', state: 'SP', address: 'Rua do hub', cityIbgeCode: '3550308', person })).toEqual(ciotRecipientFromPerson(person));
        expect(ciotRecipientFromHub({ name: 'Hub sem pessoa', city: 'São Paulo', state: 'SP', address: 'Rua do hub' })).toMatchObject({ form: { destNome: 'Hub sem pessoa', destCpfCnpj: '' }, address: { address: 'Rua do hub', cep: '' } });
    });
    it('limpa a chave anterior ao salvar uma conta bancária e envia documento do titular', () => {
        const { form, address } = readyForm();
        const changed = { ...form, pixKey: 'chave-antiga', holderDocument: '111.222.333-44' };
        expect(ciotPaymentAccount(changed).pixKey).toBe('');
        expect(buildCiotRequest(manifest.id, changed, address, '', '999', now).request?.requestData.pagamentos[0].cpfCnpjCreditado).toBe('11122233344');
    });
});
const manifest = {
    id: 'abcdef12-0000',
    totalWeight: 1200.4,
    freightAgreement: { freteBruto: 3000, adiantamento: 500, pedagio: 80 },
    link: { trailerPlate: 'ABC1D23' },
    vehicleAssignments: [
        { slot: 0, vehicleUnit: { role: 'TRACTION', wheelType: 'Cavalo' } },
        { slot: 1, vehicleUnit: { role: 'TRAILER' } },
    ],
    demands: [{ rawInputData: { nfeXmlData: { produtos: [{ ncm: '73181500' }] } } }],
    destHub: { name: 'Hub Recife', city: 'Recife', cityIbgeCode: '2611606', person: { document: '12345678000190' } },
} as unknown as Manifest;

function readyForm() {
    const { form, address } = initialCiotForm(manifest, now);
    return {
        form: {
            ...form, distanciaPercorrida: '800', dataInicioViagem: '2026-10-26T10:00:00Z',
            dataFimViagem: '2026-11-01T10:00:00Z', tipoEmbalagem: 'Caixa',
            paymentBankCode: '001', paymentAgency: '1234-5', paymentAccount: '12345-6',
        },
        address: { ...address, cep: '50000000', address: 'Rua A', number: '1', neighborhood: 'Centro' },
    };
}

function build(patch: Partial<CiotFormState> = {}, tipo: CiotTipoViagem | '' = '') {
    const { form, address } = readyForm();
    return buildCiotRequest(manifest.id, { ...form, ...patch }, address, tipo, '11122233344', now);
}

describe('ciot form', () => {
    it('pré-preenche da Carta Frete e do hub de destino', () => {
        const { form, address } = initialCiotForm(manifest, now);
        expect(form.totalViagem).toBe('3000');
        expect(form.totalAdiantamento).toBe('500');
        expect(form.pedagio).toBe('80');
        expect(form.composicaoVeicular).toBe(true);
        expect(form.destNome).toBe('Hub Recife');
        expect(form.pesoCarga).toBe('1200.4');
        expect(form.codigoNcmNaturezaCarga).toBe('7318');
        expect(form.totalQuitacao).toBe('2500');
        expect(form.retornoVazio).toBe(false);
        expect(form.paymentAccountType).toBe('ContaCorrente');
        expect(new Date(form.dataInicioViagem).getTime()).toBe(now.getTime() + 3_600_000);
        expect(address.cityIbgeCode).toBe('2611606');
    });

    it('recusa formulário incompleto e monta o pedido completo', () => {
        const initial = initialCiotForm(manifest, now);
        expect(buildCiotRequest(manifest.id, initial.form, initial.address, '', '111', now).error).toMatch(/distância/);
        const { form, address } = readyForm();
        const result = buildCiotRequest(manifest.id, form, address, 'TAC_AGREGADO', '11122233344', now);
        expect(result.error).toBeNull();
        const data = result.request?.requestData as any;
        expect(data.destinatario.endereco.codigoMunicipio).toBe(2611606);
        expect(data.pagamentos[0].cpfCnpjCreditado).toBe('11122233344');
        expect(data.retornoVazio).toBeUndefined();
        expect(buildCiotRequest(manifest.id, { ...form, paymentMethod: 'PIX' }, address, '', '1', now).error).toMatch(/PIX/);
        expect(buildCiotRequest(manifest.id, form, emptyCiotAddress, '', '1', now).error).toMatch(/destinatário/);
    });

    it('respeita os instantes planejados no fuso local do formulário', () => {
        const { form } = initialCiotForm({ ...manifest, plannedDepartureAt: '2026-10-26T12:34:00Z', plannedArrivalAt: '2026-10-27T18:45:00Z' }, now);
        expect(new Date(form.dataInicioViagem).toISOString()).toBe('2026-10-26T12:34:00.000Z');
        expect(new Date(form.dataFimViagem).toISOString()).toBe('2026-10-27T18:45:00.000Z');
    });

    it('não presume composição por placa legada nem NCM sem XML', () => {
        const { form } = initialCiotForm({ ...manifest, vehicleAssignments: [], demands: [] }, now);
        expect(form.composicaoVeicular).toBe(false);
        expect(form.codigoNcmNaturezaCarga).toBe('');
    });

    it('monta pagamento único sem categoria cuja soma coincide com o total', () => {
        const result = build();
        expect(result.error).toBeNull();
        const data = result.request!.requestData;
        expect(data.pagamentos).toHaveLength(1);
        expect(data.pagamentos[0]).toMatchObject({ valor: 3000, categoria: 'SemCategoria', indicadorPagamento: 'Avista' });
        expect(data.pagamentos.reduce((sum, payment) => sum + payment.valor, 0)).toBe(data.valores.totalViagem);
        expect(data.retornoVazio).toBe(false);
        expect(data.tipoEmbalagem).toBe('Caixa');
        expect(data.dataInicioViagem).toBe('2026-10-26T10:00:00.000Z');
    });

    it.each(['0', '-1', 'abc'])('rejeita distância inválida %s', (distanciaPercorrida) => {
        expect(build({ distanciaPercorrida }).error).toMatch(/distância/);
    });

    it('exige início futuro e limita a duração a 90 dias', () => {
        expect(build({ dataInicioViagem: '' }).error).toMatch(/início/);
        expect(build({ dataInicioViagem: '2026-10-24T10:00:00Z' }).error).toMatch(/atuais/);
        expect(build({ dataFimViagem: '2027-01-25T10:00:01Z' }).error).toMatch(/90 dias/);
        expect(build({ dataFimViagem: '2027-01-24T10:00:00Z' }).error).toBeNull();
        expect(build({ dataFimViagem: '2026-10-25T10:00:00Z' }).error).toMatch(/posterior/);
        expect(build({ dataFimViagem: 'inválida' }).error).toMatch(/data válida/);
    });

    it.each([
        [{ codigoNcmNaturezaCarga: '' }, /NCM/],
        [{ codigoNcmNaturezaCarga: '73181500' }, /4 dígitos/],
        [{ pesoCarga: '' }, /peso/],
        [{ pesoCarga: '0' }, /peso/],
        [{ codigoTipoCarga: '13' }, /tipo de carga/],
        [{ tipoEmbalagem: '' }, /embalagem/],
    ] as Array<[Partial<CiotFormState>, RegExp]>)('exige dados de carga válidos: %j', (patch, message) => {
        expect(build(patch).error).toMatch(message);
    });

    it('Fracionado automático não exige nem envia embalagem e mantém SemCategoria', () => {
        const { form, address } = readyForm();
        const result = buildCiotRequest(manifest.id, { ...form, tipoEmbalagem: '' }, address, '', '11122233344', now, 'FRACIONADO');
        expect(result.error).toBeNull();
        expect(result.request!.tipoViagemOverride).toBeUndefined();
        expect(result.request!.requestData.tipoEmbalagem).toBeUndefined();
        expect(result.request!.requestData.pagamentos[0].categoria).toBe('SemCategoria');
    });

    it('TAC omite dados de carga e início, dispensa distância e limita fim a 30 dias', () => {
        const result = build({ dataInicioViagem: '', distanciaPercorrida: '', codigoNcmNaturezaCarga: '', pesoCarga: '', codigoTipoCarga: '', tipoEmbalagem: '' }, 'TAC_AGREGADO');
        expect(result.error).toBeNull();
        expect(result.request!.requestData.distanciaPercorrida).toBe(0);
        expect(result.request!.requestData.dataInicioViagem).toBeUndefined();
        expect(result.request!.requestData.codigoNcmNaturezaCarga).toBeUndefined();
        expect(result.request!.requestData.tipoEmbalagem).toBeUndefined();
        expect(build({ dataFimViagem: '2026-11-24T10:00:01Z' }, 'TAC_AGREGADO').error).toMatch(/30 dias/);
        expect(build({ dataFimViagem: '2026-11-24T10:00:00Z' }, 'TAC_AGREGADO').error).toBeNull();
    });

    it('normaliza CEP com máscara e número para dígitos ou zero sem inventar CEP', () => {
        const { form, address } = readyForm();
        const masked = buildCiotRequest(manifest.id, form, { ...address, cep: '50000-000', number: '12-A' }, '', '11122233344', now);
        expect(masked.request!.requestData.destinatario.endereco).toMatchObject({ cep: '50000000', numero: '12' });
        const absent = buildCiotRequest(manifest.id, form, { ...address, number: '' }, '', '11122233344', now);
        expect(absent.request!.requestData.destinatario.endereco.numero).toBe('0');
        expect(buildCiotRequest(manifest.id, form, { ...address, cep: '5000000' }, '', '11122233344', now).error).toMatch(/8 dígitos/);
    });

    it('recusa PIX sem chave e o tipo inexistente IdentificadorPix', () => {
        expect(build({ paymentMethod: 'PIX' }).error).toMatch(/PIX/);
        expect(build({ paymentMethod: 'PIX', pixKey: 'real', pixKeyType: 'IdentificadorPix' as CiotFormState['pixKeyType'] }).error).toMatch(/tipo de chave/);
        expect(build({ paymentMethod: 'PIX', pixKey: 'pessoa@exemplo.com', pixKeyType: 'Email' }).request!.requestData.pagamentos[0].pix?.tipoChave).toBe('Email');
    });

    it.each(['TransferenciaBancaria', 'DepositoAgendado'] as const)('valida banco em %s, dígito da agência opcional', (tipoPagamento) => {
        expect(build({ tipoPagamento, paymentAccount: '12345' }).error).toMatch(/número-dígito/);
        expect(build({ tipoPagamento, paymentAgency: '12-A' }).error).toMatch(/número-dígito/);
        expect(build({ tipoPagamento, paymentAgency: '1234' }).error).toBeNull();
    });

    it('exige número de parcela no pagamento a prazo', () => {
        expect(build({ indicadorPagamento: 'Aprazo' }).error).toMatch(/número da parcela/);
        expect(build({ indicadorPagamento: 'Aprazo', numeroParcela: '0' }).error).toMatch(/número da parcela/);
        expect(build({ indicadorPagamento: 'Aprazo', numeroParcela: '2' }).request!.requestData.pagamentos[0].numeroParcela).toBe(2);
    });

    it('eFRETE aceita pagamento sem banco ou PIX e não envia dados ocultos', () => {
        const result = build({ tipoPagamento: 'eFRETE', paymentBankCode: '', paymentAgency: '', paymentAccount: '', pixKey: '' });
        expect(result.error).toBeNull();
        expect(result.request!.requestData.pagamentos[0].informacoesBancarias).toBeUndefined();
        expect(result.request!.requestData.pagamentos[0].pix).toBeUndefined();
    });

    it('valida soma de adiantamento e quitação com precisão de centavos', () => {
        expect(build({ totalQuitacao: '2499.99' }).error).toMatch(/Adiantamento \+ quitação/);
        expect(build({ totalAdiantamento: '-1', totalQuitacao: '3001' }).error).toMatch(/Adiantamento/);
        expect(build({ totalViagem: '0.30', totalAdiantamento: '0.10', totalQuitacao: '0.20' }).error).toBeNull();
    });

    it('exige motivo fechado e validação de 20 caracteres para Outro na dispensa', () => {
        expect(ciotDispensaError('', '')).toMatch(/Selecione/);
        expect(ciotDispensaError('FROTA_PROPRIA_CARGA_PROPRIA', '')).toBeNull();
        expect(ciotDispensaError('OUTRO_VALIDADO_TORRE', 'Validado')).toMatch(/20 caracteres/);
        expect(ciotDispensaError('OUTRO_VALIDADO_TORRE', 'Torre validou a dispensa desta operação.')).toBeNull();
    });

    it('indica o grupo que resolve a pendência do servidor', () => {
        expect(ciotFixGroup('Motorista sem CNH cadastrada')?.group).toBe('registry');
        expect(ciotFixGroup('Defina o motorista da viagem')?.group).toBe('responsible');
        expect(ciotFixGroup('algo inesperado')).toBeNull();
    });
});
