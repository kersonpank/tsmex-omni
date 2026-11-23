import type { NfeDistribuicaoMonitorDocumento, OrderInvoiceWithOrder } from '../../../lib/api';

/** Monitor de NF-e: junta a varredura da SEFAZ e as NFs lançadas à mão em pedidos, só na apresentação. */

export type NfeOrigin = 'ALL' | 'AUTO' | 'MANUAL';

export const ORIGIN_LABEL: Record<NfeOrigin, string> = { ALL: 'Todas', AUTO: 'Varredura', MANUAL: 'Lançadas à mão' };

export type NfeRow =
    | { origin: 'AUTO'; key: string; createdAt: string; doc: NfeDistribuicaoMonitorDocumento }
    | { origin: 'MANUAL'; key: string; createdAt: string; invoice: OrderInvoiceWithOrder };

const time = (iso: string) => new Date(iso).getTime() || 0;

/** Mais recentes primeiro; a origem escolhida decide quais fontes entram. */
export function unifyNfeRows(docs: NfeDistribuicaoMonitorDocumento[], invoices: OrderInvoiceWithOrder[], origin: NfeOrigin): NfeRow[] {
    const auto: NfeRow[] = origin === 'MANUAL' ? [] : docs.map((doc) => ({ origin: 'AUTO', key: `auto-${doc.id}`, createdAt: doc.createdAt, doc }));
    const manual: NfeRow[] = origin === 'AUTO' ? [] : invoices.map((invoice) => ({ origin: 'MANUAL', key: `manual-${invoice.id}`, createdAt: invoice.createdAt, invoice }));
    return [...auto, ...manual].sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

/** Só dígitos, até 14 (CNPJ). */
export const cleanCnpjFilter = (value: string): string => value.replace(/\D/g, '').slice(0, 14);

/** Parâmetros enviados ao monitor: filtro vazio não vai. */
export function monitorParams(filter: { status: string; fiscalEmitterId: string; cnpj: string }): { status?: string; fiscalEmitterId?: string; cnpjEmitente?: string } {
    return {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.fiscalEmitterId ? { fiscalEmitterId: filter.fiscalEmitterId } : {}),
        ...(filter.cnpj ? { cnpjEmitente: filter.cnpj } : {}),
    };
}

/** Últimos 12 dígitos da chave, como a clássica mostra. */
export const shortKey = (key: string | null | undefined): string => (key ? `…${key.slice(-12)}` : '—');

/** Situações que têm erro a mostrar. */
export const hasProblem = (status: string): boolean => status === 'FAILED' || status === 'PENDING_RECONCILIATION';
