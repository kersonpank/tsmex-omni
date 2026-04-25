export type Category = 'pessoas' | 'transport' | 'commercial' | 'fleet' | 'finance' | 'general';
export type TransportSubTab = 'demands' | 'viagens' | 'pedidos' | 'motoristas' | 'rotas' | 'hubs' | 'entrada';
export type CommercialSubTab = 'cotacoes' | 'clientes' | 'tarifas';
export type GeneralSubTab = 'settings' | 'especies' | 'identidade';

const CATEGORIES: Category[] = ['pessoas', 'transport', 'commercial', 'fleet', 'finance', 'general'];
const TRANSPORT_SUBS: TransportSubTab[] = ['entrada', 'demands', 'viagens', 'pedidos', 'motoristas', 'rotas', 'hubs'];
const COMMERCIAL_SUBS: CommercialSubTab[] = ['cotacoes', 'clientes', 'tarifas'];
const GENERAL_SUBS: GeneralSubTab[] = ['settings', 'especies', 'identidade'];

export interface AdminNavState {
  category: Category;
  transportSubTab: TransportSubTab;
  commercialSubTab: CommercialSubTab;
  generalSubTab: GeneralSubTab;
}

const defaultState = (): AdminNavState => ({
  category: 'transport',
  transportSubTab: 'demands',
  commercialSubTab: 'cotacoes',
  generalSubTab: 'settings',
});

function isCategory(v: string | null): v is Category {
  return !!v && (CATEGORIES as string[]).includes(v);
}

function isTransportSub(v: string | null): v is TransportSubTab {
  return !!v && (TRANSPORT_SUBS as string[]).includes(v);
}

function isCommercialSub(v: string | null): v is CommercialSubTab {
  return !!v && (COMMERCIAL_SUBS as string[]).includes(v);
}

function isGeneralSub(v: string | null): v is GeneralSubTab {
  return !!v && (GENERAL_SUBS as string[]).includes(v);
}

/** Primeira sub-aba de transporte permitida para o hub */
export function defaultHubTransportSub(hasPermission: (p: string) => boolean): TransportSubTab {
  if (hasPermission('entrada')) return 'entrada';
  if (hasPermission('demandas')) return 'demands';
  if (hasPermission('manifestos')) return 'viagens';
  if (hasPermission('pedidos')) return 'pedidos';
  return 'demands';
}

export function parseAdminSearchParams(
  search: URLSearchParams,
  isHub: boolean,
  hasPermission: (p: string) => boolean
): AdminNavState {
  const out = defaultState();
  const catRaw = search.get('cat');
  const subRaw = search.get('sub');

  if (isHub) {
    out.category = 'transport';
    const allowed = new Set<TransportSubTab>();
    if (hasPermission('entrada')) allowed.add('entrada');
    if (hasPermission('demandas')) allowed.add('demands');
    if (hasPermission('manifestos')) allowed.add('viagens');
    if (hasPermission('pedidos')) allowed.add('pedidos');
    const fallback = defaultHubTransportSub(hasPermission);
    const wanted = isTransportSub(subRaw) ? subRaw : fallback;
    out.transportSubTab = allowed.has(wanted) ? wanted : fallback;
    return out;
  }

  if (isCategory(catRaw)) out.category = catRaw;
  else out.category = 'transport';

  if (out.category === 'transport') {
    out.transportSubTab = isTransportSub(subRaw) ? subRaw : 'demands';
  } else if (out.category === 'commercial') {
    out.commercialSubTab = isCommercialSub(subRaw) ? subRaw : 'cotacoes';
  } else if (out.category === 'general') {
    out.generalSubTab = isGeneralSub(subRaw) ? subRaw : 'settings';
  }

  return out;
}

export function adminStateToSearchParams(state: AdminNavState, isHub: boolean): URLSearchParams {
  const sp = new URLSearchParams();
  if (isHub) {
    sp.set('cat', 'transport');
    sp.set('sub', state.transportSubTab);
    return sp;
  }
  sp.set('cat', state.category);
  if (state.category === 'transport') sp.set('sub', state.transportSubTab);
  else if (state.category === 'commercial') sp.set('sub', state.commercialSubTab);
  else if (state.category === 'general') sp.set('sub', state.generalSubTab);
  else {
    sp.delete('sub');
  }
  return sp;
}

