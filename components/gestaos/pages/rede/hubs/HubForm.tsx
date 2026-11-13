import React, { useMemo } from 'react';
import { hubsApi } from '../../../../../lib/api';
import type { Hub } from '../../../../../types/index';
import { KEYS, useHubs } from '../../../lib/data';
import { buildHubPayload, emitterRemovalBlocked, EMPTY_HUB_FORM, formatPhone, hubFormFrom, isEmail, type HubFormValues } from '../../../lib/redeCadastro';
import { invalidate } from '../../../lib/resource';
import { FormFooter, FormSection, FormCell, FULL_ROW, Toggle, useForm, type Rules } from '../../../ui/form';
import { Button, Field, SelectInput, TextInput } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { CityPicker, PersonPicker, toPersonSummary, type PersonSummary } from '../../../ui/pickers';

const rules: Rules<HubFormValues> = {
    name: { required: 'Informe o nome do hub.' },
    code: { required: 'Informe o código do hub (ex.: SP-GRU).' },
    city: { required: 'Escolha a cidade na busca.', check: (_, v) => (!v.cityIbgeCode ? 'Confirme a cidade escolhendo uma sugestão da busca.' : null) },
    email: { check: (value) => (value && !isEmail(value) ? 'E-mail inválido.' : null) },
};

/** Dados do hub: criar e editar. Mesmos campos e validações da gestão clássica, mais "abastecido por". */
export const HubForm: React.FC<{ hub: Hub | null; onSaved: (hub: Hub) => void; onCancel: () => void }> = ({ hub, onSaved, onCancel }) => {
    const form = useForm<HubFormValues>(hub ? hubFormFrom(hub) : EMPTY_HUB_FORM);
    const { values, errors, set } = form;
    const hubs = useHubs();
    const { busy, run } = useAction();
    const [emitter, setEmitter] = React.useState<PersonSummary | null>(() =>
        hub?.person?.id && hub.person.legalName && hub.person.document ? toPersonSummary(hub.person as Parameters<typeof toPersonSummary>[0]) : null,
    );
    const options = useMemo(() => (hubs.data ?? []).filter((h) => h.id !== hub?.id && (h.active || h.id === values.gatewayHubId)), [hubs.data, hub?.id, values.gatewayHubId]);
    const removalBlocked = emitterRemovalBlocked(hub, values);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.validate(rules)) return;
        if (removalBlocked) {
            form.setError('personId', 'O servidor não aceita remover o CNPJ emissor de um hub. Troque por outro CNPJ.');
            return;
        }
        let saved: Hub | null = null;
        const ok = await run(
            hub ? 'hub:edit' : 'hub:new',
            async () => {
                const payload = buildHubPayload(values, Boolean(hub));
                const response = hub ? await hubsApi.update(hub.id, payload) : await hubsApi.create(payload);
                saved = response.data;
            },
            { success: hub ? 'Hub atualizado.' : 'Hub criado.', error: 'O hub não foi salvo.' },
        );
        if (ok && saved) {
            invalidate(KEYS.hubs, KEYS.summary);
            onSaved(saved);
        }
    };

    return (
        <form onSubmit={submit} noValidate className="flex flex-col gap-1">
            <FormSection title="Identificação" hint="O código aparece em etiquetas, viagens e no link de convite dos operadores.">
                <Field label="Nome" error={errors.name}>
                    <TextInput value={values.name} maxLength={120} onChange={(e) => set('name', e.target.value)} aria-invalid={Boolean(errors.name) || undefined} />
                </Field>
                <Field label="Código" error={errors.code}>
                    <TextInput value={values.code} maxLength={20} placeholder="ex.: SP-GRU" onChange={(e) => set('code', e.target.value.toUpperCase())} aria-invalid={Boolean(errors.code) || undefined} />
                </Field>
                <FormCell full>
                    <Toggle checked={values.active} onChange={(checked) => set('active', checked)} label={values.active ? 'Hub ativo' : 'Hub inativo'} hint="Hub inativo não recebe carga nem convites de operador." />
                </FormCell>
            </FormSection>

            <FormSection title="Localização">
                <FormCell full>
                    <span className="gx-label mb-1.5 block">Cidade</span>
                    <CityPicker
                        ariaLabel="Cidade do hub"
                        invalid={Boolean(errors.city)}
                        value={values.cityIbgeCode ? { city: values.city, state: values.state, ibgeCode: values.cityIbgeCode } : null}
                        onChange={(city) => form.setMany(city ? { city: city.city, state: city.state, cityIbgeCode: city.ibgeCode } : { city: '', state: '', cityIbgeCode: '' })}
                    />
                    {errors.city ? <span className="gx-red-text mt-1 block text-[12.5px]">{errors.city}</span> : null}
                    {!values.cityIbgeCode && values.city ? <span className="gx-muted mt-1 block text-[12.5px]">Cadastro antigo: {values.city}/{values.state}. Busque a cidade para confirmar o código IBGE.</span> : null}
                </FormCell>
                <Field label="Endereço" className={FULL_ROW}>
                    <TextInput value={values.address} onChange={(e) => set('address', e.target.value)} />
                </Field>
            </FormSection>

            <FormSection title="Contato">
                <Field label="Gerente">
                    <TextInput value={values.managerName} onChange={(e) => set('managerName', e.target.value)} />
                </Field>
                <Field label="Telefone">
                    <TextInput inputMode="tel" placeholder="(11) 99999-9999" value={formatPhone(values.phone)} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} />
                </Field>
                <Field label="E-mail de contato" error={errors.email} className={FULL_ROW}>
                    <TextInput type="email" value={values.email} onChange={(e) => set('email', e.target.value)} aria-invalid={Boolean(errors.email) || undefined} />
                </Field>
            </FormSection>

            <FormSection title="Fiscal e rede" mode="copilot" hint="O CNPJ emissor assina o CT-e e a Minuta deste hub (não é o login do operador). O sistema só oferece hubs ativos como tronco.">
                <FormCell full>
                    <span className="gx-label mb-1.5 block">CNPJ emissor (CT-e / Minuta)</span>
                    <PersonPicker
                        documentType="CNPJ"
                        ariaLabel="CNPJ emissor"
                        value={emitter}
                        invalid={Boolean(errors.personId)}
                        onChange={(summary) => {
                            setEmitter(summary);
                            set('personId', summary?.id ?? null);
                        }}
                    />
                    {errors.personId ? <span className="gx-red-text mt-1 block text-[12.5px]">{errors.personId}</span> : null}
                </FormCell>
                <Field label="Esta unidade é abastecida por" hint="A carga para cá passa antes por esse hub (tronco para regional). Sem escolha, vai direto." className={FULL_ROW}>
                    <SelectInput value={values.gatewayHubId ?? ''} onChange={(e) => set('gatewayHubId', e.target.value || null)} aria-label="Abastecido por">
                        <option value="">Direto do tronco / nenhum</option>
                        {options.map((h) => (
                            <option key={h.id} value={h.id}>
                                {h.name} ({h.code})
                            </option>
                        ))}
                    </SelectInput>
                </Field>
            </FormSection>

            <FormFooter
                secondary={<Button onClick={onCancel} disabled={busy != null}>Cancelar</Button>}
                primary={
                    <Button type="submit" variant="primary" loading={busy === 'hub:new' || busy === 'hub:edit'}>
                        {hub ? 'Salvar hub' : 'Criar hub'}
                    </Button>
                }
            />
        </form>
    );
};
