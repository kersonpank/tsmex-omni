import React from 'react';

/** Ícones da Gestão V2: traço fino (1.75), sem preenchimento, herdam a cor do texto. Sem emoji, sem biblioteca. */

export type IconProps = { size?: number; className?: string };

const svg = (size: number, className: string | undefined, children: React.ReactNode) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
    >
        {children}
    </svg>
);

const make = (children: React.ReactNode): React.FC<IconProps> => ({ size = 18, className }) => svg(size, className, children);

export const IconToday = make(<><rect x="3.5" y="3.5" width="7" height="9" rx="2" /><rect x="13.5" y="3.5" width="7" height="5" rx="2" /><rect x="13.5" y="11.5" width="7" height="9" rx="2" /><rect x="3.5" y="15.5" width="7" height="5" rx="2" /></>);
export const IconTruck = make(<><path d="M2.5 6.5h11v10h-11z" /><path d="M13.5 10h4l3 3.2v3.3h-7" /><circle cx="7" cy="17.5" r="1.9" /><circle cx="17" cy="17.5" r="1.9" /></>);
export const IconBox = make(<><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" /><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" /></>);
export const IconCoin = make(<><circle cx="12" cy="12" r="8.5" /><path d="M14.6 9.3c-.5-.9-1.5-1.4-2.6-1.4-1.6 0-2.8.9-2.8 2.1 0 2.9 5.6 1.3 5.6 4.1 0 1.200-1.200 2.100-2.800 2.100-1.200 0-2.300-.600-2.800-1.500M12 6.200v1.700M12 16.200v1.600" /></>);
export const IconNetwork = make(<><circle cx="5" cy="6" r="2.2" /><circle cx="19" cy="6" r="2.2" /><circle cx="12" cy="18" r="2.2" /><path d="M7.200 6h9.600M6.200 7.900l4.700 8.200M17.800 7.900l-4.700 8.200" /></>);
export const IconChat = make(<><path d="M4 5.500h16v10.500H10l-4.500 3.500V16H4z" /><path d="M8 9.500h8M8 12.500h5" /></>);
export const IconGear = make(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2.200M12 18.800V21M3 12h2.200M18.800 12H21M5.600 5.600l1.600 1.600M16.800 16.800l1.600 1.600M18.400 5.600l-1.600 1.600M7.200 16.800l-1.600 1.600" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.500" /><path d="m16 16 4.500 4.500" /></>);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M18.400 5.600 17 7M7 17l-1.400 1.400" /></>);
export const IconMoon = make(<path d="M20 14.500A8.500 8.500 0 0 1 9.500 4a8.500 8.500 0 1 0 10.500 10.500z" />);
export const IconRefresh = make(<><path d="M20 12a8 8 0 0 1-14.300 4.900M4 12a8 8 0 0 1 14.300-4.900" /><path d="M18.500 3.500v3.800h-3.800M5.500 20.500v-3.800h3.800" /></>);
export const IconArrowRight = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconArrowUpRight = make(<path d="M7 17 17 7M9 7h8v8" />);
export const IconCheck = make(<path d="m5 12.500 4.500 4.500L19 7.500" />);
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconAlert = make(<><path d="M12 4 2.800 19.500h18.400z" /><path d="M12 10v4.500M12 17.200v.100" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="8.500" /><path d="M12 7.500V12l3 2" /></>);
export const IconBolt = make(<path d="M13 3 5 13.500h6L10 21l8-10.500h-6z" />);
export const IconCompass = make(<><circle cx="12" cy="12" r="8.500" /><path d="m15.500 8.500-2 5-5 2 2-5z" /></>);
export const IconHand = make(<><path d="M8 11.500V6a1.500 1.500 0 0 1 3 0v5M11 11V4.500a1.500 1.500 0 0 1 3 0V11M14 11V6a1.500 1.500 0 0 1 3 0v8.500a6 6 0 0 1-6 6h-.500a5 5 0 0 1-4.200-2.300L4 14.500a1.400 1.400 0 0 1 2.300-1.600L8 15" /></>);
export const IconDoc = make(<><path d="M6.500 3.500h8l3.500 3.500v13.500h-11.500z" /><path d="M14 3.500V7.500h4M9 12h6M9 15.500h6" /></>);
export const IconUser = make(<><circle cx="12" cy="8.500" r="3.500" /><path d="M5 20c.600-3.500 3.400-5.500 7-5.500s6.400 2 7 5.500" /></>);
export const IconChevronDown = make(<path d="m6 9.500 6 6 6-6" />);
export const IconChevronRight = make(<path d="m9.500 6 6 6-6 6" />);
export const IconFilter = make(<path d="M4 6h16M7 12h10M10 18h4" />);
export const IconHub = make(<><path d="M4 20.500V9.500l8-5 8 5v11" /><path d="M9 20.500v-6h6v6M4 20.500h16" /></>);
export const IconLogout = make(<><path d="M10 4.500H5.500v15H10" /><path d="M9.500 12H20M16 8l4 4-4 4" /></>);
export const IconPin = make(<><path d="M12 21s6.500-6 6.500-11a6.500 6.500 0 0 0-13 0c0 5 6.500 11 6.500 11z" /><circle cx="12" cy="10" r="2.300" /></>);
export const IconReceipt = make(<><path d="M6 3.500h12v17l-3-2-3 2-3-2-3 2z" /><path d="M9 8.500h6M9 12h6" /></>);
