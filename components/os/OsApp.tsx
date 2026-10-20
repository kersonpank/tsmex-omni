import React from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { OsProvider, useOs } from './OsContext';
import TodayPage from './pages/TodayPage';
import ReceivePage from './pages/ReceivePage';
import TripReceivePage from './pages/TripReceivePage';
import CargoPage from './pages/CargoPage';
import LabelsPrintPage from './pages/LabelsPrintPage';
import { OsEmpty, OsRow, OsSectionTitle } from './ui/kit';
import { IconDay, IconReceive, IconTag, IconTower, IconTruck, type OsIconProps } from './ui/icons';

/**
 * TSM O.S. — superfície operacional do hub (rota /hubs).
 * Organização por estação de trabalho (ver kersonpank/ex → RODA-OPERACIONAL.md),
 * não por entidade. Módulo isolado: nada aqui importa componentes do app legado.
 */

const TABS: Array<{ to: string; label: string; end: boolean; Icon: React.FC<OsIconProps> }> = [
    { to: '/hubs', label: 'Hoje', end: true, Icon: IconDay },
    { to: '/hubs/receber', label: 'Receber', end: false, Icon: IconReceive },
    { to: '/hubs/cargas', label: 'Cargas', end: false, Icon: IconTag },
    { to: '/hubs/viagens', label: 'Viagens', end: false, Icon: IconTruck },
];

const StubPage: React.FC<{ title: string; slice: string }> = ({ title, slice }) => (
    <div className="pt-1">
        <OsSectionTitle>{title}</OsSectionTitle>
        <OsEmpty title="Em construção" detail={`Esta estação chega na ${slice} do TSM O.S.`} />
    </div>
);

const HubPicker: React.FC = () => {
    const { hubs, selectHub } = useOs();
    return (
        <div className="pt-1">
            <OsSectionTitle>Escolha o hub para operar</OsSectionTitle>
            <div className="flex flex-col gap-2.5">
                {hubs.map((h) => (
                    <OsRow key={h.id} tone="route" onClick={() => selectHub(h.id)}>
                        <p className="truncate font-semibold text-tower-900 dark:text-white">{h.name}</p>
                        <p className="text-[13px] text-tower-500 dark:text-tower-400">
                            <span className="font-mono text-[12px]">{h.code}</span> · {h.city}/{h.state}
                        </p>
                    </OsRow>
                ))}
                {hubs.length === 0 ? <OsEmpty title="Carregando hubs…" /> : null}
            </div>
        </div>
    );
};

const OsShell: React.FC = () => {
    const { hubId, hub, isAdmin } = useOs();
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-tower-50 text-tower-900 dark:bg-tower-950 dark:text-white">
            <header className="sticky top-0 z-40 border-b border-tower-200 bg-white/95 backdrop-blur dark:border-tower-800 dark:bg-tower-900/95">
                <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-2.5">
                    <button type="button" onClick={() => navigate('/hubs')} className="flex items-center gap-2.5 text-left">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 font-display text-[13px] font-extrabold tracking-tight text-white dark:bg-brand-400 dark:text-brand-950">
                            OS
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate font-display text-[15px] font-bold leading-tight">
                                {hub?.name ?? 'TSM O.S.'}
                            </span>
                            <span className="block text-[11px] leading-tight text-tower-400">
                                {hub ? (
                                    <>
                                        <span className="font-mono">{hub.code}</span> · operação do hub
                                    </>
                                ) : (
                                    'operação do hub'
                                )}
                            </span>
                        </span>
                    </button>
                    {isAdmin ? (
                        <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-bold text-brand-600 dark:bg-brand-500/20 dark:text-brand-300">
                            <IconTower />
                            torre
                        </span>
                    ) : null}
                </div>
            </header>

            <main className="mx-auto max-w-xl px-4 pb-28 pt-2">
                {!hubId && isAdmin ? (
                    <HubPicker />
                ) : (
                    <Routes>
                        <Route index element={<TodayPage />} />
                        <Route path="receber" element={<ReceivePage />} />
                        <Route path="receber/:manifestId" element={<TripReceivePage />} />
                        <Route path="cargas" element={<CargoPage />} />
                        <Route path="etiquetas/:orderId" element={<LabelsPrintPage />} />
                        <Route path="viagens" element={<StubPage title="Viagens" slice="Fatia 3" />} />
                        <Route path="excecoes" element={<StubPage title="Exceções" slice="Fatia 4" />} />
                    </Routes>
                )}
            </main>

            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-tower-200 bg-white pb-[max(env(safe-area-inset-bottom),4px)] dark:border-tower-800 dark:bg-tower-900">
                <div className="mx-auto grid max-w-xl grid-cols-4">
                    {TABS.map(({ to, label, end, Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={end}
                            className={({ isActive }) =>
                                clsx(
                                    'relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-bold focus-visible:outline-2 focus-visible:outline-brand-500',
                                    isActive ? 'text-tower-900 dark:text-white' : 'text-tower-400 dark:text-tower-500',
                                )
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    {/* Eco da faixa: só a aba ativa carrega o amarelo. */}
                                    <span
                                        className={clsx(
                                            'absolute left-1/2 top-0 h-[3px] w-9 -translate-x-1/2 rounded-b',
                                            isActive ? 'bg-brand-yellow-400' : 'bg-transparent',
                                        )}
                                    />
                                    <Icon />
                                    {label}
                                </>
                            )}
                        </NavLink>
                    ))}
                </div>
            </nav>
        </div>
    );
};

const OsApp: React.FC = () => (
    <OsProvider>
        <OsShell />
    </OsProvider>
);

export default OsApp;
