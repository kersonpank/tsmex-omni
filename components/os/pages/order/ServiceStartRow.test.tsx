import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ordersApi } from '../../../../lib/api';
import ServiceStartRow from './ServiceStartRow';
vi.mock('../../../../lib/api', () => ({ ordersApi: { getServiceStart: vi.fn(), setServiceStart: vi.fn() } }));
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(ordersApi.getServiceStart).mockResolvedValue({ data: { city: 'Guarulhos, SP', mode: 'HUB', allowed: true } } as never);
    vi.mocked(ordersApi.setServiceStart).mockResolvedValue({ data: { city: 'Guaramirim, SC', mode: 'REMETENTE', allowed: true } } as never);
});
it('mostra início e permite trocar para coleta sem sair do pedido', async () => {
    const changed = vi.fn().mockResolvedValue(undefined);
    render(<ServiceStartRow orderId="o1" onChanged={changed} />);
    expect(await screen.findByText('Início do serviço: Guarulhos/SP · entrada direta no hub')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alterar' }));
    await user.click(screen.getByRole('button', { name: 'Na cidade do remetente (houve coleta)' }));
    expect(ordersApi.setServiceStart).toHaveBeenCalledWith('o1', 'REMETENTE');
    expect(await screen.findByText('Início do serviço: Guaramirim/SC · coletado no remetente')).toBeInTheDocument();
    expect(changed).toHaveBeenCalledOnce();
});
it('envia HUB ao escolher chegada direta', async () => {
    render(<ServiceStartRow orderId="o1" onChanged={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Alterar' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Neste hub (chegou direto)' }));
    expect(ordersApi.setServiceStart).toHaveBeenCalledWith('o1', 'HUB');
});
it('oculta alteração quando CT-e está autorizado ou em voo', async () => {
    vi.mocked(ordersApi.getServiceStart).mockResolvedValue({ data: { city: 'Guarulhos, SP', mode: 'HUB', allowed: false } } as never);
    render(<ServiceStartRow orderId="o1" onChanged={vi.fn()} />);
    await screen.findByText(/Início do serviço/);
    expect(screen.queryByRole('button', { name: 'Alterar' })).not.toBeInTheDocument();
});
it('preserva o início e mostra erro quando o servidor recusa alteração', async () => {
    vi.mocked(ordersApi.setServiceStart).mockRejectedValue({ response: { data: { error: 'CT-e em envio.' } } });
    render(<ServiceStartRow orderId="o1" onChanged={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Alterar' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Neste hub (chegou direto)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('CT-e em envio.');
    expect(screen.getByText(/Guarulhos\/SP/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled());
});
