import { describe, expect, it } from 'vitest';
import type { HubCargoItem, HubCargoResolution } from '../../../types/index';
import { buildVolumeLabels, cargoFacts, scanOutcome } from './cargo';

function item(partial: Partial<HubCargoItem>): HubCargoItem {
    return {
        id: 'i1',
        kind: 'order',
        bucket: 'stock',
        status: 'AT_HUB',
        statusLabel: 'No hub',
        invoiceCount: 1,
        weightKg: 100,
        cubedWeightKg: 120,
        effectiveWeightKg: 120,
        volumeM3: 1,
        units: 3,
        fiscalValueBRL: 1000,
        ...partial,
    } as HubCargoItem;
}

describe('buildVolumeLabels', () => {
    it('gera uma etiqueta por volume, numerada, com o número do pedido como código', () => {
        const labels = buildVolumeLabels(item({ orderNumber: 1234, units: 3, nfNumber: '555' }));
        expect(labels).toHaveLength(3);
        expect(labels[0]).toMatchObject({ code: '1234', seq: 1, total: 3, nfNumber: '555' });
        expect(labels[2]).toMatchObject({ seq: 3, total: 3 });
    });

    it('pedido sem volumes informados gera 1 etiqueta', () => {
        expect(buildVolumeLabels(item({ orderNumber: 9, units: 0 }))).toHaveLength(1);
    });

    it('sem número de pedido não há etiqueta (código não resolveria no scan)', () => {
        expect(buildVolumeLabels(item({ orderNumber: null }))).toHaveLength(0);
    });
});

describe('cargoFacts', () => {
    it('monta remetente → destinatário · volumes · peso', () => {
        const text = cargoFacts(item({ senderName: 'ACME', recipientName: 'Loja MA', units: 3 }));
        expect(text).toBe('ACME → Loja MA · 3 vol. · 120 kg');
    });

    it('omite partes ausentes sem deixar separador órfão', () => {
        expect(cargoFacts(item({ units: 0, effectiveWeightKg: 0 }))).toBe('');
    });
});

describe('scanOutcome', () => {
    const anyItem = item({});

    it('pedido no hub abre o item', () => {
        expect(scanOutcome({ resolution: 'order_at_hub', item: anyItem })).toMatchObject({ kind: 'item' });
    });

    it('pedido já em viagem abre com aviso, nunca silencioso', () => {
        const out = scanOutcome({ resolution: 'already_in_trip', item: anyItem });
        expect(out.kind).toBe('item');
        expect('note' in out && out.note).toBeTruthy();
    });

    it('código inválido vira erro com a mensagem do backend', () => {
        const res: HubCargoResolution = { resolution: 'invalid', message: 'Código inválido.', preservedCode: 'x' };
        expect(scanOutcome(res)).toEqual({ kind: 'error', message: 'Código inválido.' });
    });

    it('NF-e válida sem cadastro orienta a entrada', () => {
        const res: HubCargoResolution = {
            resolution: 'valid_nfe_not_registered',
            accessKey: '1'.repeat(44),
            message: 'x',
        };
        expect(scanOutcome(res).kind).toBe('info');
    });
});
