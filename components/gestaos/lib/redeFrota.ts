import type { VehicleType } from '../../../types/index';
import type { CarrierRegistry } from '../../os/lib/carrier';

/** Regras puras da Rede: cadastro de transportador, pendências da ficha e tipos de veículo. */

export type CarrierKind = 'TAC' | 'ETC' | 'CTC' | 'FROTA';

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/** CPF → autônomo (TAC, o servidor decide); CNPJ → empresa, cooperativa ou frota. */
export function carrierKindOptions(document: string): CarrierKind[] {
    const n = digits(document).length;
    return n === 11 ? ['TAC'] : n === 14 ? ['ETC', 'CTC', 'FROTA'] : [];
}

export interface NewCarrierDraft {
    document: string;
    name: string;
    phone: string;
    vehiclePlate: string;
    vehicleTypeId: string;
    homeBase: string;
    carrierType: CarrierKind | '';
}

export function newCarrierErrors(d: NewCarrierDraft): Partial<Record<keyof NewCarrierDraft, string>> {
    const errors: Partial<Record<keyof NewCarrierDraft, string>> = {};
    if (![11, 14].includes(digits(d.document).length)) errors.document = 'Escolha a pessoa (CPF ou CNPJ) do transportador.';
    if (!d.name.trim()) errors.name = 'Informe o nome.';
    if (digits(d.phone).length < 10) errors.phone = 'Telefone com DDD.';
    const plate = d.vehiclePlate.replace(/[^A-Za-z0-9]/g, '');
    if (plate && plate.length !== 7) errors.vehiclePlate = 'Placa com 7 letras ou números.';
    if (digits(d.document).length === 14 && !d.carrierType) errors.carrierType = 'Empresa precisa de tipo: ETC, CTC ou frota.';
    return errors;
}

/** Corpo do POST /links: só o que foi preenchido. */
export function newCarrierBody(d: NewCarrierDraft) {
    const plate = d.vehiclePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const company = digits(d.document).length === 14 && d.carrierType && d.carrierType !== 'TAC';
    return {
        document: digits(d.document),
        name: d.name.trim(),
        phone: digits(d.phone),
        ...(plate ? { vehiclePlate: plate } : {}),
        ...(d.vehicleTypeId ? { vehicleTypeId: d.vehicleTypeId } : {}),
        ...(d.homeBase.trim() ? { homeBase: d.homeBase.trim() } : {}),
        ...(company ? { carrierType: d.carrierType as 'ETC' | 'CTC' | 'FROTA' } : {}),
    };
}

export type PendingTarget = { kind: 'carrier' } | { kind: 'unit'; plate: string } | { kind: 'driver'; id: string } | { kind: 'new-driver' } | { kind: 'new-unit' };

export interface PendingItem {
    key: string;
    label: string;
    issues: string[];
    target: PendingTarget;
}

/** "Falta para rodar com CIOT e MDF-e": uma linha por item incompleto, cada uma leva ao campo que resolve. */
export function pendingItems(registry: Pick<CarrierRegistry, 'carrierIssues' | 'units' | 'drivers'>): PendingItem[] {
    const items: PendingItem[] = [];
    if (registry.carrierIssues.length) items.push({ key: 'carrier', label: 'Dados do transportador', issues: registry.carrierIssues, target: { kind: 'carrier' } });
    if (!registry.units.some((u) => u.role === 'TRACTION')) items.push({ key: 'no-traction', label: 'Nenhum veículo cadastrado', issues: ['cavalo ou veículo de carga'], target: { kind: 'new-unit' } });
    for (const unit of registry.units) {
        if (unit.issues.length) items.push({ key: `unit:${unit.plate}`, label: `${unit.role === 'TRACTION' ? 'Cavalo' : 'Reboque'} ${unit.plate}`, issues: unit.issues, target: { kind: 'unit', plate: unit.plate } });
    }
    if (registry.drivers.length === 0) items.push({ key: 'no-driver', label: 'Nenhum motorista', issues: ['motorista obrigatório para CIOT e MDF-e'], target: { kind: 'new-driver' } });
    for (const driver of registry.drivers) {
        if (driver.issues.length) items.push({ key: `driver:${driver.id}`, label: `Motorista ${driver.name}`, issues: driver.issues, target: { kind: 'driver', id: driver.id } });
    }
    return items;
}

export interface VehicleTypeDraft {
    name: string;
    code: string;
    maxWeight: number | null;
    maxVolume: number | null;
    maxValue: number | null;
    enclosed: boolean;
    refrigerated: boolean;
}

export const emptyVehicleType = (): VehicleTypeDraft => ({ name: '', code: '', maxWeight: null, maxVolume: null, maxValue: null, enclosed: true, refrigerated: false });

export const vehicleTypeToDraft = (t: VehicleType): VehicleTypeDraft => ({
    name: t.name,
    code: t.code,
    maxWeight: Number(t.maxWeight) || null,
    maxVolume: Number(t.maxVolume) || null,
    maxValue: Number(t.maxValue) || null,
    enclosed: t.enclosed,
    refrigerated: t.refrigerated,
});

export function vehicleTypeErrors(d: VehicleTypeDraft): Partial<Record<keyof VehicleTypeDraft, string>> {
    const errors: Partial<Record<keyof VehicleTypeDraft, string>> = {};
    if (!d.name.trim()) errors.name = 'Informe o nome.';
    if (!d.code.trim()) errors.code = 'Informe o código.';
    if (!d.maxWeight || d.maxWeight <= 0) errors.maxWeight = 'Capacidade de peso maior que zero.';
    if (!d.maxVolume || d.maxVolume <= 0) errors.maxVolume = 'Capacidade de volume maior que zero.';
    if (!d.maxValue || d.maxValue <= 0) errors.maxValue = 'Valor máximo maior que zero.';
    return errors;
}

export function vehicleTypeBody(d: VehicleTypeDraft) {
    return {
        name: d.name.trim(),
        code: d.code.trim().toUpperCase(),
        maxWeight: d.maxWeight as number,
        maxVolume: d.maxVolume as number,
        maxValue: d.maxValue as number,
        enclosed: d.enclosed,
        refrigerated: d.refrigerated,
    };
}

export function matchesVehicleType(t: Pick<VehicleType, 'name' | 'code'>, query: string): boolean {
    const q = query.trim().toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q);
}
