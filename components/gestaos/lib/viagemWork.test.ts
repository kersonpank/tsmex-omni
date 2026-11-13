import { describe, expect, it } from 'vitest';
import type { Hub, ManifestReadiness, ManifestReadinessIssue } from '../../../types/index';
import { buildCreateBody, commonDestination, missingItems, parseOrderIds, pendingByStep, tripPermissions, validateNewTrip, type NewTripValues } from './viagemWork';

const hub = (id: string, city: string, state: string, ibge: string | null): Hub => ({ id, name: city, code: id.toUpperCase(), city, state, cityIbgeCode: ibge ?? undefined, active: true } as unknown as Hub);
const HUBS = [hub('gru', 'Guarulhos', 'SP', '3518800'), hub('imp', 'Imperatriz', 'MA', '2105302'), hub('sem', 'Semcodigo', 'SP', null)];
const base: NewTripValues = { tripType: 'TRANSFER', hubId: 'gru', destHubId: 'imp', destCity: null, startsWithCollection: false, originCity: null, vehicleTypeId: 'vt' };

const issue = (code: string, step: ManifestReadinessIssue['step'], severity: 'blocking' | 'warning' = 'blocking'): ManifestReadinessIssue => ({ code, step, severity, message: `msg ${code}` });
const readiness = (issues: ManifestReadinessIssue[], extra: Partial<ManifestReadiness> = {}): ManifestReadiness => ({ canOffer: false, canStart: false, currentStep: 'route', steps: {} as never, issues, ...extra });

describe('criação da viagem', () => {
    it('transferência válida não pede cidade e deriva o destino do hub', () => {
        expect(validateNewTrip(base, HUBS)).toEqual({});
        expect(buildCreateBody(base, HUBS)).toMatchObject({
            tripType: 'TRANSFER', hubId: 'gru', destHubId: 'imp', vehicleTypeId: 'vt',
            origin: 'Guarulhos, SP', originCityIbgeCode: '3518800', destination: 'Imperatriz, MA', destinationCityIbgeCode: '2105302', startsWithCollection: false,
        });
    });
    it('aponta o que falta e as travas de IBGE', () => {
        expect(validateNewTrip({ ...base, hubId: null, destHubId: null, vehicleTypeId: null }, HUBS)).toEqual({ hubId: 'Selecione o hub de origem.', destHubId: 'Selecione o hub de destino.', vehicleTypeId: 'Selecione o tipo de veículo.' });
        expect(validateNewTrip({ ...base, hubId: 'sem' }, HUBS).hubId).toMatch(/IBGE/);
        expect(validateNewTrip({ ...base, destHubId: 'gru' }, HUBS).destHubId).toMatch(/diferente/);
        expect(validateNewTrip({ ...base, tripType: 'DELIVERY', destHubId: null }, HUBS).destCity).toMatch(/IBGE/);
    });
    it('entrega usa a cidade escolhida e não manda hub de destino', () => {
        const values: NewTripValues = { ...base, tripType: 'DELIVERY', destHubId: 'imp', destCity: { city: 'Pedreiras', state: 'MA', ibgeCode: '2106102' } };
        const body = buildCreateBody(values, HUBS);
        expect(body.destHubId).toBeUndefined();
        expect(body).toMatchObject({ destination: 'Pedreiras, MA', destinationCityIbgeCode: '2106102', tripType: 'DELIVERY' });
    });
    it('coleta troca a origem pela cidade da coleta', () => {
        const values: NewTripValues = { ...base, startsWithCollection: true, originCity: { city: 'Araras', state: 'SP', ibgeCode: '3503307' } };
        expect(buildCreateBody(values, HUBS)).toMatchObject({ origin: 'Araras, SP', originCityIbgeCode: '3503307', hubId: 'gru', startsWithCollection: true });
        expect(validateNewTrip({ ...values, originCity: null }, HUBS).originCity).toBeTruthy();
    });
    it('lê ?orders= sem vazios nem repetidos e acha destino comum', () => {
        expect(parseOrderIds('a,,b, a')).toEqual(['a', 'b']);
        expect(parseOrderIds(null)).toEqual([]);
        const dest = { fimPrestacao: 'Imperatriz, MA', fimIbgeCode: '2105302' };
        expect(commonDestination([dest, { ...dest }])).toEqual({ city: 'Imperatriz', state: 'MA', ibgeCode: '2105302' });
        expect(commonDestination([dest, { fimPrestacao: 'Açailândia, MA', fimIbgeCode: '2100055' }])).toBeNull();
        expect(commonDestination([])).toBeNull();
    });
});

describe('prontidão e estados', () => {
    const issues = [issue('ORDER_REQUIRED', 'orders'), issue('LINK_REQUIRED', 'responsible'), issue('FREIGHT_AGREEMENT_REQUIRED', 'freight'), issue('MDFE_RCV_PENDING', 'fiscal', 'warning')];
    it('agrupa as pendências e aponta a etapa que resolve', () => {
        const items = missingItems(issues);
        expect(items.map((item) => item.step).sort()).toEqual(['capa', 'carga', 'documentos', 'transportador']);
        expect(items.find((item) => item.step === 'documentos')?.blocking).toBe(false);
        expect(pendingByStep(issues)).toMatchObject({ carga: 1, transportador: 1, capa: 1, documentos: 0 });
    });
    it('cada ação só vale no estado certo, com motivo quando não vale', () => {
        const draft = tripPermissions({ status: 'DRAFT' }, readiness(issues));
        expect(draft.editPlanning.allowed).toBe(true);
        expect(draft.offer).toMatchObject({ allowed: false });
        expect(draft.offer.reason).toMatch(/3 pendências/);
        expect(draft.accept.allowed).toBe(false);
        expect(tripPermissions({ status: 'DRAFT' }, readiness([], { canOffer: true })).offer.allowed).toBe(true);

        const offered = tripPermissions({ status: 'PENDING_ACCEPT' }, readiness([]));
        expect(offered.withdraw.allowed).toBe(true);
        expect(offered.accept.allowed).toBe(true);
        expect(offered.editPlanning.reason).toMatch(/Retire a oferta/);

        const accepted = tripPermissions({ status: 'ACCEPTED' }, readiness([], { canStart: true }));
        expect(accepted.start.allowed).toBe(true);
        expect(accepted.reopen.allowed).toBe(true);
        expect(accepted.editCover.allowed).toBe(true);

        const road = tripPermissions({ status: 'IN_PROGRESS' }, readiness([]));
        expect(road.cancel.allowed).toBe(false);
        expect(road.start.allowed).toBe(false);
        expect(road.editCover.allowed).toBe(false);
    });
    it('não reabre com MDF-e vivo e respeita o veredito do servidor', () => {
        const live = tripPermissions({ status: 'ACCEPTED', fiscalDocuments: [{ documentType: 'MDFE', status: 'AUTHORIZED' }] as never }, readiness([]));
        expect(live.reopen.allowed).toBe(false);
        const denied = tripPermissions({ status: 'ACCEPTED' }, readiness([], { planningActions: { reopen: { allowed: false, reason: 'Há CT-e.' } } as never }));
        expect(denied.reopen.reason).toBe('Há CT-e.');
    });
});
