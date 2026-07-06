/**
 * RNTRC (Registro Nacional de Transportadores Rodoviários de Cargas) tem 8 dígitos numéricos.
 * Não implementamos dígito verificador ANTT aqui: a fórmula oficial não está documentada em
 * nenhuma fonte confiável disponível neste projeto. Um valor com formato errado é rejeitado
 * antes de gastar crédito ACBr; um valor com formato certo mas dígito inválido só será
 * pego pela SEFAZ (custo de 1 crédito) até essa fórmula ser confirmada e implementada aqui.
 */
export function validateRntrcFormat(value: string | null | undefined): boolean {
    if (typeof value !== 'string') return false;
    return /^\d{8}$/.test(value.trim());
}
