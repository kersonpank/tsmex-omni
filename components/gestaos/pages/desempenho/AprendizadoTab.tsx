import React from 'react';
import type { AutonomyReport, TripsReport } from '../../../../lib/api';
import { cents, type Period } from '../../lib/desempenho';
import { useAutonomyReport, useTripsReport } from '../../lib/desempenhoData';
import { money, plural } from '../../lib/format';
import { Highlight } from '../../ui/charts';
import { Loadable, Panel } from '../../ui/kit';
import { RoutineBreakdown, RulerBody } from './AutonomyRuler';
import { Honesty } from './Honesty';

const PlannedVsDone: React.FC<{ report: TripsReport }> = ({ report }) => {
    const t = report.totals;
    const estimated = t.revenueNetCents - t.revenueRealizedCents;
    return (
        <Panel title="Planejado × realizado" hint="Parte da receita das viagens ainda é estimada pela tarifa; só a realizada veio de cobrança.">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <Highlight label="Receita líquida" value={money(cents(t.revenueNetCents))} compare="Realizada mais estimada" />
                <Highlight label="Realizada" value={money(cents(t.revenueRealizedCents))} compare="Já cobrada" />
                <Highlight
                    label="Estimada"
                    value={money(cents(Math.max(0, estimated)))}
                    compare={plural(t.tripsWithEstimatedRevenue, 'viagem usa receita estimada', 'viagens usam receita estimada')}
                    status={t.tripsWithEstimatedRevenue > 0 ? { text: 'Ainda não confirmada', tone: 'yellow' } : undefined}
                />
                <Highlight label="Viagens medidas" value={`${t.tripsWithMargin} de ${t.trips}`} compare="Com custo completo e margem calculada" />
            </div>
        </Panel>
    );
};

const View: React.FC<{ autonomy: AutonomyReport; trips: TripsReport | null }> = ({ autonomy, trips }) => (
    <div className="flex flex-col gap-6">
        <Panel tint="auto" title="Régua de autonomia" hint="Percentual real de sugestões aceitas sem alteração, contra a meta que libera subir uma rotina de modo.">
            <RulerBody report={autonomy} />
        </Panel>
        <Panel title="Por rotina" hint="Cada rotina de consolidação com a ocupação e a margem antes e depois da decisão.">
            <RoutineBreakdown report={autonomy} />
        </Panel>
        {trips ? <PlannedVsDone report={trips} /> : null}
        <Honesty excluded={autonomy.excluded} truncated={autonomy.coverage.truncated ? `analisamos ${autonomy.coverage.feedbackAnalysed} registros (limite de ${autonomy.coverage.limit}).` : null} />
    </div>
);

export const AprendizadoTab: React.FC<{ period: Period }> = ({ period }) => {
    const autonomy = useAutonomyReport(period);
    const trips = useTripsReport(period);
    return <Loadable state={autonomy}>{(report) => <View autonomy={report} trips={trips.data} />}</Loadable>;
};
