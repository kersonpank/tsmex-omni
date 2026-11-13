import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, EmptyState, Loadable, ModeBadge, Panel, Pill } from '../../ui/kit';
import { dateFull, money, plural } from '../../lib/format';
import { PAYABLE_STATE_LABEL, payableState, toCents } from '../../lib/financeiro';
import { usePayables } from '../../lib/data';
import { NewPayableDrawer } from './NewPayableDrawer';
import { BENEFICIARY_LABEL, PAYABLE_TONE, PayableDrawer } from './PayableDrawer';
import { SettlementCandidates } from './SettlementCandidates';

export const PagarTab: React.FC = () => {
    const payables = usePayables();
    const [params, setParams] = useSearchParams();
    const [creating, setCreating] = useState(false);
    const openId = params.get('titulo');

    const select = (id: string | null) =>
        setParams(
            (current) => {
                const next = new URLSearchParams(current);
                if (id) next.set('titulo', id);
                else next.delete('titulo');
                return next;
            },
            { replace: true },
        );

    return (
        <div className="flex flex-col gap-6">
            <SettlementCandidates />
            <Panel
                title="Títulos a pagar"
                hint="O título do transportador nasce sozinho; o pagamento é sempre lançado por uma pessoa."
                count={payables.data ? plural(payables.data.length, 'título', 'títulos') : null}
                actions={
                    <Button variant="primary" onClick={() => setCreating(true)}>
                        Novo título
                    </Button>
                }
                padded={false}
            >
                <Loadable
                    state={payables}
                    isEmpty={(list) => list.length === 0}
                    empty={<div className="px-5 pb-5"><EmptyState title="Nenhum título registrado." hint="Títulos de viagem aparecem aqui ao concluir a viagem; despesas avulsas entram por Novo título." /></div>}
                >
                    {(list) => (
                        <div className="gx-scroll-x px-2">
                            <table className="gx-table">
                                <thead>
                                    <tr>
                                        <th>Beneficiário</th>
                                        <th>Descrição</th>
                                        <th className="text-right">Valor</th>
                                        <th className="text-right">Pago</th>
                                        <th className="text-right">Saldo</th>
                                        <th>Vencimento</th>
                                        <th>Situação</th>
                                        <th>Origem</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.map((row) => {
                                        const state = payableState(row);
                                        const dueClass = state === 'OVERDUE' ? 'gx-red-text' : state === 'DUE_SOON' ? 'gx-yellow-text' : '';
                                        return (
                                            <tr key={row.id} data-clickable="true" onClick={() => select(row.id)}>
                                                <td>
                                                    <button type="button" className="border-0 bg-transparent p-0 text-left font-semibold" onClick={(event) => { event.stopPropagation(); select(row.id); }}>
                                                        {row.beneficiaryName}
                                                    </button>
                                                    <span className="gx-muted block text-[12.5px]">{BENEFICIARY_LABEL[row.beneficiaryType]}</span>
                                                </td>
                                                <td className="gx-soft max-w-[280px]">{row.description}</td>
                                                <td className="gx-num text-right">{money(row.amount)}</td>
                                                <td className="gx-num text-right">{money(row.paid)}</td>
                                                <td className="gx-num text-right">{toCents(row.balance) > 0 ? money(row.balance) : '—'}</td>
                                                <td className={dueClass}>{dateFull(row.dueDate)}</td>
                                                <td>
                                                    <Pill tone={PAYABLE_TONE[state]} dot={state === 'OVERDUE' || state === 'DUE_SOON'}>
                                                        {PAYABLE_STATE_LABEL[state]}
                                                    </Pill>
                                                </td>
                                                <td>
                                                    <ModeBadge mode={row.sourceType === 'MANIFEST' ? 'auto' : 'manual'} />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Loadable>
            </Panel>
            {openId ? <PayableDrawer key={openId} payableId={openId} row={payables.data?.find((row) => row.id === openId) ?? null} onClose={() => select(null)} /> : null}
            {creating ? <NewPayableDrawer onClose={() => setCreating(false)} /> : null}
        </div>
    );
};
