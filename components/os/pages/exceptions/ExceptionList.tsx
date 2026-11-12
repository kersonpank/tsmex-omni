import React, { useMemo, useState } from 'react';
import type { HubExceptionItem } from '../../../../types/index';
import { groupExceptions } from '../../lib/exceptions';
import { OsBadge, OsRow } from '../../ui/kit';
import ExceptionCard from './ExceptionCard';

type Handlers = {
    onRetryClosure: (item: HubExceptionItem, manifestId: string) => void;
    onResolve: (item: HubExceptionItem) => void;
    onAcknowledge: (item: HubExceptionItem) => void;
};

/** Lista de exceções: tipos repetidos (3 ou mais) viram um grupo expansível. */
const ExceptionList: React.FC<{ items: HubExceptionItem[]; busyId: string | null } & Handlers> = ({ items, busyId, ...handlers }) => {
    const rows = useMemo(() => groupExceptions(items), [items]);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const card = (item: HubExceptionItem) => <ExceptionCard key={item.id} item={item} busy={busyId === item.id} {...handlers} />;
    return (
        <div className="flex flex-col gap-2.5">
            {rows.map((row) => {
                if (row.kind === 'single') return card(row.item);
                const expanded = open.has(row.category);
                const overdue = row.items.filter((item) => item.overdue).length;
                return (
                    <div key={row.category} className="flex flex-col gap-2.5">
                        <OsRow
                            tone={overdue > 0 ? 'bad' : 'attention'}
                            aria-expanded={expanded}
                            onClick={() =>
                                setOpen((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(row.category)) next.delete(row.category);
                                    else next.add(row.category);
                                    return next;
                                })
                            }
                        >
                            <div className="flex items-center justify-between gap-2 pr-1">
                                <p className="font-semibold text-tower-900 dark:text-white">{row.title}</p>
                                <OsBadge tone={overdue > 0 ? 'bad' : 'warn'}>{row.items.length}</OsBadge>
                            </div>
                            <p className="mt-0.5 text-[13px] text-tower-500 dark:text-tower-400">
                                {expanded ? 'Toque para recolher' : `Toque para ver os ${row.items.length} itens`}
                                {overdue > 0 ? ` · ${overdue} vencida(s)` : ''}
                            </p>
                        </OsRow>
                        {expanded ? <div className="ml-3 flex flex-col gap-2.5">{row.items.map(card)}</div> : null}
                    </div>
                );
            })}
        </div>
    );
};

export default ExceptionList;
