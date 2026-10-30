import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { intakeDemandsApi, personsApi } from '../../../lib/api';
import type {
    CollectionContact,
    CollectionPackageDimension,
    CreateCollectionRequestPayload,
    HubCargoItem,
    Person,
    PersonContact,
} from '../../../types/index';
import {
    AVERBACAO_NOTE,
    addressLine,
    collectionFormError,
    dedupeAddresses,
    parseNfKeys,
    todayIso,
} from '../lib/collection';
import { EMPTY_PACKAGE_ROW, parsePackageRows, type PackageRow } from '../lib/packages';
import AddressFields, { addressFrom, EMPTY_ADDRESS, type AddressValue } from '../ui/AddressFields';
import { OsBadge, OsButton } from '../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../ui/Sheet';
import PartyPicker from './entry/PartyPicker';
import PackageRows from './order/PackageRows';

const WINDOWS = ['', 'Manhã', 'Tarde', 'Dia todo'];
const TIME_PRESETS = ['08:00–12:00', '13:00–18:00', '08:00–18:00'];
const LABEL = 'mt-3 block text-[13px] font-bold text-tower-600 dark:text-tower-300';

/**
 * Solicitar coleta: o hub pede ao remetente que a carga seja coletada. Cria uma entrada esperada
 * (Aguardando chegada) marcada como coleta; ao dar entrada, o serviço parte da cidade do remetente.
 */
