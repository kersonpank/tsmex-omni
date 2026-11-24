import type { Prisma, VehicleUnitRole } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { isValidCnpj, isValidCpf } from '../documentValidation.js';
import { isValidPlate, normalizePlate } from '../vehicleUnitRules.js';
import { parseBrDate, parseIntLoose, pick } from './csv.js';

/**
 * Importação de cadastros do sistema legado (pessoas, veículos, motoristas) a partir do CSV que as
 * listagens dele exportam. Regras:
 * - identidade pela chave natural: CPF/CNPJ (pessoa, motorista) e placa (veículo);
 * - registro que não existe é criado; o que já existe só tem **lacunas preenchidas** — nunca
 *   sobrescreve um campo já preenchido no TSM (o TSM é a fonte a partir do corte);
 * - linha inválida (documento com DV errado, placa inválida, sem nome) é recusada com o motivo;
 * - `dryRun` roda tudo e não grava (relatório de conferência antes da carga).
 */
export type MasterDataKind = 'persons' | 'vehicles' | 'drivers';

export interface RowOutcome {
    line: number;
    key: string;
    result: 'created' | 'updated' | 'unchanged' | 'rejected';
    detail?: string;
}

const A = {
    document: ['cnpj_cpf', 'cpf_cnpj', 'documento', 'cnpj', 'cpf', 'doc', 'cnpjcpf'],
    legalName: ['razao_social', 'nome', 'nome_razao_social', 'razao', 'nome_completo'],
    tradeName: ['fantasia', 'nome_fantasia', 'apelido'],
    ie: ['ie', 'inscricao_estadual', 'insc_estadual', 'i_e'],
    im: ['im', 'inscricao_municipal', 'insc_municipal'],
    cep: ['cep'],
    address: ['endereco', 'logradouro', 'rua'],
    number: ['numero', 'num', 'n'],
    complement: ['complemento', 'compl'],
    neighborhood: ['bairro'],
    city: ['cidade', 'municipio'],
    state: ['uf', 'estado'],
    ibge: ['ibge', 'codigo_ibge', 'cod_ibge', 'cmun', 'codigo_municipio'],
    rntrc: ['rntrc', 'antt'],
    plate: ['placa'],
    role: ['tipo', 'tipo_veiculo', 'categoria', 'funcao'],
    renavam: ['renavam'],
    chassi: ['chassi', 'chassis'],
    axles: ['eixos', 'qtd_eixos', 'numero_eixos'],
    tare: ['tara', 'tara_kg'],
    capacity: ['capacidade', 'capacidade_kg', 'lotacao', 'capacidade_carga'],
    brand: ['marca'],
    model: ['modelo'],
    year: ['ano', 'ano_fabricacao', 'ano_modelo'],
    licensedState: ['uf_licenciamento', 'uf_placa', 'licenciamento'],
    ownerDocument: ['proprietario_cpf_cnpj', 'cpf_cnpj_proprietario', 'documento_proprietario', 'proprietario_documento'],
    ownerName: ['proprietario', 'nome_proprietario', 'proprietario_nome'],
    phone: ['telefone', 'celular', 'fone', 'whatsapp'],
    birthDate: ['nascimento', 'data_nascimento', 'dt_nascimento'],
    cnhNumber: ['cnh', 'numero_cnh', 'cnh_numero', 'registro_cnh'],
    cnhCategory: ['categoria_cnh', 'cnh_categoria'],
    cnhExpiry: ['validade_cnh', 'cnh_validade', 'vencimento_cnh'],
    cnhState: ['uf_cnh', 'cnh_uf'],
};

const digits = (v: string) => v.replace(/\D/g, '');
const uf = (v: string) => (/^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : '');

/** Só os campos vazios no registro atual recebem o valor do legado. */
function fillGaps<T extends Record<string, unknown>>(current: T, incoming: Partial<T>): Partial<T> {
    const out: Partial<T> = {};
    for (const [k, v] of Object.entries(incoming) as Array<[keyof T, T[keyof T]]>) {
        if (v === null || v === undefined || v === '') continue;
        const cur = current[k];
        if (cur === null || cur === undefined || cur === '') out[k] = v;
    }
    return out;
}

