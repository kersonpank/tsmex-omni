import prisma from '../lib/prisma.js';
import type { Prisma, SystemAlertCategory, SystemAlertSeverity } from '@prisma/client';

export async function createSystemAlert(params: {
    category: SystemAlertCategory;
    severity: SystemAlertSeverity;
    title: string;
    message: string;
    context?: Record<string, unknown>;
}): Promise<void> {
    await prisma.systemAlert.create({
        data: {
            category: params.category,
            severity: params.severity,
            title: params.title,
            message: params.message,
            context: params.context as Prisma.InputJsonValue | undefined,
        },
    });
}
