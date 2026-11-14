import React, { useEffect, useState } from 'react';
import { opportunitiesApi, pipelineApi } from '../../../../lib/api';
import { STAGE_LABEL, STAGE_ORDER } from '../../lib/comercial';
import {
    buildOpportunityCreate,
    buildOpportunityFields,
    COMPLETENESS_LABEL,
    columnForStage,
    conversionBlocker,
    emptyOpportunityForm,
    firstError,
    opportunityAccountName,
    opportunityToForm,
    OPPORTUNITY_TYPE_LABEL,
    SOURCE_LABEL,
    validateOpportunity,
    type AccountOption,
    type OpportunityForm,
    type OpportunityRow,
} from '../../lib/comercialForms';
import { dateTime, money } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { KEYS } from '../../lib/data';
import { Checkbox, FormFooter, FormSection, MoneyInput, NumberInput, useForm } from '../../ui/form';
import { Button, Field, Kv, ModeBadge, Pill, SelectInput, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';
import { AccountPicker } from './AccountPicker';

interface PipelineColumn {
    id: string;
    stage: string | null;
    active: boolean;
}

/** Nova oportunidade (conta por busca) ou detalhe/edição de uma existente, na mesma gaveta. */
export const OpportunityDrawer: React.FC<{ open: boolean; opportunity: OpportunityRow | null; onClose: () => void }> = ({ open, opportunity, onClose }) => {
    const { busy, run } = useAction();
    const form = useForm<OpportunityForm>(emptyOpportunityForm());
    const [account, setAccount] = useState<AccountOption | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [stage, setStage] = useState<string>('QUOTE');
    const columns = useResource<PipelineColumn[]>('demands:pipeline-columns', async () => ((await pipelineApi.getColumns()).data ?? []) as PipelineColumn[], { staleMs: 120_000 });
    const isNew = !opportunity;
    const { reset } = form;

    useEffect(() => {
        if (!open) return;
        reset(opportunity ? opportunityToForm(opportunity) : emptyOpportunityForm());
        setAccount(null);
        setErrors({});
        setStage(opportunity?.stage ?? 'QUOTE');
        // só reinicia ao abrir ou trocar de oportunidade: uma renovação da lista não pode apagar o que a pessoa digitou
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, opportunity?.id, reset]);

    const refresh = () => invalidate('demands:', KEYS.summary);

    const save = async () => {
        const found = validateOpportunity(account?.accountId, form.values, isNew);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        const ok = await run(
            'save',
            () => (opportunity ? opportunitiesApi.update(opportunity.id, buildOpportunityFields(form.values)) : opportunitiesApi.create(buildOpportunityCreate(account!.accountId, form.values, crypto.randomUUID()))),
            { success: opportunity ? 'Oportunidade atualizada.' : 'Oportunidade criada.', error: 'Não foi possível salvar a oportunidade.' },
        );
        if (ok) {
            refresh();
            onClose();
        }
    };

    const moveStage = async () => {
        if (!opportunity || stage === opportunity.stage) return;
        const column = columnForStage(columns.data ?? [], stage);
        const ok = await run('stage', () => (column ? pipelineApi.moveOpportunity(opportunity.id, column.id) : opportunitiesApi.update(opportunity.id, { stage })), {
            success: `Movida para ${STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? 'novo estágio'}.`,
            error: 'Não foi possível mover a oportunidade.',
        });
        if (ok) {
            refresh();
            onClose();
        }
    };

    const convert = async () => {
        if (!opportunity) return;
        const ok = await run('convert', () => opportunitiesApi.convertToDemand(opportunity.id), { success: 'Oportunidade convertida em demanda.', error: 'Não foi possível converter.' });
        if (ok) {
            refresh();
            onClose();
        }
    };

    const blocker = opportunity ? conversionBlocker(opportunity) : null;
    const set = form.set;

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={760}
            title={opportunity ? `${opportunity.origin || 'Origem a definir'} → ${opportunity.destination || 'destino a definir'}` : 'Nova oportunidade'}
            subtitle={opportunity ? opportunityAccountName(opportunity) : 'Cotação registrada por você, fora do chat.'}
            badge={opportunity ? <Pill tone={opportunity.stage === 'LOST' ? 'red' : 'royal'}>{STAGE_LABEL[opportunity.stage] ?? 'Outro estágio'}</Pill> : <ModeBadge mode="manual" />}
            footer={
                <FormFooter
                    error={firstError(errors)}
                    secondary={
                        <Button variant="ghost" onClick={onClose}>
                            Fechar
                        </Button>
                    }
                    primary={
                        <Button variant="primary" loading={busy === 'save'} disabled={Boolean(busy) && busy !== 'save'} onClick={() => void save()}>
                            {isNew ? 'Criar oportunidade' : 'Salvar alterações'}
                        </Button>
                    }
                />
            }
        >
            <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                {opportunity ? (
                    <FormSection title="Andamento" hint="O funil mostra a oportunidade na coluna do estágio escolhido." cols={1}>
                        <div className="gx-inset px-4 py-1">
                            <Kv label="Origem do contato" value={SOURCE_LABEL[opportunity.source] ?? opportunity.source} />
                            <Kv label="Dados" value={COMPLETENESS_LABEL[opportunity.completeness] ?? '—'} />
                            <Kv label="Criada em" value={dateTime(opportunity.createdAt)} />
                            {opportunity.quotedPrice != null ? <Kv label="Valor cotado" value={money(opportunity.quotedPrice)} strong /> : null}
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <Field label="Estágio" className="min-w-[220px] flex-1">
                                <SelectInput value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Estágio">
                                    {STAGE_ORDER.map((s) => (
                                        <option key={s} value={s}>
                                            {STAGE_LABEL[s]}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                            <Button variant="soft" loading={busy === 'stage'} disabled={stage === opportunity.stage || Boolean(busy)} onClick={() => void moveStage()}>
                                Mover
                            </Button>
                        </div>
                        <div className="gx-inset flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                            <p className="gx-soft min-w-0 flex-1 basis-60 text-[13.5px]">{blocker ?? 'Dados completos: pode virar demanda aprovada, pronta para consolidar em viagem.'}</p>
                            <Button variant="primary" size="sm" disabled={Boolean(blocker) || Boolean(busy)} loading={busy === 'convert'} onClick={() => void convert()}>
                                Converter em demanda
                            </Button>
                        </div>
                    </FormSection>
                ) : (
                    <FormSection title="Conta" cols={1}>
                        <Field label="Conta" error={errors.account}>
                            <AccountPicker value={account} onChange={setAccount} invalid={Boolean(errors.account)} />
                        </Field>
                    </FormSection>
                )}

                <FormSection title="Rota e carga" hint="Tudo opcional para registrar. Para converter em demanda precisa de origem, destino, peso, valor da nota e volumes.">
                    <Field label="Origem">
                        <TextInput value={form.values.origin} onChange={(event) => set('origin', event.target.value)} placeholder="Cidade, UF" />
                    </Field>
                    <Field label="Destino">
                        <TextInput value={form.values.destination} onChange={(event) => set('destination', event.target.value)} placeholder="Cidade, UF" />
                    </Field>
                    <Field label="Mercadoria" className="col-span-full">
                        <TextInput value={form.values.commodity} onChange={(event) => set('commodity', event.target.value)} />
                    </Field>
                    <Field label="Peso" error={errors.weight}>
                        <NumberInput decimal suffix="kg" value={form.values.weight} onChange={(v) => set('weight', v)} aria-label="Peso" min={0} />
                    </Field>
                    <Field label="Volumes">
                        <NumberInput value={form.values.volumes} onChange={(v) => set('volumes', v)} aria-label="Volumes" min={0} />
                    </Field>
                    <Field label="Valor da nota" error={errors.nfValue}>
                        <MoneyInput value={form.values.nfValue} onChange={(v) => set('nfValue', v)} aria-label="Valor da nota" />
                    </Field>
                    <Field label="Valor cotado">
                        <MoneyInput value={form.values.quotedPrice} onChange={(v) => set('quotedPrice', v)} aria-label="Valor cotado" />
                    </Field>
                </FormSection>

                <FormSection title="Tipo" cols={1}>
                    <Field label="Tipo de oportunidade">
                        <SelectInput value={form.values.type} onChange={(event) => set('type', event.target.value as OpportunityForm['type'])} aria-label="Tipo de oportunidade">
                            {Object.entries(OPPORTUNITY_TYPE_LABEL).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                    <Checkbox checked={form.values.needsCollection} onChange={(v) => set('needsCollection', v)} label="Precisa de coleta no cliente" />
                </FormSection>
            </form>
        </Drawer>
    );
};
