/**
 * Texto padronizado anexado a `OrderFreightCalculation.cteStatusReason` sempre que um calc cai
 * em CTE_PENDING_RECONCILIATION. A ausência de ID não prova que o POST não chegou à ACBr,
 * inclusive em jobs antigos, portanto nunca autoriza reenvio por si só.
 */
export function pendingReconciliationRecoveryHint(providerDocId: string | null | undefined): string {
    return providerDocId
        ? ' Documento já submetido à ACBr — só reconciliação (consulta de status) é permitida; reemissão automática está bloqueada para evitar duplicidade.'
        : ' ID do documento não disponível. O envio pode ter ocorrido; investigue na ACBr e na SEFAZ antes de qualquer reemissão.';
}
