import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntrySheet from './EntrySheet';
import { hubCargoApi, intakeDemandsApi, orderPackagesApi, personsApi } from '../../../../lib/api';
import type { HubCargoItem, Person } from '../../../../types/index';

vi.mock('../../../../lib/api', () => ({
    hubCargoApi: { resolve: vi.fn() },
    intakeDemandsApi: { getLocalNfeData: vi.fn(), attachNfeXml: vi.fn(), confirmArrival: vi.fn() },
    orderPackagesApi: { set: vi.fn() },
    personsApi: { search: vi.fn(), fromPublicCnpj: vi.fn(), create: vi.fn(), update: vi.fn() },
    cnpjApi: { consult: vi.fn() },
}));
vi.mock('../../OsContext', () => ({ useOs: () => ({ hub: { city: 'Guarulhos', state: 'SP' } }) }));
vi.mock('../../../manifest/FiscalAddressFields', () => ({ FiscalAddressFields: () => null }));

const remetente = { id: 'rem', documentType: 'CNPJ', document: '11111111000111', legalName: 'REMETENTE', stateRegistration: '111', city: 'SP', cityIbgeCode: '3550308', state: 'SP' } as Person;
const destinatario = { id: 'dest', documentType: 'CNPJ', document: '22222222000122', legalName: 'DESTINATARIO', stateRegistration: '222', city: 'SP', cityIbgeCode: '3550308', state: 'SP' } as Person;
const item = { demandId: 'd1', nfNumber: '42', statusLabel: 'Aguardando', units: 1, effectiveWeightKg: 10 } as HubCargoItem;
const cargo = { emitente: { cnpj: remetente.document, ie: '111' }, destinatario: { cnpj: destinatario.document, ie: '222' }, modFrete: '0', quantidadeVolumes: 1, pesoBruto: 10, valorTotalNota: 100 };

const confirmWithoutCubage = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Confirmar entrada' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar sem cubagem' }));
};

