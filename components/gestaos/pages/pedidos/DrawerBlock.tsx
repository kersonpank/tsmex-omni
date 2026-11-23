import React from 'react';
import type { Mode } from '../../lib/modes';
import { ModeBadge } from '../../ui/kit';

/** Bloco interno da gaveta do pedido (inset, nunca vidro dentro de vidro). */
export const DrawerBlock: React.FC<{ title: string; mode?: Mode; children: React.ReactNode }> = ({ title, mode, children }) => (
    <section className="gx-inset px-4 py-3.5" aria-label={title}>
        <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="gx-label">{title}</h3>
            {mode ? <ModeBadge mode={mode} /> : null}
        </div>
        {children}
    </section>
);
