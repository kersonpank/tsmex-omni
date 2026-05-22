import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type GestaoActionKey = 'list' | 'filter' | 'edit' | 'new';

export interface GestaoFilterPill {
  id: string;
  label: string;
  onRemove?: () => void;
}

/**
 * Registrado pela aba ativa da Torre. O GestaoActionBar consome e dispara os handlers.
 * Limpeza no unmount evita vazar ações entre trocas de rota.
 */
export interface ModuleActionConfig {
  onList?: () => void;
  onFilterToggle?: () => void;
  onEdit?: () => void;
  onNew?: () => void;
  /** Ex.: modo tabela ativo em Cotações */
  listActive?: boolean;
  filterOpen?: boolean;
  filterCount?: number;
  pills?: GestaoFilterPill[];
  hidden?: Partial<Record<GestaoActionKey, boolean>>;
  disabled?: Partial<Record<GestaoActionKey, boolean>>;
  labels?: Partial<Record<GestaoActionKey, string>>;
}

type GestaoModuleActionsCtx = {
  config: ModuleActionConfig | null;
  setConfig: (c: ModuleActionConfig | null) => void;
};

const GestaoModuleActionsContext = createContext<GestaoModuleActionsCtx | null>(null);

export function GestaoModuleActionsProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<ModuleActionConfig | null>(null);
  const setConfig = useCallback((c: ModuleActionConfig | null) => {
    setConfigState(c);
  }, []);
  const value = useMemo(() => ({ config, setConfig }), [config, setConfig]);
  return (
    <GestaoModuleActionsContext.Provider value={value}>
      {children}
    </GestaoModuleActionsContext.Provider>
  );
}

export function useGestaoModuleActions(): GestaoModuleActionsCtx {
  const v = useContext(GestaoModuleActionsContext);
  if (!v) {
    throw new Error('useGestaoModuleActions deve ser usado dentro de GestaoModuleActionsProvider');
  }
  return v;
}

export function useOptionalGestaoModuleActions(): GestaoModuleActionsCtx | null {
  return useContext(GestaoModuleActionsContext);
}

/**
 * Registra ações do módulo atual. `build` deve ser estável (ex.: useMemo) ou deps devem incluir
 * todos os valores lidos dentro de build para evitar closures obsoletas.
 */
export function useRegisterGestaoModuleActions(
  build: () => ModuleActionConfig | null,
  deps: React.DependencyList
): void {
  const ctx = useOptionalGestaoModuleActions();
  useEffect(() => {
    if (!ctx) return;
    ctx.setConfig(build());
    return () => ctx.setConfig(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps controlam quando re-registrar
  }, deps);
}
