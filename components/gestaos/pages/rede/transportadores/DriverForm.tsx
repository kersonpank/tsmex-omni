import React, { useEffect, useState } from 'react';
import { linksApi, personsApi } from '../../../../../lib/api';
import type { Driver } from '../../../../../types/index';
import { UFS, digits, driverToDraft, type RegistryDriver } from '../../../../os/lib/carrier';
import { invalidate } from '../../../lib/resource';
import { Button, Field, ModeBadge, SelectInput, TextInput } from '../../../ui/kit';
import { DateInput, FormFooter, FormSection, formatCnpjCpf, isValidCpf, isoToDateInput } from '../../../ui/form';
import { useAction } from '../../../ui/overlay';
import { PersonPicker, type PersonSummary } from '../../../ui/pickers';
import { AddressBlock, addressBody, addressFrom, addressReady, type AddressValue } from './AddressBlock';

const CATEGORIES = ['E', 'D', 'C', 'B', 'AE', 'AD', 'AC'];

/** Motorista com o que o e-Frete (Gravar Motorista) e o MDF-e (condutor) exigem. Se o CPF já existe, reaproveita. */
export const DriverForm: React.FC<{ linkId: string; driver: RegistryDriver | null; onDone: () => void; onCancel: () => void }> = ({ linkId, driver, onDone, onCancel }) => {
    const { busy, run } = useAction();
    const [name, setName] = useState(driver?.name ?? '');
    const [cpf, setCpf] = useState(driver?.document ?? '');
    const [phone, setPhone] = useState(driver?.phone ?? '');
    const [birthDate, setBirthDate] = useState(isoToDateInput(driver?.birthDate));
    const [cnhNumber, setCnhNumber] = useState(driver?.cnhNumber ?? '');
    const [cnhCategory, setCnhCategory] = useState(driver?.cnhCategory ?? 'E');
    const [cnhExpiry, setCnhExpiry] = useState(isoToDateInput(driver?.cnhExpiry));
    const [cnhState, setCnhState] = useState(driver?.cnhState ?? driver?.person?.state ?? '');
    const [address, setAddress] = useState<AddressValue>(() => addressFrom(driver?.person));
    const [reuseNote, setReuseNote] = useState<string | null>(null);
    const [touched, setTouched] = useState(false);

    // CPF completo: pessoa/motorista já cadastrados voltam preenchidos (Copilot).
    useEffect(() => {
        const cpfDigits = digits(cpf);
        if (driver || cpfDigits.length !== 11) {
            setReuseNote(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const person = ((await personsApi.search(cpfDigits, 'CPF')).data ?? []).find((p) => digits(p.document) === cpfDigits);
                const rows = ((await linksApi.searchDrivers(cpfDigits)).data ?? []) as Driver[];
                const existing = rows.find((d) => digits(d.document) === cpfDigits) ?? person?.drivers?.[0];
                if (cancelled || (!person && !existing)) return;
                const draft = driverToDraft({ ...(existing ?? {}), name: (existing as Driver | undefined)?.name ?? person?.legalName ?? '' } as Parameters<typeof driverToDraft>[0]);
                setName(draft.name);
                if (existing) {
                    setPhone(draft.phone);
                    setBirthDate(draft.birthDate);
                    setCnhNumber(draft.cnhNumber);
                    setCnhCategory(draft.cnhCategory);
                    setCnhExpiry(draft.cnhExpiry);
                }
                setCnhState(draft.cnhState || person?.state || '');
                if (person) setAddress(addressFrom(person));
                setReuseNote(existing ? 'Motorista já cadastrado: dados reaproveitados.' : 'Pessoa já cadastrada: será usada como motorista.');
            } catch {
                if (!cancelled) setReuseNote(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [cpf, driver]);

    const errors = {
        name: name.trim() ? null : 'Informe o nome.',
        cpf: driver || isValidCpf(cpf) ? null : 'CPF inválido.',
        phone: digits(phone).length >= 10 ? null : 'Telefone com DDD.',
        birthDate: birthDate ? null : 'Informe o nascimento.',
        cnhNumber: cnhNumber.trim() ? null : 'Informe a CNH.',
        cnhExpiry: cnhExpiry ? null : 'Informe a validade da CNH.',
        address: addressReady(address) ? null : 'Informe o CEP e o número; o município precisa estar confirmado.',
    };
    const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (Object.values(errors).some(Boolean)) return;
        const payload = { name: name.trim(), phone: digits(phone), birthDate, cnhNumber: cnhNumber.trim(), cnhCategory, cnhExpiry, ...(cnhState ? { cnhState } : {}), updatePersonAddress: true, address: addressBody(address) };
        const ok = await run('driver:save', () => (driver ? linksApi.updateDriver(linkId, driver.id, payload) : linksApi.createDriver(linkId, { ...payload, document: digits(cpf) })), {
            success: driver ? 'Motorista atualizado.' : 'Motorista cadastrado.',
            error: 'Não foi possível salvar o motorista.',
        });
        if (ok) {
            invalidate('links:', 'vehicle-types');
            onDone();
        }
    };

    return (
        <form onSubmit={save} noValidate>
            <FormSection title={driver ? driver.name : 'Novo motorista'} hint="Dados exigidos pelo CIOT (e-Frete) e pelo MDF-e.">
                {driver ? (
                    <p className="gx-muted col-span-full text-[13px]">CPF <span className="gx-mono">{formatCnpjCpf(driver.document)}</span></p>
                ) : (
                    <Field label="CPF" error={show('cpf')}>
                        <TextInput className="gx-mono" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
                    </Field>
                )}
                {reuseNote ? <p className="col-span-full flex items-center gap-2 text-[13px]"><ModeBadge mode="copilot" /> {reuseNote}</p> : null}
                <Field label="Nome completo" error={show('name')}>
                    <TextInput value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Celular com DDD" error={show('phone')}>
                    <TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
                <Field label="Nascimento" error={show('birthDate')}>
                    <DateInput value={birthDate} onChange={(v) => setBirthDate(v ?? '')} aria-label="Nascimento" />
                </Field>
            </FormSection>
            <FormSection title="CNH" cols={2}>
                <Field label="Número da CNH" error={show('cnhNumber')}>
                    <TextInput inputMode="numeric" value={cnhNumber} onChange={(e) => setCnhNumber(e.target.value)} />
                </Field>
                <Field label="Categoria">
                    <SelectInput value={cnhCategory} onChange={(e) => setCnhCategory(e.target.value)}>
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </SelectInput>
                </Field>
                <Field label="Validade" error={show('cnhExpiry')}>
                    <DateInput value={cnhExpiry} onChange={(v) => setCnhExpiry(v ?? '')} aria-label="Validade da CNH" />
                </Field>
                <Field label="UF da CNH">
                    <SelectInput value={cnhState} onChange={(e) => setCnhState(e.target.value)}>
                        <option value="">—</option>
                        {UFS.map((uf) => <option key={uf}>{uf}</option>)}
                    </SelectInput>
                </Field>
            </FormSection>
            <FormSection title="Endereço do motorista">
                <AddressBlock value={address} onChange={setAddress} error={show('address')} />
            </FormSection>
            <FormFooter secondary={<Button onClick={onCancel} disabled={busy != null}>Voltar à ficha</Button>} primary={<Button type="submit" variant="primary" loading={busy === 'driver:save'}>Salvar motorista</Button>} />
        </form>
    );
};

/** Vincula um motorista que já existe como pessoa (CPF) a este transportador. */
export const LinkDriverPicker: React.FC<{ linkId: string; onDone: () => void }> = ({ linkId, onDone }) => {
    const { busy, run } = useAction();
    const [person, setPerson] = useState<PersonSummary | null>(null);
    const link = async () => {
        if (!person) return;
        const ok = await run('driver:link', () => personsApi.asDriver(person.id, linkId), { success: `${person.legalName} vinculado como motorista.`, error: 'Não foi possível vincular.' });
        if (ok) {
            setPerson(null);
            invalidate('links:', 'vehicle-types');
            onDone();
        }
    };
    return (
        <div className="flex flex-wrap items-end gap-3">
            <Field label="Vincular motorista já cadastrado (CPF)" className="min-w-[260px] flex-1">
                <PersonPicker value={person} onChange={(next) => setPerson(next)} documentType="CPF" allowCreate={false} ariaLabel="Motorista existente" />
            </Field>
            <Button onClick={link} disabled={!person} loading={busy === 'driver:link'}>Vincular</Button>
        </div>
    );
};
