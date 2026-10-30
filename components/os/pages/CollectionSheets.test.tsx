import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollectionRequestSheet from './CollectionRequestSheet';
import CollectionDetailSheet from './CollectionDetailSheet';
import { intakeDemandsApi, personsApi } from '../../../lib/api';
import type { HubCargoItem, Person, PersonContact } from '../../../types/index';
import { AVERBACAO_NOTE } from '../lib/collection';

vi.mock('../../../lib/api', () => ({
    intakeDemandsApi: {
        getLocalNfeData: vi.fn(),
        requestCollection: vi.fn(),
        attachCollection: vi.fn(),
        cancelCollection: vi.fn(),
        getLastCollectionAddresses: vi.fn(),
        lookupNfeCargo: vi.fn(),
    },
    personsApi: {
        search: vi.fn(),
        getContacts: vi.fn(),
        createContact: vi.fn(),
        fromPublicCnpj: vi.fn(),
    },
    cnpjApi: {
        consult: vi.fn(),
    },
}));

const mockSender: Person = {
    id: 'p-sender-1',
    documentType: 'CNPJ',
    document: '12345678000195',
    legalName: 'Distribuidora São Luís LTDA',
    tradeName: 'Distribuidora São Luís',
    city: 'Imperatriz',
    state: 'MA',
    cityIbgeCode: '2105302',
    address: 'Rua Principal',
    number: '100',
    neighborhood: 'Centro',
    cep: '65900000',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
};

const mockContact: PersonContact = {
    id: 'c-1',
    personId: 'p-sender-1',
    name: 'Carlos Silva',
    phone: '99988887777',
    email: 'carlos@empresa.com',
    relation: 'Expedição',
};

describe('CollectionRequestSheet (W9)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(personsApi.search).mockResolvedValue({ data: [mockSender] } as never);
        vi.mocked(personsApi.getContacts).mockResolvedValue({ data: [mockContact] } as never);
        vi.mocked(intakeDemandsApi.getLastCollectionAddresses).mockResolvedValue({
            data: [
                {
                    address: 'Av Maranhão',
                    number: '500',
                    city: 'Imperatriz',
                    state: 'MA',
                    cep: '65900100',
                    referencePoint: 'Galpão 2',
                },
            ],
        } as never);
        vi.mocked(intakeDemandsApi.requestCollection).mockResolvedValue({ attached: 0, demands: [] } as never);
    });

    it('renderiza seções de contratante e remetente com padrão ágil', async () => {
        render(<CollectionRequestSheet hubId="hub-1" onClose={vi.fn()} onDone={vi.fn()} />);

        // Seção Contratante
        expect(screen.getByText('Contratante / Solicitante')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remetente' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Outro' })).toBeInTheDocument();

        // Seção Remetente e Destinatário
        const inputs = screen.getAllByPlaceholderText('Nome, CNPJ ou CPF');
        expect(inputs.length).toBeGreaterThanOrEqual(1);
    });

    it('ao escolher remetente, preenche endereço e carrega contatos e endereços recentes em poucos toques', async () => {
        const user = userEvent.setup();
        const onDone = vi.fn();
        render(<CollectionRequestSheet hubId="hub-1" onClose={vi.fn()} onDone={onDone} />);

        // 1. Busca e seleciona remetente (primeiro campo PartyPicker)
        const searchInput = screen.getAllByPlaceholderText('Nome, CNPJ ou CPF')[0];
        fireEvent.change(searchInput, { target: { value: 'Distribuidora' } });

        const remetenteHit = await screen.findByText('Distribuidora São Luís LTDA');
        await user.click(remetenteHit);

        // Contato é carregado e exibido como chip
        expect(await screen.findByText('Carlos Silva')).toBeInTheDocument();
        expect(screen.getByText('(Expedição)')).toBeInTheDocument();

        // Endereço é preenchido e fica colapsado (economiza toques e espaço)
        expect(screen.getByText(/Rua Principal, 100/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Alterar' })).toBeInTheDocument();

        // Endereço recente oferecido como chip
        expect(screen.getByText(/Av Maranhão, 500, Imperatriz/)).toBeInTheDocument();

        // Toggles operacionais de ajudante e carga
        const helperToggle = screen.getByRole('button', { name: /Precisa de ajudante/ });
        await user.click(helperToggle);

        // Botão de solicitar coleta fica habilitado
        const submitBtn = screen.getByRole('button', { name: 'Solicitar coleta' });
        expect(submitBtn).toBeEnabled();

        // Envia o payload enriquecido
        await user.click(submitBtn);
        await waitFor(() => {
            expect(intakeDemandsApi.requestCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    senderPersonId: 'p-sender-1',
                    needsHelper: true,
                    contacts: expect.arrayContaining([
                        expect.objectContaining({ name: 'Carlos Silva', role: 'Expedição' }),
                    ]),
                }),
            );
        });
        await waitFor(() => expect(onDone).toHaveBeenCalled());
    });

    it('exibe a nota de averbação quando NF é informada', async () => {
        render(<CollectionRequestSheet hubId="hub-1" onClose={vi.fn()} onDone={vi.fn()} />);
        expect(screen.getByText(AVERBACAO_NOTE)).toBeInTheDocument();
    });
});

