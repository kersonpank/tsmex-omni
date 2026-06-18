import {
  adminStateToSearchParams,
  normalizeGestaoNavAfterMerge,
  parseAdminSearchParams,
  type AdminNavState,
} from './adminQuery';

export interface AdminNavSection {
  title: string;
  items: {
    id: string;
    label: string;
    active: boolean;
    onSelect: () => void;
  }[];
}

export function mergeNavState(current: AdminNavState, patch: Partial<AdminNavState>): AdminNavState {
  return { ...current, ...patch };
}

type BuildParams = {
  navState: AdminNavState;
  isHub: boolean;
  hasPermission: (p: string) => boolean;
  onSelectNav: (patch: Partial<AdminNavState>) => void;
  /** Ex.: abrir detalhe de pedido: destacar "Pedidos" */
  onOrderDetailPage?: boolean;
};

export function buildAdminNavSections({
  navState,
  isHub,
  hasPermission,
  onSelectNav,
  onOrderDetailPage = false,
}: BuildParams): AdminNavSection[] {
  const { category, transportSubTab, commercialSubTab, generalSubTab } = navState;
  const go = (patch: Partial<AdminNavState>) => () => {
    onSelectNav(patch);
  };

  if (isHub) {
    const items: AdminNavSection['items'] = [];
    if (hasPermission('entrada')) {
      items.push({
        id: 'entrada',
        label: 'Entrada',
        active: !onOrderDetailPage && transportSubTab === 'entrada',
        onSelect: go({ category: 'transport', transportSubTab: 'entrada', entradaOrderId: null }),
      });
    }
    if (hasPermission('demandas')) {
      items.push({
        id: 'demands',
        label: 'Demandas',
        active: !onOrderDetailPage && transportSubTab === 'demands',
        onSelect: go({ category: 'transport', transportSubTab: 'demands' }),
      });
    }
    if (hasPermission('manifestos')) {
      items.push({
        id: 'viagens',
        label: 'Viagens',
        active: !onOrderDetailPage && transportSubTab === 'viagens',
        onSelect: go({ category: 'transport', transportSubTab: 'viagens' }),
      });
    }
    if (hasPermission('pedidos')) {
      items.push({
        id: 'pedidos',
        label: 'Pedidos',
        active: onOrderDetailPage || transportSubTab === 'pedidos',
        onSelect: go({ category: 'transport', transportSubTab: 'pedidos' }),
      });
    }
    return [{ title: 'Operação', items }];
  }

  return [
    {
      title: 'Comercial',
      items: [
        { id: 'co', label: 'Cotações', active: category === 'commercial' && commercialSubTab === 'cotacoes', onSelect: go({ category: 'commercial', commercialSubTab: 'cotacoes' }) },
        { id: 'cl', label: 'Clientes', active: category === 'commercial' && commercialSubTab === 'clientes', onSelect: go({ category: 'commercial', commercialSubTab: 'clientes' }) },
        { id: 'ta', label: 'Tarifas', active: category === 'commercial' && commercialSubTab === 'tarifas', onSelect: go({ category: 'commercial', commercialSubTab: 'tarifas' }) },
      ],
    },
    {
      title: 'Rede',
      items: [
        { id: 'en', label: 'Entrada', active: !onOrderDetailPage && category === 'transport' && transportSubTab === 'entrada', onSelect: go({ category: 'transport', transportSubTab: 'entrada', entradaOrderId: null }) },
        { id: 'de', label: 'Demandas', active: !onOrderDetailPage && category === 'transport' && transportSubTab === 'demands', onSelect: go({ category: 'transport', transportSubTab: 'demands' }) },
        { id: 'vi', label: 'Viagens', active: !onOrderDetailPage && category === 'transport' && transportSubTab === 'viagens', onSelect: go({ category: 'transport', transportSubTab: 'viagens' }) },
        { id: 'pe', label: 'Pedidos', active: onOrderDetailPage || (category === 'transport' && transportSubTab === 'pedidos'), onSelect: go({ category: 'transport', transportSubTab: 'pedidos' }) },
        { id: 'mo', label: 'Motoristas', active: !onOrderDetailPage && category === 'transport' && transportSubTab === 'motoristas', onSelect: go({ category: 'transport', transportSubTab: 'motoristas' }) },
        { id: 'ro', label: 'Rotas', active: !onOrderDetailPage && category === 'transport' && transportSubTab === 'rotas', onSelect: go({ category: 'transport', transportSubTab: 'rotas' }) },
        { id: 'hu', label: 'Hubs', active: !onOrderDetailPage && category === 'transport' && transportSubTab === 'hubs', onSelect: go({ category: 'transport', transportSubTab: 'hubs' }) },
      ],
    },
    { title: 'Cadastros', items: [{ id: 'pes', label: 'Pessoas', active: category === 'pessoas', onSelect: go({ category: 'pessoas' }) }] },
    { title: 'Frota', items: [{ id: 'fr', label: 'Tipos de veículo', active: category === 'fleet', onSelect: go({ category: 'fleet' }) }] },
    { title: 'Finanças', items: [{ id: 'fat', label: 'Faturas', active: category === 'finance', onSelect: go({ category: 'finance' }) }] },
    {
      title: 'Sistema',
      items: [{ id: 'cfg', label: 'Configurações', active: category === 'general', onSelect: go({ category: 'general', generalSubTab: 'settings' }) }],
    },
  ];
}

export function getNavStateForSystemMenu(
  searchParams: URLSearchParams,
  pathname: string,
  isHub: boolean,
  hasPermission: (p: string) => boolean
): AdminNavState {
  const base = parseAdminSearchParams(searchParams, isHub, hasPermission);
  if (pathname.startsWith('/orders/')) {
    if (isHub) {
      return { ...base, category: 'transport', transportSubTab: 'pedidos' };
    }
    return { ...base, category: 'transport', transportSubTab: 'pedidos' };
  }
  return base;
}

export function navigateToNavState(
  patch: Partial<AdminNavState>,
  current: AdminNavState,
  isHub: boolean,
  navigate: (to: string, opts?: { replace?: boolean }) => void
) {
  const next = normalizeGestaoNavAfterMerge(mergeNavState(current, patch), isHub);
  const sp = adminStateToSearchParams(next, isHub);
  const q = sp.toString();
  navigate(q ? `/gestao?${q}` : '/gestao');
}
