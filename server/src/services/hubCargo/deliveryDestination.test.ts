import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickDeliveryDestination } from './deliveryDestination.js';

describe('pickDeliveryDestination', () => {
    it('uma cidade só: destino é essa cidade, com o trio consistente', () => {
        const result = pickDeliveryDestination([
            { fimPrestacao: 'Santa Inês, MA', fimIbgeCode: '2111201', weightKg: 100 },
            { fimPrestacao: 'Santa Inês, MA', fimIbgeCode: '2111201', weightKg: 50 },
        ]);
        assert.deepEqual(result, { city: 'Santa Inês', state: 'MA', cityIbgeCode: '2111201', label: 'Santa Inês, MA', otherCities: 0 });
    });

    it('várias cidades: vence a de maior peso e o rótulo indica as outras', () => {
        const result = pickDeliveryDestination([
            { fimPrestacao: 'Bacabal, MA', fimIbgeCode: '2100501', weightKg: 80 },
            { fimPrestacao: 'Santa Inês, MA', fimIbgeCode: '2111201', weightKg: 300 },
            { fimPrestacao: 'Pindaré, MA', fimIbgeCode: '2109403', weightKg: 20 },
        ]);
        assert.equal(result?.cityIbgeCode, '2111201');
        assert.equal(result?.label, 'Santa Inês, MA +2 cidades');
        assert.equal(result?.otherCities, 2);
    });

    it('singular para uma outra cidade', () => {
        const result = pickDeliveryDestination([
            { fimPrestacao: 'Bacabal, MA', fimIbgeCode: '2100501', weightKg: 80 },
            { fimPrestacao: 'Santa Inês, MA', fimIbgeCode: '2111201', weightKg: 300 },
        ]);
        assert.equal(result?.label, 'Santa Inês, MA +1 cidade');
    });

    it('usa o nome oficial do catálogo quando disponível', () => {
        const result = pickDeliveryDestination(
            [{ fimPrestacao: 'Santa Ines, MA', fimIbgeCode: '2111201', weightKg: 10 }],
            new Map([['2111201', { city: 'Santa Inês', state: 'MA' }]]),
        );
        assert.equal(result?.city, 'Santa Inês');
    });

    it('sem IBGE de entrega não inventa destino', () => {
        assert.equal(pickDeliveryDestination([{ fimPrestacao: 'Santa Inês, MA', fimIbgeCode: null, weightKg: 10 }]), null);
        assert.equal(pickDeliveryDestination([]), null);
    });
});
