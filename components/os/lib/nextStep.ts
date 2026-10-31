import type { FreightDocState, ManifestReadiness, ManifestReadinessIssue } from '../../../types/index';
import type { ManifestWithLegs } from './arrival';
import { isDocumented } from './readiness';
import { groupOf } from './trip';

export type TripNextStepAction =
    | 'responsible'
    | 'freight'
    | 'departure'
    | 'emitter'
    | 'registry'
    | 'documents_cte'
    | 'documents_ciot'
    | 'documents_mdfe'
    | 'confirm'
    | 'start'
    | 'none';

export interface TripNextStep {
    label: string;
    action: TripNextStepAction;
    hint: string;
}

/** Uma ação por vez, na ordem operacional. A prontidão do servidor continua decidindo a saída. */
export function tripNextStep(manifest: ManifestWithLegs, readiness: ManifestReadiness | null): TripNextStep {
    const next = (action: TripNextStepAction, label: string, hint: string): TripNextStep => ({ label, action, hint });

    if (manifest.status === 'IN_PROGRESS') return next('none', 'Viagem em rota', 'O hub de destino recebe a chegada.');
    if (manifest.status === 'COMPLETED') return next('none', 'Viagem concluída', 'A chegada desta viagem já foi registrada.');
    if (manifest.status === 'CANCELLED') return next('none', 'Viagem cancelada', 'Esta viagem não pode registrar saída.');

    const issues = readiness?.issues ?? [];
    const blocking = issues.filter((issue) => issue.severity === 'blocking');
    const groupIssue = (group: 'responsible' | 'freight' | 'departure') => blocking.find((issue) => groupOf(issue) === group);
    const responsible = groupIssue('responsible');
    if (!manifest.linkId || !manifest.driverId || responsible) {
        return next('responsible', 'Definir transportador e motorista', responsible?.message ?? 'Escolha quem transporta e quem dirige esta viagem.');
    }

    const freight = groupIssue('freight');
    if (!manifest.freightAgreement || manifest.freightAgreement.freteBruto < 0 || freight) {
        return next('freight', 'Preencher Carta Frete', freight?.message ?? 'Informe os valores combinados com o transportador.');
    }

    const departure = groupIssue('departure');
    if (!manifest.plannedDepartureAt || departure) {
        return next('departure', 'Definir saída prevista', departure?.message ?? 'Informe quando o veículo deve sair.');
    }

    const emitter = issues.find((issue) => issue.code === 'FISCAL_EMITTER_PENDING');
    // Só trava quando o servidor não decidiu sozinho (vários emitentes sem padrão).
    if (emitter) {
        return next('emitter', 'Definir emitente fiscal', emitter?.message ?? 'Escolha o emitente para preparar os documentos da viagem.');
    }

    const registry = issues.find((issue) => groupOf(issue) === 'registry' && (
        issue.severity === 'blocking' || ['MDFE_VEHICLE_CAPACITY_PENDING', 'MDFE_VEHICLE_DATA_PENDING'].includes(issue.code)
    ));
    if (registry) return next('registry', 'Completar cadastro', registry.message);

    // "emitted" também pode representar uma minuta: uma pendência CT-e do servidor sempre prevalece.
    const cte = issues.find((issue) => ['ORDER_DOCUMENTATION_PENDING', 'CTE_AUTHORIZATION_REQUIRED'].includes(issue.code));
    if (cte || manifest.legs?.some((leg) => !isDocumented(leg.order?.freightDocState))) {
        return next('documents_cte', 'Autorizar CT-e dos pedidos', cte?.message ?? 'Abra os pedidos para concluir seus documentos antes de emitir o CIOT.');
    }

    const unsupported = blocking.find((issue) => ![
        'CIOT_REQUIRED', 'MDFE_AUTHORIZATION_REQUIRED',
    ].includes(issue.code));
    if (unsupported) return next('none', 'Revisar pendências da viagem', unsupported.message);

    // CIOT exige ACCEPTED. Antes disso, confirmar pelo hub é a etapa que libera os documentos.
    if (manifest.status === 'DRAFT' || manifest.status === 'PENDING_ACCEPT') {
        if (manifest.status === 'DRAFT' && !readiness?.canOffer) {
            return next('none', 'Consultar prontidão da viagem', 'Atualize a viagem para verificar se já pode confirmar o transportador.');
        }
        return next(
            'confirm',
            manifest.status === 'DRAFT' ? 'Confirmar transportador' : 'Confirmar pelo transportador',
            'Confirme o transportador para liberar CIOT e MDF-e.',
        );
    }

    const hasAuthorized = (type: 'CIOT' | 'MDFE') => manifest.fiscalDocuments?.some((doc) => doc.documentType === type && doc.status === 'AUTHORIZED');
    const ciot = issues.find((issue) => issue.code === 'CIOT_REQUIRED');
    if (ciot || (!manifest.ciotDispensado && manifest.fiscalDocuments != null && !hasAuthorized('CIOT'))) {
        return next('documents_ciot', 'Emitir ou dispensar CIOT', ciot?.message ?? 'Emita o CIOT ou registre uma dispensa com motivo para liberar o MDF-e.');
    }

    const mdfe = issues.find((issue) => issue.code === 'MDFE_AUTHORIZATION_REQUIRED');
    if (mdfe || (manifest.fiscalDocuments != null && !hasAuthorized('MDFE'))) {
        const processing = manifest.fiscalDocuments?.some((doc) => doc.documentType === 'MDFE' && doc.status === 'SENT');
        return next(
            'documents_mdfe',
            processing ? 'Consultar MDF-e' : 'Emitir MDF-e',
            processing ? 'MDF-e em processamento na SEFAZ — não reemita.' : mdfe?.message ?? 'Com CT-es e CIOT resolvidos, autorize o MDF-e antes da saída.',
        );
    }

    if (readiness?.canStart) return next('start', 'Registrar saída', 'Documentos e preparação concluídos. Registre a saída do veículo.');
    return next('none', 'Consultar prontidão da viagem', 'Atualize a viagem para verificar a liberação da saída.');
}

export type OrderNextStepAction = 'labels' | 'cubage' | 'freight' | 'trip' | 'none';

export interface OrderNextStep {
    label: string;
    action: OrderNextStepAction;
}

/**
 * Próximo passo do pedido no hub: etiquetas → cubagem → documento do frete → viagem.
 * `labelsPrinted` indefinido = o sistema não rastreia a impressão: o passo é pulado.
 * m³ <= 0,001 (placeholder da entrada) conta como cubagem não informada.
 */
export function orderNextStep(input: {
    labelsPrinted?: boolean;
    volumeM3: number;
    freightDocState: FreightDocState | null | undefined;
    inTrip: boolean;
}): OrderNextStep {
    if (input.labelsPrinted === false) return { label: 'Imprimir etiquetas', action: 'labels' };
    if (!(input.volumeM3 > 0.001)) return { label: 'Informar medidas dos volumes', action: 'cubage' };
    if (input.freightDocState === 'in_flight') return { label: 'Documento do frete em envio', action: 'none' };
    if (input.freightDocState !== 'emitted') return { label: 'Emitir documento do frete', action: 'freight' };
    if (!input.inTrip) return { label: 'Montar a viagem', action: 'trip' };
    return { label: 'Pedido já está em viagem', action: 'none' };
}
