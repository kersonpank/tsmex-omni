import { formatDateTimeBR } from './dateBR';

/**
 * Rastreio do pedido (sem React, sem rede): traduz o histórico técnico do pedido, os trechos e as
 * tentativas de entrega para linguagem de operação — sem "manifesto", "perna" nem UUID.
 */

export interface TimelineHistoryRow {
    id: string;
    eventType: string;
    description: string;
    location: string | null;
    photoUrl: string | null;
    createdAt: string;
    actorName: string | null;
}

export interface TimelineLeg {
    id: string;
    legType: 'COLETA' | 'TRANSFERENCIA' | 'ENTREGA';
    sequence: number;
    startedAt: string | null;
    completedAt: string | null;
    manifest: {
        id: string;
        status: string;
        origin: string;
        destination: string;
        plannedDepartureAt: string | null;
        plannedArrivalAt: string | null;
        arrivedAt: string | null;
        hub?: { name: string } | null;
        destHub?: { name: string } | null;
    } | null;
}

export interface TimelineAttempt {
    id: string;
    result: 'DELIVERED' | 'PARTIAL' | 'FAILED';
    receiverName: string | null;
    occurredAt: string;
    nextAction: string | null;
    exceptionReason: string | null;
}

export interface OrderTimelineData {
    order: {
        id: string;
        status: 'PENDING' | 'IN_TRANSIT' | 'AT_HUB' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
        enteredAtHubAt: string | null;
        currentHub: { id: string; name: string } | null;
        orderNumber: number | null;
        origin: string | null;
        destination: string | null;
    };
    history: TimelineHistoryRow[];
    legs: TimelineLeg[];
    attempts: TimelineAttempt[];
}

export type TimelineKind =
    | 'created' | 'collected' | 'stock' | 'departed' | 'out_for_delivery' | 'delivered' | 'delivery_failed'
    | 'vehicle_arrived' | 'damage' | 'missing' | 'resolved' | 'cancelled' | 'note';

export interface TimelineEvent {
    id: string;
    at: string;
    kind: TimelineKind;
    title: string;
    detail: string | null;
    where: string | null;
    actor: string | null;
    highlight: boolean;
    photoUrl: string | null;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Tira identificadores técnicos e troca o jargão pelo vocabulário da operação. */
export function plainText(text: string): string {
    return text
        .replace(/\b(manifesto|viagem)\s+(?:[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{8})\b/gi, '$1')
        .replace(UUID, '')
        .replace(/\bdo manifesto\b/gi, 'da viagem')
        .replace(/\bno manifesto\b/gi, 'na viagem')
        .replace(/\bao manifesto\b/gi, 'à viagem')
        .replace(/\bmanifestos\b/gi, 'viagens')
        .replace(/\bmanifesto\b/gi, 'viagem')
        .replace(/\bpernas\b/gi, 'trechos')
        .replace(/\bperna\b/gi, 'trecho')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,;:])/g, '$1')
        .trim();
}

const noTrailingDot = (text: string) => text.replace(/[.\s]+$/, '');

export function translateHistory(row: TimelineHistoryRow): TimelineEvent {
    const raw = row.description.trim();
    const base = { id: row.id, at: row.createdAt, where: row.location, actor: row.actorName, photoUrl: row.photoUrl, highlight: false };
    const make = (kind: TimelineKind, title: string, detail: string | null = null, highlight = false): TimelineEvent =>
        ({ ...base, kind, title, detail: detail ? plainText(detail) || null : null, highlight });

    let m = /^\[AVARIA NA CHEGADA\]\s*chegou com avaria em (.+?)(?:\s*\(viagem [^)]*\))?(?:\s*—\s*(.*))?$/i.exec(raw);
    if (m) return make('damage', `Chegou com avaria em ${m[1]}`, m[2] ?? null, true);
    m = /^Não chegou em (.+?) na viagem \S+: verificar com (.+?)\.\s*(.*)$/i.exec(raw);
    if (m) return make('missing', `Não chegou em ${m[1]}`, `Voltou ao estoque de ${m[2]} para apuração.${m[3] ? ` ${m[3]}` : ''}`, true);
    m = /^Veículo chegou em (.+?)\.\s*(.*)$/i.exec(raw);
    if (m) return make('vehicle_arrived', `Veículo chegou em ${m[1]}`, m[2] || null);
    m = /^Recebido no hub destino \((.+)\)$/i.exec(raw);
    if (m) return make('stock', `Recebido em ${m[1]}`);
    m = /^\[EXCEÇÃO RESOLVIDA\]\s*(.+?)\s*—\s*(.*)$/i.exec(raw);
    if (m) return make('resolved', 'Pendência resolvida', `${m[1]}. ${m[2]}`);
    if (/^Entrega comprovada/i.test(raw)) return make('delivered', 'Entrega comprovada', raw.replace(/^Entrega comprovada:?\s*/i, ''));
    if (/^Entrega parcial/i.test(raw)) return make('delivery_failed', 'Entrega parcial', raw.replace(/^Entrega parcial:?\s*/i, ''), true);
    if (/^Tentativa de entrega sem sucesso/i.test(raw)) return make('delivery_failed', 'Tentativa de entrega sem sucesso', raw.replace(/^Tentativa de entrega sem sucesso\.?\s*/i, ''), true);
    if (/^Entrega não realizada/i.test(raw)) return make('delivery_failed', 'Entrega não realizada', raw.replace(/^Entrega não realizada:?\s*/i, ''), true);
    if (/^Pedido removido do manifesto/i.test(raw)) return make('note', 'Retirado da viagem');

    switch (row.eventType) {
        case 'CREATED': return make('created', 'Pedido criado', raw);
        case 'COLLECTED': return make('collected', 'Coletado', raw);
        case 'IN_TRANSIT': return make('departed', 'Saiu em viagem', raw);
        case 'OUT_FOR_DELIVERY': return make('out_for_delivery', 'Saiu para entrega', raw);
        case 'DELIVERED': return make('delivered', 'Entregue', raw);
        case 'CANCELLED': return make('cancelled', 'Cancelado', raw, true);
        case 'AT_HUB': return make('stock', 'Entrou no estoque', raw);
        default: return make('note', noTrailingDot(plainText(raw)) || 'Anotação');
    }
}

