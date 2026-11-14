import React, { useEffect, useState } from 'react';
import { fiscalEmittersApi, uploadApi } from '../../../../lib/api';
import { CTE_CFOP_SELECT_OPTIONS, CTE_CST_SELECT_OPTIONS, cfopOptionSelectText } from '../../../../lib/cteTaxCatalog';
import type { FiscalEmitter, FiscalEnvironment, FiscalTaxRegime, MdfeCargoTotalsSource } from '../../../../types/index';
import { firstError } from '../../lib/comercialForms';
import { ENVIRONMENT_LABEL } from '../../lib/sistema';
import { buildEmitterPayload, certificateProblem, emitterToForm, emptyEmitterForm, TAX_REGIME_LABEL, TOTALS_SOURCE_LABEL, validateEmitterForm, type EmitterForm } from '../../lib/sistemaForms';
import { invalidate } from '../../lib/resource';
import { Checkbox, FormFooter, FormSection, NumberInput, formatCnpjCpf, useForm } from '../../ui/form';
import { HubSelect, PersonPicker, toPersonSummary, type PersonSummary } from '../../ui/pickers';
import { Button, Field, ModeBadge, Pill, SelectInput, TextArea, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';
import { CertificateSection, DistribuicaoSection, ReadinessSection } from './EmitterExtras';

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>);

/** Lê o arquivo em base64 puro (sem o prefixo data:), como a clássica envia. */
function toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result ?? '');
            resolve(text.includes(',') ? text.split(',')[1] : text);
        };
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
    });
}

const EnvToggle: React.FC<{ label: string; hint: string; value: FiscalEnvironment; onChange: (v: FiscalEnvironment) => void }> = ({ label, hint, value, onChange }) => (
    <div className="col-span-full gx-inset flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
            <p className="font-semibold">{label}</p>
            <p className="gx-muted text-[12.5px]">{hint}</p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label={label}>
            <Pill tone={value === 'PRODUCAO' ? 'solid' : 'yellow'}>{ENVIRONMENT_LABEL[value]}</Pill>
            <Button size="sm" variant="soft" onClick={() => onChange(value === 'PRODUCAO' ? 'HOMOLOGACAO' : 'PRODUCAO')}>
                {value === 'PRODUCAO' ? 'Voltar para teste' : 'Passar para produção'}
            </Button>
        </div>
    </div>
);

