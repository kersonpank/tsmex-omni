export type TripPriceEstimateStatus = 'READY' | 'PARTIAL' | 'UNAVAILABLE';
export type TripPriceFloorComparison = 'ABOVE' | 'BELOW' | 'UNAVAILABLE';

export type TripPriceEstimateIssueCode =
    | 'ORDER_FREIGHT_MISSING'
    | 'LINK_FREIGHT_UNAVAILABLE'
    | 'TOLL_UNAVAILABLE'
    | 'ANTT_FLOOR_UNAVAILABLE'
    | 'ANTT_FLOOR_BELOW';

export interface TripPriceEstimateIssue {
    code: TripPriceEstimateIssueCode;
    message: string;
}

export interface BuildTripPriceEstimateInput {
    /** Valores oficiais que a TSM cobra dos pedidos da viagem; não são custo do Link. */
    orderFreights: number[];
    orderFreightMissingCount: number;
    /** Valor negociado/estimado a pagar ao Link, sem pedágio. */
    suggestedFreteBruto: number | null;
    /** Pedágio de rota conhecido. `null` significa indisponível, não zero. */
    suggestedPedagio: number | null;
    /** Piso calculado por tabela ANTT vigente. `null` quando a fonte ainda não está configurada. */
    anttMinimumFreight: number | null;
}

export interface TripPriceEstimate {
    status: TripPriceEstimateStatus;
    commercialRevenue: number;
    orderFreightMissingCount: number;
    suggestedFreteBruto: number | null;
    suggestedPedagio: number | null;
    suggestedTotalCost: number | null;
    anttMinimumFreight: number | null;
    floorComparison: TripPriceFloorComparison;
    marginEstimate: number | null;
    issues: TripPriceEstimateIssue[];
}

function finiteNonNegative(value: number | null): number | null {
    return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Junta fontes já conhecidas do TMS sem escolher preço no lugar do operador.
 * Receita comercial e custo/pagamento do Link são propositalmente independentes.
 */
export function buildTripPriceEstimate(input: BuildTripPriceEstimateInput): TripPriceEstimate {
    const issues: TripPriceEstimateIssue[] = [];
    const commercialRevenue = input.orderFreights.reduce((total, value) => total + (Number.isFinite(value) && value > 0 ? value : 0), 0);
    const freteBruto = finiteNonNegative(input.suggestedFreteBruto);
    const pedagio = finiteNonNegative(input.suggestedPedagio);
    const piso = finiteNonNegative(input.anttMinimumFreight);

    if (input.orderFreightMissingCount > 0) {
        issues.push({
            code: 'ORDER_FREIGHT_MISSING',
            message: `${input.orderFreightMissingCount} pedido(s) sem frete comercial oficial para compor a receita prevista.`,
        });
    }
    if (freteBruto === null) {
        issues.push({
            code: 'LINK_FREIGHT_UNAVAILABLE',
            message: 'Sem valor negociado ou acordo de preço do Link para sugerir o frete bruto.',
        });
    }
    if (pedagio === null) {
        issues.push({
            code: 'TOLL_UNAVAILABLE',
            message: 'Pedágio da rota ainda indisponível; configure o provedor de rota/pedágio ou informe o valor na Carta Frete.',
        });
    }
    if (piso === null) {
        issues.push({
            code: 'ANTT_FLOOR_UNAVAILABLE',
            message: 'Piso mínimo ANTT ainda indisponível; carregue uma tabela vigente antes de validar automaticamente.',
        });
    }

    const floorComparison: TripPriceFloorComparison = freteBruto === null || piso === null
        ? 'UNAVAILABLE'
        : freteBruto < piso
          ? 'BELOW'
          : 'ABOVE';
    if (floorComparison === 'BELOW') {
        issues.push({
            code: 'ANTT_FLOOR_BELOW',
            message: 'Frete bruto sugerido está abaixo do piso ANTT calculado. A Carta Frete não foi alterada automaticamente.',
        });
    }

    const suggestedTotalCost = freteBruto !== null && pedagio !== null ? freteBruto + pedagio : null;
    const marginEstimate = suggestedTotalCost !== null && input.orderFreightMissingCount === 0
        ? commercialRevenue - suggestedTotalCost
        : null;
    const status: TripPriceEstimateStatus = issues.length === 0
        ? 'READY'
        : commercialRevenue === 0 && freteBruto === null && pedagio === null && piso === null
          ? 'UNAVAILABLE'
          : 'PARTIAL';

    return {
        status,
        commercialRevenue,
        orderFreightMissingCount: input.orderFreightMissingCount,
        suggestedFreteBruto: freteBruto,
        suggestedPedagio: pedagio,
        suggestedTotalCost,
        anttMinimumFreight: piso,
        floorComparison,
        marginEstimate,
        issues,
    };
}
