import React from 'react';
import type { ReportExcluded } from '../../../../lib/api';
import { num } from '../../lib/format';
import { Panel } from '../../ui/kit';

/**
 * "O que ficou de fora": a honestidade do número. Mostra o que o servidor excluiu (`excluded`),
 * o corte por limite (`coverage.truncated`) e o que mais precisar de aviso, em linguagem simples.
 */
export const Honesty: React.FC<{
    excluded: ReportExcluded[] | undefined;
    /** Frase de corte quando `coverage.truncated` é verdadeiro. */
    truncated?: string | null;
    /** Avisos extras (fontes cortadas, referência de "no prazo" etc.). */
    notes?: string[];
}> = ({ excluded, truncated, notes = [] }) => {
    const list = (excluded ?? []).filter((item) => item.count > 0);
    const clean = list.length === 0 && !truncated && notes.length === 0;
    return (
        <Panel title="O que ficou de fora" hint="Os números acima só valem para o que foi medido. Isto é o que não entrou na conta.">
            {clean ? (
                <p className="gx-soft text-[13.5px]">Nada ficou de fora neste período.</p>
            ) : (
                <ul className="flex flex-col gap-2 text-[13.5px]">
                    {truncated ? (
                        <li className="gx-yellow-text font-semibold" role="status">
                            Relatório cortado pelo limite: {truncated}
                        </li>
                    ) : null}
                    {list.map((item) => (
                        <li key={item.reason} className="flex gap-3">
                            <span className="gx-num flex-none">{num(item.count)}</span>
                            <span className="gx-soft">{item.reason}</span>
                        </li>
                    ))}
                    {notes.map((note) => (
                        <li key={note} className="gx-soft">{note}</li>
                    ))}
                </ul>
            )}
        </Panel>
    );
};
