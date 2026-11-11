/**
 * Grupo `prodPred` (produto predominante) do MDF-e rodoviário — obrigatório pela SEFAZ
 * ("Grupo produto predominante deve ser informado para modal rodoviário").
 * Com um único documento fiscal a viagem é carga lotação e `infLotacao` (CEP de carga e descarga) também é exigido.
 */
export interface MdfeProdPredInput {
    orders: Array<{ commodity?: string | null; weight?: number | null }>;
    /** Código do tipo de carga informado no CIOT (1..12); sem CIOT, carga geral (5). */
    tipoCarga?: number | null;
    documentCount: number;
    loadingCep?: string | null;
    unloadingCep?: string | null;
}

export type MdfeProdPredResult =
    | { ok: true; prodPred: Record<string, unknown> }
    | { ok: false; error: string };

const cep8 = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');
const meaningful = (value: string | null | undefined) => {
    const text = (value ?? '').trim();
    return text && !/^a definir$/i.test(text) ? text : '';
};

export function buildMdfeProdPred(input: MdfeProdPredInput): MdfeProdPredResult {
    const tipo = input.tipoCarga ?? 5;
    if (!Number.isInteger(tipo) || tipo < 1 || tipo > 12) return { ok: false, error: 'Tipo de carga inválido para o MDF-e (use 1 a 12).' };
    const predominant = [...input.orders]
        .filter((order) => meaningful(order.commodity))
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];
    const prodPred: Record<string, unknown> = {
        tpCarga: String(tipo).padStart(2, '0'),
        xProd: (meaningful(predominant?.commodity) || 'DIVERSOS').slice(0, 120),
    };
    if (input.documentCount === 1) {
        const loading = cep8(input.loadingCep);
        const unloading = cep8(input.unloadingCep);
        if (loading.length !== 8 || unloading.length !== 8) {
            return { ok: false, error: 'Viagem com um único CT-e é carga lotação: informe o CEP do hub de origem e o CEP de descarga (hub destino ou destinatário) antes de emitir o MDF-e.' };
        }
        prodPred.infLotacao = { infLocalCarrega: { CEP: loading }, infLocalDescarrega: { CEP: unloading } };
    }
    return { ok: true, prodPred };
}
