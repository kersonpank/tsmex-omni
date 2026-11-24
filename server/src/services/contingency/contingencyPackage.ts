import prisma from '../../lib/prisma.js';

/**
 * Pacote de contingência: tudo que está em aberto na operação (view `contingency_open_work`, uma linha
 * por pedido não entregue/cancelado) em CSV. É o que a equipe usa para reabrir a operação no sistema
 * legado se o TSM ficar fora do ar. O serviço de backup exporta o mesmo conteúdo a cada hora para fora
 * do servidor; aqui a torre baixa sob demanda.
 */
export type ContingencyRow = Record<string, unknown>;

function cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? value.toString() : String(value);
    // ; é o separador que o Excel em pt-BR abre direto; aspas sempre que houver separador/quebra/aspas.
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toContingencyCsv(rows: ContingencyRow[], columns?: string[]): string {
    const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
    const lines = [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))];
    // BOM para o Excel reconhecer UTF-8 (acentos dos nomes).
    return `﻿${lines.join('\r\n')}\r\n`;
}

export const CONTINGENCY_COLUMNS = [
    'pedido', 'situacao', 'hub_atual', 'remetente', 'remetente_doc', 'destinatario', 'destinatario_doc', 'destino',
    'peso_kg', 'valor_nf', 'notas_fiscais', 'documentos_frete', 'viagem_id', 'viagem_tipo', 'viagem_situacao',
    'viagem_origem', 'viagem_destino', 'transportador', 'placas', 'documentos_viagem', 'entrou_no_hub_em', 'atualizado_em',
];

export async function loadContingencyRows(hubCode?: string): Promise<ContingencyRow[]> {
    if (hubCode) {
        return prisma.$queryRaw<ContingencyRow[]>`SELECT * FROM "contingency_open_work" WHERE hub_atual = ${hubCode} OR viagem_destino = ${hubCode} ORDER BY pedido`;
    }
    return prisma.$queryRaw<ContingencyRow[]>`SELECT * FROM "contingency_open_work" ORDER BY pedido`;
}
