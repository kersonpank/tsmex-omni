import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hubCargoCapabilities } from './hubCargoReadModel.js';

describe('hubCargoCapabilities', () => {
    it('mantém acesso total para ADMIN', () => {
        assert.deepEqual(hubCargoCapabilities(['ADMIN'], []), {
            canViewOrders: true,
            canReceive: true,
            canCreateTrip: true,
        });
    });

    it('preserva os IDs de permissão já existentes no Hub', () => {
        assert.deepEqual(
            hubCargoCapabilities(['HUB'], ['pedidos', 'entrada', 'manifestos']),
            {
                canViewOrders: true,
                canReceive: true,
                canCreateTrip: true,
            },
        );
    });

    it('separa consulta, entrada e criação de viagem', () => {
        assert.deepEqual(hubCargoCapabilities(['HUB'], ['pedidos']), {
            canViewOrders: true,
            canReceive: false,
            canCreateTrip: false,
        });
        assert.deepEqual(hubCargoCapabilities(['HUB'], ['entrada']), {
            canViewOrders: false,
            canReceive: true,
            canCreateTrip: false,
        });
    });

    it('mantém o comportamento legado de Hub sem restrições explícitas', () => {
        assert.deepEqual(hubCargoCapabilities(['HUB'], []), {
            canViewOrders: true,
            canReceive: true,
            canCreateTrip: true,
        });
    });
});
