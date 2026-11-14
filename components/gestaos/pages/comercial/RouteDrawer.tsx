import React, { useEffect, useState } from 'react';
import { pricingApi } from '../../../../lib/api';
import type { PricingRoute } from '../../../../types/index';
import { buildRoutePayload, emptyRouteForm, firstError, routeToForm, validateRouteForm, type RouteForm } from '../../lib/comercialForms';
import { invalidate } from '../../lib/resource';
import { FormFooter, FormSection, useForm } from '../../ui/form';
import { Button, Field, ModeBadge, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';

/** Criar ou editar uma rota de preço (origem e destino com código). */
export const RouteDrawer: React.FC<{ open: boolean; route: PricingRoute | null; onClose: () => void }> = ({ open, route, onClose }) => {
    const { busy, run } = useAction();
    const form = useForm<RouteForm>(emptyRouteForm());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const { reset } = form;

    useEffect(() => {
        if (!open) return;
        setErrors({});
        reset(route ? routeToForm(route) : emptyRouteForm());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, route?.id, reset]);

    const save = async () => {
        const found = validateRouteForm(form.values);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        const payload = buildRoutePayload(form.values);
        const ok = await run('save', () => (route ? pricingApi.updateRoute(route.id, payload) : pricingApi.createRoute(payload)), {
            success: route ? 'Rota atualizada.' : 'Rota criada.',
            error: 'Não foi possível salvar a rota.',
        });
        if (ok) {
            invalidate('pricing:');
            onClose();
        }
    };

    const v = form.values;
    const text = (key: keyof RouteForm, label: string, placeholder?: string) => (
        <Field label={label} error={errors[key]}>
            <TextInput value={v[key]} aria-invalid={Boolean(errors[key])} placeholder={placeholder} onChange={(event) => form.set(key, event.target.value)} />
        </Field>
    );

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={720}
            title={route ? 'Editar rota de preço' : 'Nova rota de preço'}
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
                            {route ? 'Salvar rota' : 'Criar rota'}
                        </Button>
                    }
                />
            }
        >
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <FormSection title="Rota" cols={1}>
                    {text('name', 'Nome da rota', 'Ex.: Araras para Pedreiras')}
                </FormSection>
                <FormSection title="Origem">
                    {text('originName', 'Cidade de origem')}
                    {text('originCode', 'Código da origem', 'Ex.: ARA')}
                </FormSection>
                <FormSection title="Destino">
                    {text('destName', 'Cidade de destino')}
                    {text('destCode', 'Código do destino', 'Ex.: PED')}
                </FormSection>
            </form>
        </Drawer>
    );
};
