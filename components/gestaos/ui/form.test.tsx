import React, { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
    Checkbox,
    ConfirmButton,
    DateTimeInput,
    formatCep,
    formatCnpjCpf,
    formatPlate,
    isValidCnpj,
    isValidCpf,
    isoToLocalInput,
    LinkButton,
    localInputToIso,
    MoneyInput,
    NumberInput,
    onlyDigits,
    parseDecimal,
    parseMoney,
    runRules,
    SearchInput,
    Toggle,
    useForm,
} from './form';

describe('helpers puros', () => {
    it('parseMoney aceita vírgula, ponto, milhar e "R$", com no máximo 2 casas', () => {
        expect(parseMoney('1.234,56')).toBe(1234.56);
        expect(parseMoney('1,234.56')).toBe(1234.56);
        expect(parseMoney('10,5')).toBe(10.5);
        expect(parseMoney('10.5')).toBe(10.5);
        expect(parseMoney('R$ 99')).toBe(99);
        expect(parseMoney('1.234')).toBe(1234);
        expect(parseMoney('0.500')).toBe(0.5);
        expect(parseMoney('10,999')).toBe(11);
        expect(parseMoney('1.005,15')).toBe(1005.15);
        expect(parseMoney('-5,5')).toBe(-5.5);
        expect(parseMoney('')).toBeNull();
        expect(parseMoney('abc')).toBeNull();
        expect(parseMoney('1,2,3')).toBeNull();
        expect(parseMoney(null)).toBeNull();
    });

    it('parseDecimal mantém todas as casas', () => {
        expect(parseDecimal('12,3456')).toBe(12.3456);
        expect(parseDecimal('0,75')).toBe(0.75);
        expect(parseDecimal('1.234.567,5')).toBe(1234567.5);
        expect(parseDecimal('x')).toBeNull();
    });

    it('máscaras e dígitos', () => {
        expect(onlyDigits('12.345/0001-9a')).toBe('1234500019');
        expect(formatCnpjCpf('12345678901')).toBe('123.456.789-01');
        expect(formatCnpjCpf('12345678000195')).toBe('12.345.678/0001-95');
        expect(formatCnpjCpf(null)).toBe('');
        expect(formatCep('01310100')).toBe('01310-100');
        expect(formatCep('0131')).toBe('0131');
        expect(formatPlate('rqw-4d58x')).toBe('RQW4D58');
    });

    it('valida CPF e CNPJ pelos dígitos verificadores', () => {
        expect(isValidCpf('529.982.247-25')).toBe(true);
        expect(isValidCpf('529.982.247-24')).toBe(false);
        expect(isValidCpf('111.111.111-11')).toBe(false);
        expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
        expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
        expect(isValidCnpj('')).toBe(false);
    });

    it('data e hora: ISO para fora, fuso local por dentro', () => {
        const local = isoToLocalInput('2026-11-13T15:30:00.000Z');
        expect(local).toMatch(/^2026-11-1[34]T\d{2}:\d{2}$/);
        expect(localInputToIso(local)).toBe('2026-11-13T15:30:00.000Z');
        expect(localInputToIso('')).toBeNull();
        expect(isoToLocalInput('lixo')).toBe('');
    });
});