export function getAdminBreadcrumbs(state: AdminNavState, isHub: boolean): { label: string }[] {
  if (isHub) {
    const transportLabel =
      state.transportSubTab === 'entrada'
        ? 'Entrada'
        : state.transportSubTab === 'demands'
          ? 'Demandas'
          : state.transportSubTab === 'viagens'
            ? 'Viagens'
            : state.transportSubTab === 'pedidos'
              ? 'Pedidos'
              : state.transportSubTab;
    return [{ label: 'Operação' }, { label: transportLabel }];
  }

  const catLabels: Record<Category, string> = {
    pessoas: 'Pessoas',
    transport: 'Transporte',
    commercial: 'Comercial',
    fleet: 'Frota',
    finance: 'Finanças',
    general: 'Sistema',
  };
  const crumbs: { label: string }[] = [{ label: 'Torre de controle' }, { label: catLabels[state.category] }];

  if (state.category === 'transport') {
    const subLabels: Record<TransportSubTab, string> = {
      entrada: 'Entrada',
      demands: 'Demandas',
      viagens: 'Viagens',
      pedidos: 'Pedidos',
      motoristas: 'Motoristas',
      rotas: 'Rotas',
      hubs: 'Hubs',
    };
    crumbs.push({ label: subLabels[state.transportSubTab] });
  } else if (state.category === 'commercial') {
    const subLabels: Record<CommercialSubTab, string> = {
      cotacoes: 'Cotações / Oportunidades',
      clientes: 'Clientes',
      tarifas: 'Tarifas',
    };
    crumbs.push({ label: subLabels[state.commercialSubTab] });
  } else if (state.category === 'general') {
    const subLabels: Record<GeneralSubTab, string> = {
      settings: 'LLM',
      especies: 'Espécies NF',
      identidade: 'Emitentes Fiscais',
    };
    crumbs.push({ label: 'Configurações' }, { label: subLabels[state.generalSubTab] });
  }

  return crumbs;
}

export function getAdminPageTitle(state: AdminNavState, isHub: boolean): { title: string; subtitle: string } {
  if (isHub) {
    const hubTitles: Partial<Record<TransportSubTab, { title: string; subtitle: string }>> = {
      entrada: { title: 'Entrada de mercadoria', subtitle: 'Registre NF, origem e destino no depósito.' },
      demands: { title: 'Demandas', subtitle: 'Demandas ligadas ao seu hub.' },
      viagens: { title: 'Viagens', subtitle: 'Manifestos e consolidação no seu CD.' },
      pedidos: { title: 'Pedidos', subtitle: 'Pedidos sob triagem ou roteamento local.' },
    };
    return hubTitles[state.transportSubTab] ?? { title: 'Operação do depósito', subtitle: 'Painel operacional do hub.' };
  }

  if (state.category === 'pessoas') return { title: 'Pessoas', subtitle: 'Cadastro e vínculos de CPF/CNPJ com clientes, links e hubs.' };
  if (state.category === 'fleet') return { title: 'Frota', subtitle: 'Tipos de veículo disponíveis para manifestos.' };
  if (state.category === 'finance') return { title: 'Finanças', subtitle: 'Faturas e faturamento.' };

  if (state.category === 'commercial') {
    const m: Record<CommercialSubTab, { title: string; subtitle: string }> = {
      cotacoes: { title: 'Cotações', subtitle: 'Pipeline de oportunidades e conversão em demanda.' },
      clientes: { title: 'Clientes', subtitle: 'Contas embarcadoras cadastradas.' },
      tarifas: { title: 'Tarifas', subtitle: 'Tabelas de preço e rotas vinculadas.' },
    };
    return m[state.commercialSubTab];
  }

  if (state.category === 'general') {
    const m: Record<GeneralSubTab, { title: string; subtitle: string }> = {
      settings: { title: 'LLM', subtitle: 'Provedores, modelos e chaves para agentes.' },
      especies: { title: 'Espécies NF', subtitle: 'Cadastro auxiliar de espécies de nota fiscal.' },
      identidade: { title: 'Emitentes Fiscais', subtitle: 'CNPJs emissores, certificado A1 e dados para DACTE, Minuta e homologação.' },
    };
    return m[state.generalSubTab];
  }

  if (state.category === 'transport') {
    const m: Record<TransportSubTab, { title: string; subtitle: string }> = {
      entrada: { title: 'Entrada', subtitle: 'Registro de mercadoria recebida no hub.' },
      demands: { title: 'Demandas', subtitle: 'Monitore, cote e avance o ciclo de cada demanda.' },
      viagens: { title: 'Viagens', subtitle: 'Manifestos, consolidação e ofertas a motoristas.' },
      pedidos: { title: 'Pedidos', subtitle: 'Pedidos físicos e status na rede.' },
      motoristas: { title: 'Motoristas', subtitle: 'Links, aprovação e suspensão.' },
      rotas: { title: 'Rotas', subtitle: 'Rotas de precificação e tarifas.' },
      hubs: { title: 'Hubs', subtitle: 'CDs, filiais e cadastro de depósitos.' },
    };
    return m[state.transportSubTab];
  }

  return { title: 'Torre de controle', subtitle: 'Orquestração da rede TSM.' };
}
