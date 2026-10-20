import React from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { OsProvider, useOs } from './OsContext';
import TodayPage from './pages/TodayPage';
import ReceivePage from './pages/ReceivePage';
import TripReceivePage from './pages/TripReceivePage';
import { OsCard, OsEmpty, OsSectionTitle } from './ui/kit';

/**
 * TSM O.S. — superfície operacional do hub (rota /hubs).
 * Organização por estação de trabalho (ver kersonpank/ex → RODA-OPERACIONAL.md),
 * não por entidade. Módulo isolado: nada aqui importa componentes do app legado.
 */

const TABS = [
    { to: '/hubs', label: 'Hoje', end: true, icon: '☀️' },
    { to: '/hubs/receber', label: 'Receber', end: false, icon: '📦' },
    { to: '/hubs/cargas', label: 'Cargas', end: false, icon: '🏷️' },
    { to: '/hubs/viagens', label: 'Viagens', end: false, icon: '🚚' },
];

const StubPage: React.FC<{ title: string; slice: string }> = ({ title, slice }) => (
    <div className="pt-2">
        <OsSectionTitle>{title}</OsSectionTitle>
        <OsEmpty title="Em construção" detail={`Esta estação chega na ${slice} do TSM O.S.`} />
    </div>
);

const HubPicker: React.FC = () => {
    const { hubs, selectHub } = useOs();
    return (
        <div className="pt-2">
            <OsSectionTitle>Escolha o hub para operar</OsSectionTitle>
            <div className="flex flex-col gap-3">
                {hubs.map((hub) => (
                    <OsCard key={hub.id} onClick={() => selectHub(hub.id)}>
                        <p className="font-semibold text-tower-900 dark:text-white">{hub.name}</p>
                        <p className="text-sm text-tower-500 dark:text-tower-300">
                            {hub.code} · {hub.city}/{hub.state}
                        </p>
                    </OsCard>
                ))}
                {hubs.length === 0 ? <OsEmpty title="Carregando hubs…" /> : null}
            </div>
        </div>
    );
};

const OsShell: React.FC = () => {
    const { hubId, isAdmin } = useOs();
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-tower-50 text-tower-900 dark:bg-tower-950 dark:text-white">
            <header className="sticky top-0 z-40 border-b border-tower-200 bg-white/90 backdrop-blur dark:border-tower-800 dark:bg-tower-900/90">
                <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
                    <button type="button" onClick={() => navigate('/hubs')} className="text-left">
                        <p className="font-display text-lg font-bold leading-none">TSM O.S.</p>
                        <p className="text-[11px] text-tower-400">operação do hub</p>
                    </button>
                    {isAdmin ? (
                        <span className="rounded-full bg-tower-100 px-2.5 py-1 text-[11px] font-semibold text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                            modo torre
                        </span>
                    ) : null}
                </div>
            </header>

            <main className="mx-auto max-w-xl px-4 pb-24 pt-2">
                {!hubId && isAdmin ? (
                    <HubPicker />
                ) : (
                    <Routes>
                        <Route index element={<TodayPage />} />
                        <Route path="receber" element={<ReceivePage />} />
                        <Route path="receber/:manifestId" element={<TripReceivePage />} />
                        <Route path="cargas" element={<StubPage title="Cargas" slice="Fatia 2" />} />
                        <Route path="viagens" element={<StubPage title="Viagens" slice="Fatia 3" />} />
                        <Route path="excecoes" element={<StubPage title="Exceções" slice="Fatia 4" />} />
                    </Routes>
                )}
            </main>

            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-tower-200 bg-white pb-[max(env(safe-area-inset-bottom),4px)] dark:border-tower-800 dark:bg-tower-900">
                <div className="mx-auto grid max-w-xl grid-cols-4">
                    {TABS.map((tab) => (
                        <NavLink
                            key={tab.to}
                            to={tab.to}
                            end={tab.end}
                            className={({ isActive }) =>
                                clsx(
                                    'flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold',
                                    isActive
                                        ? 'text-accent-600 dark:text-accent-400'
                                        : 'text-tower-400 dark:text-tower-500',
                                )
                            }
                        >
                            <span aria-hidden className="text-lg leading-none">
                                {tab.icon}
                            </span>
                            {tab.label}
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
