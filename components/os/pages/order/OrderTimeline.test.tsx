import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrderTimeline from './OrderTimeline';

const { ordersApi } = vi.hoisted(() => ({ ordersApi: { timeline: vi.fn() } }));
vi.mock('../../../../lib/api', () => ({ ordersApi }));

describe('OrderTimeline', () => {
    beforeEach(() => vi.clearAllMocks());

    it('mostra onde está, a ocorrência destacada com autor e a ordem do mais recente ao mais antigo', async () => {
        ordersApi.timeline.mockResolvedValue({
            data: {
                order: { id: 'o', status: 'AT_HUB', enteredAtHubAt: new Date(2026, 10, 11, 9, 0).toISOString(), currentHub: { id: 'h', name: 'Hub B' }, orderNumber: 7, origin: 'A', destination: 'B' },
                history: [
                    { id: '2', eventType: 'NOTE', description: '[AVARIA NA CHEGADA] chegou com avaria em Hub B (viagem 1a2b3c4d) — caixa amassada', location: 'Hub B', photoUrl: null, createdAt: new Date(2026, 10, 11, 9, 0).toISOString(), actorName: 'Maria' },
                    { id: '1', eventType: 'IN_TRANSIT', description: 'Em trânsito', location: 'Hub A', photoUrl: null, createdAt: new Date(2026, 10, 10, 8, 0).toISOString(), actorName: null },
                ],
                legs: [],
                attempts: [],
            },
        });
        render(<OrderTimeline orderId="o" />);
        expect(await screen.findByText('Em estoque no Hub B desde 11/11/2026 09:00')).toBeInTheDocument();
        const items = screen.getAllByRole('listitem');
        expect(items[0]).toHaveTextContent('Chegou com avaria em Hub B');
        expect(items[0]).toHaveTextContent('por Maria');
        expect(items[0]).toHaveTextContent('caixa amassada');
        expect(items[1]).toHaveTextContent('Saiu em viagem');
        expect(screen.queryByText(/1a2b3c4d/)).toBeNull();
    });

    it('erro oferece tentar de novo', async () => {
        ordersApi.timeline.mockRejectedValue(new Error('x'));
        render(<OrderTimeline orderId="o" />);
        expect(await screen.findByText('Não foi possível carregar o rastreio.')).toBeInTheDocument();
    });
});