/** Emitente fiscal: criar e editar em seções, com certificado A1 e checklist. */
export const EmitterDrawer: React.FC<{ open: boolean; emitter: FiscalEmitter | null; onClose: () => void }> = ({ open, emitter, onClose }) => {
    const { busy, run } = useAction();
    const form = useForm<EmitterForm>(emptyEmitterForm());
    const [person, setPerson] = useState<PersonSummary | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [certFile, setCertFile] = useState<File | null>(null);
    const [certPassword, setCertPassword] = useState('');
    const [certProblem, setCertProblem] = useState<string | null>(null);
    const [logoBusy, setLogoBusy] = useState(false);
    const { reset } = form;
    const v = form.values;
    const set = form.set;

    useEffect(() => {
        if (!open) return;
        reset(emitter ? emitterToForm(emitter) : emptyEmitterForm());
        setPerson(emitter?.person ? toPersonSummary(emitter.person) : null);
        setErrors({});
        setCertFile(null);
        setCertPassword('');
        setCertProblem(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, emitter?.id, reset]);

    const uploadLogo = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setErrors({ logo: 'O logo precisa ser uma imagem.' });
            return;
        }
        setLogoBusy(true);
        try {
            const uploaded = await uploadApi.upload(await toBase64(file), file.name, file.type, { keyPrefix: 'branding/logos' });
            form.setMany({ logoUrl: uploaded.data.downloadUrl ?? uploaded.data.url ?? '', logoStorageKey: uploaded.data.storageKey ?? '' });
        } catch {
            setErrors({ logo: 'Não foi possível enviar o logo.' });
        } finally {
            setLogoBusy(false);
        }
    };

    const save = async () => {
        const found = validateEmitterForm(v);
        const certIssue = certificateProblem(certFile, certPassword);
        setCertProblem(certIssue);
        setErrors(found);
        if (Object.keys(found).length > 0 || certIssue) return;
        const ok = await run(
            'save',
            async () => {
                const payload = buildEmitterPayload(v, person);
                const saved = v.id ? await fiscalEmittersApi.update(v.id, payload) : await fiscalEmittersApi.create(payload);
                if (certFile) {
                    await fiscalEmittersApi.uploadCertificate(saved.data.id, {
                        file: await toBase64(certFile),
                        filename: certFile.name,
                        mimeType: certFile.type || 'application/x-pkcs12',
                        password: certPassword,
                    });
                }
            },
            { success: certFile ? 'Emitente salvo e certificado enviado.' : 'Emitente salvo.', error: 'Não foi possível salvar o emitente.' },
        );
        setCertPassword('');
        if (ok) {
            invalidate('system:', 'fiscal-emitters');
            onClose();
        }
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={860}
            title={emitter ? emitter.displayName || emitter.person?.legalName || 'Emitente fiscal' : 'Novo emitente fiscal'}
            subtitle={emitter ? formatCnpjCpf(emitter.person?.document) : 'CNPJ que emite CT-e, MDF-e e CIOT'}
            badge={<Pill tone={v.environment === 'PRODUCAO' ? 'solid' : 'yellow'}>{ENVIRONMENT_LABEL[v.environment]}</Pill>}
            footer={
                <FormFooter
                    error={firstError(errors)}
                    secondary={<Button variant="ghost" onClick={onClose}>Cancelar</Button>}
                    primary={<Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>{emitter ? 'Salvar emitente' : 'Criar emitente'}</Button>}
                />
            }
        >
            <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
                <FormSection title="Dados fiscais" hint="Quem emite e em qual ambiente.">
                    <Field label="CNPJ do emitente" error={errors.personId} className="col-span-full">
                        <PersonPicker value={person} documentType="CNPJ" ariaLabel="CNPJ do emitente" invalid={Boolean(errors.personId)} onChange={(p) => { setPerson(p); set('personId', p?.id ?? ''); }} />
                    </Field>
                    <Field label="Hub" hint="Sem hub, o emitente vale para a rede toda.">
                        <HubSelect value={v.hubId} onChange={(id) => set('hubId', id)} emptyOption="Sem hub específico" />
                    </Field>
                    <Field label="RNTRC">
                        <TextInput value={v.rntrc} onChange={(event) => set('rntrc', event.target.value)} />
                    </Field>
                    <Field label="Regime tributário">
                        <SelectInput value={v.taxRegime} onChange={(event) => set('taxRegime', event.target.value as FiscalTaxRegime | '')} aria-label="Regime tributário">
                            <option value="">Selecione</option>
                            {options(TAX_REGIME_LABEL)}
                        </SelectInput>
                    </Field>
                    <Field label="CRT" hint="1, 2 ou 3.">
                        <TextInput value={v.crt} onChange={(event) => set('crt', event.target.value)} />
                    </Field>
                    <Field label="CFOP padrão do CT-e">
                        <SelectInput value={v.defaultCteCfop} onChange={(event) => set('defaultCteCfop', event.target.value)} aria-label="CFOP padrão">
                            <option value="">Selecione</option>
                            {CTE_CFOP_SELECT_OPTIONS.map((o) => <option key={o.code} value={o.code} title={o.labelFull}>{cfopOptionSelectText(o)}</option>)}
                        </SelectInput>
                    </Field>
                    <Field label="CST padrão do CT-e">
                        <SelectInput value={v.defaultCteCst} onChange={(event) => set('defaultCteCst', event.target.value)} aria-label="CST padrão">
                            <option value="">Selecione</option>
                            {CTE_CST_SELECT_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.label}</option>)}
                        </SelectInput>
                    </Field>
                    <EnvToggle label="Ambiente de CT-e e MDF-e" hint="Homologação é teste e não vale como documento fiscal. Produção emite de verdade." value={v.environment} onChange={(e) => set('environment', e)} />
                    <EnvToggle label="Ambiente do CIOT (e-Frete)" hint="Independente do ambiente acima. Só passe para produção com as credenciais de produção prontas." value={v.efreteEnvironment} onChange={(e) => set('efreteEnvironment', e)} />
                    <div className="col-span-full flex flex-wrap gap-x-8 gap-y-3">
                        <Checkbox checked={v.provider === 'ACBR'} onChange={(c) => set('provider', c ? 'ACBR' : 'SIMULATED')} label="Emitir pela ACBr API" hint="Sem isso o emitente fica simulado. Exige as credenciais da ACBr no servidor." />
                        <Checkbox checked={v.active} onChange={(c) => set('active', c)} label="Emitente ativo" />
                        <Checkbox checked={v.defaultForHub} onChange={(c) => set('defaultForHub', c)} label="Padrão do hub" />
                        <Checkbox checked={v.distribuicaoNfeEnabled} onChange={(c) => set('distribuicaoNfeEnabled', c)} label="Buscar NF-e na SEFAZ" hint="Varredura automática 2 vezes ao dia." />
                    </div>
                </FormSection>

                <FormSection title="Peso e valor da carga no MDF-e" hint="Vale para o MDF-e e para o encerramento do CIOT." cols={1}>
                    <Field label="Origem dos totais">
                        <SelectInput value={v.mdfeCargoTotalsSource} onChange={(event) => set('mdfeCargoTotalsSource', event.target.value as MdfeCargoTotalsSource)} aria-label="Origem dos totais do MDF-e">
                            {options(TOTALS_SOURCE_LABEL)}
                        </SelectInput>
                    </Field>
                </FormSection>

                <FormSection title="Seguro da carga e averbação" hint="O seguro vai no grupo seg do MDF-e. A senha da averbação nunca é mostrada.">
                    <Field label="Seguradora"><TextInput value={v.cargoInsurerName} onChange={(event) => set('cargoInsurerName', event.target.value)} /></Field>
                    <Field label="CNPJ da seguradora" error={errors.cargoInsurerCnpj}><TextInput value={v.cargoInsurerCnpj} className="gx-mono" onChange={(event) => set('cargoInsurerCnpj', event.target.value)} /></Field>
                    <Field label="Apólice" className="col-span-full"><TextInput value={v.cargoInsurancePolicyNumber} onChange={(event) => set('cargoInsurancePolicyNumber', event.target.value)} /></Field>
                    <Field label="Averbação">
                        <SelectInput value={v.averbacaoProvider} onChange={(event) => set('averbacaoProvider', event.target.value as 'NONE' | 'ATM')} aria-label="Averbação">
                            <option value="NONE">Manual (sem integração)</option>
                            <option value="ATM">AT&amp;M</option>
                        </SelectInput>
                    </Field>
                    {v.averbacaoProvider === 'ATM' ? (
                        <>
                            <Field label="Ambiente da AT&M">
                                <SelectInput value={v.atmEnvironment} onChange={(event) => set('atmEnvironment', event.target.value as FiscalEnvironment)} aria-label="Ambiente da AT&M">{options(ENVIRONMENT_LABEL)}</SelectInput>
                            </Field>
                            <Field label="Código AT&M"><TextInput value={v.atmCode} onChange={(event) => set('atmCode', event.target.value)} /></Field>
                            <Field label="Usuário AT&M"><TextInput value={v.atmUser} onChange={(event) => set('atmUser', event.target.value)} /></Field>
                            <Field label="Senha AT&M" hint={v.hasAtmPassword ? 'Senha gravada. Deixe em branco para manter.' : undefined} className="col-span-full">
                                <TextInput type="password" autoComplete="new-password" value={v.atmPassword} onChange={(event) => set('atmPassword', event.target.value)} />
                            </Field>
                            <div className="col-span-full flex flex-wrap gap-x-8 gap-y-3">
                                <Checkbox checked={v.cargoTracked} onChange={(c) => set('cargoTracked', c)} label="Carga rastreada" />
                                <Checkbox checked={v.cargoLoadUnloadCovered} onChange={(c) => set('cargoLoadUnloadCovered', c)} label="Carga e descarga cobertas" />
                                <Checkbox checked={v.atmDeclareMdfe} onChange={(c) => set('atmDeclareMdfe', c)} label="Declarar o MDF-e na AT&M" />
                                <Checkbox checked={v.rcvBlocksDeparture} onChange={(c) => set('rcvBlocksDeparture', c)} label="Recusa do RC-V trava a saída" hint="Sem isso, só avisa." />
                            </div>
                        </>
                    ) : null}
                </FormSection>

                <FormSection title="Numerações" hint="Último número emitido; o próximo sai com o seguinte." cols={2}>
                    <Field label="Série do CT-e"><NumberInput value={v.cteSeries} onChange={(n) => set('cteSeries', n ?? 1)} min={1} aria-label="Série do CT-e" /></Field>
                    <Field label="Último CT-e"><NumberInput value={v.lastCteNumber} onChange={(n) => set('lastCteNumber', n ?? 0)} min={0} aria-label="Último CT-e" /></Field>
                    <Field label="Último DC-e"><NumberInput value={v.lastDceNumber} onChange={(n) => set('lastDceNumber', n ?? 0)} min={0} aria-label="Último DC-e" /></Field>
                    <Field label="Última minuta"><NumberInput value={v.lastMinutaNumber} onChange={(n) => set('lastMinutaNumber', n ?? 0)} min={0} aria-label="Última minuta" /></Field>
                </FormSection>

                <FormSection title="Identidade e impressão" hint="Aparece no DACTE e nos impressos.">
                    <Field label="Nome no DACTE"><TextInput value={v.displayName} onChange={(event) => set('displayName', event.target.value)} /></Field>
                    <Field label="Nome fantasia"><TextInput value={v.tradeName} onChange={(event) => set('tradeName', event.target.value)} /></Field>
                    <Field label="Rodapé dos impressos" className="col-span-full"><TextArea rows={2} value={v.footerNote} onChange={(event) => set('footerNote', event.target.value)} /></Field>
                    <Field label="Logo" error={errors.logo} hint={v.logoUrl ? 'Logo enviado. Salve o emitente para aplicar.' : undefined} className="col-span-full">
                        <input type="file" accept="image/*" className="gx-input" disabled={logoBusy} aria-label="Arquivo do logo" onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.target.value = ''; }} />
                    </Field>
                </FormSection>

                <CertificateSection emitter={emitter} file={certFile} password={certPassword} problem={certProblem} onFile={setCertFile} onPassword={setCertPassword} />
                {emitter ? <DistribuicaoSection emitter={emitter} /> : null}
                {emitter ? <ReadinessSection emitterId={emitter.id} /> : <p className="gx-muted text-[13px]"><ModeBadge mode="copilot" /> O checklist de prontidão aparece depois que o emitente for criado.</p>}
            </form>
        </Drawer>
    );
};
