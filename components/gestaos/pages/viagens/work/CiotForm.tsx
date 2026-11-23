import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatApiError, linksApi, manifestsApi } from '../../../../../lib/api';
import type { AnttFloor, CiotEmissionJob, CiotTipoViagem, CiotTipoViagemSuggestion } from '../../../../../types/index';
import type { ManifestWithLegs } from '../../../../os/lib/arrival';
import {
    buildCiotRequest,
    CIOT_CARGO_TYPES,
    CIOT_PACKAGING,
    ciotFixGroup,
    ciotFixNote,
    ciotNcmOptions,
    ciotPaymentAccount,
    ciotPaymentFromAccount,
    ciotStartInPast,
    distanceSuggestionCaption,
    formatAnttFloor,
    initialCiotForm,
    isBelowAnttFloor,
    isTacAgregadoAllowed,
    mergeCiotDefaults,
    type CiotAddressState,
    type CiotFormState,
} from '../../../../os/lib/ciot';
import { useHubs } from '../../../lib/data';
import { readableFiscalMessage } from '../../../lib/viagemFiscal';
import { stepOfGroup, type TripStep } from '../../../lib/viagemWork';
import { Checkbox, DateTimeInput, FormSection, isoToLocalInput, MoneyInput, NumberInput } from '../../../ui/form';
import { Button, Field, SelectInput, TextInput } from '../../../ui/kit';
import { Drawer, useAction } from '../../../ui/overlay';
import { CiotPayment } from './CiotPayment';
import { CiotRecipient } from './CiotRecipient';
import type { StepProps } from './types';

