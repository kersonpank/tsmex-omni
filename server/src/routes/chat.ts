import { Router, Response, NextFunction } from 'express';
import { callLLM, getActiveModel, ChatMessage } from '../services/llmService.js';
import { AGENT_TOOLS, buildSystemPromptWithContext } from '../services/agentTools.js';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

/** Normaliza CNPJ/CPF para apenas dígitos. */
function normalizeCnpjCpf(value: string | null | undefined): string {
    if (!value || typeof value !== 'string') return '';
    return value.replace(/\D/g, '');
}

/** Verifica se ao menos um dos CNPJs está na lista da conta (apenas dígitos). */
function atLeastOneCnpjInAccount(sender: string, receiver: string, accountCnpjs: string[]): boolean {
    const s = normalizeCnpjCpf(sender);
    const r = normalizeCnpjCpf(receiver);
    const set = new Set(accountCnpjs.map(normalizeCnpjCpf).filter(Boolean));
    return !!(s && set.has(s)) || !!(r && set.has(r));
}

export interface ToolResult {
    opportunityId: string | null;
    quoteData: { freight: number; gris: number; advalorem: number; total: number } | null;
    needsAccount: boolean;
    needsAddCnpj: boolean;
    cnpjSuggest: string | null;
}

async function handleToolCalls(
    toolCalls: Array<{ name: string; args: any }>,
    accountId: string | null,
    accountCnpjs: string[],
    sessionId?: string
): Promise<ToolResult> {
    const res: ToolResult = {
        opportunityId: null,
        quoteData: null,
        needsAccount: false,
        needsAddCnpj: false,
        cnpjSuggest: null,
    };

    const effectiveSessionId = sessionId || `chat-${Date.now()}`;

    for (const call of toolCalls) {
        const args = typeof call.args === 'string' ? JSON.parse(call.args) : (call.args || {});

        if (call.name === 'create_opportunity' || call.name === 'calculate_quote') {
            if (!accountId) {
                res.needsAccount = true;
                continue;
            }
            if (!args.accountId) args.accountId = accountId;

            const cpfCnpjSender = args.cpfCnpjSender ? normalizeCnpjCpf(args.cpfCnpjSender) : '';
            const cpfCnpjReceiver = args.cpfCnpjReceiver ? normalizeCnpjCpf(args.cpfCnpjReceiver) : '';
            const accountRole = args.accountRole as string | undefined;
            const isConsignatario = accountRole === 'CONSIGNATARIO';

            const hasCnpjs = !!(cpfCnpjSender || cpfCnpjReceiver);
            const oneInAccount = hasCnpjs && atLeastOneCnpjInAccount(args.cpfCnpjSender, args.cpfCnpjReceiver, accountCnpjs);

            if (hasCnpjs && !oneInAccount && !isConsignatario) {
                res.needsAddCnpj = true;
                res.cnpjSuggest = cpfCnpjSender || cpfCnpjReceiver || null;
                continue;
            }

            const validRoles = ['REMETENTE', 'DESTINATARIO', 'CONSIGNATARIO'];
            const role = typeof accountRole === 'string' && validRoles.includes(accountRole) ? accountRole : null;

            const oppData: Record<string, unknown> = {
                origin: args.origin,
                destination: args.destination,
                commodity: args.commodity,
                weight: args.weight,
                nfValue: args.nfValue,
                volumes: args.volumes,
                dimensions: args.dimensions ?? null,
                needsCollection: !!args.needsCollection,
                source: 'CHAT',
                cpfCnpjSender: args.cpfCnpjSender ?? null,
                cpfCnpjReceiver: args.cpfCnpjReceiver ?? null,
                accountRole: role,
            };

            if (args.weight != null && args.nfValue != null) {
                (oppData as any).completeness = 'COMPLETE';
            } else if (args.origin && args.destination) {
                (oppData as any).completeness = 'INCOMPLETE';
            }

            if (call.name === 'calculate_quote' || (args.weight != null && args.nfValue != null)) {
                const weight = args.weight ?? 0;
                const value = args.nfValue ?? 0;
                const freight = weight * 1.5;
                const gris = value * 0.003;
                const advalorem = value * 0.005;
                const total = freight + gris + advalorem;
                (oppData as any).quotedPrice = total;
                (oppData as any).quoteBreakdown = { freight, gris, advalorem, total };
                (oppData as any).stage = 'QUOTE';
                res.quoteData = { freight, gris, advalorem, total };
            }

            let opportunity;
            const existing = await prisma.opportunity.findFirst({
                where: { sessionId: effectiveSessionId, stage: { not: 'CONVERTED' } },
                orderBy: { createdAt: 'desc' },
            });

            if (existing) {
                opportunity = await prisma.opportunity.update({
                    where: { id: existing.id },
                    data: oppData as any,
                });
            } else {
                opportunity = await prisma.opportunity.create({
                    data: {
                        ...(oppData as any),
                        sessionId: effectiveSessionId,
                        accountId,
                    },
                });
            }
            res.opportunityId = opportunity.id;
        }

        if (call.name === 'request_collection') {
            const { opportunityId, contractor, senderContact, address, needsHelper, needsLoading, commodity, volumes, dimensions, weight, nfValue } = args;
            if (!opportunityId) continue;

            const collectionData = {
                contractor: contractor ?? {},
                senderContact: senderContact ?? {},
                address: address ?? {},
                needsHelper: !!needsHelper,
                needsLoading: !!needsLoading,
                commodity,
                volumes,
                dimensions,
                weight,
                nfValue,
            };

            const updated = await prisma.opportunity.update({
                where: { id: opportunityId },
                data: {
                    collectionData: collectionData as any,
                    stage: 'COLLECTION_REQUESTED',
                    needsCollection: true,
                },
            });
            res.opportunityId = updated.id;
        }
    }

    return res;
}