describe('runRules e useForm', () => {
    interface Values {
        name: string;
        weight: number | null;
        note: string;
    }
    const initial: Values = { name: '', weight: null, note: '' };

    it('runRules: obrigatório, mínimo e função (primeiro erro por campo)', () => {
        const errors = runRules(initial, {
            name: { required: 'Informe o nome.' },
            weight: [{ required: true }, { min: 1 }],
            note: (value) => (value.length > 3 ? 'Longo demais.' : null),
        });
        expect(errors).toEqual({ name: 'Informe o nome.', weight: 'Campo obrigatório.' });
        expect(runRules({ ...initial, weight: 0 }, { weight: { min: 1, message: 'Mínimo 1 kg.' } })).toEqual({ weight: 'Mínimo 1 kg.' });
        expect(runRules({ ...initial, name: 'abc' }, { name: { minLength: 5 } }).name).toBe('Use ao menos 5 caracteres.');
        expect(runRules({ ...initial, weight: 0 }, { weight: { required: true } })).toEqual({});
    });

    it('guarda valores, erros por campo, sujo/limpo e reset', () => {
        const { result } = renderHook(() => useForm<Values>(initial));
        expect(result.current.dirty).toBe(false);

        act(() => result.current.set('name', 'Rodomax'));
        expect(result.current.values.name).toBe('Rodomax');
        expect(result.current.dirty).toBe(true);

        let ok = true;
        act(() => {
            ok = result.current.validate({ weight: { required: 'Peso é obrigatório.' } });
        });
        expect(ok).toBe(false);
        expect(result.current.errors.weight).toBe('Peso é obrigatório.');

        act(() => result.current.set('weight', 10));
        expect(result.current.errors.weight).toBeUndefined();

        act(() => result.current.setError('note', 'Veio do servidor.'));
        expect(result.current.errors.note).toBe('Veio do servidor.');
        act(() => result.current.setMany({ note: 'ok', name: 'X' }));
        expect(result.current.errors.note).toBeUndefined();

        act(() => result.current.reset());
        expect(result.current.values).toEqual(initial);
        expect(result.current.dirty).toBe(false);

        act(() => result.current.reset({ ...initial, name: 'Base' }));
        expect(result.current.dirty).toBe(false);
        act(() => result.current.set('name', 'Outra'));
        expect(result.current.dirty).toBe(true);
    });
});

describe('MoneyInput', () => {
    function Harness({ onValue }: { onValue: (value: number | null) => void }) {
        const [value, setValue] = useState<number | null>(null);
        return (
            <>
                <MoneyInput
                    aria-label="Valor"
                    value={value}
                    onChange={(next) => {
                        setValue(next);
                        onValue(next);
                    }}
                />
                <output data-testid="state">{value === null ? 'null' : String(value)}</output>
            </>
        );
    }

    it('mostra R$, aceita vírgula ou ponto, limita a 2 casas e devolve número', async () => {
        const seen = vi.fn();
        render(<Harness onValue={seen} />);
        expect(screen.getByText('R$')).toBeInTheDocument();
        const input = screen.getByLabelText('Valor');

        await userEvent.type(input, '1234,567');
        expect(input).toHaveValue('1234,56');
        expect(screen.getByTestId('state')).toHaveTextContent('1234.56');

        await userEvent.clear(input);
        expect(screen.getByTestId('state')).toHaveTextContent('null');

        await userEvent.type(input, '10.5');
        expect(screen.getByTestId('state')).toHaveTextContent('10.5');
        await userEvent.tab();
        expect(input).toHaveValue('10,50');
        expect(seen).toHaveBeenLastCalledWith(10.5);
    });

    it('acompanha o valor trocado por fora', () => {
        const { rerender } = render(<MoneyInput aria-label="Valor" value={5} onChange={() => undefined} />);
        expect(screen.getByLabelText('Valor')).toHaveValue('5,00');
        rerender(<MoneyInput aria-label="Valor" value={1234.5} onChange={() => undefined} />);
        expect(screen.getByLabelText('Valor')).toHaveValue('1.234,50');
        rerender(<MoneyInput aria-label="Valor" value={null} onChange={() => undefined} />);
        expect(screen.getByLabelText('Valor')).toHaveValue('');
    });
});

describe('NumberInput', () => {
    it('inteiro rejeita vírgula; decimal aceita, limita as casas e mostra o sufixo', async () => {
        const onChange = vi.fn();
        const first = render(<NumberInput aria-label="Peso" value={null} onChange={onChange} suffix="kg" />);
        expect(screen.getByText('kg')).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText('Peso'), '12,5');
        expect(onChange).toHaveBeenLastCalledWith(125);
        first.unmount();

        render(<NumberInput aria-label="Volume" value={null} onChange={onChange} decimal decimals={2} suffix="m³" />);
        await userEvent.type(screen.getByLabelText('Volume'), '1,234');
        expect(onChange).toHaveBeenLastCalledWith(1.23);
    });
});

describe('DateTimeInput', () => {
    it('devolve ISO UTC', () => {
        const onChange = vi.fn();
        render(<DateTimeInput aria-label="Quando" value={null} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('Quando'), { target: { value: '2026-11-13T10:00' } });
        expect(onChange).toHaveBeenCalledWith(new Date('2026-11-13T10:00').toISOString());
    });
});

