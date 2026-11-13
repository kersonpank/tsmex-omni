import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError, ordersEntradaApi } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import {
    buildEntradaPayload,
    buildInvoicePayload,
    buildPeoplePayload,
    coletaFromCollectionData,
    coletaFromPerson,
    coletaToCollectionData,
    draftFromInvoice,
    emptyColeta,
    parsePlaceText,
    payerLockReason,
    validateColeta,
    validateParties,
    type ColetaDraft,
    type ColetaErrors,
    type FreightTerm,
    type InvoiceDraft,
    type SavedInvoice,
} from '../../lib/pedidoForm';
import { invalidate } from '../../lib/resource';
import { FormFooter, LinkButton, useForm } from '../../ui/form';
import { Button, Panel } from '../../ui/kit';
import { useToast } from '../../ui/overlay';
import { toPersonSummary } from '../../ui/pickers';
import { OrderCollectionSection } from './OrderCollectionSection';
import { OrderInvoicesSection } from './OrderInvoicesSection';
import { OrderPartiesSection, type PartiesValues, type PartyRole } from './OrderPartiesSection';
import type { NfeCopilotResult } from './nfeCopilot';

/** Pedido como o GET /orders/:id devolve, só com o que o formulário usa. */
export interface OrderDetail {
    id: string;
    freightTerm?: FreightTerm | null;
    remetentePerson?: Parameters<typeof toPersonSummary>[0] | null;
    destinatarioPerson?: Parameters<typeof toPersonSummary>[0] | null;
    consignatarioPerson?: Parameters<typeof toPersonSummary>[0] | null;
    expedidorPerson?: Parameters<typeof toPersonSummary>[0] | null;
    redespachantePerson?: Parameters<typeof toPersonSummary>[0] | null;
    origemPrestacao?: string | null;
    origemIbgeCode?: string | null;
    fimPrestacao?: string | null;
    fimIbgeCode?: string | null;
    routeId?: string | null;
    collectionData?: Record<string, unknown> | null;
    invoicesRel?: SavedInvoice[];
    invoices?: Array<{ status?: string | null }>;
    freightCalculations?: Array<{ status: string; documentType: string; cteNumber?: string | null }>;
}

const person = (p: OrderDetail['remetentePerson']) => (p ? toPersonSummary(p) : null);

function initialValues(order: OrderDetail | null, userHubId: string | null): PartiesValues {
    if (!order) {
        return { hubId: userHubId, freightTerm: null, remetente: null, destinatario: null, consignatario: null, expedidor: null, redespachante: null, expRed: false, origem: null, fim: null, routeId: null };
    }
    return {
        hubId: null,
        freightTerm: (order.freightTerm ?? 'CIF') as FreightTerm,
        remetente: person(order.remetentePerson),
        destinatario: person(order.destinatarioPerson),
        consignatario: person(order.consignatarioPerson),
        expedidor: person(order.expedidorPerson),
        redespachante: person(order.redespachantePerson),
        expRed: Boolean(order.expedidorPerson || order.redespachantePerson),
        origem: parsePlaceText(order.origemPrestacao, order.origemIbgeCode),
        fim: parsePlaceText(order.fimPrestacao, order.fimIbgeCode),
        routeId: order.routeId ?? null,
    };
}

