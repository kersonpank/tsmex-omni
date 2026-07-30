import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasOperationalPermission } from './operationalPermissions.js';

describe('hasOperationalPermission', () => {
    it('permite ADMIN independentemente das permissões operacionais', () => {
        assert.equal(hasOperationalPermission(['ADMIN'], [], 'entrada'), true);
    });

    it('permite HUB com a permissão solicitada', () => {
        assert.equal(hasOperationalPermission(['HUB'], ['entrada'], 'entrada'), true);
    });

    it('nega HUB com permissões explícitas que não incluem a operação', () => {
        assert.equal(hasOperationalPermission(['HUB'], ['pedidos'], 'entrada'), false);
    });

    it('mantém HUB legado sem restrições explícitas', () => {
        assert.equal(hasOperationalPermission(['HUB'], [], 'entrada'), true);
    });

    it('não concede operação de HUB a outros papéis', () => {
        assert.equal(hasOperationalPermission(['CLIENT'], ['entrada'], 'entrada'), false);
    });
});
