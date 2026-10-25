import { describe, expect, it } from 'vitest';
import type { Manifest } from '../../../types/index';
import { buildCiotRequest, ciotFixGroup, emptyCiotAddress, initialCiotForm } from './ciot';

const manifest = {
    id: 'abcdef12-0000',
    totalWeight: 1200.4,
    freightAgreement: { freteBruto: 3000, adiantamento: 500, pedagio: 80 },
    link: { trailerPlate: 'ABC1D23' },
    destHub: { name: 'Hub Recife', city: 'Recife', cityIbgeCode: '2611606', person: { document: '12345678000190' } },
} as unknown as Manifest;

describe('ciot form', () => {
    it('pré-preenche da Carta Frete e do hub de destino', () => {
        const { form, address } = initialCiotForm(manifest);
        expect(form.totalViagem).toBe('3000');
        expect(form.totalAdiantamento).toBe('500');
        expect(form.pedagio).toBe('80');
        expect(form.composicaoVeicular).toBe(true);
        expect(form.destNome).toBe('Hub Recife');
        expect(form.pesoCarga).toBe('1200');
        expect(address.cityIbgeCode).toBe('2611606');
    });

    it('recusa formulário incompleto e monta o pedido completo', () => {
        const { form, address } = initialCiotForm(manifest);
        expect(buildCiotRequest(manifest.id, form, address, '', '111').error).toMatch(/distância/);
        const ready = { ...form, distanciaPercorrida: '800', dataFimViagem: '2026-11-01T10:00', paymentBankCode: '001', paymentAgency: '1', paymentAccount: '2' };
        const full = { ...address, cep: '50000000', address: 'Rua A', number: '1', neighborhood: 'Centro' };
        const result = buildCiotRequest(manifest.id, ready, full, 'TAC_AGREGADO', '11122233344');
        expect(result.error).toBeNull();
        const data = result.request?.requestData as any;
        expect(data.destinatario.endereco.codigoMunicipio).toBe(2611606);
        expect(data.pagamentos[0].cpfCnpjCreditado).toBe('11122233344');
        expect(data.retornoVazio).toBeUndefined();
        expect(buildCiotRequest(manifest.id, { ...ready, paymentMethod: 'PIX' }, full, '', '1').error).toMatch(/PIX/);
        expect(buildCiotRequest(manifest.id, ready, emptyCiotAddress, '', '1').error).toMatch(/destinatário/);
    });

    it('indica o grupo que resolve a pendência do servidor', () => {
        expect(ciotFixGroup('Motorista sem CNH cadastrada')?.group).toBe('registry');
        expect(ciotFixGroup('Defina o motorista da viagem')?.group).toBe('responsible');
        expect(ciotFixGroup('algo inesperado')).toBeNull();
    });
});
