import React from 'react';
import clsx from 'clsx';
import type { Notice } from '../../../lib/freteDoc';

/** Resultado de uma ação fiscal que fica na tela (o aviso curto some; este não). Estado sempre em texto. */
export const FreightNotice: React.FC<{ notice: Notice | null; className?: string }> = ({ notice, className }) => {
    if (!notice) return null;
    const label = notice.tone === 'bad' ? 'Não concluído' : notice.tone === 'ok' ? 'Concluído' : 'Em andamento';
    return (
        <p
            role={notice.tone === 'bad' ? 'alert' : 'status'}
            className={clsx('gx-inset px-4 py-3 text-[13.5px] font-medium', notice.tone === 'bad' && 'gx-red-text', notice.tone === 'ok' && 'gx-royal-text', className)}
        >
            <span className="gx-label mr-2">{label}</span>
            {notice.text}
        </p>
    );
};
