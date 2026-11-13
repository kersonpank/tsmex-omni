/**
 * Autopilot × Copilot × Manual — como cada rotina da torre é tocada HOJE pelo sistema.
 *
 * Nada aqui é promessa: cada linha descreve um comportamento que já existe no backend
 * (worker, sugestões e rotas atuais). Quando uma rotina mudar de modo no servidor, muda aqui.
 */

export type Mode = 'auto' | 'copilot' | 'manual';

export const MODE_LABEL: Record<Mode, string> = { auto: 'Autopilot', copilot: 'Copilot', manual: 'Manual' };

export const MODE_HINT: Record<Mode, string> = {
    auto: 'O sistema executa sozinho. Você audita o resultado.',
    copilot: 'O sistema sugere com o motivo. Você aceita ou altera.',
    manual: 'Decisão só sua. O sistema registra.',
};

export type RoutineArea = 'Fiscal' | 'Operação' | 'Financeiro' | 'Comercial' | 'Rede';

export interface Routine {
    id: string;
    area: RoutineArea;
    name: string;
    mode: Mode;
    /** O que o sistema faz, em uma frase. */
    how: string;
}

export const ROUTINES: Routine[] = [
    { id: 'fiscal-closure', area: 'Fiscal', mode: 'auto', name: 'Encerrar MDF-e e CIOT', how: 'Ao concluir a viagem, encerra os documentos e repete sozinho com espera crescente se o provedor falhar.' },
    { id: 'averbacao', area: 'Fiscal', mode: 'auto', name: 'Averbar o seguro da carga', how: 'Averba cada CT-e e declara o MDF-e na seguradora assim que são autorizados.' },
    { id: 'cte-reconcile', area: 'Fiscal', mode: 'auto', name: 'Conferir CT-e sem resposta', how: 'Consulta o emissor a cada 2 minutos e só reenvia com prova de que o documento não chegou.' },
    { id: 'nfe-fetch', area: 'Fiscal', mode: 'auto', name: 'Buscar NF-e na SEFAZ', how: 'Varre as notas destinadas duas vezes ao dia e prepara a entrada das que reconhece.' },
    { id: 'payable', area: 'Financeiro', mode: 'auto', name: 'Gerar título do transportador', how: 'Cria o título pelo saldo da Carta Frete poucos minutos depois da conclusão da viagem.' },
    { id: 'exception-rules', area: 'Operação', mode: 'auto', name: 'Vigiar carga parada, atraso e pedido sem rota', how: 'Abre o alerta com dono e prazo, e fecha sozinho quando a condição deixa de existir.' },

    { id: 'next-hop', area: 'Operação', mode: 'copilot', name: 'Montar viagem pelo próximo salto', how: 'Agrupa o estoque por destino usando a cobertura dos hubs; o hub aceita ou altera a carga.' },
    { id: 'readiness', area: 'Operação', mode: 'copilot', name: 'Liberar a saída da viagem', how: 'Lista o que falta para sair, em ordem, e bloqueia a saída enquanto houver pendência.' },
    { id: 'composition', area: 'Operação', mode: 'copilot', name: 'Escolher veículo e motorista', how: 'Propõe a composição da última viagem do transportador.' },
    { id: 'freight-doc', area: 'Fiscal', mode: 'copilot', name: 'Documento e preço do frete', how: 'Propõe CT-e ou minuta, pagador e preço pela tabela do cliente ou da rota.' },
    { id: 'ciot', area: 'Fiscal', mode: 'copilot', name: 'Tipo de viagem do CIOT e piso ANTT', how: 'Sugere o tipo de viagem e calcula o piso mínimo para comparar com a Carta Frete.' },
    { id: 'trip-cost', area: 'Financeiro', mode: 'copilot', name: 'Custo e margem da viagem', how: 'Estima o custo pelo acordo com o transportador e mostra a margem antes de fechar a Carta Frete.' },

    { id: 'carrier-approval', area: 'Rede', mode: 'manual', name: 'Aprovar ou recusar transportador', how: 'A decisão é da torre ou do hub que cadastrou.' },
    { id: 'trip-cancel', area: 'Operação', mode: 'manual', name: 'Cancelar ou reabrir viagem', how: 'Exige motivo e fica registrado.' },
    { id: 'billing', area: 'Financeiro', mode: 'manual', name: 'Faturar, baixar e pagar', how: 'Fatura, recebimento e pagamento são lançados por uma pessoa.' },
    { id: 'quote', area: 'Comercial', mode: 'manual', name: 'Cotar demanda', how: 'O preço da cotação é informado por uma pessoa.' },
    { id: 'pricing', area: 'Comercial', mode: 'manual', name: 'Tarifas, cobertura e cadastros', how: 'Configuração da rede, feita pela torre.' },
];

export function routinesByMode(mode: Mode): Routine[] {
    return ROUTINES.filter((routine) => routine.mode === mode);
}
