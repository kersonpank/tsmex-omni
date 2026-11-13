import type { Manifest } from '../../../types/index';
import { dateShort, money } from './format';
import { routeLabel, tripCode } from './trips';

/**
 * Feed do Autopilot: o que o sistema executou sozinho, lido de dados que já existem
 * (documentos encerrados, títulos gerados, alertas que ele mesmo fechou). Nenhuma rota nova.
 */

export type AutoKind = 'fiscalClosure' | 'payable' | 'alertSelfResolved';

export interface AutoEvent {
    id: string;
    kind: AutoKind;
    /** ISO do momento em que o sistema concluiu a ação. */
    at: string;
    title: string;
    detail: string;
    /** Caminho interno para conferir, quando existe. */
    to?: string;
}

export const AUTO_KIND_LABEL: Record<AutoKind, string> = {
    fiscalClosure: 'Documentos encerrados',
    payable: 'Títulos gerados',
    alertSelfResolved: 'Alertas fechados sozinhos',
};

export interface PayableLike {
    id: string;
    beneficiaryName: string;
    amount: string | number;
    dueDate: string;
    sourceType?: string | null;
    manifestId?: string | null;
    createdAt?: string | null;
}

export interface ResolvedAlertLike {
    id: string;
    title: string;
    resolvedAt?: string | null;
    resolvedByUserId?: string | null;
}

function within(iso: string | null | undefined, since: number): iso is string {
    if (!iso) return false;
    const time = new Date(iso).getTime();
    return Number.isFinite(time) && time >= since;
}

export function buildAutopilotFeed(
    input: { manifests?: Manifest[] | null; payables?: PayableLike[] | null; resolvedAlerts?: ResolvedAlertLike[] | null },
    now: Date = new Date(),
    windowDays = 7,
): AutoEvent[] {
    const since = now.getTime() - windowDays * 86_400_000;
    const events: AutoEvent[] = [];

    for (const trip of input.manifests ?? []) {
        for (const doc of trip.fiscalDocuments ?? []) {
            if (doc.status !== 'CLOSED' || !within(doc.closedAt, since)) continue;
            const name = doc.documentType === 'MDFE' ? 'MDF-e' : 'CIOT';
            events.push({
                id: `closure:${doc.id}`,
                kind: 'fiscalClosure',
                at: doc.closedAt,
                title: `${name} encerrado`,
                detail: `${routeLabel(trip)} · viagem ${tripCode(trip)}${doc.number ? ` · nº ${doc.number}` : ''}`,
                to: `/gestaos/viagens?v=${trip.id}`,
            });
        }
    }

    for (const payable of input.payables ?? []) {
        if (payable.sourceType !== 'MANIFEST' || !within(payable.createdAt, since)) continue;
        events.push({
            id: `payable:${payable.id}`,
            kind: 'payable',
            at: payable.createdAt,
            title: 'Título do transportador gerado',
            detail: `${payable.beneficiaryName} · ${money(payable.amount)} · vence ${dateShort(payable.dueDate)}`,
            to: '/gestaos/financeiro?aba=pagar',
        });
    }

    for (const alert of input.resolvedAlerts ?? []) {
        // Sem usuário no desfecho = o próprio sistema fechou (a condição deixou de existir).
        if (alert.resolvedByUserId || !within(alert.resolvedAt, since)) continue;
        events.push({
            id: `alert:${alert.id}`,
            kind: 'alertSelfResolved',
            at: alert.resolvedAt,
            title: 'Alerta fechado sozinho',
            detail: alert.title,
        });
    }

    return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function countByKind(events: AutoEvent[]): Record<AutoKind, number> {
    const counts: Record<AutoKind, number> = { fiscalClosure: 0, payable: 0, alertSelfResolved: 0 };
    for (const event of events) counts[event.kind] += 1;
    return counts;
}

/** Agrupa por dia de calendário, preservando a ordem (mais recente primeiro). */
export function groupByDay(events: AutoEvent[]): Array<{ day: string; events: AutoEvent[] }> {
    const groups: Array<{ day: string; events: AutoEvent[] }> = [];
    for (const event of events) {
        const date = new Date(event.at);
        const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        const last = groups[groups.length - 1];
        if (last && last.day === day) last.events.push(event);
        else groups.push({ day, events: [event] });
    }
    return groups;
}
