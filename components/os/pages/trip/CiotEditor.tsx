import React, { useCallback, useEffect, useRef, useState } from 'react';
import { hubsApi, linksApi, manifestsApi } from '../../../../lib/api';
import { FiscalAddressFields } from '../../../manifest/FiscalAddressFields';
import type { CiotEmissionJob, CiotTipoViagem, CiotTipoViagemSuggestion, Hub } from '../../../../types/index';
import type { ManifestWithLegs } from '../../lib/arrival';
import {
    buildCiotRequest,
    CIOT_DISPENSA_REASONS,
    CIOT_FINAL_PHASES,
    CIOT_POLL_ATTEMPTS,
    CIOT_POLL_INTERVAL_MS,
    ciotFixGroup,
    ciotDispensaError,
    initialCiotForm,
    CIOT_CARGO_TYPES,
    ciotNcmOptions,
    ciotPaymentFromAccount,
    ciotPaymentAccount,
    type CiotAddressState,
    type CiotFixGroup,
    type CiotFormState,
    type CiotDispensaReason,
} from '../../lib/ciot';
import { OsBadge, OsButton, OsErrorNotice } from '../../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../../ui/Sheet';
import PaymentAccountFields from './PaymentAccountFields';
import CiotRecipientPicker from './CiotRecipientPicker';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <label className="block text-[13px] font-bold text-tower-600 dark:text-tower-300">
        {label}
        <div className="mt-1.5">{children}</div>
    </label>
);

const Legend: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="mt-5 mb-2 text-[12px] font-bold uppercase tracking-wide text-tower-500 dark:text-tower-400">{children}</p>
);