async function cityIbge(city: string, state: string): Promise<string | null> {
    if (!city || !state) return null;
    const norm = city.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const candidates = await prisma.city.findMany({ where: { state: { code: state } }, select: { name: true, ibgeCode: true } });
    const hit = candidates.find((c) => c.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim() === norm);
    return hit?.ibgeCode ?? null;
}

async function importPerson(row: Record<string, string>, line: number, dryRun: boolean): Promise<RowOutcome> {
    const document = digits(pick(row, A.document));
    const legalName = pick(row, A.legalName);
    const type = document.length === 11 ? 'CPF' : document.length === 14 ? 'CNPJ' : null;
    if (!type || !(type === 'CPF' ? isValidCpf(document) : isValidCnpj(document))) {
        return { line, key: document, result: 'rejected', detail: 'CPF/CNPJ ausente ou com dígito verificador inválido' };
    }
    if (!legalName) return { line, key: document, result: 'rejected', detail: 'sem nome/razão social' };
    const state = uf(pick(row, A.state));
    const city = pick(row, A.city);
    const ibgeRaw = digits(pick(row, A.ibge));
    const data = {
        legalName,
        tradeName: pick(row, A.tradeName) || null,
        stateRegistration: pick(row, A.ie).toUpperCase() === 'ISENTO' ? 'ISENTO' : digits(pick(row, A.ie)) || null,
        municipalRegistration: digits(pick(row, A.im)) || null,
        cep: digits(pick(row, A.cep)).slice(0, 8) || null,
        address: pick(row, A.address) || null,
        number: pick(row, A.number) || null,
        complement: pick(row, A.complement) || null,
        neighborhood: pick(row, A.neighborhood) || null,
        city: city || null,
        state: state || null,
        cityIbgeCode: ibgeRaw.length === 7 ? ibgeRaw : await cityIbge(city, state),
        rntrc: (() => { const r = digits(pick(row, A.rntrc)); return r.length >= 8 && r.length <= 9 ? r : null; })(),
    };
    const existing = await prisma.person.findUnique({ where: { document } });
    if (!existing) {
        if (!dryRun) await prisma.person.create({ data: { ...data, document, documentType: type } });
        return { line, key: document, result: 'created' };
    }
    const patch = fillGaps(existing as unknown as Record<string, unknown>, data as Record<string, unknown>);
    delete (patch as Record<string, unknown>).legalName;
    if (Object.keys(patch).length === 0) return { line, key: document, result: 'unchanged' };
    if (!dryRun) await prisma.person.update({ where: { id: existing.id }, data: patch as Prisma.PersonUpdateInput });
    return { line, key: document, result: 'updated', detail: `preenchido: ${Object.keys(patch).join(', ')}` };
}

function vehicleRole(value: string): VehicleUnitRole {
    const v = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return /reboque|carreta|semi|implemento|trailer|dolly/.test(v) ? 'TRAILER' : 'TRACTION';
}

