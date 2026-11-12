import React from 'react';
import clsx from 'clsx';
import type { ConferenceMark, UnloadItem } from '../../lib/arrival';
import { itemLabel } from '../../lib/conference';
import { OsCard } from '../../ui/kit';
import { IconAlert, IconCheck, IconX, type OsIconProps } from '../../ui/icons';

const MARKS: Array<{ mark: ConferenceMark; label: string; Icon: React.FC<OsIconProps>; selected: string }> = [
    { mark: 'OK', label: 'Chegou', Icon: IconCheck, selected: 'border-emerald-600 bg-emerald-600 text-white' },
    { mark: 'AVARIA', label: 'Avaria', Icon: IconAlert, selected: 'border-brand-yellow-500 bg-brand-yellow-400 text-brand-950' },
    { mark: 'FALTA', label: 'Não chegou', Icon: IconX, selected: 'border-brand-red-600 bg-brand-red-500 text-white' },
];

/** Um pedido da descarga: três botões grandes. Avaria e "não chegou" passam pelas folhas da página. */
const ConferenceRow: React.FC<{
    item: UnloadItem;
    current: ConferenceMark | undefined;
    note?: string;
    hasPhoto?: boolean;
    onPick: (mark: ConferenceMark) => void;
}> = ({ item, current, note, hasPhoto, onPick }) => (
    <OsCard className="!p-3.5">
        <p className="font-semibold text-tower-900 dark:text-white">
            {itemLabel({ orderNumber: item.orderNumber, nfNumber: null })}
            {item.nfNumber ? (
                <>
                    {' · NF '}
                    <span className="font-mono text-[14px] font-medium">{item.nfNumber}</span>
                </>
            ) : null}
        </p>
        {item.destination ? <p className="mt-0.5 text-[13px] text-tower-500 dark:text-tower-400">{item.destination}</p> : null}
        <div className="mt-3 grid grid-cols-3 gap-2">
            {MARKS.map(({ mark, label, Icon, selected }) => (
                <button
                    key={mark}
                    type="button"
                    aria-pressed={current === mark}
                    onClick={() => onPick(mark)}
                    className={clsx(
                        'flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-[12px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-brand-500',
                        current === mark
                            ? selected
                            : 'border-tower-200 bg-white text-tower-500 active:bg-tower-50 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-300',
                    )}
                >
                    <Icon size={18} />
                    {label}
                </button>
            ))}
        </div>
        {current === 'AVARIA' && note ? (
            <p className="mt-2 text-[13px] text-tower-600 dark:text-tower-300">
                Avaria: {note}
                {hasPhoto ? ' · com foto' : ''}
            </p>
        ) : null}
    </OsCard>
);

export default ConferenceRow;