describe('CollectionDetailSheet (W9)', () => {
    const cargoItem: HubCargoItem = {
        id: 'item-1',
        kind: 'intake',
        bucket: 'awaiting',
        demandId: 'dem-1',
        status: 'AWAITING_ARRIVAL',
        statusLabel: 'Aguardando chegada',
        invoiceCount: 1,
        weightKg: 100,
        cubedWeightKg: 100,
        effectiveWeightKg: 100,
        volumeM3: 0.5,
        units: 2,
        fiscalValueBRL: 5000,
        allowedActions: { confirmArrival: true, triage: false, view: true, manualEntry: false, selectForTrip: false, openTrip: false },
        blockingReasons: [],
        collectionRequest: {
            senderPersonId: 'p-sender-1',
            senderName: 'Remetente Exemplo LTDA',
            contractingPersonName: 'Contratante Exemplo',
            address: {
                address: 'Rua das Flores',
                number: '123',
                neighborhood: 'Distrito',
                city: 'Imperatriz',
                state: 'MA',
                cep: '65900000',
                referencePoint: 'Portão 3',
                accessInstructions: 'Doca livre',
            },
            contacts: [
                { name: 'Ana Souza', phone: '99988880000', role: 'Gerente', email: 'ana@exemplo.com' },
            ],
            availabilityWindow: '08:00–12:00',
            goodsDescription: 'Peças industriais',
            approxUnits: 2,
            approxWeightKg: 100,
            nfValue: 5000,
            needsHelper: true,
            needsLoading: true,
            requestedDate: '2026-11-05',
            nfKeys: ['35260512345678000190550010000000012345678901'],
            requestedAt: '2026-10-30T10:00:00Z',
        },
    };

    it('exibe contatos com links tel: e WhatsApp, endereço com link Google Maps e botão Copiar resumo', async () => {
        const user = userEvent.setup();
        const writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: writeTextMock },
            configurable: true,
        });

        render(
            <CollectionDetailSheet
                item={cargoItem}
                onClose={vi.fn()}
                onReceive={vi.fn()}
                onCancelled={vi.fn()}
            />,
        );

        // Header e dados
        expect(screen.getByText('Remetente Exemplo LTDA')).toBeInTheDocument();
        expect(screen.getByText('Contratante Exemplo')).toBeInTheDocument();

        // Endereço e Google Maps link
        const mapsLink = screen.getByRole('link', { name: /Maps/ });
        expect(mapsLink).toHaveAttribute('href', expect.stringContaining('google.com/maps'));

        // Contato com tel: e WhatsApp link
        expect(screen.getByText('Ana Souza')).toBeInTheDocument();
        expect(screen.getByText('(Gerente)')).toBeInTheDocument();
        const telLink = screen.getByRole('link', { name: '99988880000' });
        expect(telLink).toHaveAttribute('href', 'tel:+5599988880000');
        const waLink = screen.getByRole('link', { name: 'WhatsApp' });
        expect(waLink).toHaveAttribute('href', 'https://wa.me/5599988880000');

        // Botão copiar resumo
        const copyBtn = screen.getByRole('button', { name: 'Copiar resumo (WhatsApp)' });
        await user.click(copyBtn);
        expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('SOLICITAÇÃO DE COLETA'));
        expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('Remetente Exemplo LTDA'));
    });
});
