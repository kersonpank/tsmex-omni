import React, { useState } from 'react';
import { costAgreementsApi, hubsApi, linksApi, vehicleTypesApi, type LinkCostAgreementRow } from '../../../../lib/api';
import { Drawer, useAction } from '../../ui/overlay';
import { Button, Field, Loadable, SelectInput, TextInput } from '../../ui/kit';
import { invalidate, useResource } from '../../lib/resource';

type CostMode = LinkCostAgreementRow['costMode'];
export const COST_MODE_LABEL: Record<CostMode, string> = { FLAT: 'Valor fechado por viagem', PER_M3: 'Por m³', PER_KG: 'Por kg' };

/** Número de um campo de texto; vazio vira `null`. */
const parse = (text: string): number | null => {
    const clean = text.trim().replace(',', '.');
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
};

const useOptions = () =>
    useResource(
        'agreements:options',
        async () => {
            const [links, hubs, vehicles] = await Promise.all([linksApi.list(), hubsApi.list(), vehicleTypesApi.list()]);
            const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR');
            return {
                links: (links.data ?? []).map((item) => ({ id: item.id, name: item.name })).sort(byName),
                hubs: (hubs.data ?? []).map((item) => ({ id: item.id, name: item.name })).sort(byName),
                vehicles: (vehicles.data ?? []).map((item) => ({ code: item.code, name: item.name })).sort(byName),
            };
        },
        { staleMs: 300_000 },
    );

/** Acordo do transportador por rota e veículo. Validações da tela clássica e do servidor. */
export const LinkAgreementDrawer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const options = useOptions();
    const { busy, run } = useAction();
    const [form, setForm] = useState({ linkId: '', originCity: '', destinationCity: '', vehicleTypeCode: '', costMode: 'FLAT' as CostMode, value: '' });
    const [touched, setTouched] = useState(false);
    const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

    const value = parse(form.value);
    const minValue = form.costMode === 'FLAT' ? 0 : 0.0001;
    const maxValue = form.costMode === 'FLAT' ? 10_000_000 : 1_000_000;
    const errors = {
        linkId: form.linkId ? null : 'Escolha o transportador.',
        originCity: form.originCity.trim().length < 2 ? 'Informe a origem.' : null,
        destinationCity: form.destinationCity.trim().length < 2 ? 'Informe o destino.' : null,
        vehicleTypeCode: form.vehicleTypeCode ? null : 'Escolha o tipo de veículo.',
        value: value == null || value < minValue || value > maxValue ? (form.costMode === 'FLAT' ? 'Informe o valor da viagem (zero ou mais).' : 'Informe um valor maior que zero.') : null,
    };
    const show = (field: keyof typeof errors) => (touched ? errors[field] : null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (Object.values(errors).some(Boolean) || value == null) return;
        const ok = await run(
            'agreement:link',
            () =>
                costAgreementsApi.createLink({
                    linkId: form.linkId,
                    originCity: form.originCity.trim(),
                    destinationCity: form.destinationCity.trim(),
                    vehicleTypeCode: form.vehicleTypeCode,
                    costMode: form.costMode,
                    flatRate: form.costMode === 'FLAT' ? value : 0,
                    ratePerM3: form.costMode === 'PER_M3' ? value : null,
                    ratePerKg: form.costMode === 'PER_KG' ? value : null,
                }),
            { success: 'Acordo do transportador criado.', error: 'O acordo não foi criado.' },
        );
        invalidate('agreements:');
        if (ok) onClose();
    };

    return (
        <Drawer open onClose={onClose} title="Novo acordo com transportador" subtitle="Quanto pagamos por rota e tipo de veículo. Alimenta o custo e a margem da viagem.">
            <Loadable state={options}>
                {(data) => (
                    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                        <Field label="Transportador" error={show('linkId')}>
                            <SelectInput value={form.linkId} onChange={(event) => set({ linkId: event.target.value })}>
                                <option value="">Selecione…</option>
                                {data.links.map((link) => (
                                    <option key={link.id} value={link.id}>{link.name}</option>
                                ))}
                            </SelectInput>
                        </Field>
                        <Field label="Origem" error={show('originCity')}>
                            <TextInput value={form.originCity} maxLength={120} placeholder="São Paulo" onChange={(event) => set({ originCity: event.target.value })} />
                        </Field>
                        <Field label="Destino" error={show('destinationCity')}>
                            <TextInput value={form.destinationCity} maxLength={120} placeholder="Imperatriz" onChange={(event) => set({ destinationCity: event.target.value })} />
                        </Field>
                        <Field label="Tipo de veículo" error={show('vehicleTypeCode')}>
                            <SelectInput value={form.vehicleTypeCode} onChange={(event) => set({ vehicleTypeCode: event.target.value })}>
                                <option value="">Selecione…</option>
                                {data.vehicles.map((vehicle) => (
                                    <option key={vehicle.code} value={vehicle.code}>{vehicle.name}</option>
                                ))}
                            </SelectInput>
                        </Field>
                        <Field label="Como o transportador cobra">
                            <SelectInput value={form.costMode} onChange={(event) => set({ costMode: event.target.value as CostMode, value: '' })}>
                                {Object.entries(COST_MODE_LABEL).map(([mode, label]) => (
                                    <option key={mode} value={mode}>{label}</option>
                                ))}
                            </SelectInput>
                        </Field>
                        <Field label={form.costMode === 'FLAT' ? 'Valor da viagem (R$)' : form.costMode === 'PER_M3' ? 'Valor por m³ (R$)' : 'Valor por kg (R$)'} error={show('value')}>
                            <TextInput inputMode="decimal" value={form.value} placeholder="0,00" onChange={(event) => set({ value: event.target.value })} />
                        </Field>
                        <div className="flex flex-wrap gap-2.5 pt-1">
                            <Button type="submit" variant="primary" loading={busy === 'agreement:link'}>Adicionar acordo</Button>
                            <Button onClick={onClose} disabled={busy != null}>Cancelar</Button>
                        </div>
                    </form>
                )}
            </Loadable>
        </Drawer>
    );
};