export interface WhereNow {
    headline: string;
    detail: string | null;
    tone: 'ok' | 'route' | 'attention' | 'bad' | 'none';
}

const hubName = (leg: TimelineLeg, side: 'origin' | 'dest') =>
    (side === 'origin' ? leg.manifest?.origin ?? leg.manifest?.hub?.name : leg.manifest?.destination ?? leg.manifest?.destHub?.name) ?? '';

/** "Onde está agora", em uma frase. */
export function whereNow(data: OrderTimelineData): WhereNow {
    const { order, legs, history, attempts } = data;
    const latestEvent = history[0] ? translateHistory(history[0]) : null;
    if (order.status === 'DELIVERED') {
        const done = attempts.find((attempt) => attempt.result === 'DELIVERED' || attempt.result === 'PARTIAL');
        const delivered = history.find((row) => row.eventType === 'DELIVERED');
        const at = formatDateTimeBR(done?.occurredAt ?? delivered?.createdAt);
        return { headline: `Entregue${done?.receiverName ? ` a ${done.receiverName}` : ''}${at ? ` em ${at}` : ''}`, detail: null, tone: 'ok' };
    }
    if (order.status === 'CANCELLED') return { headline: 'Pedido cancelado', detail: null, tone: 'bad' };
    if (order.status === 'OUT_FOR_DELIVERY') {
        const leg = legs.find((l) => l.legType === 'ENTREGA' && l.startedAt && !l.completedAt);
        const since = formatDateTimeBR(leg?.startedAt ?? history.find((row) => row.eventType === 'OUT_FOR_DELIVERY')?.createdAt);
        return { headline: `Saiu para entrega${since ? ` em ${since}` : ''}`, detail: null, tone: 'route' };
    }
    if (order.status === 'IN_TRANSIT') {
        const leg = [...legs].reverse().find((l) => l.startedAt && !l.completedAt) ?? null;
        const since = formatDateTimeBR(leg?.startedAt);
        const headline = leg
            ? `Em viagem de ${hubName(leg, 'origin')} para ${hubName(leg, 'dest')}${since ? ` desde ${since}` : ''}`
            : 'Em viagem';
        const arrived = latestEvent?.kind === 'vehicle_arrived' ? `${latestEvent.title}. Aguardando conferência.` : null;
        return { headline, detail: arrived, tone: arrived ? 'attention' : 'route' };
    }
    if (order.status === 'AT_HUB') {
        const since = formatDateTimeBR(order.enteredAtHubAt);
        const returned = latestEvent && (latestEvent.kind === 'missing' || latestEvent.kind === 'delivery_failed');
        return {
            headline: `Em estoque${order.currentHub ? ` no ${order.currentHub.name}` : ''}${since ? ` desde ${since}` : ''}`,
            detail: returned ? latestEvent.title : null,
            tone: returned ? 'attention' : 'ok',
        };
    }
    return { headline: 'Aguardando entrada no hub', detail: null, tone: 'none' };
}

const TRIP_STATUS_LABEL: Record<string, string> = { DRAFT: 'em preparação', PENDING_ACCEPT: 'aguardando aceite', ACCEPTED: 'pronta para sair' };

/** Próximos passos conhecidos: viagens planejadas que ainda não saíram. */
export function nextSteps(data: OrderTimelineData): string[] {
    return data.legs
        .filter((leg) => !leg.startedAt && !leg.completedAt && leg.manifest && !['CANCELLED', 'COMPLETED'].includes(leg.manifest.status))
        .sort((a, b) => a.sequence - b.sequence)
        .map((leg) => {
            const departure = formatDateTimeBR(leg.manifest!.plannedDepartureAt);
            const status = TRIP_STATUS_LABEL[leg.manifest!.status];
            const route = `${hubName(leg, 'origin')} para ${hubName(leg, 'dest')}`;
            const head = leg.legType === 'ENTREGA' ? `Entrega ao cliente planejada (${route})` : `Viagem planejada: ${route}`;
            return `${head}${status ? ` · ${status}` : ''}${departure ? ` · saída prevista ${departure}` : ''}`;
        });
}

/** Linha do tempo: do mais recente ao mais antigo. */
export function timelineEvents(data: OrderTimelineData): TimelineEvent[] {
    return data.history
        .map(translateHistory)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
