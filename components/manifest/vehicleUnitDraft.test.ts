import { describe, expect, it } from 'vitest';
import type { Link, VehicleUnit } from '../../types/index';
import {
  compositionDraftIssues,
  draftIssues,
  draftsFromLink,
  draftToInput,
  emptyDraft,
  linkCompositionSummary,
  newTrailerDraft,
} from './vehicleUnitDraft';

const unit = (overrides: Partial<VehicleUnit> = {}): VehicleUnit => ({
  id: 'u1',
  plate: 'ABC1D23',
  role: 'TRACTION',
  chassi: '9BWZZZ377VT004251',
  renavam: '12345678901',
  axles: 3,
  rntrc: '123456789',
  ...overrides,
});
const link = (overrides: Partial<Link> = {}): Link => ({ id: 'l1', vehiclePlate: '', ...overrides } as Link);

describe('vehicle unit draft', () => {
  it('rascunho de unidade completa não tem pendência', () => {
    expect(draftIssues(draftsFromLink(link({ tractionUnit: unit() })).traction)).toEqual([]);
  });

  it('RENAVAM e RNTRC são obrigatórios', () => {
    const draft = { ...emptyDraft('TRACTION'), plate: 'ABC1D23', chassi: '9BWZZZ377VT004251', axles: '3' };
    expect(draftIssues(draft).map((i) => i.field)).toEqual(['renavam', 'rntrc']);
  });

  it('formato inválido é distinto de ausente', () => {
    const draft = { ...emptyDraft('TRACTION'), plate: 'ABC12', chassi: 'CURTO', renavam: '12', axles: '0', rntrc: '123' };
    expect(draftIssues(draft).every((i) => i.reason === 'invalid')).toBe(true);
    expect(draftIssues(draft)).toHaveLength(5);
  });

  it('reboque nasce com rodado "não aplicável" (só o cavalo é "Cavalo") e herda o RNTRC do cavalo', () => {
    expect(emptyDraft('TRAILER').wheelType).toBe('NaoAplicavel');
    expect(emptyDraft('TRACTION').wheelType).toBe('Cavalo');
    expect(newTrailerDraft({ ...emptyDraft('TRACTION'), rntrc: '123456789' }).rntrc).toBe('123456789');
  });

  it('usa as unidades do Link e cai nas colunas legadas quando ainda não há unidade', () => {
    const fromUnits = draftsFromLink(link({ tractionUnit: unit(), trailer1Unit: unit({ id: 'u2', plate: 'REB1A11', role: 'TRAILER' }) }));
    expect(fromUnits.traction.unitId).toBe('u1');
    expect(fromUnits.trailers.map((t) => t.plate)).toEqual(['REB1A11']);

    const legacy = draftsFromLink(link({ vehiclePlate: 'abc-1d23', vehicleChassi: '9BWZZZ377VT004251', vehicleAxles: 6, trailerPlate: 'reb1a11' }));
    expect(legacy.traction.plate).toBe('ABC1D23');
    expect(legacy.traction.axles).toBe('6');
    expect(legacy.trailers[0].plate).toBe('REB1A11');
    expect(legacy.trailers[0].unitId).toBeUndefined();
  });

  it('placeholder de cadastro ("A completar") não vira placa do cavalo', () => {
    expect(draftsFromLink(link({ vehiclePlate: 'A completar' })).traction.plate).toBe('');
  });

  it('converte para o payload da API normalizando e limpando vazios', () => {
    const input = draftToInput({ ...emptyDraft('TRAILER'), plate: 'reb-1a11', chassi: '9bwzzz377vt004999', renavam: '123.456.789-01', axles: '3', rntrc: '12.345.678-9' });
    expect(input).toMatchObject({ plate: 'REB1A11', chassi: '9BWZZZ377VT004999', renavam: '12345678901', axles: 3, rntrc: '123456789', year: null, ownerDocument: null });
  });

  it('resume as pendências por unidade, com rótulo de cavalo/reboque', () => {
    const traction = { ...emptyDraft('TRACTION'), plate: 'ABC1D23', chassi: '9BWZZZ377VT004251', renavam: '12345678901', axles: '3', rntrc: '123456789' };
    const trailer = { ...emptyDraft('TRAILER'), plate: 'REB1A11' };
    const pending = compositionDraftIssues(traction, [trailer]);
    expect(pending).toHaveLength(1);
    expect(pending[0].label).toBe('Reboque 1');
  });

  it('linkCompositionSummary marca só a unidade que realmente falta dado', () => {
    const summary = linkCompositionSummary(link({ tractionUnit: unit(), trailerPlate: 'REB1A11' }));
    expect(summary.map((s) => [s.plate, s.issues.length > 0])).toEqual([['ABC1D23', false], ['REB1A11', true]]);
  });
});