/** Comissão do hub parceiro: taxa por pedido e/ou percentual do frete. */
export const HubAgreementDrawer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const options = useOptions();
    const { busy, run } = useAction();
    const [form, setForm] = useState({ hubId: '', fee: '', percent: '' });
    const [touched, setTouched] = useState(false);

    const fee = parse(form.fee) ?? 0;
    const percent = parse(form.percent);
    const errors = {
        hubId: form.hubId ? null : 'Escolha o hub.',
        fee: fee < 0 || fee > 1_000_000 || (form.fee.trim() !== '' && parse(form.fee) == null) ? 'Taxa inválida (zero ou mais).' : null,
        percent: form.percent.trim() !== '' && (percent == null || percent < 0 || percent > 100) ? 'Use um percentual entre 0 e 100.' : null,
    };
    const show = (field: keyof typeof errors) => (touched ? errors[field] : null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (Object.values(errors).some(Boolean)) return;
        const ok = await run('agreement:hub', () => costAgreementsApi.createHub({ hubId: form.hubId, handlingFeePerOrder: fee, percentOfFreight: percent }), {
            success: 'Comissão do hub criada.',
            error: 'A comissão não foi criada.',
        });
        invalidate('agreements:');
        if (ok) onClose();
    };

    return (
        <Drawer open onClose={onClose} title="Nova comissão de hub" subtitle="O que o hub parceiro recebe por pedido e/ou sobre o frete. Sem acordo a comissão conta zero na margem.">
            <Loadable state={options}>
                {(data) => (
                    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                        <Field label="Hub" error={show('hubId')}>
                            <SelectInput value={form.hubId} onChange={(event) => setForm({ ...form, hubId: event.target.value })}>
                                <option value="">Selecione…</option>
                                {data.hubs.map((hub) => (
                                    <option key={hub.id} value={hub.id}>{hub.name}</option>
                                ))}
                            </SelectInput>
                        </Field>
                        <Field label="Taxa por pedido (R$)" error={show('fee')}>
                            <TextInput inputMode="decimal" value={form.fee} placeholder="0,00" onChange={(event) => setForm({ ...form, fee: event.target.value })} />
                        </Field>
                        <Field label="% do frete (opcional)" error={show('percent')}>
                            <TextInput inputMode="decimal" value={form.percent} placeholder="0" onChange={(event) => setForm({ ...form, percent: event.target.value })} />
                        </Field>
                        <div className="flex flex-wrap gap-2.5 pt-1">
                            <Button type="submit" variant="primary" loading={busy === 'agreement:hub'}>Adicionar comissão</Button>
                            <Button onClick={onClose} disabled={busy != null}>Cancelar</Button>
                        </div>
                    </form>
                )}
            </Loadable>
        </Drawer>
    );
};