const num = (text: string): number | null => (text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text));
const str = (value: number | null): string => (value == null ? '' : String(value));
/** O formulário guarda "AAAA-MM-DDTHH:mm" (hora local); o campo de data usa ISO. */
const toIso = (local: string): string | null => {
    const date = new Date(local);
    return local && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const typeName = (type: string | undefined) => (type === 'FRACIONADO' ? 'Fracionado' : 'Lotação (Padrão)');

interface Props extends Pick<StepProps, 'trip' | 'readiness' | 'goto'> {
    trip: ManifestWithLegs;
    onClose: () => void;
    onEmitted: (job: CiotEmissionJob | null) => void;
}

/** Emissão do CIOT: mesmas travas, valores e corpo do formulário do hub (`buildCiotRequest`). */
export const CiotForm: React.FC<Props> = ({ trip, readiness, goto, onClose, onEmitted }) => {
    const { busy, run } = useAction();
    const hubs = useHubs().data ?? [];
    const initial = useRef(initialCiotForm(trip, new Date(), trip.ciotSuggestion ?? null));
    const baseline = useRef<CiotFormState>(initial.current.form);
    const baselineAddress = useRef<CiotAddressState>(initial.current.address);
    const [form, setForm] = useState<CiotFormState>(initial.current.form);
    const [address, setAddress] = useState<CiotAddressState>(initial.current.address);
    const [override, setOverride] = useState<CiotTipoViagem | ''>(trip.ciotTipoViagemOverride ?? '');
    const [suggestion, setSuggestion] = useState<CiotTipoViagemSuggestion | null>(trip.ciotSuggestion ?? null);
    const [floor, setFloor] = useState<AnttFloor | null>(null);
    const [floorError, setFloorError] = useState<string | null>(null);
    const [floorLoading, setFloorLoading] = useState(false);
    const [savePayment, setSavePayment] = useState(true);
    const [paymentEdited, setPaymentEdited] = useState(false);
    const [recipientTouched, setRecipientTouched] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const alive = useRef(true);
    // O Drawer devolve o foco ao painel quando `onClose` muda: a função precisa ser estável enquanto a pessoa digita.
    const busyRef = useRef<string | null>(null);
    busyRef.current = busy;
    const close = useCallback(() => {
        if (!busyRef.current) onClose();
    }, [onClose]);

    const selectedType: CiotTipoViagem = override || suggestion?.tipoViagem || 'PADRAO';
    const isTac = selectedType === 'TAC_AGREGADO';
    const tacAllowed = isTacAgregadoAllowed(trip.link?.document);
    const startInPast = !isTac && ciotStartInPast(form.dataInicioViagem);
    const carrierAccount = trip.link?.person?.paymentAccounts?.find((account) => account.isPrimary !== false);
    const ncmOptions = ciotNcmOptions(trip);
    const shownSuggestion = suggestion ?? trip.ciotSuggestion ?? null;
    const set = <K extends keyof CiotFormState>(key: K, value: CiotFormState[K]) => setForm((current) => ({ ...current, [key]: value }));

    // Copilot: a sugestão do servidor (distância, fim, embalagem, destinatário) entra só nos campos que a pessoa ainda não mexeu.
    useEffect(() => {
        alive.current = true;
        void manifestsApi
            .ciotSuggestion(trip.id)
            .then((res) => {
                if (!alive.current) return;
                const data = res.data ?? null;
                setSuggestion(data);
                if (!data) return;
                const base = baseline.current;
                const next = initialCiotForm(trip, new Date(), data);
                setForm((current) => {
                    const merged = mergeCiotDefaults(current, base, next.form);
                    if (data.recipient && current.destNome === base.destNome && current.destCpfCnpj === base.destCpfCnpj) {
                        return { ...merged, destNome: next.form.destNome, destCpfCnpj: next.form.destCpfCnpj };
                    }
                    return merged;
                });
                if (data.recipient) {
                    setAddress((current) => (JSON.stringify(current) === JSON.stringify(baselineAddress.current) ? next.address : current));
                    baselineAddress.current = next.address;
                }
                baseline.current = next.form;
            })
            .catch(() => alive.current && setSuggestion(null));
        return () => {
            alive.current = false;
        };
    }, [trip.id]);

    // Piso mínimo ANTT: recalcula com a distância, o tipo de carga e o alto desempenho.
    useEffect(() => {
        let active = true;
        setFloor(null);
        setFloorError(null);
        const distance = Number(form.distanciaPercorrida);
        if (!Number.isFinite(distance) || distance <= 0) {
            setFloorLoading(false);
            setFloorError('Informe a distância da viagem para calcular o piso mínimo ANTT.');
            return;
        }
        setFloorLoading(true);
        const timeout = window.setTimeout(() => {
            void manifestsApi
                .anttFloor(trip.id, { distanceKm: distance, tipoCarga: Number(form.codigoTipoCarga), altoDesempenho: form.altoDesempenho })
                .then((res) => active && setFloor(res.data ?? null))
                .catch((cause) => active && setFloorError(formatApiError(cause)))
                .finally(() => active && setFloorLoading(false));
        }, 400);
        return () => {
            active = false;
            window.clearTimeout(timeout);
        };
    }, [trip.id, form.distanciaPercorrida, form.codigoTipoCarga, form.altoDesempenho]);

    const fix = formError ? ciotFixGroup(formError, readiness) : null;
    const note = formError ? ciotFixNote(formError) : null;
    const leave = (step: TripStep) => {
        onClose();
        goto(step);
    };

    const submit = async () => {
        const built = buildCiotRequest(trip.id, form, address, override, trip.link?.document ?? '', new Date(), selectedType);
        if (built.error) {
            setFormError(built.error);
            return;
        }
        setFormError(null);
        const request = built.request;
        const ok = await run(
            'ciot-emit',
            async () => {
                try {
                    // Mesma ordem do hub: primeiro grava a conta no cadastro do transportador, depois emite.
                    if (paymentEdited && savePayment && form.tipoPagamento !== 'eFRETE' && trip.linkId) {
                        await linksApi.updateOwnerPerson(trip.linkId, { paymentAccount: ciotPaymentAccount(form) });
                    }
                    const res = await manifestsApi.emitCiot(trip.id, request);
                    onEmitted(res.data ?? null);
                } catch (cause) {
                    setFormError(readableFiscalMessage(formatApiError(cause), 'Não foi possível emitir o CIOT.').message);
                    throw cause;
                }
            },
            { success: 'CIOT enviado para emissão. Acompanhe a fila abaixo.', error: 'Não foi possível emitir o CIOT.' },
        );
        if (ok) onClose();
    };

    return (
        <Drawer
            open
            width={820}
            onClose={close}
            title="Emitir CIOT"
            subtitle="Dados do contratado, valores e destinatário"
            footer={
                <div className="flex w-full flex-col gap-2">
                    {formError ? (
                        <div role="alert" className="flex flex-col gap-2">
                            <p className="gx-red-text text-[13.5px] font-semibold">{formError}</p>
                            {note ? <p className="gx-soft text-[13px]">{note}</p> : null}
                            {fix ? (
                                <div>
                                    <Button size="sm" onClick={() => leave(stepOfGroup(fix.group))}>
                                        {fix.label}
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button disabled={busy != null} onClick={onClose}>
                            Voltar
                        </Button>
                        <Button variant="primary" loading={busy === 'ciot-emit'} onClick={() => void submit()}>
                            Emitir CIOT
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-2">
                <FormSection title="Viagem" mode="copilot" hint={shownSuggestion ? `Sugestão do sistema: ${typeName(shownSuggestion.tipoViagem)}${shownSuggestion.clientDocuments.length >= 2 ? `, ${shownSuggestion.clientDocuments.length} clientes distintos na composição` : ''}.` : undefined}>
                    <Field label="Tipo de viagem" hint={!tacAllowed ? 'TAC agregado só para transportador pessoa física.' : undefined}>
                        <SelectInput aria-label="Tipo de viagem" value={override} onChange={(event) => setOverride(event.target.value as CiotTipoViagem | '')}>
                            <option value="">Automático ({shownSuggestion?.tipoViagem === 'FRACIONADO' ? 'Fracionado' : 'Lotação'})</option>
                            <option value="PADRAO">Lotação (Padrão)</option>
                            <option value="FRACIONADO">Fracionado</option>
                            <option value="TAC_AGREGADO" disabled={!tacAllowed}>TAC Agregado</option>
                        </SelectInput>
                    </Field>
                    <Field label="Documento da viagem">
                        <TextInput aria-label="Documento da viagem" value={form.documentoViagem} onChange={(event) => set('documentoViagem', event.target.value)} />
                    </Field>
                    {!isTac ? (
                        <Field label="Distância percorrida (km)" hint={distanceSuggestionCaption(shownSuggestion) ?? undefined}>
                            <NumberInput aria-label="Distância percorrida" decimal suffix="km" value={num(form.distanciaPercorrida)} onChange={(value) => set('distanciaPercorrida', str(value))} />
                            {shownSuggestion?.distanceKm != null && Number(form.distanciaPercorrida) !== shownSuggestion.distanceKm ? (
                                <button type="button" className="gx-royal-text mt-1 min-h-8 text-[13px] font-semibold underline" onClick={() => set('distanciaPercorrida', String(shownSuggestion.distanceKm))}>
                                    Usar sugestão
                                </button>
                            ) : null}
                        </Field>
                    ) : null}
                    {!isTac ? (
                        <Field label="Início da viagem">
                            <DateTimeInput aria-label="Início da viagem" value={toIso(form.dataInicioViagem)} onChange={(iso) => set('dataInicioViagem', iso ? isoToLocalInput(iso) : '')} />
                        </Field>
                    ) : null}
                    <Field label="Fim da viagem" hint={isTac ? 'Até 30 dias da declaração.' : 'Início a partir de agora. Término em até 90 dias do início.'}>
                        <DateTimeInput aria-label="Fim da viagem" value={toIso(form.dataFimViagem)} onChange={(iso) => set('dataFimViagem', iso ? isoToLocalInput(iso) : '')} />
                    </Field>
                    {startInPast ? (
                        <div role="alert" className="gx-inset col-span-full flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                            <p className="gx-red-text text-[13.5px] font-semibold">O início da viagem já passou. Atualize a saída prevista.</p>
                            <Button size="sm" onClick={() => leave('capa')}>
                                Ajustar saída prevista
                            </Button>
                        </div>
                    ) : null}
                </FormSection>

                {!isTac ? (
                    <FormSection title="Carga">
                        <Field label="NCM da natureza da carga (4 dígitos)">
                            <TextInput aria-label="NCM da carga" inputMode="numeric" maxLength={4} value={form.codigoNcmNaturezaCarga} onChange={(event) => set('codigoNcmNaturezaCarga', event.target.value)} />
                        </Field>
                        {ncmOptions.length ? (
                            <div className="col-span-full flex flex-wrap gap-2">
                                {ncmOptions.map((option) => (
                                    <Button key={option.ncm4} size="sm" variant={form.codigoNcmNaturezaCarga === option.ncm4 ? 'primary' : 'ghost'} onClick={() => set('codigoNcmNaturezaCarga', option.ncm4)}>
                                        {option.ncm4} · {option.description} ({option.count} {option.count === 1 ? 'NF' : 'NFs'})
                                    </Button>
                                ))}
                            </div>
                        ) : null}
                        <Field label="Peso da carga (kg)">
                            <NumberInput aria-label="Peso da carga" decimal suffix="kg" value={num(form.pesoCarga)} onChange={(value) => set('pesoCarga', str(value))} />
                        </Field>
                        <Field label="Tipo de carga">
                            <SelectInput aria-label="Tipo de carga" value={form.codigoTipoCarga} onChange={(event) => set('codigoTipoCarga', event.target.value)}>
                                {CIOT_CARGO_TYPES.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.value} · {option.label}
                                    </option>
                                ))}
                            </SelectInput>
                        </Field>
                        {selectedType === 'PADRAO' ? (
                            <Field label="Tipo de embalagem">
                                <SelectInput aria-label="Tipo de embalagem" value={form.tipoEmbalagem} onChange={(event) => set('tipoEmbalagem', event.target.value)}>
                                    <option value="">Selecione a embalagem</option>
                                    {CIOT_PACKAGING.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                        ) : null}
                        <Checkbox checked={form.altoDesempenho} onChange={(checked) => set('altoDesempenho', checked)} label="Alto desempenho" />
                        <Checkbox checked={form.retornoVazio} onChange={(checked) => set('retornoVazio', checked)} label="Retorno vazio" />
                        <p className="gx-muted col-span-full text-[12.5px]">Composição veicular: {form.composicaoVeicular ? 'cavalo com implemento' : 'veículo simples'}, calculada pelos veículos atribuídos à viagem.</p>
                    </FormSection>
                ) : null}

                <FormSection title="Pagamento ao beneficiário">
                    <Field label="Tipo de pagamento">
                        <SelectInput aria-label="Tipo de pagamento" value={form.tipoPagamento} onChange={(event) => set('tipoPagamento', event.target.value as CiotFormState['tipoPagamento'])}>
                            <option value="TransferenciaBancaria">Transferência bancária</option>
                            <option value="eFRETE">eFRETE</option>
                            <option value="DepositoAgendado">Depósito agendado</option>
                        </SelectInput>
                    </Field>
                    <Field label="Entrega de documentação">
                        <SelectInput aria-label="Entrega de documentação" value={form.entregaDocumentacao} onChange={(event) => set('entregaDocumentacao', event.target.value as CiotFormState['entregaDocumentacao'])}>
                            <option value="RedeCredenciada">Rede credenciada</option>
                            <option value="Cliente">Cliente</option>
                        </SelectInput>
                    </Field>
                    {form.tipoPagamento !== 'eFRETE' ? (
                        <>
                            <p className="gx-muted col-span-full text-[13px]">Confirme os dados de pagamento com o contratado. O CPF/CNPJ não será presumido como chave PIX.</p>
                            {carrierAccount ? (
                                <div className="col-span-full">
                                    <Button size="sm" onClick={() => { setForm((current) => ({ ...current, ...ciotPaymentFromAccount(carrierAccount) })); setPaymentEdited(false); }}>
                                        Usar dados bancários do transportador:{' '}
                                        {carrierAccount.pixKey ? `PIX ${carrierAccount.pixKeyType === 'CpfOuCnpj' ? 'CPF/CNPJ' : carrierAccount.pixKeyType ?? ''} ${carrierAccount.pixKey}` : `Banco ${carrierAccount.bankCode ?? ''} ag ${carrierAccount.agency ?? ''} cc ${carrierAccount.account ?? ''}`}
                                    </Button>
                                </div>
                            ) : null}
                            <CiotPayment value={form} disabled={busy != null} onChange={(payment) => { setForm((current) => ({ ...current, ...payment })); setPaymentEdited(true); }} />
                            {paymentEdited && trip.linkId ? <Checkbox className="col-span-full" checked={savePayment} onChange={setSavePayment} label="Salvar no cadastro do transportador" /> : null}
                        </>
                    ) : (
                        <p className="gx-soft col-span-full text-[13.5px]">Pagamento pela e-Frete. Dados bancários e chave PIX não são necessários.</p>
                    )}
                </FormSection>

                <FormSection title="Valores (Carta Frete)" hint="Adiantamento + quitação devem fechar o total. Será registrado um pagamento sem categoria pelo valor total da viagem.">
                    <div className="gx-inset col-span-full flex flex-wrap items-center justify-between gap-3 px-4 py-3" aria-live="polite">
                        <p className="text-[13.5px]">{floorLoading ? 'Calculando piso mínimo ANTT…' : floorError ?? formatAnttFloor(floor)}</p>
                        {isBelowAnttFloor(Number(form.totalViagem), floor) ? (
                            <>
                                <p className="gx-red-text text-[13.5px] font-semibold">Frete abaixo do piso</p>
                                <Button size="sm" onClick={() => leave('capa')}>
                                    Ajustar Carta Frete
                                </Button>
                            </>
                        ) : null}
                    </div>
                    <Field label="Frete bruto (total)">
                        <MoneyInput aria-label="Frete bruto" value={num(form.totalViagem)} onChange={(value) => set('totalViagem', str(value))} />
                    </Field>
                    <Field label="Adiantamento">
                        <MoneyInput aria-label="Adiantamento" value={num(form.totalAdiantamento)} onChange={(value) => set('totalAdiantamento', str(value))} />
                    </Field>
                    <Field label="Quitação">
                        <MoneyInput aria-label="Quitação" value={num(form.totalQuitacao)} onChange={(value) => set('totalQuitacao', str(value))} />
                    </Field>
                    <Field label="Pedágio">
                        <MoneyInput aria-label="Pedágio" value={num(form.pedagio)} onChange={(value) => set('pedagio', str(value))} />
                    </Field>
                    <Field label="Pagamento">
                        <SelectInput aria-label="Indicador de pagamento" value={form.indicadorPagamento} onChange={(event) => set('indicadorPagamento', event.target.value as CiotFormState['indicadorPagamento'])}>
                            <option value="Avista">À vista</option>
                            <option value="Aprazo">A prazo</option>
                        </SelectInput>
                    </Field>
                    {form.indicadorPagamento === 'Aprazo' ? (
                        <Field label="Número da parcela">
                            <NumberInput aria-label="Número da parcela" value={num(form.numeroParcela)} onChange={(value) => set('numeroParcela', str(value))} />
                        </Field>
                    ) : null}
                </FormSection>

                <FormSection title="Destinatário" mode="copilot">
                    <CiotRecipient
                        trip={trip}
                        hubs={hubs}
                        suggested={shownSuggestion?.recipient ?? null}
                        form={form}
                        address={address}
                        touched={recipientTouched}
                        disabled={busy != null}
                        onForm={(patch) => setForm((current) => ({ ...current, ...patch }))}
                        onAddress={setAddress}
                        onTouched={() => setRecipientTouched(true)}
                    />
                </FormSection>
            </div>
        </Drawer>
    );
};