router.post('/', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const { message, history, sessionId, attachments } = req.body;

        if (!message && (!attachments || attachments.length === 0)) {
            throw new AppError('Message or attachments are required', 400);
        }

        let processedMessage = message || '';
        if (attachments?.length) {
            for (const att of attachments) {
                if (att.type === 'NF' || att.type === 'DOCUMENT') {
                    processedMessage += `\n\n[Arquivo anexado: ${att.fileName || 'documento'} - Por favor, extraia dados da Nota Fiscal se possível]`;
                } else if (att.type === 'IMAGE') {
                    processedMessage += `\n\n[Imagem anexada: ${att.fileName || 'imagem'}]`;
                } else if (att.type === 'AUDIO') {
                    processedMessage += `\n\n[Áudio anexado: ${att.fileName || 'áudio'}]`;
                }
            }
        }

        let finalAccountId: string | null = null;
        let accountCnpjs: string[] = [];

        if (req.user!.roles.includes('CLIENT')) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: { include: { companies: true } } },
            });
            if (user?.accountId) {
                finalAccountId = user.accountId;
                accountCnpjs = (user.account?.companies ?? []).map((c) => c.cnpj);
            }
        }

        let modelConfig;
        try {
            modelConfig = await getActiveModel('chat');
            if (process.env.NODE_ENV === 'development') {
                console.log(`[Chat] Using model: ${modelConfig.modelId} (${modelConfig.provider.apiFormat})`);
            }
        } catch (e: any) {
            console.error('[Chat] Error getting model:', e?.message);
            throw new AppError(
                e?.message || 'Falha ao obter configuração do modelo LLM. Configure em Settings > LLM.',
                400
            );
        }

        const systemPrompt = buildSystemPromptWithContext(accountCnpjs);
        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            ...(history || []).map((h: any) => ({
                role: (h.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
                content: h.content,
            })),
            { role: 'user', content: processedMessage },
        ];

        const result = await callLLM(modelConfig.provider, {
            model: modelConfig.modelId,
            messages,
            tools: AGENT_TOOLS,
            maxTokens: 4096,
        });

        let assistantResponse = result.text || '';
        let opportunity: any = null;

        let needsAddCnpj = false;
        let cnpjSuggest: string | null = null;

        if (result.toolCalls?.length) {
            const toolCalls = result.toolCalls.map((tc) => ({
                name: tc.function.name,
                args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
            }));

            const toolResult = await handleToolCalls(toolCalls, finalAccountId, accountCnpjs, sessionId);

            if (toolResult.opportunityId) {
                opportunity = await prisma.opportunity.findUnique({
                    where: { id: toolResult.opportunityId },
                    include: {
                        account: { select: { id: true, name: true } },
                    },
                });
            }
            if (toolResult.quoteData) {
                assistantResponse += `\n\n**Cotação Estimada:** R$ ${toolResult.quoteData.total.toFixed(2)}`;
            }
            needsAddCnpj = toolResult.needsAddCnpj;
            cnpjSuggest = toolResult.cnpjSuggest;
        }

        res.json({
            response: assistantResponse,
            opportunity,
            needsAccount: !finalAccountId,
            needsAddCnpj,
            cnpjSuggest,
        });
    } catch (error) {
        next(error);
    }
});

