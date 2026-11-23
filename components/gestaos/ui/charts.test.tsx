import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChartCard, GoalProgress, Highlight, MonthBars, RankedBars } from './charts';

describe('charts', () => {
    it('barras ranqueadas: mostra valor, selo de estado e dica no foco', async () => {
        render(
            <RankedBars
                ariaLabel="Margem por rota"
                items={[
                    { key: 'a', label: 'Fortaleza → Recife', value: 5000, display: 'R$ 50,00', detail: '3 viagens' },
                    { key: 'b', label: 'Recife → Salvador', value: -200, display: '-R$ 2,00', badge: 'abaixo de zero' },
                ]}
            />,
        );
        expect(screen.getByText('R$ 50,00')).toBeTruthy();
        expect(screen.getByText('abaixo de zero')).toBeTruthy();
        await userEvent.hover(screen.getByText('Fortaleza → Recife'));
        expect(screen.getByRole('tooltip').textContent).toContain('3 viagens');
    });

    it('cartão alterna entre gráfico e tabela', async () => {
        render(
            <ChartCard title="Faturado" table={{ head: ['Mês', 'Valor'], rows: [['nov/26', 'R$ 10,00']] }}>
                <MonthBars ariaLabel="Faturado por mês" items={[{ key: '2026-11', label: 'nov/26', value: 1000, display: 'R$ 10' }]} />
            </ChartCard>,
        );
        expect(screen.getByRole('img', { name: 'Faturado por mês' })).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Ver como tabela' }));
        expect(screen.getByRole('table')).toBeTruthy();
        expect(screen.getByText('R$ 10,00')).toBeTruthy();
    });

    it('meta: abaixo da meta tem texto; destaque mostra estado', () => {
        render(
            <>
                <GoalProgress value={60} target={90} label="Aceitas sem alteração" />
                <Highlight label="Vencido" value="R$ 5,00" status={{ text: 'Em atraso', tone: 'red' }} />
            </>,
        );
        expect(screen.getByText('Abaixo da meta')).toBeTruthy();
        expect(screen.getByText('Meta 90%')).toBeTruthy();
        expect(screen.getByText('Em atraso')).toBeTruthy();
    });
});
