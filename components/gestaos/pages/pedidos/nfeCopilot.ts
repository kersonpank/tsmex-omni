import { formatApiError, nfeApi, personsApi } from '../../../../lib/api';
import type { Person } from '../../../../types/index';
import { toPersonSummary, type PersonSummary } from '../../ui/pickers';

/**
 * Copilot da entrada: com a chave de 44 dígitos o servidor devolve emitente e, quando já tem o XML,
 * o destinatário. Aqui a chave vira nota + pessoas, do mesmo jeito que o prescan da gestão clássica
 * (busca a pessoa pelo CNPJ; se não existe, cadastra com os dados da NF). Volumes, peso e valor NÃO
 * vêm dessa consulta: o servidor não os devolve, então a pessoa digita da DANFE.
 */

export type NfeLookupData = Awaited<ReturnType<typeof nfeApi.lookup>>['data']['data'];

export interface NfeCopilotResult {
    lookup: NfeLookupData;
    remetente: PersonSummary | null;
    destinatario: PersonSummary | null;
    /** Avisos sobre o que o sistema não conseguiu preencher. */
    notes: string[];
}

const same = (a: string, b: string) => a.replace(/\D/g, '') === b.replace(/\D/g, '');

async function findOrCreate(document: string, create: (() => Record<string, unknown>) | null): Promise<PersonSummary | null> {
    try {
        const found = ((await personsApi.search(document)) as { data?: Person[] })?.data ?? [];
        const match = found.find((person) => same(person.document, document));
        if (match) return toPersonSummary(match);
        if (!create) return null;
        const created = (await personsApi.create(create() as never)) as { data?: Person } | Person;
        const person = ((created as { data?: Person })?.data ?? created) as Person;
        return person?.id ? toPersonSummary(person) : null;
    } catch {
        return null;
    }
}

export const isChave = (text: string): boolean => text.replace(/\D/g, '').length === 44;

export async function runNfeCopilot(chave: string, hubId?: string | null): Promise<NfeCopilotResult> {
    const digits = chave.replace(/\D/g, '');
    if (digits.length !== 44) throw new Error('A chave da NF-e tem 44 dígitos.');
    let lookup: NfeLookupData;
    try {
        lookup = (await nfeApi.lookup(digits, hubId || undefined)).data.data;
    } catch (cause) {
        throw new Error(`${formatApiError(cause)} Preencha a nota à mão.`);
    }
    const notes: string[] = [];

    const remetente = lookup.cnpjEmitente
        ? await findOrCreate(
              lookup.cnpjEmitente,
              lookup.emitenteRazaoSocial
                  ? () => ({
                        documentType: 'CNPJ',
                        document: lookup.cnpjEmitente,
                        legalName: lookup.emitenteRazaoSocial,
                        ...(lookup.emitenteTradeName ? { tradeName: lookup.emitenteTradeName } : {}),
                        ...(lookup.emitenteMunicipio ? { city: lookup.emitenteMunicipio } : {}),
                        ...(lookup.uf ? { state: lookup.uf } : {}),
                        ...(lookup.emitenteCep ? { cep: lookup.emitenteCep } : {}),
                        ...(lookup.emitenteLogradouro ? { address: lookup.emitenteLogradouro } : {}),
                        ...(lookup.emitenteNumero ? { number: lookup.emitenteNumero } : {}),
                        ...(lookup.emitenteBairro ? { neighborhood: lookup.emitenteBairro } : {}),
                        ...(lookup.emitenteIe ? { stateRegistration: lookup.emitenteIe } : {}),
                    })
                  : null,
          )
        : null;
    if (!remetente) notes.push(`CNPJ ${lookup.cnpjEmitente || 'do emitente'} não encontrado: escolha o remetente abaixo.`);

    const dest = lookup.destinatario;
    const destinatario = dest?.cnpj
        ? await findOrCreate(
              dest.cnpj,
              dest.razaoSocial
                  ? () => ({
                        documentType: 'CNPJ',
                        document: dest.cnpj,
                        legalName: dest.razaoSocial,
                        ...(dest.ie ? { stateRegistration: dest.ie } : {}),
                        ...(dest.municipio ? { city: dest.municipio } : {}),
                        ...(dest.uf ? { state: dest.uf } : {}),
                        ...(dest.cep ? { cep: dest.cep } : {}),
                        ...(dest.logradouro ? { address: dest.logradouro } : {}),
                        ...(dest.numero ? { number: dest.numero } : {}),
                        ...(dest.bairro ? { neighborhood: dest.bairro } : {}),
                    })
                  : null,
          )
        : null;
    if (!destinatario) {
        const limited = lookup.distribuicaoIndisponivel;
        if (limited?.motivo === 'rate_limit') {
            const at = limited.nextAllowedAt ? new Date(limited.nextAllowedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
            notes.push(`A SEFAZ permite só 1 consulta de distribuição por hora para este CNPJ${at ? `; liberada às ${at}` : ''}. Escolha o destinatário à mão.`);
        } else if (lookup.transportador) {
            notes.push(`Destinatário não identificado. Transportador declarado na NF-e: ${lookup.transportador.razaoSocial ?? lookup.transportador.cnpj}. Escolha o destinatário abaixo.`);
        } else {
            notes.push('Não foi possível obter o destinatário desta NF-e: escolha-o abaixo.');
        }
    }
    return { lookup, remetente, destinatario, notes };
}
