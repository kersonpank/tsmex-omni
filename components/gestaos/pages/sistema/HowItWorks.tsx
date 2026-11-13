import React from 'react';
import { MODE_HINT, routinesByMode, type Mode } from '../../lib/modes';
import { ModeBadge, Panel, Pill } from '../../ui/kit';

const COLUMNS: Array<{ mode: Mode; lead: string }> = [
    { mode: 'auto', lead: 'Roda sozinho, o tempo todo. Seu trabalho é auditar o resultado.' },
    { mode: 'copilot', lead: 'O sistema põe a sugestão e o motivo à mão. Você decide com um clique.' },
    { mode: 'manual', lead: 'O sistema não decide nada aqui. Ele só registra o que você fez.' },
];

/** Mapa do paradigma: quem toca cada rotina. Não é formulário: nada aqui liga ou desliga. */
export const HowItWorks: React.FC = () => (
    <section aria-labelledby="como-trabalha">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="como-trabalha" className="gx-h2">
                Como a torre trabalha
            </h2>
            <p className="gx-muted text-[13px]">Mapa do que existe hoje. Subir uma rotina de modo é decisão medida e não acontece nesta tela.</p>
        </div>
        <div className="gx-stagger grid grid-cols-1 gap-5 lg:grid-cols-3">
            {COLUMNS.map(({ mode, lead }) => {
                const routines = routinesByMode(mode);
                return (
                    <Panel key={mode} tint={mode === 'auto' ? 'auto' : undefined} className="h-full">
                        <div className="flex items-center justify-between gap-3">
                            <ModeBadge mode={mode} />
                            <span className="gx-muted text-[12.5px]">{routines.length} rotinas</span>
                        </div>
                        <p className="mt-3 font-semibold">{MODE_HINT[mode]}</p>
                        <p className="gx-muted mt-1 text-[13px]">{lead}</p>
                        <ul className="mt-4 flex flex-col">
                            {routines.map((routine) => (
                                <li key={routine.id} className="gx-hair-t py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[14.5px] font-semibold">{routine.name}</span>
                                        <Pill>{routine.area}</Pill>
                                    </div>
                                    <p className="gx-soft mt-1 text-[13.5px]">{routine.how}</p>
                                </li>
                            ))}
                        </ul>
                    </Panel>
                );
            })}
        </div>
    </section>
);
