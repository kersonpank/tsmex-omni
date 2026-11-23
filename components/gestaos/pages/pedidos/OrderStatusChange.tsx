import React, { useRef, useState } from 'react';
import { formatApiError, operationSettingsApi, ordersApi } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import type { OperationSettings, OrderStatus } from '../../../../types/index';
import { useHubs } from '../../lib/data';
import { canChangeStatusManually, friendlyOrderError, statusBody, statusProblem, statusTargets, type StatusDraft } from '../../lib/pedidoDrawer';
import { orderStatusLabel } from '../../lib/pedidos';
import { invalidate, useResource } from '../../lib/resource';
import { Button, Field, SelectInput, TextInput } from '../../ui/kit';
import { useToast } from '../../ui/overlay';
import { DrawerBlock } from './DrawerBlock';

/**
 * Troca manual de status. Só aparece para quem está em `manualOrderStatusRoles` (configuração da operação);
 * o servidor confere de novo e bloqueia pedido em viagem em andamento. A mensagem dele é mostrada ao lado do campo.
 */
export const OrderStatusChange: React.FC<{ orderId: string; status: string; currentHubId?: string | null }> = ({ orderId, status, currentHubId }) => {
    const toast = useToast();
    const user = useAuthStore((state) => state.user);
    const roles = user?.roles ?? [];
    const isHubUser = roles.includes('HUB');
    const settings = useResource<OperationSettings>('settings:operation', async () => (await operationSettingsApi.get()).data, { staleMs: 60_000 });
    const hubs = useHubs();
    const [draft, setDraft] = useState<StatusDraft>({ status: '', hubId: '', reason: '' });
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const running = useRef(false);

    if (!settings.data) return null;
    if (!canChangeStatusManually(roles, settings.data.manualOrderStatusRoles)) return null;

    const patch = (changes: Partial<StatusDraft>) => {
        setDraft((current) => ({ ...current, ...changes }));
        setError(null);
    };

    const submit = async () => {
        if (running.current) return;
        const problem = statusProblem(draft, { isHubUser, currentHubId });
        if (problem) {
            setError(problem);
            return;
        }
        running.current = true;
        setSaving(true);
        setError(null);
        try {
            await ordersApi.updateStatus(orderId, statusBody(draft, { isHubUser }));
            toast.success(`Status trocado para "${orderStatusLabel(draft.status)}".`);
            setDraft({ status: '', hubId: '', reason: '' });
            invalidate('orders:', 'manifests');
        } catch (cause) {
            setError(friendlyOrderError(formatApiError(cause)));
        } finally {
            running.current = false;
            setSaving(false);
        }
    };

    const needsHub = draft.status === 'AT_HUB' && !isHubUser;
    return (
        <DrawerBlock title="Trocar status à mão" mode="manual">
            <p className="gx-muted mb-3 text-[13px]">Use só para corrigir um erro de registro. O fluxo normal (chegada, entrega) segue pelas viagens.</p>
            <div className="flex flex-col gap-3">
                <Field label="Novo status">
                    <SelectInput value={draft.status} onChange={(event) => patch({ status: event.target.value as OrderStatus | '' })}>
                        <option value="">Escolha…</option>
                        {statusTargets(status).map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.label}
                            </option>
                        ))}
                    </SelectInput>
                </Field>
                {needsHub ? (
                    <Field label="Em qual hub a carga está" hint={currentHubId ? 'Se não escolher, vale o hub atual do pedido.' : undefined}>
                        <SelectInput value={draft.hubId} onChange={(event) => patch({ hubId: event.target.value })}>
                            <option value="">Escolha…</option>
                            {(hubs.data ?? [])
                                .filter((hub) => hub.active !== false)
                                .map((hub) => (
                                    <option key={hub.id} value={hub.id}>
                                        {hub.name}
                                    </option>
                                ))}
                        </SelectInput>
                    </Field>
                ) : null}
                <Field label="Motivo" error={error}>
                    <TextInput value={draft.reason} maxLength={200} onChange={(event) => patch({ reason: event.target.value })} placeholder="Ex.: entrega conferida por telefone" />
                </Field>
            </div>
            <div className="mt-3">
                <Button size="sm" variant="soft" loading={saving} onClick={() => void submit()}>
                    Trocar status
                </Button>
            </div>
        </DrawerBlock>
    );
};