/** CIOT da viagem: emitir (formulário nativo), acompanhar a fila, baixar o PDF ou dispensar com motivo. */
const CiotEditor: React.FC<{
    manifest: ManifestWithLegs;
    disabled?: boolean;
    onUpdated: () => Promise<void>;
    onResolve: (group: CiotFixGroup) => void;
}> = ({ manifest, disabled = false, onUpdated, onResolve }) => {
    const [formOpen, setFormOpen] = useState(false);
    const [dispenseOpen, setDispenseOpen] = useState(false);
    const [form, setForm] = useState<CiotFormState>(() => initialCiotForm(manifest).form);
    const [address, setAddress] = useState<CiotAddressState>(() => initialCiotForm(manifest).address);
    const [override, setOverride] = useState<CiotTipoViagem | ''>(manifest.ciotTipoViagemOverride ?? '');
    const [suggestion, setSuggestion] = useState<CiotTipoViagemSuggestion | null>(null);
    const [job, setJob] = useState<CiotEmissionJob | null>(null);
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [motivo, setMotivo] = useState<CiotDispensaReason | ''>('');
    const [observacao, setObservacao] = useState('');
    const [hubs, setHubs] = useState<Hub[]>([]);
    const [savePayment, setSavePayment] = useState(true);
    const [paymentEdited, setPaymentEdited] = useState(false);
    const timer = useRef<number | null>(null);
    const alive = useRef(true);

    const authorized = manifest.fiscalDocuments?.find((doc) => doc.documentType === 'CIOT' && doc.status === 'AUTHORIZED') ?? null;
    const mdfeAuthorized = Boolean(manifest.fiscalDocuments?.some((doc) => doc.documentType === 'MDFE' && doc.status === 'AUTHORIZED'));
    const dispensed = Boolean(manifest.ciotDispensado) && !authorized;
    const jobRunning = Boolean(job && !CIOT_FINAL_PHASES.includes(job.phase));
    const selectedType = override || suggestion?.tipoViagem || 'PADRAO';
    const ncmOptions = ciotNcmOptions(manifest);
    const carrierAccount = manifest.link?.person?.paymentAccounts?.find((account) => account.isPrimary !== false);

    const stopPolling = useCallback(() => {
        if (timer.current != null) window.clearTimeout(timer.current);
        timer.current = null;
    }, []);

    const poll = useCallback((attemptsLeft: number) => {
        stopPolling();
        timer.current = window.setTimeout(async () => {
            try {
                const res = await manifestsApi.ciotStatus(manifest.id);
                if (!alive.current) return;
                const current = res.data ?? null;
                setJob(current);
                if (current && CIOT_FINAL_PHASES.includes(current.phase)) {
                    await onUpdated();
                    return;
                }
            } catch {
                /* a próxima tentativa tenta de novo */
            }
            if (alive.current && attemptsLeft > 1) poll(attemptsLeft - 1);
        }, CIOT_POLL_INTERVAL_MS);
    }, [manifest.id, onUpdated, stopPolling]);

    useEffect(() => {
        alive.current = true;
        // Retoma o acompanhamento de uma emissão que já estava em andamento.
        void manifestsApi.ciotStatus(manifest.id).then((res) => {
            if (!alive.current) return;
            const current = res.data ?? null;
            setJob(current);
            if (current && !CIOT_FINAL_PHASES.includes(current.phase)) poll(CIOT_POLL_ATTEMPTS);
        }).catch(() => undefined);
        return () => {
            alive.current = false;
            stopPolling();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manifest.id]);

    const openForm = () => {
        const initial = initialCiotForm(manifest);
        setForm(initial.form);
        setAddress(initial.address);
        setOverride(manifest.ciotTipoViagemOverride ?? '');
        setFormError(null);
        setSavePayment(true);
        setPaymentEdited(false);
        setFormOpen(true);
        void hubsApi.list().then((res) => { if (alive.current) setHubs(res.data ?? []); }).catch(() => setHubs([]));
        void manifestsApi.ciotSuggestion(manifest.id).then((res) => alive.current && setSuggestion(res.data ?? null)).catch(() => setSuggestion(null));
    };

    const emit = async () => {
        const built = buildCiotRequest(manifest.id, form, address, override, manifest.link?.document ?? '', new Date(), selectedType);
        if (built.error) {
            setFormError(built.error);
            return;
        }
        setBusy(true);
        setFormError(null);
        try {
            if (paymentEdited && savePayment && form.tipoPagamento !== 'eFRETE' && manifest.linkId) {
                await linksApi.updateOwnerPerson(manifest.linkId, { paymentAccount: ciotPaymentAccount(form) });
            }
            const res = await manifestsApi.emitCiot(manifest.id, built.request);
            setJob(res.data ?? null);
            setFormOpen(false);
            setError(null);
            poll(CIOT_POLL_ATTEMPTS);
        } catch (cause) {
            setFormError(apiErrorMessage(cause, 'Não foi possível emitir o CIOT.'));
        } finally {
            setBusy(false);
        }
    };

    const dispense = async () => {
        const reasonError = ciotDispensaError(motivo, observacao);
        if (reasonError || !motivo) {
            setFormError(reasonError);
            return;
        }
        setBusy(true);
        setFormError(null);
        try {
            await manifestsApi.dispenseCiot(manifest.id, motivo, observacao.trim() || undefined);
            setDispenseOpen(false);
            setMotivo('');
            setObservacao('');
            await onUpdated();
        } catch (cause) {
            setFormError(apiErrorMessage(cause, 'Não foi possível dispensar o CIOT.'));
        } finally {
            setBusy(false);
        }
    };

    const undo = async () => {
        setBusy(true);
        setError(null);
        try {
            await manifestsApi.undoCiotDispensa(manifest.id);
            await onUpdated();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível desfazer a dispensa.'));
        } finally {
            setBusy(false);
        }
    };

    const downloadPdf = async () => {
        if (!authorized) return;
        setBusy(true);
        setError(null);
        try {
            const { downloadUrl } = await manifestsApi.fiscalDocumentPdf(manifest.id, authorized.id);
            window.open(downloadUrl, '_blank', 'noopener');
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível baixar o PDF do CIOT.'));
        } finally {
            setBusy(false);
        }
    };

    const set = <K extends keyof CiotFormState>(key: K, value: CiotFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
    const text = (key: keyof CiotFormState, type = 'text') => (
        <input
            type={type}
            value={String(form[key])}
            inputMode={type === 'number' ? 'decimal' : undefined}
            onChange={(e) => set(key, e.target.value as never)}
            className={osFieldClass}
        />
    );
    const fixHint = (message: string | null) => {
        const fix = message ? ciotFixGroup(message) : null;
        return fix ? (
            <OsButton full variant="secondary" onClick={() => { setFormOpen(false); setDispenseOpen(false); onResolve(fix.group); }}>
                {fix.label}
            </OsButton>
        ) : null;
    };

    const failed = job && (job.phase === 'FAILED' || job.phase === 'PENDING_RECONCILIATION');

    return (
        <div>
            {error ? <div className="mb-3" role="alert"><OsErrorNotice message={error} /></div> : null}

            {authorized ? (
                <div>
                    <p className="text-[14px] font-bold text-emerald-700 dark:text-emerald-300">CIOT autorizado{authorized.number ? ` · nº ${authorized.number}` : ''}</p>
                    <div className="mt-2">
                        <OsButton full variant="secondary" disabled={busy} onClick={() => void downloadPdf()}>Baixar PDF</OsButton>
                    </div>
                </div>
            ) : dispensed ? (
                <div>
                    <p className="text-[14px] font-bold text-tower-800 dark:text-tower-100">CIOT dispensado</p>
                    <p className="mt-1 text-[13px] text-tower-600 dark:text-tower-300">Motivo: {manifest.ciotDispensadoMotivo ?? 'não informado'}</p>
                    {mdfeAuthorized ? (
                        <p className="mt-2 text-[12px] text-tower-500">A dispensa não pode ser desfeita depois da autorização do MDF-e.</p>
                    ) : (
                        <div className="mt-2">
                            <OsButton full variant="secondary" disabled={busy || disabled} onClick={() => void undo()}>Desfazer dispensa</OsButton>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {job ? (
                        <div role="status" className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[13px] font-semibold text-tower-800 dark:text-tower-100">
                                    {jobRunning ? 'CIOT em processamento' : failed ? 'CIOT não concluído' : 'CIOT processado'}
                                </p>
                                <OsBadge tone={failed ? 'bad' : job.phase === 'DONE' ? 'ok' : 'warn'}>{job.phase}</OsBadge>
                            </div>
                            {jobRunning ? <p className="mt-1 text-[12px] text-tower-500">Acompanhando a fila — não emita novamente.</p> : null}
                            {job.lastError ? <p className="mt-1 text-[12px] text-brand-red-600 dark:text-brand-red-400">{job.lastError}</p> : null}
                            {job.phase === 'PENDING_RECONCILIATION' ? <p className="mt-1 text-[12px] text-tower-500">Aguardando conciliação: consulte antes de tentar de novo.</p> : null}
                            {jobRunning && !timer.current ? (
                                <div className="mt-2"><OsButton full variant="ghost" onClick={() => poll(CIOT_POLL_ATTEMPTS)}>Consultar andamento</OsButton></div>
                            ) : null}
                        </div>
                    ) : null}
                    <OsButton full disabled={disabled || busy || jobRunning} onClick={openForm}>{failed ? 'Corrigir e emitir CIOT' : 'Emitir CIOT'}</OsButton>
                    <OsButton full variant="secondary" disabled={disabled || busy || jobRunning} onClick={() => { setFormError(null); setDispenseOpen(true); }}>Dispensar CIOT</OsButton>
                </div>
            )}

            {formOpen ? (
                <OsSheet
                    title="Emitir CIOT"
                    subtitle="Dados do contratado, valores e destinatário"
                    onClose={() => setFormOpen(false)}
                    footer={
                        <div className="flex flex-col gap-2">
                            {formError ? <div role="alert"><OsErrorNotice message={formError} /></div> : null}
                            {fixHint(formError)}
                            <OsButton full disabled={busy} onClick={() => void emit()}>{busy ? 'Enviando…' : 'Emitir CIOT'}</OsButton>
                        </div>
                    }
                >
                    {suggestion ? (
                        <p className="mb-3 text-[13px] text-tower-600 dark:text-tower-300">
                            Sugestão: <strong>{suggestion.tipoViagem === 'FRACIONADO' ? 'Fracionado' : 'Lotação (Padrão)'}</strong>
                            {suggestion.clientDocuments.length >= 2 ? ` — ${suggestion.clientDocuments.length} clientes distintos na composição.` : ''}
                        </p>
                    ) : null}
                    <div className="flex flex-col gap-3">
                        <Field label="Tipo de viagem">
                            <select value={override} onChange={(e) => setOverride(e.target.value as CiotTipoViagem | '')} className={osFieldClass}>
                                <option value="">Automático ({suggestion?.tipoViagem === 'FRACIONADO' ? 'Fracionado' : 'Lotação'})</option>
                                <option value="PADRAO">Lotação (Padrão)</option>
                                <option value="FRACIONADO">Fracionado</option>
                                <option value="TAC_AGREGADO">TAC Agregado</option>
                            </select>
                        </Field>
                        <Field label="Documento da viagem">{text('documentoViagem')}</Field>
                        {selectedType !== 'TAC_AGREGADO' ? <Field label="Distância percorrida (km)*">{text('distanciaPercorrida', 'number')}</Field> : null}
                        {selectedType !== 'TAC_AGREGADO' ? <Field label="Início da viagem*">{text('dataInicioViagem', 'datetime-local')}</Field> : null}
                        <Field label="Fim da viagem*">{text('dataFimViagem', 'datetime-local')}</Field>
                        <p className="text-[12px] text-tower-500">{selectedType === 'TAC_AGREGADO' ? 'Até 30 dias da declaração.' : 'Início a partir de agora. Término em até 90 dias do início.'}</p>
                        {selectedType !== 'TAC_AGREGADO' ? (
                            <>
                                <Field label="NCM da natureza da carga (4 dígitos)*">{text('codigoNcmNaturezaCarga')}</Field>
                                <div className="flex flex-wrap gap-2">
                                    {ncmOptions.map((option) => <OsButton key={option.ncm4} variant={form.codigoNcmNaturezaCarga === option.ncm4 ? 'primary' : 'secondary'} onClick={() => set('codigoNcmNaturezaCarga', option.ncm4)}>
                                        {option.ncm4} · {option.description} ({option.count} {option.count === 1 ? 'NF' : 'NFs'})
                                    </OsButton>)}
                                </div>
                                <Field label="Peso da carga (kg)*">{text('pesoCarga', 'number')}</Field>
                                <Field label="Tipo de carga*">
                                    <select value={form.codigoTipoCarga} onChange={(event) => set('codigoTipoCarga', event.target.value)} className={osFieldClass}>
                                        {CIOT_CARGO_TYPES.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.label}</option>)}
                                    </select>
                                </Field>
                            </>
                        ) : null}
                        {selectedType === 'PADRAO' ? (
                            <Field label="Tipo de embalagem*">
                                <select value={form.tipoEmbalagem} onChange={(e) => set('tipoEmbalagem', e.target.value)} className={osFieldClass}>
                                    <option value="">Selecione a embalagem</option>
                                    <option value="Bigbag">Big bag</option>
                                    <option value="Pallet">Pallet</option>
                                    <option value="Granel">Granel</option>
                                    <option value="Container">Contêiner</option>
                                    <option value="Saco">Saco</option>
                                    <option value="Caixa">Caixa</option>
                                    <option value="Unitario">Unitário</option>
                                    <option value="Fardo">Fardo</option>
                                </select>
                            </Field>
                        ) : null}
                        <Field label="Tipo de pagamento">
                            <select value={form.tipoPagamento} onChange={(e) => set('tipoPagamento', e.target.value as CiotFormState['tipoPagamento'])} className={osFieldClass}>
                                <option value="TransferenciaBancaria">Transferência bancária</option>
                                <option value="eFRETE">eFRETE</option>
                                <option value="DepositoAgendado">Depósito agendado</option>
                            </select>
                        </Field>
                        <Field label="Entrega de documentação">
                            <select value={form.entregaDocumentacao} onChange={(e) => set('entregaDocumentacao', e.target.value as CiotFormState['entregaDocumentacao'])} className={osFieldClass}>
                                <option value="RedeCredenciada">Rede credenciada</option>
                                <option value="Cliente">Cliente</option>
                            </select>
                        </Field>
                        <label className="flex min-h-[44px] items-center gap-2 text-[14px] text-tower-700 dark:text-tower-200">
                            <input type="checkbox" checked={form.altoDesempenho} onChange={(e) => set('altoDesempenho', e.target.checked)} className="h-5 w-5" /> Alto desempenho
                        </label>
                        {selectedType !== 'TAC_AGREGADO' ? (
                            <label className="flex min-h-[44px] items-center gap-2 text-[14px] text-tower-700 dark:text-tower-200">
                                <input type="checkbox" checked={form.retornoVazio} onChange={(e) => set('retornoVazio', e.target.checked)} className="h-5 w-5" /> Retorno vazio
                            </label>
                        ) : null}
                        <p className="text-[12px] text-tower-500">Composição veicular: {form.composicaoVeicular ? 'cavalo com implemento' : 'veículo simples'}. Calculada pelos veículos atribuídos à viagem.</p>
                    </div>

                    {form.tipoPagamento !== 'eFRETE' ? (
                        <>
                            <Legend>Conta real do beneficiário</Legend>
                            <p className="mb-2 text-[12px] text-tower-500">Confirme os dados de pagamento com o contratado. O CPF/CNPJ não será presumido como chave PIX.</p>
                            {carrierAccount ? <OsButton full variant="secondary" className="mb-3" onClick={() => {
                                setForm((current) => ({ ...current, ...ciotPaymentFromAccount(carrierAccount) }));
                                setPaymentEdited(false);
                            }}>
                                Usar dados bancários do transportador: {carrierAccount.pixKey
                                    ? `PIX ${carrierAccount.pixKeyType === 'CpfOuCnpj' ? 'CPF/CNPJ' : carrierAccount.pixKeyType ?? ''} ${carrierAccount.pixKey}`
                                    : `Banco ${carrierAccount.bankCode ?? ''} ag ${carrierAccount.agency ?? ''} cc ${carrierAccount.account ?? ''}`}
                            </OsButton> : null}
                            <PaymentAccountFields value={form} disabled={busy} onChange={(payment) => {
                                setForm((current) => ({ ...current, ...payment }));
                                setPaymentEdited(true);
                            }} />
                            {paymentEdited && manifest.linkId ? <label className="mt-3 flex min-h-[44px] items-center gap-2 text-[14px]">
                                <input type="checkbox" checked={savePayment} onChange={(event) => setSavePayment(event.target.checked)} className="h-5 w-5" />
                                Salvar no cadastro do transportador
                            </label> : null}

                        </>
                    ) : <p className="mt-4 text-[13px] text-tower-600 dark:text-tower-300">Pagamento pela e-Frete. Dados bancários e chave PIX não são necessários.</p>}

                    <Legend>Valores (Carta Frete)</Legend>
                    <div className="flex flex-col gap-3">
                        <Field label="Frete bruto (total)*">{text('totalViagem', 'number')}</Field>
                        <Field label="Adiantamento">{text('totalAdiantamento', 'number')}</Field>
                        <Field label="Quitação">{text('totalQuitacao', 'number')}</Field>
                        <Field label="Pedágio">{text('pedagio', 'number')}</Field>
                        <Field label="Pagamento">
                            <select value={form.indicadorPagamento} onChange={(e) => set('indicadorPagamento', e.target.value as CiotFormState['indicadorPagamento'])} className={osFieldClass}>
                                <option value="Avista">À vista</option>
                                <option value="Aprazo">A prazo</option>
                            </select>
                        </Field>
                        {form.indicadorPagamento === 'Aprazo' ? <Field label="Número da parcela*">{text('numeroParcela', 'number')}</Field> : null}
                        <p className="text-[12px] text-tower-500">Adiantamento + quitação devem fechar o total. Será registrado um pagamento sem categoria pelo valor total da viagem.</p>
                    </div>

                    <Legend>Destinatário</Legend>
                    <CiotRecipientPicker manifest={manifest} hubs={hubs} onChange={(recipient) => {
                        setForm((current) => ({ ...current, ...recipient.form }));
                        setAddress(recipient.address);
                    }} />
                    <div className="flex flex-col gap-3">
                        <Field label="Nome/Razão social*">{text('destNome')}</Field>
                        <Field label="CPF/CNPJ*">{text('destCpfCnpj')}</Field>
                    </div>
                    <FiscalAddressFields value={address} onChange={setAddress} readOnly={busy} fieldClass={osFieldClass} />
                </OsSheet>
            ) : null}

            {dispenseOpen ? (
                <OsSheet
                    title="Dispensar CIOT"
                    subtitle="Fica registrado com seu usuário e pode ser desfeito até o MDF-e"
                    onClose={() => setDispenseOpen(false)}
                    footer={
                        <div className="flex flex-col gap-2">
                            {formError ? <div role="alert"><OsErrorNotice message={formError} /></div> : null}
                            <OsButton full disabled={busy || Boolean(ciotDispensaError(motivo, observacao))} onClick={() => void dispense()}>{busy ? 'Registrando…' : 'Dispensar CIOT'}</OsButton>
                        </div>
                    }
                >
                    <Field label="Motivo da dispensa*">
                        <select value={motivo} onChange={(e) => setMotivo(e.target.value as CiotDispensaReason | '')} className={osFieldClass}>
                            <option value="">Selecione o motivo</option>
                            {CIOT_DISPENSA_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                        </select>
                    </Field>
                    <div className="mt-3">
                        <Field label={motivo === 'OUTRO_VALIDADO_TORRE' ? 'Validação da torre (mín. 20 caracteres)*' : 'Observação (opcional)'}>
                            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} className={`${osFieldClass} h-auto py-3`} />
                        </Field>
                    </div>
                    <p className="mt-3 text-[12px] text-tower-500">Ser ETC com motorista empregado, por si só, não dispensa o CIOT.</p>
                </OsSheet>
            ) : null}
        </div>
    );
};

export default CiotEditor;