async function importVehicle(row: Record<string, string>, line: number, dryRun: boolean): Promise<RowOutcome> {
    const plate = normalizePlate(pick(row, A.plate));
    if (!isValidPlate(plate)) return { line, key: plate, result: 'rejected', detail: 'placa ausente ou inválida (7 letras/números)' };
    const ownerDocument = digits(pick(row, A.ownerDocument));
    const owner = ownerDocument ? await prisma.person.findUnique({ where: { document: ownerDocument }, select: { id: true } }) : null;
    const year = parseIntLoose(pick(row, A.year));
    const data = {
        role: vehicleRole(pick(row, A.role)),
        renavam: digits(pick(row, A.renavam)) || null,
        chassi: pick(row, A.chassi).replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null,
        axles: parseIntLoose(pick(row, A.axles)),
        tareKg: parseIntLoose(pick(row, A.tare)),
        capacityKg: parseIntLoose(pick(row, A.capacity)),
        brand: pick(row, A.brand) || null,
        model: pick(row, A.model) || null,
        year: year && year > 1950 && year < 2100 ? year : null,
        licensedState: uf(pick(row, A.licensedState)) || null,
        ownerPersonId: owner?.id ?? null,
        ownerDocument: ownerDocument || null,
        ownerName: pick(row, A.ownerName) || null,
    };
    const existing = await prisma.vehicleUnit.findUnique({ where: { plate } });
    const ownerNote = ownerDocument && !owner ? ' (proprietário ainda não cadastrado como pessoa: importe pessoas antes)' : '';
    if (!existing) {
        if (!dryRun) await prisma.vehicleUnit.create({ data: { ...data, plate } });
        return { line, key: plate, result: 'created', detail: ownerNote.trim() || undefined };
    }
    const { role: _role, ...rest } = data; // tipo do veículo nunca muda por importação
    const patch = fillGaps(existing as unknown as Record<string, unknown>, rest as Record<string, unknown>);
    if (Object.keys(patch).length === 0) return { line, key: plate, result: 'unchanged' };
    if (!dryRun) await prisma.vehicleUnit.update({ where: { id: existing.id }, data: patch as Prisma.VehicleUnitUncheckedUpdateInput });
    return { line, key: plate, result: 'updated', detail: `preenchido: ${Object.keys(patch).join(', ')}${ownerNote}` };
}

async function importDriver(row: Record<string, string>, line: number, dryRun: boolean): Promise<RowOutcome> {
    const document = digits(pick(row, A.document));
    if (document.length !== 11 || !isValidCpf(document)) return { line, key: document, result: 'rejected', detail: 'CPF ausente ou inválido' };
    const name = pick(row, A.legalName);
    if (!name) return { line, key: document, result: 'rejected', detail: 'sem nome' };
    const person = await prisma.person.findUnique({ where: { document }, select: { id: true } });
    const data = {
        name,
        phone: digits(pick(row, A.phone)),
        birthDate: parseBrDate(pick(row, A.birthDate)),
        cnhNumber: digits(pick(row, A.cnhNumber)) || null,
        cnhCategory: pick(row, A.cnhCategory).toUpperCase() || null,
        cnhExpiry: parseBrDate(pick(row, A.cnhExpiry)),
        cnhState: uf(pick(row, A.cnhState)) || null,
        personId: person?.id ?? null,
    };
    const existing = await prisma.driver.findUnique({ where: { document } });
    if (!existing) {
        if (!dryRun) await prisma.driver.create({ data: { ...data, document } });
        return { line, key: document, result: 'created', detail: data.phone ? undefined : 'sem telefone (obrigatório no CIOT): completar no TSM' };
    }
    const { name: _n, ...rest } = data;
    const patch = fillGaps(existing as unknown as Record<string, unknown>, rest as Record<string, unknown>);
    if (Object.keys(patch).length === 0) return { line, key: document, result: 'unchanged' };
    if (!dryRun) await prisma.driver.update({ where: { id: existing.id }, data: patch as Prisma.DriverUncheckedUpdateInput });
    return { line, key: document, result: 'updated', detail: `preenchido: ${Object.keys(patch).join(', ')}` };
}

const HANDLERS: Record<MasterDataKind, typeof importPerson> = { persons: importPerson, vehicles: importVehicle, drivers: importDriver };

export async function importMasterData(kind: MasterDataKind, rows: Array<Record<string, string>>, options: { dryRun?: boolean } = {}): Promise<RowOutcome[]> {
    const handler = HANDLERS[kind];
    const out: RowOutcome[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
        const line = i + 2; // linha 1 = cabeçalho
        try {
            const outcome = await handler(rows[i], line, options.dryRun === true);
            // Repetido no mesmo arquivo: o primeiro vale, os demais só complementam (e no dry-run aparecem).
            if (outcome.result === 'created' && seen.has(outcome.key) && options.dryRun) outcome.result = 'updated';
            if (outcome.key) seen.add(outcome.key);
            out.push(outcome);
        } catch (err) {
            out.push({ line, key: '', result: 'rejected', detail: err instanceof Error ? err.message.split('\n').slice(-1)[0] : String(err) });
        }
    }
    return out;
}
