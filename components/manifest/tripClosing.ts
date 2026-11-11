import type { ManifestMarginInfo } from '../../types/index';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatBRL = (value: number | null | undefined): string => (value == null ? '—' : brl.format(value));

const percent = (value: number | null | undefined, digits: number): string =>
  value == null ? '—' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface TripClosingView {
  revenueNet: string;
  linkCost: string;
  hubCost: string;
  margin: string;
  marginPercent: string;
  occupancyWeight: string;
  occupancyVolume: string;
  /** O que falta, em linguagem simples, quando o fechamento tem dado incompleto. */
  warnings: string[];
  tone: 'good' | 'bad' | 'incomplete';
}

/** Texto do cartão "Fechamento da viagem" a partir dos números do servidor (nada é recalculado aqui). */
export function describeTripClosing(data: Partial<ManifestMarginInfo>): TripClosingView {
  const warnings: string[] = [];
  const costComplete = data.costComplete !== false;

  if (!costComplete) {
    warnings.push('Falta o custo do transportador: lance a Carta Frete da viagem ou cadastre o acordo da rota. Sem ele a margem não é calculada.');
  }
  if (data.revenueEstimated) {
    const n = data.ordersWithoutOfficialFreight ?? 0;
    warnings.push(`${n} ${n === 1 ? 'pedido' : 'pedidos'} sem CT-e, DC-e ou minuta emitido: a receita é estimada, não confirmada.`);
  }
  if ((data.ordersWithoutFreightValue ?? 0) > 0) {
    warnings.push(`${plural(data.ordersWithoutFreightValue!, 'pedido sem valor de frete', 'pedidos sem valor de frete')}: nada foi somado na receita.`);
  }

  const margin = costComplete ? data.margin ?? null : null;
  const tone: TripClosingView['tone'] = !costComplete || data.revenueEstimated ? 'incomplete' : margin != null && margin < 0 ? 'bad' : 'good';

  return {
    revenueNet: formatBRL(data.revenueNet),
    linkCost: costComplete ? formatBRL(data.linkCost) : 'não lançado',
    hubCost: formatBRL(data.hubCost),
    margin: formatBRL(margin),
    marginPercent: costComplete ? percent(data.marginPercent, 1) : '—',
    occupancyWeight: percent(data.occupancyWeightPercent, 0),
    occupancyVolume: percent(data.occupancyVolumePercent, 0),
    warnings,
    tone,
  };
}
