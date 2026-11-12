import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { HubExceptionItem } from '../../../../types/index';
import { ageLabel, dueLabel, exceptionAction, exceptionExplain } from '../../lib/exceptions';
import { OsBadge, OsButton, OsRow, type RowTone } from '../../ui/kit';

const TONE: Record<HubExceptionItem['severity'], RowTone> = { CRITICAL: 'bad', WARNING: 'attention', INFO: 'route' };

/** Cartão de exceção: o que travou, por que você está vendo, o que fazer e as ações. */
const ExceptionCard: React.FC<{
    item: HubExceptionItem;
    busy: boolean;
    onRetryClosure: (item: HubExceptionItem, manifestId: string) => void;
    onResolve: (item: HubExceptionItem) => void;
    onAcknowledge: (item: HubExceptionItem) => void;
}> = ({ item, busy, onRetryClosure, onResolve, onAcknowledge }) => {
    const navigate = useNavigate();
    const action = exceptionAction(item);
    const explain = exceptionExplain(item.category);
    return (
        <OsRow tone={item.overdue ? 'bad' : TONE[item.severity]} chevron={false} className="!items-start">
            <div className="flex items-start justify-between gap-2">
                <p className="font-semibold leading-snug text-tower-900 dark:text-white">{item.title}</p>
                <OsBadge tone={item.overdue ? 'bad' : 'warn'}>{dueLabel(item)}</OsBadge>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-tower-600 dark:text-tower-300">{item.message}</p>
            <p className="mt-1.5 text-[12px] leading-snug text-tower-600 dark:text-tower-300">
                <strong>Por que estou vendo isto:</strong> {explain.why}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-tower-600 dark:text-tower-300">
                <strong>O que fazer:</strong> {explain.what}
            </p>
            <p className="mt-1 text-[11px] text-tower-400">
                {ageLabel(item)}
                {item.status === 'ACKNOWLEDGED' ? ' · ciente' : ''}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
                {action.kind === 'link' ? (
                    <OsButton className="min-h-[44px]" onClick={() => navigate(action.to)}>{action.label}</OsButton>
                ) : null}
                {action.kind === 'retryFiscalClosure' ? (
                    <OsButton className="min-h-[44px]" disabled={busy} onClick={() => onRetryClosure(item, action.manifestId)}>
                        {action.label}
                    </OsButton>
                ) : null}
                <OsButton variant="secondary" className="min-h-[44px]" disabled={busy} onClick={() => onResolve(item)}>Resolver</OsButton>
                {item.status === 'OPEN' ? (
                    <OsButton variant="ghost" className="min-h-[44px]" disabled={busy} onClick={() => onAcknowledge(item)}>Ciente</OsButton>
                ) : null}
            </div>
        </OsRow>
    );
};

export default ExceptionCard;
