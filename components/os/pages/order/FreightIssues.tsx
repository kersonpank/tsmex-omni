import React, { useState } from 'react';
import clsx from 'clsx';
import type { FreightSuggestion, Person } from '../../../../types/index';
import { CTE_CFOP_SELECT_OPTIONS, CTE_CST_SELECT_OPTIONS, cfopOptionSelectText } from '../../../../lib/cteTaxCatalog';
import { PersonFormModal } from '../../../ui/PersonFormModal';
import { blockerAction } from '../../lib/freight';
import { osFieldClass } from '../../ui/Sheet';
import { personFormValues } from '../entry/PartyCard';

/**
 * Pendências do documento do frete, cada uma com quem resolve: cadastro de uma parte se
 * completa aqui mesmo; dado do emitente/hub é da torre. CFOP/CST aparecem só quando o
 * padrão do emitente falta ou é incompatível com a prestação.
 */
const FreightIssues: React.FC<{
    suggestion: FreightSuggestion;
    issues: string[];
    tax: { cfop: string; cst: string };
    onTax: (tax: { cfop: string; cst: string }) => void;
    showTax: boolean;
    onPartyEdited: () => void;
}> = ({ suggestion, issues, tax, onTax, showTax, onPartyEdited }) => {
    const [editing, setEditing] = useState<Person | null>(null);
    const visible = issues.filter((issue) => !/CFOP|CST/.test(issue) || !showTax || /^SEFAZ (519|524|908):/.test(issue));
    if (visible.length === 0 && !showTax) return null;

    return (
        <div className="mt-3 rounded-xl border-l-4 border-brand-yellow-400 bg-brand-yellow-400/10 p-3">
            <p className="text-[13px] font-bold text-[#6b5900] dark:text-brand-yellow-400">Antes de emitir</p>
            <ul className="mt-1.5 flex flex-col gap-2">
                {visible.map((issue) => {
                    const action = blockerAction(issue, suggestion.payer?.role ?? null);
                    const person = action && action !== 'tower' ? suggestion.parties[action] : null;
                    return (
                        <li key={issue} className="text-[13px] text-tower-700 dark:text-tower-200">
                            {issue}
                            {person ? (
                                <button type="button" onClick={() => setEditing(person)} className="ml-2 font-bold text-brand-600 dark:text-brand-300">
                                    Completar cadastro
                                </button>
                            ) : action === 'tower' ? (
                                <span className="ml-2 text-[12px] text-tower-400">(a torre resolve)</span>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
            {showTax ? (
                <div className="mt-3 grid grid-cols-1 gap-2.5">
                    <label className="block text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                        CFOP
                        <select value={tax.cfop} onChange={(e) => onTax({ ...tax, cfop: e.target.value })} className={clsx(osFieldClass, 'mt-1')}>
                            <option value="">Escolha o CFOP</option>
                            {CTE_CFOP_SELECT_OPTIONS.map((o) => (
                                <option key={o.code} value={o.code} title={o.labelFull}>
                                    {cfopOptionSelectText(o)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                        CST do ICMS
                        <select value={tax.cst} onChange={(e) => onTax({ ...tax, cst: e.target.value })} className={clsx(osFieldClass, 'mt-1')}>
                            <option value="">Escolha o CST</option>
                            {CTE_CST_SELECT_OPTIONS.map((o) => (
                                <option key={o.code} value={o.code}>
                                    {o.code} | {o.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            ) : null}
            {editing ? (
                <PersonFormModal
                    mode="edit"
                    personId={editing.id}
                    initialValues={personFormValues(editing)}
                    onClose={() => setEditing(null)}
                    onSuccess={() => {
                        setEditing(null);
                        onPartyEdited();
                    }}
                />
            ) : null}
        </div>
    );
};

export default FreightIssues;
