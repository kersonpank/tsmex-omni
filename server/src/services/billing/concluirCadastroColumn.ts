import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';

/** Coluna "Concluir cadastro do cliente" do CRM (criada na primeira necessidade). */
export async function findOrCreateConcluirCadastroColumn(db: Prisma.TransactionClient = prisma) {
    let col = await db.pipelineColumn.findFirst({
        where: { name: 'Concluir cadastro do cliente', active: true },
    });
    if (!col) {
        const maxOrder = await db.pipelineColumn.aggregate({ _max: { order: true } });
        col = await db.pipelineColumn.create({
            data: {
                name: 'Concluir cadastro do cliente',
                color: '#EA580C',
                stage: null,
                order: (maxOrder._max.order ?? -1) + 1,
            },
        });
    }
    return col;
}
