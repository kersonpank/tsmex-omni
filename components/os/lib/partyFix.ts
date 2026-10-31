export type PartyRole = 'remetente' | 'destinatario' | 'tomador' | 'expedidor' | 'recebedor';

export const partyLabels: Record<PartyRole, string> = {
    remetente: 'Remetente', destinatario: 'Destinatário', tomador: 'Tomador', expedidor: 'Expedidor', recebedor: 'Recebedor',
};

/** Regras explícitas da mensagem SEFAZ: não inferir a parte de um erro genérico. */
export function partyFixForRejection(reason: string | null | undefined): PartyRole | null {
    const text = (reason ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const match = /\bIE\s+d[oa]\s+(remetente|destinatario|tomador|expedidor|recebedor)\b/i.exec(text);
    return match ? match[1].toLowerCase() as PartyRole : null;
}
