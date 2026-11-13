import React, { useEffect, useState } from 'react';
import { cnpjApi, personsApi } from '../../../../../lib/api';
import type { Person } from '../../../../../types/index';
import { buildPersonPayload, EMPTY_PERSON_FORM, isEmitterPerson, personErrors, personFormFrom, type PersonDocType, type PersonFormValues } from '../../../lib/redeCadastro';
import { invalidate } from '../../../lib/resource';
import { FormCell, FormFooter, FormSection, FULL_ROW, formatCnpjCpf, isValidCnpj, isValidCpf, onlyDigits, Toggle, useForm } from '../../../ui/form';
import { Button, Field, SelectInput, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { CepField, CityPicker } from '../../../ui/pickers';

interface Props {
    person: Person | null;
    /** Abre o cadastro de uma pessoa que já existe com o mesmo documento. */
    onOpenExisting: (id: string) => void;
    onSaved: (person: Person) => void;
    onCancel: () => void;
}

/** Criar e editar pessoa: dados, endereço (CEP/cidade confirmados), IE, IM e RNTRC. */
export const PersonForm: React.FC<Props> = ({ person, onOpenExisting, onSaved, onCancel }) => {
    const editing = Boolean(person);
    const isEmitter = isEmitterPerson(person);
    const form = useForm<PersonFormValues>(person ? personFormFrom(person) : EMPTY_PERSON_FORM);
    const { values, errors, set } = form;
    const { busy, run } = useAction();
    const [existing, setExisting] = useState<{ id: string; legalName: string } | null>(null);
    const [importing, setImporting] = useState(false);
    const [importNote, setImportNote] = useState<string | null>(null);
    const digits = onlyDigits(values.document);
    const docValid = values.documentType === 'CPF' ? isValidCpf(digits) : isValidCnpj(digits);

    // Copilot: documento válido e novo → avisa se a pessoa já existe antes de cadastrar em duplicidade.
    useEffect(() => {
        setExisting(null);
        if (editing || !docValid) return;
        let current = true;
        const timer = window.setTimeout(() => {
            personsApi.lookupDocument(digits).then((response) => {
                const found = response.data?.person as { id: string; legalName: string } | null | undefined;
                if (current && found) setExisting({ id: found.id, legalName: found.legalName });
            }).catch(() => undefined);
        }, 350);
        return () => {
            current = false;
            window.clearTimeout(timer);
        };
    }, [editing, docValid, digits]);

    const importFromReceita = async () => {
        setImporting(true);
        setImportNote(null);
        try {
            const response = await cnpjApi.consult(digits);
            const data = (response?.data ?? response) as Record<string, any>;
            const address = data.address ?? {};
            form.setMany({
                legalName: data.legalName || values.legalName,
                tradeName: data.tradeName || values.tradeName,
                address: address.street || values.address,
                number: address.number || values.number,
                complement: address.complement || values.complement,
                neighborhood: address.neighborhood || values.neighborhood,
                city: address.city || values.city,
                state: address.state || values.state,
                cityIbgeCode: address.cityIbgeCode || '',
                cep: onlyDigits(address.zipCode) || values.cep,
                stateRegistration: values.stateRegistration || data.stateRegistration || '',
            });
            setImportNote(`Dados preenchidos pela Receita${data.situation ? ` (situação: ${data.situation})` : ''}. Confira antes de gravar.${address.cityIbgeCode ? '' : ' Município sem código IBGE: escolha a cidade na busca.'}`);
        } catch (cause) {
            const status = (cause as { response?: { status?: number } })?.response?.status;
            setImportNote(status === 404 ? 'CNPJ não encontrado na Receita.' : status === 429 ? 'Muitas consultas seguidas; tente de novo em instantes.' : 'A consulta ao CNPJ falhou. Preencha à mão.');
        } finally {
            setImporting(false);
        }
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const found = personErrors(values, isEmitter);
        form.clearErrors();
        for (const [field, message] of Object.entries(found)) form.setError(field as keyof PersonFormValues, message ?? null);
        if (Object.keys(found).length > 0) return;
        let saved: Person | null = null;
        const ok = await run(
            editing ? 'person:edit' : 'person:new',
            async () => {
                const payload = buildPersonPayload(values, editing);
                const response = person ? await personsApi.update(person.id, payload) : await personsApi.create(payload);
                saved = response.data;
            },
            { success: editing ? 'Pessoa atualizada.' : 'Pessoa cadastrada.', error: 'A pessoa não foi salva.' },
        );
        if (ok && saved) {
            invalidate('persons:', 'clients:', 'hubs');
            onSaved(saved);
        }
    };

    const ie = values.stateRegistration.trim().toUpperCase();

    return (
        <form onSubmit={submit} noValidate className="flex flex-col gap-1">
            <FormSection title="Documento" mode={editing ? undefined : 'copilot'} hint={editing ? undefined : 'O sistema confere se a pessoa já existe e, para CNPJ, preenche pela Receita.'}>
                <Field label="Tipo">
                    <SelectInput value={values.documentType} onChange={(e) => set('documentType', e.target.value as PersonDocType)} aria-label="Tipo de documento">
                        <option value="CNPJ">CNPJ (empresa)</option>
                        <option value="CPF">CPF (pessoa)</option>
                    </SelectInput>
                </Field>
                <Field label="Documento" error={errors.document}>
                    <TextInput inputMode="numeric" value={formatCnpjCpf(values.document)} placeholder={values.documentType === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'} onChange={(e) => set('document', onlyDigits(e.target.value).slice(0, values.documentType === 'CPF' ? 11 : 14))} aria-invalid={Boolean(errors.document) || undefined} />
                </Field>
                {existing ? (
                    <div className={`${FULL_ROW} gx-inset flex flex-wrap items-center justify-between gap-2 px-3 py-2.5`} role="status">
                        <span className="text-[13.5px]">Já existe cadastro com este documento: <strong>{existing.legalName}</strong>.</span>
                        <Button size="sm" variant="soft" onClick={() => onOpenExisting(existing.id)}>Abrir cadastro</Button>
                    </div>
                ) : null}
                {values.documentType === 'CNPJ' && docValid && !editing ? (
                    <div className={`${FULL_ROW} flex flex-wrap items-center gap-3`}>
                        <Button size="sm" variant="soft" loading={importing} onClick={() => void importFromReceita()}>Preencher pela Receita</Button>
                        {importNote ? <span className="gx-muted text-[13px]" role="status">{importNote}</span> : null}
                    </div>
                ) : null}
                <Field label="Nome / razão social" error={errors.legalName} className={FULL_ROW}>
                    <TextInput value={values.legalName} onChange={(e) => set('legalName', e.target.value)} aria-invalid={Boolean(errors.legalName) || undefined} />
                </Field>
                <Field label="Nome fantasia" className={FULL_ROW}>
                    <TextInput value={values.tradeName} onChange={(e) => set('tradeName', e.target.value)} />
                </Field>
            </FormSection>

            <FormSection title="Endereço" hint="O CEP preenche rua, bairro e cidade. A cidade precisa vir da base do IBGE (vale para CT-e e MDF-e).">
                <Field label="CEP">
                    <CepField
                        value={values.cep}
                        onChange={(cep) => set('cep', cep)}
                        onResolve={(a) => form.setMany({ cep: a.cep, address: a.street || values.address, neighborhood: a.neighborhood || values.neighborhood, city: a.city, state: a.state, cityIbgeCode: a.ibgeCode })}
                    />
                </Field>
                <FormCell>
                    <span className="gx-label mb-1.5 block">Cidade</span>
                    <CityPicker
                        ariaLabel="Cidade da pessoa"
                        invalid={Boolean(errors.city)}
                        value={values.cityIbgeCode ? { city: values.city, state: values.state, ibgeCode: values.cityIbgeCode } : null}
                        onChange={(city) => form.setMany(city ? { city: city.city, state: city.state, cityIbgeCode: city.ibgeCode } : { city: '', state: '', cityIbgeCode: '' })}
                    />
                    {errors.city ? <span className="gx-red-text mt-1 block text-[12.5px]">{errors.city}</span> : null}
                    {!values.cityIbgeCode && values.city ? <span className="gx-muted mt-1 block text-[12.5px]">Cadastro antigo: {values.city}/{values.state}. Busque a cidade para confirmar.</span> : null}
                </FormCell>
                <Field label="Rua" className={FULL_ROW}>
                    <TextInput value={values.address} onChange={(e) => set('address', e.target.value)} />
                </Field>
                <Field label="Número">
                    <TextInput value={values.number} onChange={(e) => set('number', e.target.value)} />
                </Field>
                <Field label="Complemento">
                    <TextInput value={values.complement} onChange={(e) => set('complement', e.target.value)} />
                </Field>
                <Field label="Bairro" className={FULL_ROW}>
                    <TextInput value={values.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />
                </Field>
            </FormSection>

            <FormSection title="Fiscal" hint={isEmitter ? 'Esta pessoa emite documento fiscal: a Inscrição Estadual é obrigatória (ou ISENTO).' : undefined}>
                <FormCell>
                    <Field label="Inscrição Estadual" error={errors.stateRegistration}>
                        <TextInput value={ie === 'ISENTO' ? 'ISENTO' : values.stateRegistration} disabled={ie === 'ISENTO'} placeholder="Apenas números" onChange={(e) => set('stateRegistration', e.target.value)} aria-invalid={Boolean(errors.stateRegistration) || undefined} />
                    </Field>
                    <Toggle className="mt-2" checked={ie === 'ISENTO'} onChange={(checked) => set('stateRegistration', checked ? 'ISENTO' : '')} label="Isento" />
                </FormCell>
                <Field label="Inscrição Municipal">
                    <TextInput value={values.municipalRegistration} placeholder="Opcional" onChange={(e) => set('municipalRegistration', e.target.value)} />
                </Field>
                {editing ? (
                    <Field label="RNTRC (transportador)" error={errors.rntrc} hint="8 ou 9 dígitos. Vale para viagens ofertadas depois da mudança." className={FULL_ROW}>
                        <TextInput inputMode="numeric" value={values.rntrc} onChange={(e) => set('rntrc', onlyDigits(e.target.value).slice(0, 9))} aria-invalid={Boolean(errors.rntrc) || undefined} />
                    </Field>
                ) : null}
            </FormSection>

            <FormFooter
                secondary={<Button onClick={onCancel} disabled={busy != null}>Cancelar</Button>}
                primary={<Button type="submit" variant="primary" loading={busy === 'person:new' || busy === 'person:edit'}>{editing ? 'Salvar pessoa' : 'Cadastrar pessoa'}</Button>}
            />
        </form>
    );
};
