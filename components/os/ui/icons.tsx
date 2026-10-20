import React from 'react';

/**
 * Ícones do TSM O.S. — traço grosso (2.2), cantos arredondados, desenhados para
 * leitura rápida em tela pequena. Nada de emoji nem biblioteca externa.
 */

export type OsIconProps = { size?: number; className?: string };

const base = (size: number) => ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
});

/** Hoje — sol de turno de doca. */
export const IconDay: React.FC<OsIconProps> = ({ size = 22, className }) => (
    <svg {...base(size)} className={className}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </svg>
);

/** Receber — caixa descendo na doca. */
export const IconReceive: React.FC<OsIconProps> = ({ size = 22, className }) => (
    <svg {...base(size)} className={className}>
        <path d="M12 3v7.5M9.2 8l2.8 2.8L14.8 8" />
        <path d="M4 12.5l8 3.4 8-3.4" />
        <path d="M4 12.5V18l8 3.4 8-3.4v-5.5" />
    </svg>
);

/** Cargas — etiqueta de volume. */
export const IconTag: React.FC<OsIconProps> = ({ size = 22, className }) => (
    <svg {...base(size)} className={className}>
        <path d="M11.2 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6.2c0 .4.16.78.44 1.06l8.3 8.3a1.5 1.5 0 0 0 2.12 0l6.2-6.2a1.5 1.5 0 0 0 0-2.12l-8.3-8.3a1.5 1.5 0 0 0-1.06-.44Z" />
        <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
);

/** Viagens — cavalo + baú vistos da doca. */
export const IconTruck: React.FC<OsIconProps> = ({ size = 22, className }) => (
    <svg {...base(size)} className={className}>
        <path d="M2.8 6.5h11v9h-11zM13.8 9.5h3.6l3 3v3h-6.6" />
        <circle cx="7" cy="17.8" r="1.9" />
        <circle cx="17.2" cy="17.8" r="1.9" />
    </svg>
);

export const IconCheck: React.FC<OsIconProps> = ({ size = 20, className }) => (
    <svg {...base(size)} className={className}>
        <path d="M4.5 12.8l4.6 4.6L19.5 7" />
    </svg>
);

export const IconAlert: React.FC<OsIconProps> = ({ size = 20, className }) => (
    <svg {...base(size)} className={className}>
        <path d="M12 3.6 2.8 19.4h18.4L12 3.6Z" />
        <path d="M12 10v4.4" />
        <circle cx="12" cy="17" r="0.4" fill="currentColor" stroke="none" />
    </svg>
);

export const IconX: React.FC<OsIconProps> = ({ size = 20, className }) => (
    <svg {...base(size)} className={className}>
        <path d="M6 6l12 12M18 6L6 18" />
    </svg>
);

export const IconChevron: React.FC<OsIconProps> = ({ size = 20, className }) => (
    <svg {...base(size)} className={className}>
        <path d="M9 5.5 15.5 12 9 18.5" />
    </svg>
);

/** Torre — supervisão (modo admin). */
export const IconTower: React.FC<OsIconProps> = ({ size = 18, className }) => (
    <svg {...base(size)} className={className}>
        <path d="M8 21h8M12 21v-4M6.5 7.5 12 3l5.5 4.5M7.5 7.5h9l-1.2 9.5h-6.6L7.5 7.5Z" />
    </svg>
);
