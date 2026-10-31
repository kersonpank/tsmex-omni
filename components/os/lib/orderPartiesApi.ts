import api, { type DocumentLookupResult } from '../../../lib/api';
import type { Person } from '../../../types/index';
import type { PartyRole } from './partyFix';

export type PartyData = Partial<Pick<Person, 'legalName' | 'cep' | 'address' | 'number' | 'complement' | 'neighborhood' | 'city' | 'state' | 'cityIbgeCode'>> & { stateRegistration?: string | null };
export type OrderParties = Record<PartyRole, Person | null> & { freightTerm: string | null };

export const orderPartiesApi = {
    get: async (id: string): Promise<OrderParties> => (await api.get(`/orders/${id}/parties`)).data.data,
    registry: async (document: string): Promise<DocumentLookupResult> => (await api.get(`/persons/lookup-document/${document.replace(/\D/g, '')}`, { params: { fresh: 1 } })).data.data,
    refreshNfe: async (id: string, role: PartyRole, xml?: string): Promise<PartyData> => (await api.post(`/orders/${id}/parties/nfe-refresh`, { role, ...(xml ? { xml } : {}) })).data.data,
};
