import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import FiscalClosureNotice, { openFiscalDocuments } from './FiscalClosureNotice';

const { manifestsApi } = vi.hoisted(() => ({ manifestsApi: { retryFiscalClosure: vi.fn() } }));
vi.mock('../../../../lib/api', () => ({ manifestsApi }));

const doc = (documentType: string, status: string) => ({ id: documentType, manifestId: 't', documentType, status, createdAt: '', updatedAt: '' }) as any;
beforeEach(() => vi.resetAllMocks());

it('só lista documentos AUTHORIZED de viagem concluída', () => {
    const docs = [doc('MDFE', 'AUTHORIZED'), doc('CIOT', 'CLOSED'), doc('CTE', 'AUTHORIZED')];
    expect(openFiscalDocuments({ status: 'COMPLETED', fiscalDocuments: docs }).map((d) => d.documentType)).toEqual(['MDFE']);
    expect(openFiscalDocuments({ status: 'IN_PROGRESS', fiscalDocuments: docs })).toEqual([]);
});

it('não aparece quando tudo foi encerrado', () => {
    const { container } = render(<FiscalClosureNotice manifest={{ id: 't', status: 'COMPLETED', fiscalDocuments: [doc('MDFE', 'CLOSED')] }} onDone={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
});

it('avisa do MDF-e aberto e chama a rota de encerramento', async () => {
    const user = userEvent.setup();
    manifestsApi.retryFiscalClosure.mockResolvedValue({ success: true, message: 'Encerramento fiscal reenfileirado.' });
    const onDone = vi.fn();
    render(<FiscalClosureNotice manifest={{ id: 'trip', status: 'COMPLETED', fiscalDocuments: [doc('MDFE', 'AUTHORIZED')] }} onDone={onDone} />);
    expect(screen.getByText('MDF-e ainda aberto na SEFAZ: sem encerrar, o veículo não emite outro.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Encerrar documentos' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(manifestsApi.retryFiscalClosure).toHaveBeenCalledWith('trip');
    expect(screen.getByRole('status')).toHaveTextContent('reenfileirado');
});

it('mostra o erro da rota sem esconder o botão', async () => {
    const user = userEvent.setup();
    manifestsApi.retryFiscalClosure.mockRejectedValue({ response: { data: { error: 'O encerramento fiscal desta viagem já está em andamento.' } } });
    render(<FiscalClosureNotice manifest={{ id: 'trip', status: 'COMPLETED', fiscalDocuments: [doc('CIOT', 'AUTHORIZED')] }} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Encerrar documentos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('já está em andamento');
    expect(screen.getByRole('button', { name: 'Encerrar documentos' })).toBeEnabled();
});