// ==================== FILE UPLOAD ====================

router.post('/upload', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const { file, fileName, mimeType, type } = req.body;
        if (!file || !fileName || !mimeType) {
            throw new AppError('File data, fileName, and mimeType are required', 400);
        }
        const allowedTypes = ['IMAGE', 'AUDIO', 'DOCUMENT', 'NF'];
        if (type && !allowedTypes.includes(type)) {
            throw new AppError(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`, 400);
        }
        const allowedMimeTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'audio/mpeg', 'audio/wav', 'audio/ogg',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (!allowedMimeTypes.includes(mimeType)) {
            throw new AppError(`MIME type not allowed: ${mimeType}`, 400);
        }
        const fileUrl = `data:${mimeType};base64,${file}`;
        const size = Math.round((file.length * 3) / 4);
        const maxSize = 10 * 1024 * 1024;
        if (size > maxSize) throw new AppError('File size exceeds 10MB limit', 400);
        res.json({
            success: true,
            data: {
                fileUrl,
                fileName,
                mimeType,
                type: type || (mimeType.startsWith('image/') ? 'IMAGE' : mimeType.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT'),
                size,
            },
        });
    } catch (error) {
        next(error);
    }
});

// ==================== GET CHAT MESSAGES BY SESSION ====================

// GET /api/chat/session/:sessionId/messages - Get all messages from a session
router.get('/session/:sessionId/messages', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const sessionId = req.params.sessionId as string;

        // Try to find session by slug or sessionId
        const session = await prisma.chatSession.findFirst({
            where: {
                OR: [
                    { slug: sessionId },
                    { id: sessionId }
                ]
            },
            include: {
                messages: {
                    include: {
                        attachments: {
                            orderBy: { createdAt: 'asc' }
                        }
                    },
                    orderBy: { createdAt: 'asc' }
                }
            }
        });

        if (!session) {
            throw new AppError('Chat session not found', 404);
        }

        // Check authorization - client can only see their own sessions
        if (req.user!.roles.includes('CLIENT') && session.accountId) {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.id },
                include: { account: true }
            });

            if (!user || !user.accountId || session.accountId !== user.accountId) {
                throw new AppError('Not authorized', 403);
            }
        }

        res.json({
            success: true,
            data: {
                session: {
                    id: session.id,
                    slug: session.slug,
                    accountId: session.accountId,
                    createdAt: session.createdAt,
                },
                messages: session.messages,
            },
        });
    } catch (error) {
        next(error);
    }
});

export const chatRouter = router;
