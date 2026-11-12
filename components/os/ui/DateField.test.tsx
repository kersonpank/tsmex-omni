// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateField, DateTimeField } from './DateField';

const Harness: React.FC<{ initial?: string; onValue?: (v: string) => void }> = ({ initial = '', onValue }) => {
    const [v, setV] = useState(initial);
    return <DateTimeField value={v} shortcuts={['today18']} onChange={(n) => { setV(n); onValue?.(n); }} aria-label="saida" />;
};

describe('DateTimeField', () => {
    it('mostra dd/mm/aaaa hh:mm e entrega o valor interno', () => {
        let last = 'x';
        render(<Harness initial="2026-11-12T08:05" onValue={(v) => { last = v; }} />);
        const input = screen.getByLabelText('saida') as HTMLInputElement;
        expect(input.value).toBe('12/11/2026 08:05');
        fireEvent.change(input, { target: { value: '131120261900' } });
        expect(input.value).toBe('13/11/2026 19:00');
        expect(last).toBe('2026-11-13T19:00');
    });
    it('hora inválida limpa o valor e mostra o erro', () => {
        let last = 'x';
        render(<Harness onValue={(v) => { last = v; }} />);
        const input = screen.getByLabelText('saida');
        fireEvent.change(input, { target: { value: '131120262560' } });
        fireEvent.blur(input);
        expect(last).toBe('');
        expect(screen.getByRole('alert').textContent).toContain('dd/mm/aaaa hh:mm');
    });
    it('atalho preenche o campo', () => {
        let last = '';
        render(<Harness onValue={(v) => { last = v; }} />);
        fireEvent.click(screen.getByText('Hoje 18:00'));
        expect(last).toMatch(/T18:00$/);
        expect((screen.getByLabelText('saida') as HTMLInputElement).value).toMatch(/ 18:00$/);
    });
    it('DateField respeita a data mínima', () => {
        let last = 'x';
        render(<DateField aria-label="d" min="2026-11-12" value="" onChange={(v) => { last = v; }} />);
        fireEvent.change(screen.getByLabelText('d'), { target: { value: '01/11/2026' } });
        expect(last).toBe('');
    });
});