describe('SearchInput', () => {
    it('só avisa depois do debounce, limpa na hora e acompanha o valor de fora', () => {
        vi.useFakeTimers();
        try {
            const onChange = vi.fn();
            const { rerender } = render(<SearchInput aria-label="Buscar pedido" onChange={onChange} delay={350} />);
            const input = screen.getByLabelText('Buscar pedido');
            fireEvent.change(input, { target: { value: 'abc' } });
            act(() => void vi.advanceTimersByTime(300));
            expect(onChange).not.toHaveBeenCalled();
            act(() => void vi.advanceTimersByTime(60));
            expect(onChange).toHaveBeenCalledWith('abc');

            fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
            expect(onChange).toHaveBeenLastCalledWith('');
            expect(input).toHaveValue('');

            rerender(<SearchInput aria-label="Buscar pedido" value="de fora" onChange={onChange} />);
            expect(screen.getByLabelText('Buscar pedido')).toHaveValue('de fora');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Checkbox, Toggle e LinkButton', () => {
    it('rótulo clicável marca e liga; LinkButton é um link com cara de botão', async () => {
        const onCheck = vi.fn();
        const onToggle = vi.fn();
        render(
            <MemoryRouter>
                <Checkbox checked={false} onChange={onCheck} label="Isento de IE" />
                <Toggle checked={false} onChange={onToggle} label="Ativo" />
                <LinkButton to="/gestaos/rede" variant="soft">
                    Ir para a rede
                </LinkButton>
            </MemoryRouter>,
        );
        await userEvent.click(screen.getByText('Isento de IE'));
        expect(onCheck).toHaveBeenCalledWith(true);
        await userEvent.click(screen.getByText('Ativo'));
        expect(onToggle).toHaveBeenCalledWith(true);
        expect(screen.getByRole('switch', { name: 'Ativo' })).toHaveAttribute('aria-checked', 'false');
        const link = screen.getByRole('link', { name: 'Ir para a rede' });
        expect(link).toHaveAttribute('href', '/gestaos/rede');
        expect(link.className).toContain('gx-btn-soft');
    });
});

describe('ConfirmButton', () => {
    it('dois passos: o primeiro clique só pede confirmação; Voltar desiste', async () => {
        const onConfirm = vi.fn();
        render(<ConfirmButton label="Excluir tarifa" onConfirm={onConfirm} />);
        await userEvent.click(screen.getByRole('button', { name: 'Excluir tarifa' }));
        expect(onConfirm).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Confirmar?' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
        expect(screen.getByRole('button', { name: 'Excluir tarifa' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Excluir tarifa' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar?' }));
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
        expect(await screen.findByRole('button', { name: 'Excluir tarifa' })).toBeInTheDocument();
    });

    it('com motivo, só libera depois do mínimo e entrega o texto', async () => {
        const onConfirm = vi.fn();
        render(<ConfirmButton label="Cancelar viagem" onConfirm={onConfirm} reason={{ label: 'Motivo do cancelamento', minLength: 8 }} />);
        await userEvent.click(screen.getByRole('button', { name: 'Cancelar viagem' }));
        const confirm = screen.getByRole('button', { name: 'Confirmar?' });
        expect(confirm).toBeDisabled();

        await userEvent.type(screen.getByLabelText('Motivo do cancelamento'), 'curto');
        expect(confirm).toBeDisabled();
        expect(screen.getByText('Faltam 3 caracteres.')).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Motivo do cancelamento'), ' demais ');
        expect(confirm).toBeEnabled();
        await userEvent.click(confirm);
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('curto demais'));
    });

    it('Esc volta sem confirmar e onConfirm=false mantém o passo aberto', async () => {
        const onConfirm = vi.fn().mockResolvedValue(false);
        render(<ConfirmButton label="Apagar" onConfirm={onConfirm} />);
        await userEvent.click(screen.getByRole('button', { name: 'Apagar' }));
        await userEvent.keyboard('{Escape}');
        expect(screen.getByRole('button', { name: 'Apagar' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Apagar' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar?' }));
        await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
        expect(screen.getByRole('button', { name: 'Confirmar?' })).toBeInTheDocument();
    });
});
