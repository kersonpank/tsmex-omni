/**
 * CIOT / registro ANTEF — integração fora do pacote REST CT-e/MDF-e/DC-e da ACBr.
 * Placeholder até sprint dedicada (compliance + provedor específico).
 */

export interface CiotPlaceholderResult {
    status: 'PLANNED';
    message: string;
    complianceNotes: string[];
}

export function buildCiotPlaceholder(manifestId: string): CiotPlaceholderResult {
    return {
        status: 'PLANNED',
        message: `Registro CIOT para o manifesto ${manifestId} ainda não integrado. Próxima sprint: spike ANTEF + validação jurídica/contábil.`,
        complianceNotes: [
            'Confirmar obrigatoriedade e bases legais vigentes com o contador.',
            'Definir provedor (ANTT, financeira, API terceira) e formato de contrato/vale-pedágio se aplicável.',
        ],
    };
}
