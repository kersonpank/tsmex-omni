import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonAutocomplete } from './PersonAutocomplete';
import { PersonFormModal } from './PersonFormModal';

vi.mock('../../lib/api', () => ({ personsApi: { search: vi.fn(), update: vi.fn(), create: vi.fn() } }));
vi.mock('./DocumentInput', () => ({ DocumentInput: ({ onImport }: any) => <button type="button" onClick={() => onImport?.({ stateRegistration: '111111111' })}>Consultar fonte externa</button> }));
vi.mock('../manifest/FiscalAddressFields', () => ({ FiscalAddressFields: () => <div>Endereço</div> }));

describe('pessoa existente no pedido', () => {
  const person = { id: 'person', document: '11222333000181', documentType: 'CNPJ', legalName: 'Empresa', cityIbgeCode: '3550308', stateRegistration: '' } as any;
  it('oferece edição sem sugerir criar a pessoa selecionada e preenche IE da NF-e', () => {
    render(<PersonAutocomplete value={person} onChange={vi.fn()} stateRegistrationSuggestion={{ document: person.document, value: '123456789', source: 'XML da NF-e' }} />);
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.queryByText('+ Cadastrar nova pessoa')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Editar pessoa selecionada/ }));
    expect(screen.getByDisplayValue('123456789')).toBeInTheDocument();
    expect(screen.getByText(/encontrada em XML da NF-e/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Consultar fonte externa' }));
    expect(screen.getByDisplayValue('123456789')).toBeInTheDocument();
  });
  it('mantém a IE cadastrada até o operador confirmar a divergência', () => {
    render(<PersonFormModal mode="edit" personId="person" initialValues={{ ...person, stateRegistration: '987654321' }} onClose={vi.fn()} onSuccess={vi.fn()} stateRegistrationSuggestion={{ value: '123456789', source: 'XML da NF-e' }} />);
    expect(screen.getByDisplayValue('987654321')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('123456789')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Usar IE da NF-e' }));
    expect(screen.getByDisplayValue('123456789')).toBeInTheDocument();
  });
});
