import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { resolveStateRegistration, type ResolveStateRegistrationDeps } from './resolveStateRegistration.js';

function makeConsultCNPJ(stateRegistration?: string) {
    return mock.fn(async () => ({
        cnpj: '12345678000199',
        legalName: 'X',
        source: 'sintegra' as const,
        stateRegistration,
    }));
}

describe('resolveStateRegistration', () => {
    it('reusa Person.stateRegistration já gravado — nunca chama Sintegra', async () => {
        const consultCNPJ = makeConsultCNPJ('nao-deveria-ser-chamado');
        const deps: ResolveStateRegistrationDeps = {
            findPersonStateRegistration: mock.fn(async () => '110042490114'),
            consultCNPJ,
        };

        const result = await resolveStateRegistration('12345678000199', 'ie-do-xml', deps);

        assert.equal(result, '110042490114');
        assert.equal(consultCNPJ.mock.callCount(), 0);
    });

    it('usa IE do XML quando Person não tem — não chama Sintegra (dado já pago)', async () => {
        const consultCNPJ = makeConsultCNPJ('nao-deveria-ser-chamado');
        const deps: ResolveStateRegistrationDeps = {
            findPersonStateRegistration: mock.fn(async () => undefined),
            consultCNPJ,
        };

        const result = await resolveStateRegistration('12345678000199', '206283703315', deps);

        assert.equal(result, '206283703315');
        assert.equal(consultCNPJ.mock.callCount(), 0);
    });

    it('cai pro Sintegra só quando Person e XML não têm a IE', async () => {
        const consultCNPJ = makeConsultCNPJ('999888777');
        const deps: ResolveStateRegistrationDeps = {
            findPersonStateRegistration: mock.fn(async () => undefined),
            consultCNPJ,
        };
        process.env.SINTEGRA_TOKEN = 'fake-token';

        const result = await resolveStateRegistration('12345678000199', undefined, deps);

        assert.equal(result, '999888777');
        assert.equal(consultCNPJ.mock.callCount(), 1);
    });

    it('CPF (11 dígitos) nunca cai pro Sintegra — retorna undefined se não achar antes', async () => {
        const consultCNPJ = makeConsultCNPJ('nao-deveria-ser-chamado');
        const deps: ResolveStateRegistrationDeps = {
            findPersonStateRegistration: mock.fn(async () => undefined),
            consultCNPJ,
        };

        const result = await resolveStateRegistration('12345678901', undefined, deps);

        assert.equal(result, undefined);
        assert.equal(consultCNPJ.mock.callCount(), 0);
    });

    it('não falha se o Sintegra der erro — retorna undefined', async () => {
        const deps: ResolveStateRegistrationDeps = {
            findPersonStateRegistration: mock.fn(async () => undefined),
            consultCNPJ: mock.fn(async () => {
                throw new Error('Sintegra fora do ar');
            }),
        };
        process.env.SINTEGRA_TOKEN = 'fake-token';

        const result = await resolveStateRegistration('12345678000199', undefined, deps);

        assert.equal(result, undefined);
    });
});
