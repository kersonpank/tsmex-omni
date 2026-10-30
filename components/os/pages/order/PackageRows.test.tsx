import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EMPTY_PACKAGE_ROW, type PackageRow } from '../../lib/packages';
import PackageRows from './PackageRows';

const Harness: React.FC<{ expectedUnits?: number | null; initial?: PackageRow[] }> = ({ expectedUnits = null, initial }) => {
    const [rows, setRows] = useState<PackageRow[]>(initial ?? [{ ...EMPTY_PACKAGE_ROW }]);
    return <PackageRows rows={rows} onChange={setRows} expectedUnits={expectedUnits} />;
};

describe('PackageRows: teclado e foco', () => {
    it('Enter caminha Qtd, C, L, A e abre a próxima linha pelo botão com foco na Qtd', async () => {
        const user = userEvent.setup();
        render(<Harness expectedUnits={3} />);
        const qtd = screen.getByLabelText('Quantidade');
        expect(qtd).toHaveValue('3');
        await user.click(qtd);
        await user.keyboard('{Enter}');
        expect(screen.getByLabelText('Comprimento em cm')).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(screen.getByLabelText('Largura em cm')).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(screen.getByLabelText('Altura em cm')).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(screen.getByLabelText('Altura em cm')).not.toHaveFocus();

        await user.click(screen.getByRole('button', { name: '+ Adicionar outra medida' }));
        const quantities = screen.getAllByLabelText('Quantidade');
        expect(quantities).toHaveLength(2);
        expect(quantities[1]).toHaveFocus();
        expect(quantities[1]).toHaveValue('');
    });

    it('Enter na A da primeira linha vai para a Qtd da seguinte', async () => {
        const user = userEvent.setup();
        const row = { quantity: '1', lengthCm: '', widthCm: '', heightCm: '' };
        render(<Harness initial={[row, { ...row }]} />);
        await user.click(screen.getAllByLabelText('Altura em cm')[0]);
        await user.keyboard('{Enter}');
        expect(screen.getAllByLabelText('Quantidade')[1]).toHaveFocus();
    });

    it('campos numéricos, dicas de teclado e sem zeros preenchidos', () => {
        render(<Harness />);
        const qtd = screen.getByLabelText('Quantidade');
        expect(qtd).toHaveAttribute('inputmode', 'numeric');
        expect(qtd).toHaveAttribute('pattern', '[0-9]*');
        expect(qtd).toHaveValue('1');
        for (const label of ['Comprimento em cm', 'Largura em cm', 'Altura em cm']) {
            const input = screen.getByLabelText(label);
            expect(input).toHaveAttribute('inputmode', 'decimal');
            expect(input).toHaveValue('');
            expect(input).toHaveAttribute('placeholder', '0');
        }
        expect(qtd).toHaveAttribute('enterkeyhint', 'next');
        expect(screen.getByLabelText('Altura em cm')).toHaveAttribute('enterkeyhint', 'done');
    });

    it('botão de adicionar fica alinhado à direita com alvo de toque alto', () => {
        render(<Harness />);
        const add = screen.getByRole('button', { name: '+ Adicionar outra medida' });
        expect(add.parentElement).toHaveClass('flex', 'justify-end');
        expect(add).toHaveClass('min-h-11');
    });

    it('as linhas ficam dentro de um form (barra de setas do iOS) que não envia', () => {
        const { container } = render(<Harness />);
        const form = container.querySelector('form');
        expect(form).not.toBeNull();
        expect(form!.contains(screen.getByLabelText('Quantidade'))).toBe(true);
    });
});
