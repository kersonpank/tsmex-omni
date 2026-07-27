import React, { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import GestaoActionBar from './GestaoActionBar';
import {
  GestaoModuleActionsProvider,
  useGestaoModuleActions,
  useRegisterGestaoModuleActions,
  type ModuleActionConfig,
} from './GestaoModuleActionsContext';

function ActionBarHarness({ config }: { config: ModuleActionConfig }) {
  const { setConfig } = useGestaoModuleActions();
  useEffect(() => {
    setConfig(config);
    return () => setConfig(null);
  }, [config, setConfig]);
  return <GestaoActionBar />;
}

function RegisterOutsideProvider() {
  useRegisterGestaoModuleActions(() => ({ onNew: vi.fn() }), []);
  return <p>ok</p>;
}

describe('GestaoModuleActionsContext', () => {
  it('useRegisterGestaoModuleActions fora do provider não lança', () => {
    expect(() => render(<RegisterOutsideProvider />)).not.toThrow();
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});

describe('GestaoActionBar', () => {
  it('dispara onList ao clicar no botão de listagem', async () => {
    const user = userEvent.setup();
    const onList = vi.fn();
    render(
      <GestaoModuleActionsProvider>
        <ActionBarHarness
          config={{
            onList,
            onFilterToggle: vi.fn(),
            listActive: true,
          }}
        />
      </GestaoModuleActionsProvider>
    );
    const listBtn = screen.getByRole('button', { name: /Listagem/i });
    await user.click(listBtn);
    expect(onList).toHaveBeenCalledTimes(1);
  });

  it('mantém Filtro, Editar e Novo focáveis em sequência (Tab)', async () => {
    const user = userEvent.setup();
    render(
      <GestaoModuleActionsProvider>
        <ActionBarHarness
          config={{
            onList: vi.fn(),
            onFilterToggle: vi.fn(),
            onEdit: vi.fn(),
            onNew: vi.fn(),
            listActive: true,
          }}
        />
      </GestaoModuleActionsProvider>
    );
    const toolbars = screen.getAllByRole('toolbar', { name: /Ações do módulo/i });
    expect(toolbars).toHaveLength(1);
    const buttons = toolbars[0].querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.tab();
    expect(buttons[1]).toHaveFocus();
    await user.tab();
    expect(buttons[2]).toHaveFocus();
    await user.tab();
    expect(buttons[3]).toHaveFocus();
  });

  it('não dispara Editar quando desabilitado', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <GestaoModuleActionsProvider>
        <ActionBarHarness
          config={{
            onList: vi.fn(),
            onFilterToggle: vi.fn(),
            onEdit,
            disabled: { edit: true },
            labels: { edit: 'Edição indisponível' },
          }}
        />
      </GestaoModuleActionsProvider>
    );
    const editBtn = screen.getByRole('button', { name: /Edição indisponível/i });
    expect(editBtn).toBeDisabled();
    await user.click(editBtn);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('exibe a ação Novo com texto quando ela inicia um fluxo principal', () => {
    render(
      <GestaoModuleActionsProvider>
        <ActionBarHarness
          config={{
            onNew: vi.fn(),
            prominentNew: true,
            labels: { new: 'Nova viagem' },
          }}
        />
      </GestaoModuleActionsProvider>
    );

    expect(screen.getByRole('button', { name: 'Nova viagem' })).toHaveTextContent('Nova viagem');
  });
});
