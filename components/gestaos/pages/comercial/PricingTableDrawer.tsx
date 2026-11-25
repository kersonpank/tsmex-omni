import React, { useEffect, useState } from 'react';
import { pricingApi } from '../../../../lib/api';
import type { FreightUnit, IcmsUnit, MinFreightUnit, PricingRoute, PricingTable, TollUnit } from '../../../../types/index';
import {
    buildTablePayload,
    emptyTableForm,
    firstError,
    FREIGHT_UNIT_LABEL,
    ICMS_UNIT_LABEL,
    MIN_FREIGHT_UNIT_LABEL,
    previewTableIcms,
    TABLE_TYPE_LABEL,
    tableToForm,
    TOLL_UNIT_LABEL,
    validateTableForm,
    type TableForm,
} from '../../lib/comercialForms';
import { money } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { Checkbox, FormFooter, FormGrid, FormSection, MoneyInput, NumberInput, useForm } from '../../ui/form';
import { ClientSelect } from '../../ui/pickers';
import { Button, Field, ModeBadge, SelectInput, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';

const options = (labels: Record<string, string>) =>
    Object.entries(labels).map(([value, label]) => (
        <option key={value} value={value}>
            {label}
        </option>
    ));

const ICMS_UNIT_HINT: Record<IcmsUnit, string> = {
    PERCENT: 'Percentual sobre a soma do frete e das taxas.',
    DIVISOR: 'Ex.: 0,88 = ICMS de 12% por dentro.',
    FIXED: 'Valor em reais somado ao frete.',
};

interface PricingTableDrawerProps {
    open: boolean;
    table: PricingTable | null;
    onClose: () => void;
    initial?: Partial<TableForm>;
    onSaved?: (table: PricingTable) => void;
}

/** Criar ou editar uma tabela de preço. Mesmo corpo e mesma regra da gestão clássica (descrição obrigatória). */
export const PricingTableDrawer: React.FC<PricingTableDrawerProps> = ({ open, table, onClose, initial, onSaved }) => {
    const { busy, run } = useAction();
    const form = useForm<TableForm>(emptyTableForm());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [saveError, setSaveError] = useState<string | null>(null);
    const routes = useResource<PricingRoute[]>('pricing:routes:active', async () => (await pricingApi.listRoutes({ includeInactive: false })).data ?? [], { staleMs: 60_000 });
    const { reset } = form;
    const v = form.values;
    const set = form.set;
    const icmsPreview = previewTableIcms(v);

    useEffect(() => {
        if (!open) return;
        setErrors({});
        setSaveError(null);
        if (!table) {
            reset({ ...emptyTableForm(), ...initial });
            return;
        }
        reset(tableToForm(table));
        let cancelled = false;
        // Busca a versão atual da tabela, como na gestão clássica.
        pricingApi.getTableById(table.id).then(
            (res) => {
                if (!cancelled && res.data) reset(tableToForm(res.data));
            },
            () => undefined,
        );
        return () => {
            cancelled = true;
        };
        // O preenchimento inicial só é reaplicado ao abrir ou trocar de tabela.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, table?.id, reset]);

    const save = async () => {
        const found = validateTableForm(v);
        setErrors(found);
        setSaveError(null);
        if (Object.keys(found).length > 0) return;
        const payload = buildTablePayload(v) as Partial<PricingTable>;
        let savedTable: PricingTable | undefined;
        const ok = await run(
            'save',
            async () => {
                const response = await (table ? pricingApi.updateTable(table.id, payload) : pricingApi.createTable(payload));
                if (!response.success || !response.data) throw new Error(response.error ?? 'Não foi possível salvar a tabela.');
                savedTable = response.data;
            },
            { success: table ? 'Tabela atualizada.' : 'Tabela criada.', onError: setSaveError },
        );
        if (ok && savedTable) {
            invalidate('pricing:');
            onSaved?.(savedTable);
            onClose();
        }
    };

    const setRange = (index: number, patch: Partial<TableForm['ranges'][number]>) => set('ranges', v.ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    const setIcms = (patch: Partial<Pick<TableForm, 'icmsIncluded' | 'icmsUnit' | 'icmsPercent'>>) => {
        form.setMany(patch);
        setErrors(({ icmsPercent: _previous, ...otherErrors }) => otherErrors);
    };

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
                    error={firstError(errors) ?? saveError}
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
                        <SelectInput value={v.type} onChange={(event) => set('type', event.target.value as TableForm['type'])} aria-label="Tipo">
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
                    ) : (
                        <div className="col-span-full">
                            <Checkbox
                                checked={v.coverageOnly}
                                onChange={(checked) => set('coverageOnly', checked)}
                                label="Só para cidades de cobertura"
                                hint="Não entra como tabela geral para todos os pedidos; vale só nas cidades de cobertura onde for vinculada."
                            />
                        </div>
                    )}
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
                        <Checkbox checked={v.icmsIncluded} onChange={(icmsIncluded) => setIcms({ icmsIncluded })} label="ICMS já incluso no frete" />
                    </div>
                    {v.cubeEnabled ? (
                        <Field label="Fator de cubagem">
                            <NumberInput decimal suffix="kg/m³" value={v.cubeFactor} onChange={(n) => set('cubeFactor', n)} aria-label="Fator de cubagem" min={0} />
                        </Field>
                    ) : null}
                    {!v.icmsIncluded ? (
                        <FormGrid className="col-span-full">
                            <Field label="Unidade do ICMS">
                                <SelectInput value={v.icmsUnit} onChange={(event) => setIcms({ icmsUnit: event.target.value as IcmsUnit, icmsPercent: null })} aria-label="Unidade do ICMS">
                                    {options(ICMS_UNIT_LABEL)}
                                </SelectInput>
                            </Field>
                            <Field label="Valor do ICMS" hint={ICMS_UNIT_HINT[v.icmsUnit]} error={errors.icmsPercent}>
                                <NumberInput
                                    decimal
                                    decimals={6}
                                    suffix={v.icmsUnit === 'PERCENT' ? '%' : undefined}
                                    value={v.icmsPercent}
                                    onChange={(icmsPercent) => setIcms({ icmsPercent })}
                                    aria-label="Valor do ICMS"
                                    min={Number.NEGATIVE_INFINITY}
                                    invalid={Boolean(errors.icmsPercent)}
                                />
                            </Field>
                            {icmsPreview ? (
                                <p className="gx-muted col-span-full text-[12.5px]" aria-live="polite">
                                    Sobre {money(icmsPreview.subtotal)} de frete: ICMS {money(icmsPreview.icms)} → total {money(icmsPreview.total)}
                                </p>
                            ) : null}
                        </FormGrid>
                    ) : null}
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
