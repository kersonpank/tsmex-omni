import { describe, expect, it } from 'vitest';
import { mdfeDocUf, mdfeUfRows, printableFiscalDocuments } from './mdfe';

const doc = (over: Record<string, unknown>) => ({ id: 'd', documentType: 'MDFE', status: 'AUTHORIZED', number: null, statusReason: null, ...over }) as never;

describe('mdfeUfRows', () => {
  it('viagem de uma UF só não ganha linhas por UF', () => {
    expect(mdfeUfRows([doc({ unloadUf: 'MA' })], ['MA'])).toEqual([]);
    expect(mdfeUfRows([doc({})], undefined)).toEqual([]);
  });

  it('uma linha por UF com número, processamento e motivo da recusa', () => {
    const rows = mdfeUfRows([
      doc({ id: 'a', unloadUf: 'MA', number: '15' }),
      doc({ id: 'b', unloadUf: 'PI', status: 'REJECTED', statusReason: 'Informe valor da carga' }),
    ], ['MA', 'PI', 'CE']);
    expect(rows.map((r) => r.text)).toEqual(['MDF-e MA · nº 15 · autorizado', 'MDF-e PI · pendente: Informe valor da carga', 'MDF-e CE · pendente']);
    expect(rows.map((r) => r.state)).toEqual(['authorized', 'rejected', 'missing']);
  });

  it('SENT aparece como em processamento; MDF-e antigo sem UF cobre todas', () => {
    expect(mdfeUfRows([doc({ unloadUf: 'PI', status: 'SENT', number: '16' })], ['MA', 'PI'])[1].state).toBe('processing');
    expect(mdfeUfRows([doc({ number: '9' })], ['MA', 'PI']).map((r) => r.state)).toEqual(['authorized', 'authorized']);
    expect(mdfeDocUf(doc({ rawPayload: { infMDFe: { ide: { UFFim: 'pi' } } } }))).toBe('PI');
  });
});

describe('printableFiscalDocuments', () => {
  it('lista CIOT e MDF-e autorizados ou encerrados; só cita a UF com mais de um MDF-e', () => {
    const one = printableFiscalDocuments([doc({ id: '1', unloadUf: 'MA', number: '15', status: 'CLOSED' }), doc({ id: '2', documentType: 'CIOT', number: '77' }), doc({ id: '3', status: 'REJECTED' })]);
    expect(one.map((i) => i.label)).toEqual(['CIOT · nº 77', 'MDF-e · nº 15']);
    const two = printableFiscalDocuments([doc({ id: '1', unloadUf: 'PI', number: '16' }), doc({ id: '2', unloadUf: 'MA', number: '15' })]);
    expect(two.map((i) => i.label)).toEqual(['MDF-e MA · nº 15', 'MDF-e PI · nº 16']);
  });
});