/** Criar e editar pedido: mesmas rotas e ordem da entrada clássica (entrada, depois as notas). */
export const OrderEditor: React.FC<{ order: OrderDetail | null }> = ({ order }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const user = useAuthStore((state) => state.user);
    const isHubUser = user?.roles?.includes('HUB') ?? false;
    const userHubId = (user?.profile as { hub?: { hubId?: string } } | undefined)?.hub?.hubId ?? (user as { hubId?: string } | null)?.hubId ?? null;

    const form = useForm<PartiesValues>(initialValues(order, isHubUser ? userHubId : null));
    const { values } = form;
    const [invoices, setInvoices] = useState<InvoiceDraft[]>(() => (order?.invoicesRel ?? []).map(draftFromInvoice));
    const [coletaOn, setColetaOn] = useState(Boolean(order?.collectionData));
    const [coleta, setColeta] = useState<ColetaDraft>(() => (order?.collectionData ? coletaFromCollectionData(order.collectionData, coletaFromPerson(order.remetentePerson)) : emptyColeta()));
    const [coletaDirty, setColetaDirty] = useState(false);
    const [coletaErrors, setColetaErrors] = useState<ColetaErrors>({});
    const [documentKey, setDocumentKey] = useState<string | null>(null);
    const [createdId, setCreatedId] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const running = useRef(false);

    const orderId = order?.id ?? createdId;
    const editing = Boolean(orderId);
    const payerLock = order ? payerLockReason(order) : null;

    const pick = (role: PartyRole, next: PartiesValues['remetente']) => {
        const patch: Partial<PartiesValues> = { [role]: next };
        if (next?.city && next.state) {
            const place = { city: next.city, state: next.state, ibgeCode: next.cityIbgeCode ?? '' };
            if (role === 'remetente' && !values.origem) patch.origem = place;
            if (role === 'destinatario' && !values.fim) patch.fim = place;
        }
        form.setMany(patch);
    };

    const chooseTerm = (term: FreightTerm) => form.setMany({ freightTerm: term, ...(term !== 'REDESPACHO' ? { consignatario: null } : {}) });

    const onLookup = (result: NfeCopilotResult) => {
        if (result.remetente && !values.remetente) pick('remetente', result.remetente);
        if (result.destinatario && !values.destinatario) pick('destinatario', result.destinatario);
        if (!orderId && !documentKey) setDocumentKey(result.lookup.chave);
    };

    const toggleColeta = (enabled: boolean) => {
        setColetaOn(enabled);
        setColetaDirty(true);
        if (enabled && !order?.collectionData && !coletaDirty) setColeta(coletaFromPerson(values.remetente));
    };

    const save = async () => {
        if (running.current) return;
        setFormError(null);
        form.clearErrors();
        const found = validateParties({ ...values });
        for (const [field, message] of Object.entries(found)) form.setError(field as keyof PartiesValues, message);
        const foundColeta = coletaOn ? validateColeta(coleta) : {};
        setColetaErrors(foundColeta);
        if (Object.keys(found).length > 0 || Object.keys(foundColeta).length > 0) {
            setFormError('Confira os campos marcados antes de salvar.');
            return;
        }

        running.current = true;
        setSaving(true);
        let id = orderId;
        let list = invoices;
        try {
            const collectionData = coletaOn && (coletaDirty || !id) ? coletaToCollectionData(coleta) : null;
            if (!id) {
                const created = await ordersEntradaApi.create(buildEntradaPayload(values, { isHub: isHubUser, userHubId, documentKey, collectionData }));
                id = (created as { data?: { id?: string } })?.data?.id ?? null;
                if (!id) throw new Error('O servidor não devolveu o pedido criado.');
                setCreatedId(id);
                form.reset(values);
                setColetaDirty(false);
            } else if (form.dirty || (collectionData && coletaDirty)) {
                await ordersEntradaApi.updatePeople(id, buildPeoplePayload(values, collectionData));
                form.reset(values);
                setColetaDirty(false);
            }
            for (const draft of invoices) {
                if (draft.id && !draft.touched) continue;
                const payload = buildInvoicePayload(draft);
                try {
                    if (draft.id) await ordersEntradaApi.updateInvoice(id, draft.id, payload);
                    else {
                        const saved = await ordersEntradaApi.addInvoice(id, payload);
                        const savedId = (saved as { data?: { id?: string } })?.data?.id ?? draft.key;
                        list = list.map((item) => (item.key === draft.key ? { ...item, id: savedId, key: savedId, touched: false } : item));
                        continue;
                    }
                    list = list.map((item) => (item.key === draft.key ? { ...item, touched: false } : item));
                } catch (cause) {
                    setInvoices(list);
                    invalidate('orders:');
                    setFormError(`${createdId || order ? 'O pedido está salvo' : 'Pedido criado'}, mas a NF ${payload.nfNumber} não foi gravada: ${formatApiError(cause)} Corrija e salve de novo; o pedido não será duplicado.`);
                    return;
                }
            }
            invalidate('orders:');
            toast.success(order ? 'Pedido atualizado.' : 'Pedido criado.');
            navigate(`/gestaos/pedidos?p=${id}`);
        } catch (cause) {
            setInvoices(list);
            setFormError(`${order ? 'Não foi possível salvar o pedido.' : 'O pedido não foi criado.'} ${cause instanceof Error && !('response' in cause) ? cause.message : formatApiError(cause)}`);
        } finally {
            running.current = false;
            setSaving(false);
        }
    };

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
            noValidate
        >
            <Panel className="gx-rise" bodyClassName="flex flex-col">
                <OrderPartiesSection values={values} errors={form.errors} editing={editing} isHubUser={isHubUser} payerLock={payerLock} onTerm={chooseTerm} onPick={pick} onSet={form.set} />
                <OrderInvoicesSection invoices={invoices} onChange={setInvoices} hubId={isHubUser ? userHubId : values.hubId} onLookup={onLookup} editing={editing} />
                <OrderCollectionSection
                    enabled={coletaOn}
                    onEnable={toggleColeta}
                    coleta={coleta}
                    errors={coletaErrors}
                    onChange={(next) => {
                        setColeta(next);
                        setColetaDirty(true);
                    }}
                />
                {orderId ? (
                    <section className="gx-hair-t flex flex-col gap-2 py-5" aria-label="Documento do frete">
                        <h3 className="gx-h2">Documento do frete</h3>
                        <p className="gx-muted text-[13px]">O cálculo e a emissão do CT-e ou da minuta ficam no hub, onde a carga é conferida.</p>
                        <div>
                            <LinkButton to={`/hubs/pedidos/${orderId}`} variant="soft">
                                Emitir no hub
                            </LinkButton>
                        </div>
                    </section>
                ) : null}
            </Panel>
            <FormFooter
                className="mt-5"
                error={formError}
                secondary={
                    <Button variant="ghost" onClick={() => navigate(orderId ? `/gestaos/pedidos?p=${orderId}` : '/gestaos/pedidos')}>
                        {createdId ? 'Fechar e abrir o pedido' : 'Cancelar'}
                    </Button>
                }
                primary={
                    <Button type="submit" variant="primary" loading={saving}>
                        {order || createdId ? 'Salvar alterações' : 'Criar pedido'}
                    </Button>
                }
            />
        </form>
    );
};
