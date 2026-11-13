import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import './gestaos.css';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../hooks/useTheme';
import { useExceptions } from './lib/data';
import { clearResources, invalidate } from './lib/resource';
import { CommandPalette } from './ui/CommandPalette';
import { Glass } from './ui/kit';
import { LAYER_ID, ToastProvider } from './ui/overlay';
import {
    IconArrowUpRight,
    IconBox,
    IconChat,
    IconCoin,
    IconGear,
    IconLogout,
    IconMoon,
    IconNetwork,
    IconRefresh,
    IconSearch,
    IconSun,
    IconToday,
    IconTruck,
    IconUser,
    type IconProps,
} from './ui/icons';
import HojePage from './pages/HojePage';
import ViagensPage from './pages/ViagensPage';
import PedidosPage from './pages/PedidosPage';
import FinanceiroPage from './pages/FinanceiroPage';
import RedePage from './pages/RedePage';
import ComercialPage from './pages/ComercialPage';
import SistemaPage from './pages/SistemaPage';

/**
 * Gestão V2 (/gestaos) — a torre organizada pelo que a pessoa faz no dia, não por cadastro.
 * Duas vozes na tela: Autopilot (o que o sistema já resolveu) e Copilot (o que ele põe à mão
 * para a pessoa decidir). Módulo isolado: usa as mesmas APIs, não importa telas da gestão clássica.
 */

const NAV: Array<{ to: string; label: string; end?: boolean; Icon: React.FC<IconProps> }> = [
    { to: '/gestaos', label: 'Hoje', end: true, Icon: IconToday },
    { to: '/gestaos/viagens', label: 'Viagens', Icon: IconTruck },
    { to: '/gestaos/pedidos', label: 'Pedidos', Icon: IconBox },
    { to: '/gestaos/financeiro', label: 'Financeiro', Icon: IconCoin },
    { to: '/gestaos/rede', label: 'Rede', Icon: IconNetwork },
    { to: '/gestaos/comercial', label: 'Comercial', Icon: IconChat },
    { to: '/gestaos/sistema', label: 'Sistema', Icon: IconGear },
];

const UserMenu: React.FC = () => {
    const { user, logout } = useAuthStore();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button type="button" className="gx-icon-btn" aria-label="Conta" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <IconUser />
            </button>
            {open ? (
                <Glass strong float role="menu" className="gx-pop absolute right-0 top-[calc(100%+10px)] z-40 w-[264px] p-2" style={{ borderRadius: 18 }}>
                    <p className="gx-muted truncate px-3 pb-2 pt-1.5 text-[12.5px]">{user?.email}</p>
                    <Link role="menuitem" to="/hubs" className="gx-row flex items-center justify-between gap-3">
                        <span>Operação do hub</span>
                        <IconArrowUpRight size={15} className="gx-muted" />
                    </Link>
                    <Link role="menuitem" to="/gestao" className="gx-row flex items-center justify-between gap-3">
                        <span>Gestão clássica</span>
                        <IconArrowUpRight size={15} className="gx-muted" />
                    </Link>
                    <button role="menuitem" type="button" className="gx-row gx-red-text flex items-center justify-between gap-3" onClick={() => logout()}>
                        <span>Sair</span>
                        <IconLogout size={15} />
                    </button>
                </Glass>
            ) : null}
        </div>
    );
};

const Shell: React.FC = () => {
    const { isDark, toggleTheme } = useTheme();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const exceptions = useExceptions();
    const pending = exceptions.data?.counts.total ?? 0;

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setPaletteOpen((value) => !value);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const refreshAll = () => {
        setRefreshing(true);
        invalidate('');
        window.setTimeout(() => setRefreshing(false), 900);
    };

    return (
        <>
            <div className="sticky top-0 z-30 px-3 pt-3 sm:px-5">
                <Glass strong className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-2 gap-y-2 px-2.5 py-2" style={{ borderRadius: 20 }}>
                    <Link to="/gestaos" className="flex flex-none items-center gap-2.5 py-0.5 pl-1 pr-3" aria-label="Gestão — início">
                        <span
                            className="grid h-9 w-9 place-items-center rounded-[11px] text-[11px] font-extrabold tracking-[0.05em]"
                            style={{ background: 'var(--gx-royal)', color: 'var(--gx-on-royal)', boxShadow: 'inset 0 -3px 0 var(--gx-yellow)' }}
                        >
                            TSM
                        </span>
                        <span className="leading-none">
                            <span className="block text-[15px] font-bold tracking-[-0.01em]">Gestão</span>
                            <span className="gx-label mt-1 block text-[10px]">Torre de controle</span>
                        </span>
                    </Link>

                    <nav className="gx-no-scrollbar order-3 flex w-full min-w-0 gap-1 overflow-x-auto lg:order-none lg:w-auto lg:flex-1" aria-label="Áreas da torre">
                        {NAV.map(({ to, label, end, Icon }) => (
                            <NavLink key={to} to={to} end={end} className="gx-nav-link">
                                <Icon size={17} />
                                {label}
                                {end && pending > 0 ? (
                                    <span className="gx-mono rounded-full px-1.5 text-[11px] font-semibold" style={{ background: 'var(--gx-red)', color: '#fff' }}>
                                        {pending}
                                    </span>
                                ) : null}
                            </NavLink>
                        ))}
                    </nav>

                    <div className="ml-auto flex flex-none items-center gap-1">
                        <button type="button" className="gx-btn gx-btn-ghost gx-btn-sm" style={{ minHeight: 40 }} onClick={() => setPaletteOpen(true)}>
                            <IconSearch size={16} />
                            <span className="hidden sm:inline">Buscar</span>
                            <span className="gx-kbd hidden md:inline">Ctrl K</span>
                        </button>
                        <button type="button" className="gx-icon-btn" aria-label="Atualizar dados" title="Atualizar dados" onClick={refreshAll}>
                            <IconRefresh className={refreshing ? 'animate-spin' : undefined} />
                        </button>
                        <button type="button" className="gx-icon-btn" aria-label={isDark ? 'Usar tema claro' : 'Usar tema escuro'} title={isDark ? 'Tema claro' : 'Tema escuro'} onClick={toggleTheme}>
                            {isDark ? <IconSun /> : <IconMoon />}
                        </button>
                        <UserMenu />
                    </div>
                </Glass>
            </div>

            <main className="mx-auto max-w-[1480px] px-3 pb-24 pt-7 sm:px-5">
                <Routes>
                    <Route index element={<HojePage />} />
                    <Route path="viagens" element={<ViagensPage />} />
                    <Route path="pedidos" element={<PedidosPage />} />
                    <Route path="financeiro" element={<FinanceiroPage />} />
                    <Route path="rede" element={<RedePage />} />
                    <Route path="comercial" element={<ComercialPage />} />
                    <Route path="sistema" element={<SistemaPage />} />
                    <Route path="*" element={<Navigate to="/gestaos" replace />} />
                </Routes>
            </main>

            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </>
    );
};

const GestaosApp: React.FC = () => {
    // Ao sair da Gestão V2 (ou trocar de usuário) nada do cache fica para a próxima sessão.
    useEffect(() => () => clearResources(), []);

    return (
        <div className="gx">
            <ToastProvider>
                <Shell />
            </ToastProvider>
            <div id={LAYER_ID} />
        </div>
    );
};

export default GestaosApp;
