import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FreightDocumentSummary } from '../../../../types/index';
import FreightDocuments from './FreightDocuments';

const { ordersFreightApi } = vi.hoisted(() => ({
    ordersFreightApi: { emitCte: vi.fn(), prepare: vi.fn() },
}));

vi.mock('../../../../lib/api', () => ({ ordersFreightApi }));
vi.mock('../../freightActions', () => ({ loadFreightPrint: vi.fn() }));
vi.mock('../../../ui/DactePrintPreview', () => ({ default: () => null }));

const DOCUMENT: FreightDocumentSummary = {
    id: 'calc-21794',
    documentType: 'CTE',
    status: 'CTE_PENDING_RECONCILIATION',
    number: '21794',
    freightTotal: 420,
    calculationMethod: 'INFORMADO',
    pricingLabel: null,
    statusReason: 'A tentativa anterior terminou antes do envio ao provedor fiscal.',
    accessKey: null,
    attempt: null,
    createdAt: '2026-10-25T12:00:00.000Z',
    canResend: true,
};

function pending() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

describe('FreightDocuments — reenvio do CT-e pendente de reconciliação', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('reenvia o cálculo existente e mantém a ação ocupada até recarregar os documentos', async () => {
        const emission = pending();
        const reload = pending();
        ordersFreightApi.emitCte.mockReturnValue(emission.promise);
        const onResent = vi.fn(() => reload.promise);
        const user = userEvent.setup();
        render(<FreightDocuments orderId="order-1" documents={[DOCUMENT]} onResent={onResent} />);

        await user.click(screen.getByRole('button', { name: 'Reenviar à SEFAZ' }));

        expect(ordersFreightApi.emitCte).toHaveBeenCalledExactlyOnceWith('order-1', DOCUMENT.id);
        const busyButton = screen.getByRole('button', { name: 'Reenviando…' });
        expect(busyButton).toBeDisabled();
        await user.click(busyButton);
        expect(ordersFreightApi.emitCte).toHaveBeenCalledTimes(1);
        expect(onResent).not.toHaveBeenCalled();

        await act(async () => { emission.resolve(); });
        await waitFor(() => expect(onResent).toHaveBeenCalledTimes(1));
        expect(screen.getByRole('button', { name: 'Reenviando…' })).toBeDisabled();

        await act(async () => { reload.resolve(); });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Reenviar à SEFAZ' })).toBeEnabled());
        expect(ordersFreightApi.prepare).not.toHaveBeenCalled();
    });

    it.each(['error', 'message'] as const)('mostra a mensagem de certificado em response.data.%s e recarrega após falha', async (field) => {
        const certificateError = 'Certificado A1 expirado. Atualize o certificado do emitente antes de reenviar à SEFAZ.';
        ordersFreightApi.emitCte.mockRejectedValue({ response: { data: { [field]: certificateError } } });
        const onResent = vi.fn().mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(<FreightDocuments orderId="order-1" documents={[DOCUMENT]} onResent={onResent} />);

        await user.click(screen.getByRole('button', { name: 'Reenviar à SEFAZ' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(certificateError);
        await waitFor(() => expect(onResent).toHaveBeenCalledTimes(1));
        expect(screen.getByRole('button', { name: 'Reenviar à SEFAZ' })).toBeEnabled();
        expect(ordersFreightApi.prepare).not.toHaveBeenCalled();
    });

    it.each([true, false])('exibe o motivo da reconciliação com até três linhas quando canResend=%s', (canResend) => {
        render(<FreightDocuments orderId="order-1" documents={[{ ...DOCUMENT, canResend }]} onResent={vi.fn()} />);

        expect(screen.getByText(DOCUMENT.statusReason!)).toHaveClass('line-clamp-3');
    });

    it('mantém a conferência pela torre e explica a espera quando o reenvio não está disponível', () => {
        render(<FreightDocuments orderId="order-1" documents={[{ ...DOCUMENT, canResend: false }]} onResent={vi.fn()} />);

        expect(screen.getByText('CT-e nº 21794 · aguardando conferência na SEFAZ (torre)')).toBeInTheDocument();
        expect(screen.getByText('a torre confere na SEFAZ antes de reenviar')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reenviar à SEFAZ' })).not.toBeInTheDocument();
        expect(ordersFreightApi.emitCte).not.toHaveBeenCalled();
    });
});
