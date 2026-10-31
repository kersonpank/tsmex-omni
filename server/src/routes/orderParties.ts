import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { checkHubAccessIfHubRole, hubOrderAccessSelect } from '../lib/hubOrderAccess.js';
import { parseNfeProcXml, type ParsedNfeCargo } from '../services/acbr/nfeXmlParser.js';
import { getCargoDataFromDistribuicaoDocument } from '../services/fiscal/nfeDistribuicaoCargoData.js';

export const orderPartiesRouter = Router({ mergeParams: true });
const partyInclude = { remetentePerson: true, destinatarioPerson: true, consignatarioPerson: true, expedidorPerson: true } as const;
const refreshSchema = z.object({
    role: z.enum(['remetente', 'destinatario', 'tomador', 'expedidor', 'recebedor']),
    xml: z.string().min(1).max(5_000_000).optional(),
}).strict();

async function accessibleOrder(req: AuthRequest) {
    const order = await prisma.order.findUnique({
        where: { id: req.params.id as string },
        include: { ...partyInclude, demand: true, legs: hubOrderAccessSelect.legs, invoicesRel: { orderBy: { createdAt: 'asc' } } },
    });
    if (!order) throw new AppError('Pedido não encontrado.', 404);
    checkHubAccessIfHubRole(req, order);
    return order;
}

orderPartiesRouter.use(authenticate, authorize('ADMIN', 'HUB'));
orderPartiesRouter.get('/', async (req: AuthRequest, res, next) => {
    try {
        const order = await accessibleOrder(req);
        const tomador = order.freightTerm === 'CIF' ? order.remetentePerson
            : order.freightTerm === 'FOB' ? order.destinatarioPerson : order.consignatarioPerson ?? order.destinatarioPerson;
        // Recebedor é o destinatário no mapper CT-e atual (não há pessoa separada no pedido).
        res.json({ success: true, data: { remetente: order.remetentePerson, destinatario: order.destinatarioPerson, tomador, expedidor: order.expedidorPerson, recebedor: order.destinatarioPerson, freightTerm: order.freightTerm } });
    } catch (error) { next(error); }
});

orderPartiesRouter.post('/nfe-refresh', async (req: AuthRequest, res, next) => {
    try {
        const { role, xml } = refreshSchema.parse(req.body);
        const order = await accessibleOrder(req);
        const keys = [...new Set([
            ...order.invoicesRel.filter((i) => i.type === 'NFE').map((i) => i.nfKey),
            order.demand.documentKey,
        ].filter((key): key is string => Boolean(key && /^\d{44}$/.test(key))))];
        if (!keys.length) throw new AppError('Pedido sem chave NF-e vinculada.', 400);
        let cargo: ParsedNfeCargo | null = null;
        if (xml) {
            try { cargo = parseNfeProcXml(xml); }
            catch { throw new AppError('XML inválido. Envie o XML completo da NF-e.', 400); }
        } else {
            const raw = order.demand.rawInputData as { nfeXmlUpload?: { storageKey?: string } } | null;
            const uploadKey = raw?.nfeXmlUpload?.storageKey;
            if (uploadKey) cargo = await getCargoDataFromDistribuicaoDocument({ tipo: 'NFE_PROC', xmlStorageKey: uploadKey });
            if (!cargo) {
                for (const accessKey of keys) {
                    const stored = await prisma.nfeDistribuicaoDocumento.findUnique({ where: { accessKey }, select: { tipo: true, xmlStorageKey: true } });
                    if (stored) cargo = await getCargoDataFromDistribuicaoDocument(stored);
                    if (cargo) break;
                }
            }
        }
        if (!cargo) throw new AppError('XML não disponível. Envie o arquivo XML da NF-e.', 404);
        if (!keys.includes(cargo.chave)) throw new AppError('XML não corresponde à NF-e deste pedido.', 400);
        const person = role === 'remetente' ? order.remetentePerson
            : role === 'destinatario' || role === 'recebedor' ? order.destinatarioPerson
            : role === 'expedidor' ? order.expedidorPerson
            : order.freightTerm === 'CIF' ? order.remetentePerson
            : order.freightTerm === 'FOB' ? order.destinatarioPerson : order.consignatarioPerson ?? order.destinatarioPerson;
        const document = person?.document.replace(/\D/g, '');
        const party = [cargo.emitente, cargo.destinatario].find((p) => document && (p.cnpj || ('cpf' in p ? p.cpf : '') || '').replace(/\D/g, '') === document);
        if (!party) throw new AppError('Esta pessoa não é emitente nem destinatário da NF-e. Troque a pessoa ou edite manualmente.', 400);
        res.json({ success: true, data: {
            legalName: party.razaoSocial, stateRegistration: party.ie ?? ('indIEDest' in party && party.indIEDest === '2' ? 'ISENTO' : null),
            cep: party.cep ?? '', address: party.logradouro ?? '', number: party.numero ?? '', complement: party.complemento ?? '',
            neighborhood: party.bairro ?? '', city: party.municipio ?? '', state: party.uf ?? '', cityIbgeCode: party.ibge ?? '',
        } });
    } catch (error) { next(error instanceof z.ZodError ? new AppError('Informe a parte e um XML válido.', 400) : error); }
});
