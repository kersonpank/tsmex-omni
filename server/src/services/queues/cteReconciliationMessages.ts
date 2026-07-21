/**
 * Texto padronizado anexado a `OrderFreightCalculation.cteStatusReason` sempre que um calc cai
 * em CTE_PENDING_RECONCILIATION — deixa explícito pra UI/admin, ANTES de qualquer clique, se
 * reenvio automático é seguro (nenhum documento foi submetido à ACBr) ou se só reconciliação
 * (consulta de status) é permitida (documento já enviado, aguardando SEFAZ). Fonte única usada
 * por cteEmissionProcessor.ts e repair-stuck-cte-jobs.ts — evita textos divergentes.
 */
export function pendingReconciliationRecoveryHint(providerDocId: string | null | undefined): string {
    return providerDocId
        ? ' Documento já submetido à ACBr — só reconciliação (consulta de status) é permitida; reemissão automática está bloqueada para evitar duplicidade.'
        : ' Nenhum documento foi submetido à ACBr ainda — reemissão automática está disponível (repita a emissão normalmente, é seguro).';
}
