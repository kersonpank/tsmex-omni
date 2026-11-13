import React from 'react';
import { IconAlert } from '../../../ui/icons';

/** Aviso de ação bloqueada: sempre com o motivo, nunca só um botão apagado. */
export const Blocked: React.FC<{ reason: string | null; className?: string }> = ({ reason, className }) =>
    reason ? (
        <p className={`gx-inset gx-soft flex items-start gap-2 px-3.5 py-2.5 text-[13.5px] ${className ?? ''}`} role="status">
            <IconAlert size={16} className="gx-yellow-text mt-0.5 flex-none" />
            <span>{reason}</span>
        </p>
    ) : null;