describe('EntrySheet: início do serviço e edição', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(personsApi.search).mockResolvedValue({ data: [] } as never);
        vi.mocked(intakeDemandsApi.getLocalNfeData).mockResolvedValue({ data: { status: 'available', cargo, parties: { remetente, destinatario }, partiesSource: 'nfe_xml' } } as never);
        vi.mocked(intakeDemandsApi.confirmArrival).mockResolvedValue({ data: { order: null } } as never);
        vi.mocked(hubCargoApi.resolve).mockResolvedValue({ data: {} } as never);
    });

    it('seleciona chegada direta por padrão sem solicitação de coleta', async () => {
        const user = userEvent.setup();
        render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        expect(await screen.findByRole('radio', { name: /Chegou direto neste hub/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /Foi coletado no remetente/ })).not.toBeChecked();
        await confirmWithoutCubage(user);
        await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalledWith('d1', expect.objectContaining({ intakeMode: 'HUB_DIRECT' })));
    });

    it('envia HUB_DIRECT somente ao confirmar entrega direta no hub', async () => {
        const user = userEvent.setup();
        render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        await user.click(await screen.findByRole('radio', { name: /Chegou direto neste hub/ }));
        expect(screen.getByText('O CT-e começa em Guarulhos/SP.')).toBeInTheDocument();
        await confirmWithoutCubage(user);
        await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalledWith('d1', expect.objectContaining({
            intakeMode: 'HUB_DIRECT', remetentePersonId: 'rem', destinatarioPersonId: 'dest', freightTerm: 'CIF',
        })));
    });

    it('não carrega a escolha de entrega direta para outra demanda', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        await user.click(await screen.findByRole('radio', { name: /Chegou direto neste hub/ }));
        rerender(<EntrySheet item={{ ...item, demandId: 'd2' }} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        expect(await screen.findByRole('radio', { name: /Chegou direto neste hub/ })).toBeChecked();
        await confirmWithoutCubage(user);
        await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalledWith('d2', expect.objectContaining({ intakeMode: 'HUB_DIRECT' })));
    });

    it('seleciona coleta quando a oportunidade exige coleta', async () => {
        vi.mocked(intakeDemandsApi.getLocalNfeData).mockResolvedValue({ data: { status: 'available', cargo, needsCollection: true, parties: { remetente, destinatario } } } as never);
        render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        expect(await screen.findByRole('radio', { name: 'Foi coletado no remetente' })).toBeChecked();
        expect(screen.getByText('O CT-e começa em SP/SP.')).toBeInTheDocument();
        await confirmWithoutCubage(userEvent.setup());
        await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalledWith('d1', expect.objectContaining({ intakeMode: 'UNKNOWN' })));
    });

    it('avisa quando falha a conferência das IEs, mantendo a entrada disponível', async () => {
        vi.mocked(intakeDemandsApi.getLocalNfeData).mockResolvedValue({ data: { status: 'available', cargo, parties: { remetente, destinatario }, partiesSource: 'nfe_xml', ieRecovery: 'read_failed' } } as never);
        render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        expect(await screen.findByText('Não foi possível conferir as IEs no XML armazenado. Confira os cadastros.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirmar entrada' })).toBeEnabled();
    });

    it('o XML anexado não troca pessoa nem pagador escolhidos enquanto a leitura estava pendente', async () => {
        const user = userEvent.setup();
        vi.mocked(intakeDemandsApi.getLocalNfeData).mockResolvedValue({ data: { status: 'pending', parties: { remetente, destinatario }, partiesSource: 'public_cnpj' } } as never);
        const chosen = { ...remetente, id: 'outro', document: '33333333000133', legalName: 'ESCOLHA MANUAL', stateRegistration: '999' } as Person;
        vi.mocked(personsApi.search).mockResolvedValue({ data: [chosen] } as never);
        let resolveUpload!: (value: unknown) => void;
        vi.mocked(intakeDemandsApi.attachNfeXml).mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve as (value: unknown) => void; }) as never);
        const { container } = render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        const remLabel = await screen.findByText('Remetente', { selector: 'p' });
        const upload = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['xml'], 'nota.xml', { type: 'text/xml' });
        Object.defineProperty(file, 'text', { value: async () => 'xml' });
        fireEvent.change(upload, { target: { files: [file] } });
        await waitFor(() => expect(intakeDemandsApi.attachNfeXml).toHaveBeenCalled());
        const remSection = remLabel.parentElement!;
        await user.click(within(remSection).getByRole('button', { name: 'Trocar' }));
        await user.type(screen.getByPlaceholderText('Nome, CNPJ ou CPF'), 'ESCOLHA');
        await user.click(await screen.findByRole('button', { name: /ESCOLHA MANUAL/ }));
        await user.click(screen.getByRole('button', { name: /Destinatário/ }));
        resolveUpload({ data: { status: 'available', cargo, parties: { remetente, destinatario }, partiesSource: 'nfe_xml' } });
        await waitFor(() => expect(screen.queryByText(/O XML desta NF-e não está no sistema/)).not.toBeInTheDocument());
        expect(screen.getAllByText('ESCOLHA MANUAL').length).toBeGreaterThan(0);
        expect(screen.queryByText('REMETENTE')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Destinatário/ })).toHaveAttribute('aria-pressed', 'true');
        await confirmWithoutCubage(user);
        await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalledWith('d1', expect.objectContaining({ remetentePersonId: 'outro', freightTerm: 'FOB' })));
    });

    it('mostra a cubagem sempre visível, sem a palavra opcional', async () => {
        render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        expect(await screen.findByText('Cubagem (medidas dos volumes)')).toBeInTheDocument();
        expect(screen.getByText('Necessária para o preço (peso cubado) e para saber se cabe no veículo.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Só sei o m³ total' })).toBeInTheDocument();
        expect(screen.queryByText(/opcional/i)).not.toBeInTheDocument();
    });

    it('sem cubagem pergunta antes de confirmar e "Informar cubagem" não confirma', async () => {
        const user = userEvent.setup();
        render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        await user.click(await screen.findByRole('button', { name: 'Confirmar entrada' }));
        expect(screen.getByRole('dialog', { name: 'Seguir sem a cubagem?' })).toBeInTheDocument();
        expect(screen.getByText(/Sem cubagem o frete usa só o peso/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Informar cubagem' }));
        expect(screen.queryByRole('dialog', { name: 'Seguir sem a cubagem?' })).not.toBeInTheDocument();
        expect(intakeDemandsApi.confirmArrival).not.toHaveBeenCalled();
    });

    it('com medidas completas confirma direto e grava a cubagem', async () => {
        const user = userEvent.setup();
        vi.mocked(intakeDemandsApi.confirmArrival).mockResolvedValue({ data: { order: { id: 'o1' } } } as never);
        vi.mocked(orderPackagesApi.set).mockResolvedValue({ data: {} } as never);
        render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        await user.type(await screen.findByLabelText('Comprimento em cm'), '50');
        await user.type(screen.getByLabelText('Largura em cm'), '40');
        await user.type(screen.getByLabelText('Altura em cm'), '30');
        await user.click(screen.getByRole('button', { name: 'Confirmar entrada' }));
        await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalled());
        expect(screen.queryByRole('dialog', { name: 'Seguir sem a cubagem?' })).not.toBeInTheDocument();
        await waitFor(() => expect(orderPackagesApi.set).toHaveBeenCalledWith('o1', { packages: [{ quantity: 1, lengthCm: 50, widthCm: 40, heightCm: 30 }] }));
    });

    it('com só o m³ total confirma direto e envia o total', async () => {
        const user = userEvent.setup();
        vi.mocked(intakeDemandsApi.confirmArrival).mockResolvedValue({ data: { order: { id: 'o2' } } } as never);
        vi.mocked(orderPackagesApi.set).mockResolvedValue({ data: {} } as never);
        render(<EntrySheet item={item} hubId="hub" onClose={vi.fn()} onDone={vi.fn()} />);
        await user.click(await screen.findByRole('button', { name: 'Só sei o m³ total' }));
        await user.type(screen.getByLabelText(/Cubagem total/), '0,5');
        await user.click(screen.getByRole('button', { name: 'Confirmar entrada' }));
        await waitFor(() => expect(orderPackagesApi.set).toHaveBeenCalledWith('o2', { packages: [], totalM3: 0.5 }));
        expect(screen.queryByRole('dialog', { name: 'Seguir sem a cubagem?' })).not.toBeInTheDocument();
    });
});
