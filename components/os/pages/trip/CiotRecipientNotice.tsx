import React from 'react';
import type { CiotRecipientSuggestion } from '../../../../types/index';

/** Explica de onde veio o destinatário do CIOT e o que falta completar (some conforme o operador preenche). */
const CiotRecipientNotice: React.FC<{ recipient: CiotRecipientSuggestion | null; missing: string[]; touched: boolean }> = ({ recipient, missing, touched }) => {
    const origin = touched || !recipient ? null : recipient.source === 'ORDER' ? 'Destinatário do pedido desta entrega.' : 'Destinatário: a unidade de destino da viagem.';
    return (
        <div className="mb-3 flex flex-col gap-2" aria-live="polite">
            {origin ? <p className="rounded-lg bg-brand-500/8 p-3 text-[13px] text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{origin} Pode trocar abaixo.</p> : null}
            {!touched && recipient?.note ? <p className="rounded-lg bg-amber-500/10 p-3 text-[13px] font-semibold text-amber-800 dark:text-amber-300">{recipient.note}</p> : null}
            {missing.length > 0 ? (
                <p role="alert" className="rounded-lg border-2 border-brand-yellow-400 bg-brand-yellow-400/10 p-3 text-[13px] font-bold text-tower-800 dark:text-tower-100">
                    Falta completar: {missing.join(', ')}.
                </p>
            ) : null}
        </div>
    );
};

export default CiotRecipientNotice;
