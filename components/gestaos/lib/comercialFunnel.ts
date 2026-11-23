import type { DemandStatus } from '../../../types/index';
import { demandStatusLabel } from './comercial';

/**
 * Próximo passo de uma demanda. Segue a sequência da gestão clássica, mas parte do estado real:
 * a clássica manda ASSIGNED de volta para QUOTED (erro); aqui ASSIGNED segue para COLLECTED, que é
 * o que o servidor aceita. Depois de COLLECTED a demanda vira CONVERTED no servidor e o pedido
 * passa a andar pelo pedido/viagem, então a sequência termina ali.
 */
const NEXT: Partial<Record<DemandStatus, DemandStatus>> = {
    QUOTED: 'APPROVED',
    APPROVED: 'COLLECTED',
    ASSIGNED: 'COLLECTED',
};

export function nextDemandStatus(status: string | null | undefined): DemandStatus | null {
    return (status && NEXT[status as DemandStatus]) || null;
}

export interface DemandStep {
    next: DemandStatus;
    /** Texto do botão. */
    action: string;
    /** Passo que gera pedido e não volta atrás: pede confirmação. */
    needsConfirm: boolean;
    description: string;
}

export function demandStep(status: string | null | undefined): DemandStep | null {
    const next = nextDemandStatus(status);
    if (!next) return null;
    const label = demandStatusLabel(next);
    return {
        next,
        action: next === 'APPROVED' ? 'Cliente aprovou' : 'Marcar como coletada',
        needsConfirm: next === 'COLLECTED',
        description: `Status atualizado para ${label}`,
    };
}

/* ---------- Colunas do funil ---------- */

export interface FunnelColumn {
    id: string;
    name: string;
    color: string;
    stage: string | null;
    order?: number;
    active?: boolean;
    _count?: { opportunities?: number };
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
export const DEFAULT_COLUMN_COLOR = '#3B82F6';

export const isHexColor = (value: string): boolean => HEX.test(value.trim());

export function validateColumn(name: string, color: string): { name?: string; color?: string } {
    const errors: { name?: string; color?: string } = {};
    if (!name.trim()) errors.name = 'Informe o nome da coluna.';
    if (!isHexColor(color)) errors.color = 'Use uma cor no formato #RRGGBB.';
    return errors;
}

/** Ids na nova ordem depois de subir (-1) ou descer (+1) a coluna do índice; sem mudança, devolve `null`. */
export function reorderedIds(columns: Array<Pick<FunnelColumn, 'id'>>, index: number, direction: -1 | 1): string[] | null {
    const target = index + direction;
    if (index < 0 || index >= columns.length || target < 0 || target >= columns.length) return null;
    const ids = columns.map((column) => column.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return ids;
}

/** Coluna ligada a um estágio só é desativada pelo servidor; coluna livre é apagada e leva as oportunidades para Cotação. */
export const deleteConsequence = (column: Pick<FunnelColumn, 'stage' | 'name'>): string =>
    column.stage
        ? `“${column.name}” é uma coluna fixa do funil: será desativada, não apagada.`
        : `“${column.name}” será apagada e as oportunidades dela voltam para Cotação.`;
