import React from 'react';
import clsx from 'clsx';
import { formatBRL, INFORMED_FIELDS, parseInformed, type InformedForm } from '../../lib/freight';
import { osFieldClass } from '../../ui/Sheet';

/**
 * Frete informado pelo hub: os mesmos componentes do cálculo por tabela, digitados.
 * Com tabela disponível, usar outro valor pede o motivo (fica no histórico do pedido).
 */
const InformedFields: React.FC<{
    value: InformedForm;
    onChange: (next: InformedForm) => void;
    reason: string;
    onReason: (reason: string) => void;
    requireReason: boolean;
}> = ({ value, onChange, reason, onReason, requireReason }) => {
    const { total } = parseInformed(value);
    return (
        <div className="mt-2">
            <div className="grid grid-cols-2 gap-2.5">
                {INFORMED_FIELDS.map((field) => (
                    <label key={field.key} className="block text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                        {field.label} (R$)
                        <input
                            inputMode="decimal"
                            value={value[field.key]}
                            onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
                            placeholder="0,00"
                            className={clsx(osFieldClass, 'mt-1')}
                        />
                    </label>
                ))}
            </div>
            <p className="mt-3 text-right text-[15px] font-bold text-tower-900 dark:text-white">Total {formatBRL(total)}</p>
            {requireReason ? (
                <label className="mt-2 block text-[12px] font-semibold text-tower-500 dark:text-tower-400">
                    Motivo para não usar a tabela
                    <input
                        value={reason}
                        onChange={(e) => onReason(e.target.value)}
                        placeholder="Ex.: negociado com o cliente"
                        maxLength={500}
                        className={clsx(osFieldClass, 'mt-1')}
                    />
                </label>
            ) : null}
        </div>
    );
};

export default InformedFields;
