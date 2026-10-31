import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FreightDocumentSummary } from '../../../../types/index';
import { CTE_CFOP_SELECT_OPTIONS } from '../../../../lib/cteTaxCatalog';
import { CTE_CFOP_OPTIONS } from '../../../../server/src/services/fiscal/cteTaxRules';
import FreightDocuments from './FreightDocuments';

const { ordersFreightApi } = vi.hoisted(() => ({
    ordersFreightApi: { emitCte: vi.fn(), retryRejectedCte: vi.fn(), prepare: vi.fn(), ctePreflight: vi.fn().mockResolvedValue({ data: { tax: { cfop: null } } }) },
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

describe('FreightDocuments — corrigir IE dentro da O.S.', () => {
    it.each([
        ['Código 422: Rejeição: IE do remetente não vinculada ao CNPJ', 'remetente'],
        ['Código 427: Rejeição: IE do destinatário não vinculada ao CNPJ', 'destinatário'],
    ])('abre a parte da rejeição: %s', async (reason, label) => {
        const onFixParty = vi.fn();
        const user = userEvent.setup();
        render(<FreightDocuments orderId="o1" documents={[{ ...DOCUMENT, status: 'CTE_REJECTED', statusReason: reason }]} onResent={vi.fn()} onFixParty={onFixParty} />);
        await user.click(screen.getByRole('button', { name: `Corrigir IE do ${label}` }));
        expect(onFixParty).toHaveBeenCalledWith(label === 'destinatário' ? 'destinatario' : 'remetente');
    });
    it('mostra os dados corrigidos junto do reenvio existente', () => {
        render(<FreightDocuments orderId="o1" documents={[{ ...DOCUMENT, status: 'CTE_REJECTED' }]} onResent={vi.fn()} partiesCorrected />);
        expect(screen.getByRole('status')).toHaveTextContent('Dados corrigidos — reenvie para a SEFAZ');
        expect(screen.getByRole('button', { name: 'Reenviar à SEFAZ' })).toBeEnabled();
    });
});

function pending() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

describe('FreightDocuments — reenvio do CT-e pendente de reconciliação', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        ordersFreightApi.ctePreflight.mockResolvedValue({ data: { tax: { cfop: null } } });
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
    });});

describe('FreightDocuments — correção de CFOP rejeitado', () => {
    const rejected: FreightDocumentSummary = {
        ...DOCUMENT, status: 'CTE_REJECTED', canResend: false, statusReason: '519 - CFOP inválido para operação',
    };

    beforeEach(() => {
        vi.resetAllMocks();
        ordersFreightApi.ctePreflight.mockResolvedValue({ data: { tax: { cfop: null } } });
    });

    it('mantém o catálogo de CFOP da interface igual ao validado no servidor', () => {
        expect(CTE_CFOP_SELECT_OPTIONS.map(({ code, labelFull }) => [code, labelFull]))
            .toEqual(CTE_CFOP_OPTIONS.map(({ code, label }) => [code, label]));
    });

    it('permite escolher CFOP e declarar entrega direta, sem preparar ou recalcular o frete', async () => {
        const send = pending();
        const reload = pending();
        ordersFreightApi.retryRejectedCte.mockReturnValue(send.promise);
        const onResent = vi.fn(() => reload.promise);
        const user = userEvent.setup();
        render(<FreightDocuments orderId="order-1" documents={[rejected]} onResent={onResent} />);

        expect(screen.getByText(/519 - CFOP inválido/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Corrigir CFOP e reenviar' }));
        expect(screen.getByRole('button', { name: 'Corrigir e reenviar CT-e' })).toBeDisabled();
        await user.selectOptions(screen.getByLabelText('CFOP para o reenvio'), '5932');
        await user.click(screen.getByRole('checkbox', { name: /carga foi entregue diretamente neste hub/i }));
        await user.click(screen.getByRole('button', { name: 'Corrigir e reenviar CT-e' }));
        expect(ordersFreightApi.retryRejectedCte).toHaveBeenCalledExactlyOnceWith('order-1', rejected.id, { cfop: '5932', deliveredDirectlyToHub: true });
        expect(screen.getByRole('button', { name: 'Reenviando…' })).toBeDisabled();
        await act(async () => { send.resolve(); });
        await waitFor(() => expect(onResent).toHaveBeenCalledOnce());
        await act(async () => { reload.resolve(); });
        expect(ordersFreightApi.emitCte).not.toHaveBeenCalled();
        expect(ordersFreightApi.prepare).not.toHaveBeenCalled();
    });

    it('mostra o erro do preflight e mantém a seleção para correção', async () => {
        ordersFreightApi.retryRejectedCte.mockRejectedValue({ response: { data: { error: 'SEFAZ 519: CFOP incompatível com a prestação.' } } });
        const user = userEvent.setup();
        render(<FreightDocuments orderId="order-1" documents={[rejected]} onResent={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Corrigir CFOP e reenviar' }));
        await user.selectOptions(screen.getByLabelText('CFOP para o reenvio'), '6352');
        await user.click(screen.getByRole('button', { name: 'Corrigir e reenviar CT-e' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('SEFAZ 519');
        expect(screen.getByLabelText('CFOP para o reenvio')).toHaveValue('6352');
    });

    it('does not offer CFOP correction for sent, authorized or other document types', () => {
        for (const doc of [
            { ...rejected, status: 'CTE_SENT' as const },
            { ...rejected, status: 'CTE_AUTHORIZED' as const },
            { ...rejected, status: 'DCE_REJECTED' as const, documentType: 'DCE' as const },
        ]) {
            const { unmount } = render(<FreightDocuments orderId="order-1" documents={[doc]} onResent={vi.fn()} />);
            expect(screen.queryByRole('button', { name: 'Corrigir CFOP e reenviar' })).not.toBeInTheDocument();
            unmount();
        }
    });

    it('hides CFOP correction for a non-CFOP rejection', () => {
        render(<FreightDocuments orderId="order-1" documents={[{ ...rejected, statusReason: 'Certificate invalid' }]} onResent={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Corrigir CFOP e reenviar' })).not.toBeInTheDocument();
    });
});
it('mostra rejeição anterior como histórico em cálculo já preparado', () => {
    render(<FreightDocuments orderId="o1" documents={[{ ...DOCUMENT, status: 'CALCULATED', statusReason: 'CFOP inválido' }]} onResent={vi.fn()} />);
    expect(screen.getByText('Rejeição anterior: CFOP inválido')).toBeInTheDocument();
    expect(screen.getByText('CT-e em rascunho')).toBeInTheDocument();
});
it('preenche o CFOP sugerido pelo preflight', async () => {
    ordersFreightApi.ctePreflight.mockResolvedValue({ data: { tax: { cfop: { code: '6353' } } } });
    render(<FreightDocuments orderId="o1" documents={[{ ...DOCUMENT, status: 'CTE_REJECTED', statusReason: 'CFOP inválido' }]} onResent={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Corrigir CFOP e reenviar' }));
    await waitFor(() => expect(screen.getByLabelText('CFOP para o reenvio')).toHaveValue('6353'));
});
