import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCiotRouteCeps } from './ciotRouteCeps.js';

const hub = (cep: string | null = '65010000', ibge = '2111300') => ({ city: 'São Luís', state: 'MA', cityIbgeCode: ibge, person: { cep, cityIbgeCode: ibge } });

describe('resolveCiotRouteCeps', () => {
    it('cidades diferentes sem CEP: não envia CEP e não bloqueia', () => {
        const result = resolveCiotRouteCeps({
            manifest: { hub: hub(null), destinationCity: 'Santa Inês', destinationState: 'MA', destinationCityIbgeCode: '2111201' } as any,
        });
        assert.deepEqual(result, {});
    });

    it('cidades diferentes: não envia CEP (o par de códigos IBGE basta e CEP desconhecido é recusado)', () => {
        const result = resolveCiotRouteCeps({
            manifest: {
                hub: hub(), destinationCity: 'Santa Inês', destinationState: 'MA', destinationCityIbgeCode: '2111201',
                legs: [{ order: { fimIbgeCode: '2111201', destinatarioPerson: { cep: '65.300-000', cityIbgeCode: '2111201' } } }],
            } as any,
        });
        assert.deepEqual(result, {});
    });

    it('só um CEP disponível (cidades diferentes): omite os dois, pois a ANTT recusa tipos mistos', () => {
        const result = resolveCiotRouteCeps({
            manifest: { hub: hub(), destinationCity: 'Santa Inês', destinationState: 'MA', destinationCityIbgeCode: '2111201' } as any,
        });
        assert.deepEqual(result, {});
    });

    it('mesmo IBGE sem CEP: bloqueia com mensagem clara', () => {
        assert.throws(() => resolveCiotRouteCeps({
            manifest: { hub: hub(null), destinationCity: 'São Luís', destinationState: 'MA', destinationCityIbgeCode: '2111300' } as any,
        }), (e: any) => e.statusCode === 400 && /mesmo município/.test(e.message) && /origem/.test(e.message) && /destino/.test(e.message));
    });

    it('mesmo IBGE: origem cai no endereço do emitente e destino no destinatário da Carta Frete', () => {
        const result = resolveCiotRouteCeps({
            manifest: { hub: hub(null), destinationCity: 'São Luís', destinationState: 'MA', destinationCityIbgeCode: '2111300' } as any,
            emitterPerson: { cep: '65020000', cityIbgeCode: '2111300' },
            destinatario: { endereco: { cep: '65030000', codigoMunicipio: 2111300 } },
        });
        assert.deepEqual(result, { cepOrigem: '65020000', cepDestino: '65030000' });
    });

    it('CEP de emitente de outro município não é usado como origem', () => {
        assert.throws(() => resolveCiotRouteCeps({
            manifest: { hub: hub(null), destinationCity: 'São Luís', destinationState: 'MA', destinationCityIbgeCode: '2111300' } as any,
            emitterPerson: { cep: '07000000', cityIbgeCode: '3518800' },
            destinatario: { endereco: { cep: '65030000', codigoMunicipio: 2111300 } },
        }), /mesmo município/);
    });
});
