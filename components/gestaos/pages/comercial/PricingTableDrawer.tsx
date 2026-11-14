import React, { useEffect, useState } from 'react';
import { pricingApi } from '../../../../lib/api';
import type { FreightUnit, MinFreightUnit, PricingRoute, PricingTable, TollUnit } from '../../../../types/index';
import {
    buildTablePayload,
    emptyTableForm,
    firstError,
    FREIGHT_UNIT_LABEL,
    MIN_FREIGHT_UNIT_LABEL,
    TABLE_TYPE_LABEL,
    tableToForm,
    TOLL_UNIT_LABEL,
    validateTableForm,
    type PricingTableForm,
} from '../../lib/comercialForms';
import { invalidate, useResource } from '../../lib/resource';
import { Checkbox, FormFooter, FormSection, MoneyInput, NumberInput, useForm } from '../../ui/form';
import { ClientSelect } from '../../ui/pickers';
import { Button, Field, ModeBadge, SelectInput, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';

const options = (labels: Record<string, string>) =>
    Object.entries(labels).map(([value, label]) => (
        <option key={value} value={value}>
            {label}
        </option>
    ));

/** Criar ou editar uma tabela de preço. Mesmo corpo e mesma regra da gestão clássica (descrição obrigatória). */
export const PricingTableDrawer: React.FC<{ open: boolean; table: PricingTable | null; onClose: () => void }> = ({ open, table, onClose }) => {
    const { busy, run } = useAction();
    const form = useForm<PricingTableForm>(emptyTableForm());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const routes = useResource<PricingRoute[]>('pricing:routes:active', async () => (await pricingApi.listRoutes({ includeInactive: false })).data ?? [], { staleMs: 60_000 });
    const { reset } = form;
    const v = form.values;
    const set = form.set;

    useEffect(() => {
        if (!open) return;
        setErrors({});
        reset(emptyTableForm());
        if (!table) return;
        let cancelled = false;
        // a lista não traz as faixas de frete mínimo: busca a tabela inteira, como a clássica
        pricingApi.getTableById(table.id).then(
            (res) => {
                if (!cancelled && res.data) reset(tableToForm(res.data));
            },
            () => {
                if (!cancelled) reset(tableToForm(table));
            },
        );
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, table?.id, reset]);

    const save = async () => {
        const found = validateTableForm(v);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        const payload = buildTablePayload(v);
        const ok = await run('save', () => (table ? pricingApi.updateTable(table.id, payload as Partial<PricingTable>) : pricingApi.createTable(payload as Partial<PricingTable>)), {
            success: table ? 'Tabela atualizada.' : 'Tabela criada.',
            error: 'Não foi possível salvar a tabela.',
        });
        if (ok) {
            invalidate('pricing:');
            onClose();
        }
    };

    const setRange = (index: number, patch: Partial<PricingTableForm['ranges'][number]>) => set('ranges', v.ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={820}
            title={table ? 'Editar tabela de preço' : 'Nova tabela de preço'}
            subtitle={table?.description}
            badge={<ModeBadge mode="manual" />}
            footer={
                <FormFooter
                    error={firstError(errors)}
                    secondary={
                        <Button variant="ghost" onClick={onClose}>
                            Cancelar
                        </Button>
                    }
                    primary={
                        <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
                            {table ? 'Salvar tabela' : 'Criar tabela'}
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
                <FormSection title="Identificação">
                    <Field label="Descrição" error={errors.description} className="col-span-full">
                        <TextInput value={v.description} aria-invalid={Boolean(errors.description)} onChange={(event) => set('description', event.target.value)} placeholder="Ex.: peso/cubagem 300, 1,15 por kg + 10 por mil de advalor" />
                    </Field>
                    <Field label="Tipo">
                        <SelectInput value={v.type} onChange={(event) => set('type', event.target.value as PricingTableForm['type'])} aria-label="Tipo">
                            {options(TABLE_TYPE_LABEL)}
                        </SelectInput>
                    </Field>
                    <Field label="Rota" hint="Sem rota vale para qualquer trecho.">
                        <SelectInput value={v.routeId ?? ''} onChange={(event) => set('routeId', event.target.value || null)} aria-label="Rota">
                            <option value="">Todas as rotas</option>
                            {(routes.data ?? []).map((r) => (
                                <option key={r.id} value={r.id}>
                                    {r.name}
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                    {v.type === 'SPECIAL' ? (
                        <Field label="Cliente" className="col-span-full" hint="A tabela especial só vale para este cliente.">
                            <ClientSelect value={v.clientId} onChange={(id) => set('clientId', id)} emptyOption="Nenhum" />
                        </Field>
                    ) : null}
                </FormSection>

                <FormSection title="Frete">
                    <Field label="Valor do frete">
                        <NumberInput decimal decimals={6} value={v.freightValue} onChange={(n) => set('freightValue', n)} aria-label="Valor do frete" min={0} />
                    </Field>
                    <Field label="Unidade do frete">
                        <SelectInput value={v.freightUnit} onChange={(event) => set('freightUnit', event.target.value as FreightUnit)} aria-label="Unidade do frete">
                            {options(FREIGHT_UNIT_LABEL)}
                        </SelectInput>
                    </Field>
                    <Field label="Frete mínimo">
                        <NumberInput decimal value={v.minFreightValue} onChange={(n) => set('minFreightValue', n)} aria-label="Frete mínimo" min={0} />
                    </Field>
                    <Field label="Unidade do mínimo">
                        <SelectInput value={v.minFreightUnit} onChange={(event) => set('minFreightUnit', event.target.value as MinFreightUnit)} aria-label="Unidade do mínimo">
                            {options(MIN_FREIGHT_UNIT_LABEL)}
                        </SelectInput>
                    </Field>
                </FormSection>

                <FormSection title="Faixas de frete mínimo por peso" hint="Opcional. Cada faixa define o frete mínimo em reais para um intervalo de peso." cols={1}>
                    {v.ranges.map((range, index) => (
                        <div key={index} className="gx-inset grid grid-cols-1 items-end gap-3 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                            <Field label="Peso de (kg)">
                                <NumberInput decimal value={range.minWeight} onChange={(n) => setRange(index, { minWeight: n })} aria-label={`Peso inicial da faixa ${index + 1}`} min={0} />
                            </Field>
                            <Field label="Até (kg)" hint="Vazio = sem limite.">
                                <NumberInput decimal value={range.maxWeight} onChange={(n) => setRange(index, { maxWeight: n })} aria-label={`Peso final da faixa ${index + 1}`} min={0} />
                            </Field>
                            <Field label="Frete mínimo">
                                <MoneyInput value={range.value} onChange={(n) => setRange(index, { value: n })} aria-label={`Valor da faixa ${index + 1}`} />
                            </Field>
                            <Button variant="ghost" size="sm" onClick={() => set('ranges', v.ranges.filter((_, i) => i !== index))} aria-label={`Remover faixa ${index + 1}`}>
                                Remover
                            </Button>
                        </div>
                    ))}
                    {errors.ranges ? <p className="gx-red-text text-[12.5px]">{errors.ranges}</p> : null}
                    <div>
                        <Button size="sm" variant="soft" onClick={() => set('ranges', [...v.ranges, { minWeight: 0, maxWeight: null, value: null }])}>
                            Adicionar faixa
                        </Button>
                    </div>
                </FormSection>

                <FormSection title="Taxas">
                    <Field label="Advalor (por R$ 1.000)">
                        <NumberInput decimal decimals={6} value={v.adValoremPercent} onChange={(n) => set('adValoremPercent', n)} aria-label="Advalor" min={0} />
                    </Field>
                    <Field label="GRIS (por R$ 1.000)">
                        <NumberInput decimal decimals={6} value={v.grisPercent} onChange={(n) => set('grisPercent', n)} aria-label="GRIS" min={0} />
                    </Field>
                    <Field label="Advalor a partir de (valor da nota)">
                        <MoneyInput value={v.adValoremThreshold} onChange={(n) => set('adValoremThreshold', n)} aria-label="Advalor a partir de" />
                    </Field>
                    <Field label="Pedágio">
                        <NumberInput decimal value={v.tollValue} onChange={(n) => set('tollValue', n)} aria-label="Pedágio" min={0} />
                    </Field>
                    <Field label="Unidade do pedágio">
                        <SelectInput value={v.tollUnit} onChange={(event) => set('tollUnit', event.target.value as TollUnit)} aria-label="Unidade do pedágio">
                            {options(TOLL_UNIT_LABEL)}
                        </SelectInput>
                    </Field>
                    <Field label="Despacho">
                        <MoneyInput value={v.dispatchFee} onChange={(n) => set('dispatchFee', n)} aria-label="Despacho" />
                    </Field>
                    <Field label="Outras taxas">
                        <MoneyInput value={v.otherFees} onChange={(n) => set('otherFees', n)} aria-label="Outras taxas" />
                    </Field>
                </FormSection>

                <FormSection title="Cubagem e ICMS">
                    <div className="col-span-full flex flex-wrap gap-x-8 gap-y-3">
                        <Checkbox checked={v.cubeEnabled} onChange={(c) => set('cubeEnabled', c)} label="Cobrar pelo peso cubado" hint="Compara o peso real com o cubado e cobra o maior." />
                        <Checkbox checked={v.icmsIncluded} onChange={(c) => set('icmsIncluded', c)} label="ICMS já incluso no frete" />
                    </div>
                    {v.cubeEnabled ? (
                        <Field label="Fator de cubagem">
                            <NumberInput decimal suffix="kg/m³" value={v.cubeFactor} onChange={(n) => set('cubeFactor', n)} aria-label="Fator de cubagem" min={0} />
                        </Field>
                    ) : null}
                    <Field label="ICMS">
                        <NumberInput decimal suffix="%" value={v.icmsPercent} onChange={(n) => set('icmsPercent', n)} aria-label="ICMS" min={0} />
                    </Field>
                </FormSection>

                <FormSection title="Situação">
                    <Field label="Prioridade" hint="Maior número é considerada primeiro.">
                        <NumberInput value={v.priority} onChange={(n) => set('priority', n ?? 0)} aria-label="Prioridade" min={0} />
                    </Field>
                    <div className="flex items-end">
                        <Checkbox checked={v.active} onChange={(c) => set('active', c)} label="Tabela ativa" hint="Tabela inativa não entra no cálculo de frete." />
                    </div>
                </FormSection>
            </form>
        </Drawer>
    );
};
