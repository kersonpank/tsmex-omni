import React from 'react';

const iconClass = 'h-6 w-6 shrink-0';

export const HubNavIconHome: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`${iconClass} ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
  </svg>
);

export const HubNavIconPlus: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`${iconClass} ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8.25v7.5M8.25 12h7.5" />
  </svg>
);

export const HubNavIconOrders: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`${iconClass} ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4" />
    <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2v0Z" />
    <path d="M9 12h6M9 16h4" />
  </svg>
);

export const HubNavIconManifest: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`${iconClass} ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 18V8a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8h2.5" />
    <path d="M14 12h2.5l3.5 3.5V18h-2" />
    <circle cx="6.5" cy="18.5" r="1.75" />
    <circle cx="17.5" cy="18.5" r="1.75" />
  </svg>
);