const CollectionRequestSheet: React.FC<{
    hubId: string;
    /** Modo NF: anexa a coleta a esta entrada que já aguarda (remetente vem da NF/XML). */
    attachTo?: HubCargoItem;
    onClose: () => void;
    onDone: () => void;
}> = ({ hubId, attachTo, onClose, onDone }) => {
    // 1. Contratante
    const [contractorMode, setContractorMode] = useState<'same_as_sender' | 'other'>('same_as_sender');
    const [contractingPerson, setContractingPerson] = useState<Person | null>(null);
    const [contractingContacts, setContractingContacts] = useState<PersonContact[]>([]);

    // 2. Remetente
    const [sender, setSender] = useState<Person | null>(null);
    const [senderContacts, setSenderContacts] = useState<PersonContact[]>([]);
    const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
    const [showAddContact, setShowAddContact] = useState(false);
    const [newContactName, setNewContactName] = useState('');
    const [newContactPhone, setNewContactPhone] = useState('');
    const [newContactEmail, setNewContactEmail] = useState('');
    const [newContactRole, setNewContactRole] = useState('');
    const [savingContact, setSavingContact] = useState(false);
    const [contactError, setContactError] = useState<string | null>(null);
    const [availabilityWindow, setAvailabilityWindow] = useState('');

    // 3. Endereço de coleta
    const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
    const [editingAddress, setEditingAddress] = useState(false);
    const [recentAddresses, setRecentAddresses] = useState<AddressValue[]>([]);
    const [referencePoint, setReferencePoint] = useState('');
    const [accessInstructions, setAccessInstructions] = useState('');

    // 4. Destinatário (opcional)
    const [destinatario, setDestinatario] = useState<Person | null>(null);

    // 5. Mercadoria
    const [keysText, setKeysText] = useState('');
    const [goodsDescription, setGoodsDescription] = useState('');
    const [units, setUnits] = useState('');
    const [weightKg, setWeightKg] = useState('');
    const [nfValue, setNfValue] = useState('');
    const [packageRows, setPackageRows] = useState<PackageRow[]>([{ ...EMPTY_PACKAGE_ROW }]);
    const [showDimensions, setShowDimensions] = useState(false);
    const checkedKeysRef = useRef<Set<string>>(new Set());

    // 6. Serviço
    const [needsHelper, setNeedsHelper] = useState(false);
    const [needsLoading, setNeedsLoading] = useState(false);
    const [date, setDate] = useState(todayIso());
    const [windowLabel, setWindowLabel] = useState('');
    const [note, setNote] = useState('');

    // Estado geral
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [linked, setLinked] = useState<string | null>(null);

    // NF que já aguarda: o remetente e o endereço vêm da própria nota (XML ou CNPJ da chave).
    useEffect(() => {
        if (!attachTo?.demandId) return;
        let cancelled = false;
        intakeDemandsApi
            .getLocalNfeData(attachTo.demandId)
            .then((body) => {
                if (cancelled) return;
                const parties = body.data?.parties;
                if (parties?.remetente) {
                    pickSender(parties.remetente);
                }
                if (parties?.destinatario) {
                    setDestinatario(parties.destinatario);
                }
                const cargo = body.data?.cargo as any;
                if (cargo) {
                    if (cargo.produtos?.[0]?.descricao && !goodsDescription) {
                        setGoodsDescription(cargo.produtos.map((p: any) => p.descricao).filter(Boolean).slice(0, 3).join(', '));
                    }
                    if (cargo.quantidadeVolumes && !units) setUnits(String(cargo.quantidadeVolumes));
                    if ((cargo.pesoBruto || cargo.pesoLiquido) && !weightKg) {
                        setWeightKg(String(cargo.pesoBruto ?? cargo.pesoLiquido));
                    }
                    if (cargo.valorTotalNota && !nfValue) setNfValue(String(cargo.valorTotalNota));
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [attachTo?.demandId]);

    // Carrega contatos e endereços recentes do remetente
    useEffect(() => {
        if (!sender?.id) {
            setSenderContacts([]);
            setSelectedContactIds([]);
            setRecentAddresses([]);
            return;
        }
        let cancelled = false;

        personsApi
            .getContacts(sender.id)
            .then((body) => {
                if (!cancelled) {
                    const contacts = body.data ?? [];
                    setSenderContacts(contacts);
                    if (contacts.length > 0) {
                        // Seleciona o primeiro contato automaticamente para agilizar o operador
                        setSelectedContactIds([contacts[0].id]);
                    }
                }
            })
            .catch(() => undefined);

        intakeDemandsApi
            .getLastCollectionAddresses(sender.id)
            .then((body) => {
                if (!cancelled) {
                    const unique = dedupeAddresses((body.data ?? []) as any);
                    setRecentAddresses(
                        unique.map((a) => ({
                            cep: a.cep ?? '',
                            address: a.address ?? '',
                            number: a.number ?? '',
                            complement: a.complement ?? '',
                            neighborhood: a.neighborhood ?? '',
                            city: a.city ?? '',
                            state: a.state ?? '',
                            cityIbgeCode: a.cityIbgeCode ?? '',
                            referencePoint: a.referencePoint ?? '',
                            accessInstructions: a.accessInstructions ?? '',
                        })),
                    );
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [sender?.id]);

    // Carrega contatos do contratante quando for diferente do remetente
    useEffect(() => {
        if (contractorMode !== 'other' || !contractingPerson?.id) {
            setContractingContacts([]);
            return;
        }
        let cancelled = false;
        personsApi
            .getContacts(contractingPerson.id)
            .then((body) => {
                if (!cancelled) setContractingContacts(body.data ?? []);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [contractorMode, contractingPerson?.id]);

    // Consulta de NF por chave: preenche automaticamente produtos, volumes, peso, valor e destinatário
    useEffect(() => {
        const keys = parseNfKeys(keysText);
        if (keys.length === 0) return;
        const firstKey = keys[0];
        if (checkedKeysRef.current.has(firstKey)) return;
        checkedKeysRef.current.add(firstKey);

        let cancelled = false;
        intakeDemandsApi
            .lookupNfeCargo(firstKey)
            .then((res) => {
                if (cancelled || !res.data?.found) return;
                const { cargo, parties } = res.data;
                if (cargo?.goodsDescription && !goodsDescription) setGoodsDescription(cargo.goodsDescription);
                if (cargo?.units && !units) setUnits(String(cargo.units));
                if (cargo?.weightKg && !weightKg) setWeightKg(String(cargo.weightKg));
                if (cargo?.nfValue && !nfValue) setNfValue(String(cargo.nfValue));
                if (parties?.destinatario && !destinatario) setDestinatario(parties.destinatario);
                if (parties?.remetente && !sender) pickSender(parties.remetente);
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [keysText]);

    const pickSender = (person: Person | null) => {
        setSender(person);
        setAddress(person ? addressFrom(person) : EMPTY_ADDRESS);
        setEditingAddress(false);
        setError(null);
    };

    const toggleContact = (contactId: string) => {
        setSelectedContactIds((prev) =>
            prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId],
        );
    };

    const saveNewContact = async () => {
        if (!sender?.id || !newContactName.trim() || savingContact) return;
        setSavingContact(true);
        setContactError(null);
        try {
            const body = await personsApi.createContact(sender.id, {
                name: newContactName.trim(),
                phone: newContactPhone.trim() || undefined,
                email: newContactEmail.trim() || undefined,
                role: newContactRole.trim() || undefined,
            });
            const created = body.data;
            setSenderContacts((prev) => [...prev, created]);
            setSelectedContactIds((prev) => [...prev, created.id]);
            setNewContactName('');
            setNewContactPhone('');
            setNewContactEmail('');
            setNewContactRole('');
            setShowAddContact(false);
        } catch (cause) {
            setContactError(apiErrorMessage(cause, 'Não foi possível salvar o contato.'));
        } finally {
            setSavingContact(false);
        }
    };

    const applyRecentAddress = (rec: AddressValue) => {
        setAddress(rec);
        if ((rec as any).referencePoint && !referencePoint) setReferencePoint((rec as any).referencePoint);
        if ((rec as any).accessInstructions && !accessInstructions) setAccessInstructions((rec as any).accessInstructions);
        setEditingAddress(false);
    };

    const keys = attachTo ? [] : parseNfKeys(keysText);
    const parsedDims = parsePackageRows(packageRows);

    const problem = collectionFormError({
        senderId: sender?.id ?? null,
        address,
        requestedDate: date,
        weightKg: attachTo ? '' : weightKg,
        units: attachTo ? '' : units,
        keysText: attachTo ? '' : keysText,
        nfValue: attachTo ? '' : nfValue,
    });

    const submit = async () => {
        if (problem || !sender || busy) return;
        setBusy(true);
        setError(null);
        try {
            // Mapeia os contatos selecionados
            const chosenContacts: CollectionContact[] = senderContacts
                .filter((c) => selectedContactIds.includes(c.id))
                .map((c) => ({
                    personContactId: c.id,
                    name: c.name,
                    phone: c.phone ?? undefined,
                    email: c.email ?? undefined,
                    role: c.relation ?? undefined,
                }));

            const effectiveContractorId = contractorMode === 'other' && contractingPerson ? contractingPerson.id : sender.id;

            const payload: CreateCollectionRequestPayload = {
                expectedHubId: hubId,
                senderPersonId: sender.id,
                contractingPersonId: effectiveContractorId,
                contacts: chosenContacts.length > 0 ? chosenContacts : undefined,
                address: {
                    cep: address.cep.replace(/\D/g, '') || undefined,
                    address: address.address || undefined,
                    number: address.number || undefined,
                    complement: address.complement || undefined,
                    neighborhood: address.neighborhood || undefined,
                    city: address.city || undefined,
                    state: address.state || undefined,
                    cityIbgeCode: address.cityIbgeCode || undefined,
                    referencePoint: referencePoint.trim() || undefined,
                    accessInstructions: accessInstructions.trim() || undefined,
                },
                referencePoint: referencePoint.trim() || undefined,
                accessInstructions: accessInstructions.trim() || undefined,
                destinatarioPersonId: destinatario?.id || undefined,
                goodsDescription: goodsDescription.trim() || undefined,
                requestedDate: date,
                windowLabel: windowLabel || undefined,
                availabilityWindow: availabilityWindow.trim() || undefined,
                approxWeightKg: weightKg.trim() ? Number(weightKg.replace(',', '.')) : undefined,
                approxUnits: units.trim() ? Number(units) : undefined,
                nfValue: nfValue.trim() ? Number(nfValue.replace(/[^\d.,]/g, '').replace(',', '.')) : undefined,
                packageDimensions: parsedDims.length > 0 ? (parsedDims as CollectionPackageDimension[]) : undefined,
                needsHelper,
                needsLoading,
                nfKeys: keys.length > 0 ? keys : undefined,
                note: note.trim() || undefined,
            };

            if (attachTo?.demandId) {
                await intakeDemandsApi.attachCollection(attachTo.demandId, payload);
                onDone();
                return;
            }
            const body = await intakeDemandsApi.requestCollection(payload);
            if (body.attached > 0) setLinked(body.message ?? 'NF já estava aguardando — coleta vinculada.');
            else onDone();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível solicitar a coleta. Tente de novo.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <OsSheet
            title={attachTo ? 'Solicitar coleta desta NF' : 'Solicitar coleta'}
            subtitle={attachTo?.nfNumber ? `NF ${attachTo.nfNumber} — sem coleta, a carga é entregue direto no hub` : 'A carga será coletada no remetente e esperada neste hub'}
            onClose={onClose}
            footer={
                linked ? (
                    <OsButton full onClick={onDone}>
                        Fechar
                    </OsButton>
                ) : (
                    <>
                        {error ? <p role="alert" className="mb-2 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
                        <OsButton full disabled={Boolean(problem) || busy} onClick={() => void submit()}>
                            {busy ? 'Solicitando…' : 'Solicitar coleta'}
                        </OsButton>
                        {problem && sender ? <p className="mt-2 text-center text-[12px] text-tower-500">{problem}</p> : null}
                    </>
                )
            }
        >
            {linked ? (
                <p role="status" className="rounded-xl border-l-4 border-brand-500 bg-brand-500/8 p-3 text-[14px] font-semibold text-brand-700 dark:text-brand-200">
                    {linked}
                </p>
            ) : null}

            {/* SEÇÃO A: Contratante / quem solicita */}
            <div className="rounded-2xl border border-tower-200 bg-tower-50/50 p-3 dark:border-tower-800 dark:bg-tower-900/40">
                <div className="flex items-center justify-between">
                    <span className="text-[13px] font-bold text-tower-700 dark:text-tower-200">Contratante / Solicitante</span>
                    <div className="flex items-center gap-1 rounded-xl bg-tower-200/60 p-0.5 text-[12px] font-semibold dark:bg-tower-800">
                        <button
                            type="button"
                            onClick={() => setContractorMode('same_as_sender')}
                            className={clsx(
                                'rounded-lg px-2.5 py-1 transition-all',
                                contractorMode === 'same_as_sender'
                                    ? 'bg-white font-bold text-tower-900 shadow-sm dark:bg-tower-700 dark:text-white'
                                    : 'text-tower-500 hover:text-tower-800 dark:text-tower-400',
                            )}
                        >
                            Remetente
                        </button>
                        <button
                            type="button"
                            onClick={() => setContractorMode('other')}
                            className={clsx(
                                'rounded-lg px-2.5 py-1 transition-all',
                                contractorMode === 'other'
                                    ? 'bg-white font-bold text-tower-900 shadow-sm dark:bg-tower-700 dark:text-white'
                                    : 'text-tower-500 hover:text-tower-800 dark:text-tower-400',
                            )}
                        >
                            Outro
                        </button>
                    </div>
                </div>

                {contractorMode === 'other' ? (
                    <div className="mt-2.5">
                        <PartyPicker label="Quem solicita / paga o frete" value={contractingPerson} source="manual" onChange={(p) => setContractingPerson(p)} />
                        {contractingContacts.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="text-[11px] font-medium text-tower-400">Contatos salvos:</span>
                                {contractingContacts.map((c) => (
                                    <span key={c.id} className="rounded-md bg-tower-200/60 px-2 py-0.5 text-[11px] font-semibold text-tower-700 dark:bg-tower-800 dark:text-tower-300">
                                        {c.name} {c.phone ? `(${c.phone})` : ''}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <p className="mt-1 text-[12px] text-tower-500">
                        {sender ? `Mesmo que o remetente (${sender.tradeName || sender.legalName})` : 'Padrão: o frete é solicitado pelo próprio remetente'}
                    </p>
                )}
            </div>

            {/* SEÇÃO B: Remetente */}
            <div className="mt-3">
                <PartyPicker label="Remetente" value={sender} source="manual" onChange={(person) => pickSender(person)} />

                {sender ? (
                    <div className="mt-3 rounded-2xl border border-tower-200 p-3 dark:border-tower-800">
                        <div className="flex items-center justify-between">
                            <p className="text-[13px] font-bold text-tower-700 dark:text-tower-200">Quem atende na coleta</p>
                            <button
                                type="button"
                                onClick={() => setShowAddContact(!showAddContact)}
                                className="text-[12px] font-bold text-brand-600 hover:text-brand-700 dark:text-brand-400"
                            >
                                {showAddContact ? 'Fechar' : '+ Novo contato'}
                            </button>
                        </div>

                        {/* Chips de contatos salvos */}
                        {senderContacts.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {senderContacts.map((c) => {
                                    const selected = selectedContactIds.includes(c.id);
                                    return (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => toggleContact(c.id)}
                                            className={clsx(
                                                'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-left text-[12px] font-medium transition-all',
                                                selected
                                                    ? 'border-brand-500 bg-brand-50 text-brand-800 shadow-sm dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-200'
                                                    : 'border-tower-200 bg-white text-tower-600 hover:border-tower-300 dark:border-tower-700 dark:bg-tower-800 dark:text-tower-300',
                                            )}
                                        >
                                            <span className={clsx('h-2 w-2 rounded-full', selected ? 'bg-brand-500' : 'bg-tower-300 dark:bg-tower-600')} />
                                            <span className="font-bold">{c.name}</span>
                                            {c.relation ? <span className="opacity-75">({c.relation})</span> : null}
                                            {c.phone ? <span className="font-mono text-[11px] opacity-80">{c.phone}</span> : null}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="mt-1 text-[12px] text-tower-400">Nenhum contato cadastrado no remetente ainda.</p>
                        )}

                        {/* Formulário rápido de novo contato */}
                        {showAddContact ? (
                            <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-900/60 dark:bg-brand-950/30">
                                <p className="text-[12px] font-bold text-brand-700 dark:text-brand-300">Novo contato para {sender.tradeName || sender.legalName}</p>
                                {contactError ? <p className="mt-1 text-[12px] font-semibold text-brand-red-600">{contactError}</p> : null}
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <input
                                        type="text"
                                        placeholder="Nome *"
                                        value={newContactName}
                                        onChange={(e) => setNewContactName(e.target.value)}
                                        className={clsx(osFieldClass, 'h-10 text-[13px]')}
                                    />
                                    <input
                                        type="tel"
                                        placeholder="Telefone"
                                        value={newContactPhone}
                                        onChange={(e) => setNewContactPhone(e.target.value)}
                                        className={clsx(osFieldClass, 'h-10 text-[13px]')}
                                    />
                                    <input
                                        type="email"
                                        placeholder="Email"
                                        value={newContactEmail}
                                        onChange={(e) => setNewContactEmail(e.target.value)}
                                        className={clsx(osFieldClass, 'h-10 text-[13px]')}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Cargo / setor (ex: Expedição)"
                                        value={newContactRole}
                                        onChange={(e) => setNewContactRole(e.target.value)}
                                        className={clsx(osFieldClass, 'h-10 text-[13px]')}
                                    />
                                </div>
                                <div className="mt-2.5 flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowAddContact(false)}
                                        className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-tower-500 hover:bg-tower-100 dark:hover:bg-tower-800"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!newContactName.trim() || savingContact}
                                        onClick={() => void saveNewContact()}
                                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                                    >
                                        {savingContact ? 'Salvando…' : 'Salvar contato'}
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {/* Horário disponível no local */}
                        <div className="mt-3">
                            <label className="block text-[12px] font-bold text-tower-600 dark:text-tower-300">
                                Horário disponível no remetente
                                <input
                                    type="text"
                                    placeholder="Ex.: 08:00–12:00 ou das 8h às 17h"
                                    value={availabilityWindow}
                                    onChange={(e) => setAvailabilityWindow(e.target.value)}
                                    className={clsx(osFieldClass, 'mt-1 h-10 text-[13px]')}
                                />
                            </label>
                            <div className="mt-1.5 flex gap-1.5">
                                {TIME_PRESETS.map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setAvailabilityWindow(t)}
                                        className="rounded-lg bg-tower-100 px-2 py-0.5 text-[11px] font-semibold text-tower-600 hover:bg-tower-200 dark:bg-tower-800 dark:text-tower-300"
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>

            {/* SEÇÃO C: Endereço de coleta */}
            {sender ? (
                <div className="mt-3 rounded-2xl border border-tower-200 p-3 dark:border-tower-800">
                    <p className="text-[13px] font-bold text-tower-700 dark:text-tower-200">Endereço de coleta</p>

                    {/* Endereços recentes usados por este remetente */}
                    {recentAddresses.length > 0 && !editingAddress ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-medium text-tower-400">Recentes:</span>
                            {recentAddresses.slice(0, 3).map((rec, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => applyRecentAddress(rec)}
                                    className="rounded-lg border border-tower-200 bg-white px-2 py-0.5 text-[11px] font-medium text-tower-700 hover:border-brand-500 hover:text-brand-600 dark:border-tower-700 dark:bg-tower-800 dark:text-tower-200"
                                >
                                    {[rec.address, rec.number, rec.city].filter(Boolean).join(', ')}
                                </button>
                            ))}
                        </div>
                    ) : null}

                    {editingAddress || !addressLine(address) ? (
                        <div className="mt-2">
                            <AddressFields value={address} onChange={setAddress} />
                        </div>
                    ) : (
                        <div className="mt-1.5 flex items-start justify-between gap-3 rounded-xl border border-tower-200 bg-white p-3 dark:border-tower-700 dark:bg-tower-800">
                            <div>
                                <p className="text-[14px] font-medium text-tower-900 dark:text-tower-100">{addressLine(address)}</p>
                                {address.cep ? <p className="font-mono text-[12px] text-tower-500">CEP {address.cep}</p> : null}
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditingAddress(true)}
                                className="min-h-[36px] shrink-0 text-[13px] font-bold text-brand-600 hover:underline dark:text-brand-400"
                            >
                                Alterar
                            </button>
                        </div>
                    )}

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="block text-[12px] font-semibold text-tower-600 dark:text-tower-300">
                            Ponto de referência
                            <input
                                type="text"
                                placeholder="Ex.: Próximo à portaria 2, em frente ao posto"
                                value={referencePoint}
                                onChange={(e) => setReferencePoint(e.target.value)}
                                className={clsx(osFieldClass, 'mt-1 h-10 text-[13px]')}
                            />
                        </label>
                        <label className="block text-[12px] font-semibold text-tower-600 dark:text-tower-300">
                            Instruções de acesso
                            <input
                                type="text"
                                placeholder="Ex.: Doca 3, rua sem saída, horário carga até 17h"
                                value={accessInstructions}
                                onChange={(e) => setAccessInstructions(e.target.value)}
                                className={clsx(osFieldClass, 'mt-1 h-10 text-[13px]')}
                            />
                        </label>
                    </div>
                </div>
            ) : null}

            {/* SEÇÃO D: Destinatário (opcional) */}
            <div className="mt-3">
                <PartyPicker
                    label="Destinatário (opcional)"
                    value={destinatario}
                    source="manual"
                    onChange={(p) => setDestinatario(p)}
                />
            </div>

            {/* SEÇÃO E: Mercadoria */}
            <div className="mt-3 rounded-2xl border border-tower-200 p-3 dark:border-tower-800">
                <p className="text-[13px] font-bold text-tower-700 dark:text-tower-200">Mercadoria e Carga</p>

                {attachTo ? null : (
                    <div className="mt-1.5">
                        <label className="block text-[12px] font-semibold text-tower-600 dark:text-tower-300">
                            Chaves das NF-e (44 dígitos — preenche carga e partes)
                            <textarea
                                value={keysText}
                                onChange={(e) => setKeysText(e.target.value)}
                                rows={2}
                                placeholder="Cole ou bipe a chave de 44 dígitos"
                                className={clsx(osFieldClass, 'mt-1 h-auto py-2 font-mono text-[13px]')}
                            />
                        </label>
                        {keys.length > 0 ? (
                            <div className="mt-1 flex items-center justify-between">
                                <p className="text-[12px] font-semibold text-brand-600 dark:text-brand-400">
                                    {keys.length} {keys.length === 1 ? 'chave reconhecida' : 'chaves reconhecidas'}
                                </p>
                            </div>
                        ) : null}

                        {/* Nota de averbação */}
                        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-tower-100 p-2 text-[11px] text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                            <span className="font-bold">ℹ️</span>
                            <span>{AVERBACAO_NOTE}</span>
                        </div>
                    </div>
                )}

                <div className="mt-2.5">
                    <label className="block text-[12px] font-semibold text-tower-600 dark:text-tower-300">
                        O que é (descrição dos produtos)
                        <input
                            type="text"
                            placeholder="Ex.: Peças automotivas, bobinas plásticas..."
                            value={goodsDescription}
                            onChange={(e) => setGoodsDescription(e.target.value)}
                            className={clsx(osFieldClass, 'mt-1 h-10 text-[13px]')}
                        />
                    </label>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                    <label className="block text-[12px] font-semibold text-tower-600 dark:text-tower-300">
                        Volumes
                        <input
                            inputMode="numeric"
                            value={units}
                            onChange={(e) => setUnits(e.target.value)}
                            placeholder="Ex: 5"
                            className={clsx(osFieldClass, 'mt-1 h-10 text-[13px]')}
                        />
                    </label>
                    <label className="block text-[12px] font-semibold text-tower-600 dark:text-tower-300">
                        Peso aprox. (kg)
                        <input
                            inputMode="decimal"
                            value={weightKg}
                            onChange={(e) => setWeightKg(e.target.value)}
                            placeholder="Ex: 120"
                            className={clsx(osFieldClass, 'mt-1 h-10 text-[13px]')}
                        />
                    </label>
                    <label className="block text-[12px] font-semibold text-tower-600 dark:text-tower-300">
                        Valor da NF (R$)
                        <input
                            inputMode="decimal"
                            value={nfValue}
                            onChange={(e) => setNfValue(e.target.value)}
                            placeholder="Ex: 1500"
                            className={clsx(osFieldClass, 'mt-1 h-10 text-[13px]')}
                        />
                    </label>
                </div>

                {/* Medidas detalhadas reutilizando PackageRows */}
                <div className="mt-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-tower-600 dark:text-tower-300">
                            Medidas dos volumes (Qtd × C × L × A)
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowDimensions(!showDimensions)}
                            className="text-[12px] font-bold text-brand-600 dark:text-brand-400"
                        >
                            {showDimensions ? 'Ocultar medidas' : '+ Detalhar medidas'}
                        </button>
                    </div>

                    {showDimensions ? (
                        <div className="mt-2 rounded-xl border border-tower-200 bg-white p-2 dark:border-tower-700 dark:bg-tower-800">
                            <PackageRows
                                rows={packageRows}
                                onChange={setPackageRows}
                                expectedUnits={units.trim() ? Number(units) : undefined}
                            />
                        </div>
                    ) : null}
                </div>
            </div>

            {/* SEÇÃO F: Serviço e Agendamento */}
            <div className="mt-3 rounded-2xl border border-tower-200 p-3 dark:border-tower-800">
                <p className="text-[13px] font-bold text-tower-700 dark:text-tower-200">Serviço e Agendamento</p>

                {/* Toggles operacionais */}
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => setNeedsHelper(!needsHelper)}
                        className={clsx(
                            'flex items-center justify-between rounded-xl border p-2.5 text-left text-[12px] font-medium transition-all',
                            needsHelper
                                ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'border-tower-200 bg-white text-tower-700 dark:border-tower-700 dark:bg-tower-800 dark:text-tower-300',
                        )}
                    >
                        <span>Precisa de ajudante</span>
                        <OsBadge tone={needsHelper ? 'brand' : 'neutral'}>{needsHelper ? 'Sim' : 'Não'}</OsBadge>
                    </button>

                    <button
                        type="button"
                        onClick={() => setNeedsLoading(!needsLoading)}
                        className={clsx(
                            'flex items-center justify-between rounded-xl border p-2.5 text-left text-[12px] font-medium transition-all',
                            needsLoading
                                ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'border-tower-200 bg-white text-tower-700 dark:border-tower-700 dark:bg-tower-800 dark:text-tower-300',
                        )}
                    >
                        <span>Carga/descarga equipe</span>
                        <OsBadge tone={needsLoading ? 'brand' : 'neutral'}>{needsLoading ? 'Sim' : 'Não'}</OsBadge>
                    </button>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <label className={LABEL}>
                        Data desejada
                        <input
                            type="date"
                            min={todayIso()}
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className={clsx(osFieldClass, 'mt-1.5')}
                        />
                    </label>
                    <label className={LABEL}>
                        Janela de atendimento
                        <select
                            value={windowLabel}
                            onChange={(e) => setWindowLabel(e.target.value)}
                            className={clsx(osFieldClass, 'mt-1.5')}
                        >
                            {WINDOWS.map((w) => (
                                <option key={w} value={w}>
                                    {w || 'Qualquer horário'}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <label className={LABEL}>
                    Observação operacional (opcional)
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder="Orientações adicionais para a equipe de coleta"
                        className={clsx(osFieldClass, 'mt-1.5 h-auto py-2')}
                    />
                </label>
            </div>
        </OsSheet>
    );
};

export default CollectionRequestSheet;
