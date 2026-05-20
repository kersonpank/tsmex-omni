import prisma from '../../lib/prisma.js';

export type ResolveIntakeClientStatus = 'found' | 'not_found';

export interface ResolveIntakeClientResult {
    status: ResolveIntakeClientStatus;
    document: string;
    client?: { id: string; companyName: string; document: string };
}

function normalizeDocument(document: string): string {
    return document.replace(/\D/g, '');
}

export async function resolveIntakeClientByDocument(
    document: string,
): Promise<ResolveIntakeClientResult> {
    const normalized = normalizeDocument(document);
    if (normalized.length < 11) {
        return { status: 'not_found', document: normalized };
    }

    const client = await prisma.client.findFirst({
        where: { document: normalized },
        select: { id: true, companyName: true, document: true },
    });

    if (!client) {
        return { status: 'not_found', document: normalized };
    }

    return {
        status: 'found',
        document: normalized,
        client,
    };
}
