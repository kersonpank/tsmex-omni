import React from 'react';
import { pricingApi } from '../../../../lib/api';
import type { PricingRoute } from '../../../../types/index';
import { FREIGHT_TERMS, payerOf, type FreightTerm, type PartiesErrors, type PlaceDraft } from '../../lib/pedidoForm';
import { useResource } from '../../lib/resource';
import { Checkbox, FormSection } from '../../ui/form';
import { SelectInput } from '../../ui/kit';
import { CityPicker, HubSelect, PersonPicker, type PersonSummary } from '../../ui/pickers';

export interface PartiesValues {
    hubId: string | null;
    freightTerm: FreightTerm | null;
    remetente: PersonSummary | null;
    destinatario: PersonSummary | null;
    consignatario: PersonSummary | null;
    expedidor: PersonSummary | null;
    redespachante: PersonSummary | null;
    expRed: boolean;
    origem: PlaceDraft | null;
    fim: PlaceDraft | null;
    routeId: string | null;
}

export type PartyRole = 'remetente' | 'destinatario' | 'consignatario' | 'expedidor' | 'redespachante';

/** Linha com rótulo e erro, sem `<label>` envolvendo botões internos dos seletores. */
const Row: React.FC<{ label: string; error?: string | null; hint?: string; children: React.ReactNode }> = ({ label, error, hint, children }) => (
    <div className="min-w-0">
        <span className="gx-label mb-1.5 block">{label}</span>
        {children}
        {error ? (
            <span role="alert" className="gx-red-text mt-1 block text-[12.5px]">
                {error}
            </span>
        ) : hint ? (
            <span className="gx-muted mt-1 block text-[12.5px]">{hint}</span>
        ) : null}
    </div>
);

interface Props {
    values: PartiesValues;
    errors: PartiesErrors;
    editing: boolean;
    /** Usuário de hub: o hub é o dele e não aparece como escolha. */
    isHubUser: boolean;
    /** Motivo de o pagador estar travado (fatura ou CT-e emitido); null = livre. */
    payerLock: string | null;
    onTerm: (term: FreightTerm) => void;
    onPick: (role: PartyRole, person: PersonSummary | null) => void;
    onSet: <K extends keyof PartiesValues>(field: K, value: PartiesValues[K]) => void;
}

export const OrderPartiesSection: React.FC<Props> = ({ values, errors, editing, isHubUser, payerLock, onTerm, onPick, onSet }) => {
    const routes = useResource<PricingRoute[]>('pricing-routes', async () => (await pricingApi.listRoutes()).data ?? [], { staleMs: 300_000 });
    const payer = payerOf<PersonSummary>(values.freightTerm, values);
    const lockTerm = Boolean(payerLock);

    return (
        <>
            {!editing && !isHubUser ? (
                <FormSection title="Hub que recebe" hint="A carga entra por este hub. Sem hub, o pedido nasce pendente, sem posse de ninguém.">
                    <div className="min-w-0 sm:col-span-2">
                        <HubSelect value={values.hubId} onChange={(id) => onSet('hubId', id)} emptyOption="Sem hub (pedido pendente)" ariaLabel="Hub que recebe" />
                    </div>
                </FormSection>
            ) : null}

            <FormSection title="Quem paga o frete" hint={payerLock ?? 'Define o tomador do documento fiscal. Depois de faturado ou com CT-e emitido, não muda.'} cols={1}>
                <div role="radiogroup" aria-label="Quem paga o frete" className="grid gap-2 sm:grid-cols-3">
                    {FREIGHT_TERMS.map((term) => (
                        <label key={term.id} className="gx-check gx-inset px-3.5 py-3">
                            <input type="radio" name="freightTerm" checked={values.freightTerm === term.id} disabled={lockTerm} onChange={() => onTerm(term.id)} />
                            <span className="min-w-0">
                                <span className="block text-[14px] font-semibold">
                                    {term.label} <span className="gx-muted gx-mono text-[12px]">{term.id}</span>
                                </span>
                                <span className="gx-muted block text-[12.5px]">{term.hint}</span>
                            </span>
                        </label>
                    ))}
                </div>
                {errors.freightTerm ? (
                    <p role="alert" className="gx-red-text text-[12.5px]">
                        {errors.freightTerm}
                    </p>
                ) : payer ? (
                    <p className="gx-soft text-[13px]">
                        Pagador do frete: <strong>{payer.legalName}</strong>
                    </p>
                ) : null}
            </FormSection>

            <FormSection title="Pessoas" hint="Busque pelo nome ou pelo CNPJ/CPF. Se não existir, o campo cadastra a pessoa ali mesmo.">
                <Row label="Remetente" error={errors.remetente}>
                    <PersonPicker ariaLabel="Remetente" value={values.remetente} onChange={(person) => onPick('remetente', person)} invalid={Boolean(errors.remetente)} />
                </Row>
                <Row label="Destinatário" error={errors.destinatario}>
                    <PersonPicker ariaLabel="Destinatário" value={values.destinatario} onChange={(person) => onPick('destinatario', person)} invalid={Boolean(errors.destinatario)} />
                </Row>
                {values.freightTerm === 'REDESPACHO' ? (
                    <Row label="Consignatário (paga o frete)" error={errors.consignatario}>
                        <PersonPicker ariaLabel="Consignatário" value={values.consignatario} onChange={(person) => onPick('consignatario', person)} invalid={Boolean(errors.consignatario)} />
                    </Row>
                ) : null}
                <div className="col-span-full">
                    <Checkbox
                        checked={values.expRed}
                        label="Operação com expedidor ou redespachante"
                        hint="Marque quando a carga passa por um expedidor e/ou redespachante."
                        onChange={(checked) => {
                            onSet('expRed', checked);
                            if (!checked) {
                                onPick('expedidor', null);
                                onPick('redespachante', null);
                            }
                        }}
                    />
                </div>
                {values.expRed ? (
                    <>
                        <Row label="Expedidor">
                            <PersonPicker ariaLabel="Expedidor" value={values.expedidor} onChange={(person) => onPick('expedidor', person)} />
                        </Row>
                        <Row label="Redespachante">
                            <PersonPicker ariaLabel="Redespachante" value={values.redespachante} onChange={(person) => onPick('redespachante', person)} />
                        </Row>
                    </>
                ) : null}
            </FormSection>

            <FormSection title="Trecho do serviço" hint="Vem da cidade do remetente e do destinatário quando eles têm endereço; troque se o serviço começa ou termina em outro lugar.">
                <Row label="Origem da prestação" error={errors.origem}>
                    <CityPicker ariaLabel="Origem da prestação" value={values.origem} onChange={(place) => onSet('origem', place)} invalid={Boolean(errors.origem)} />
                </Row>
                <Row label="Fim da prestação" error={errors.fim}>
                    <CityPicker ariaLabel="Fim da prestação" value={values.fim} onChange={(place) => onSet('fim', place)} invalid={Boolean(errors.fim)} />
                </Row>
                <Row label="Rota (opcional)">
                    <SelectInput aria-label="Rota" value={values.routeId ?? ''} onChange={(event) => onSet('routeId', event.target.value || null)}>
                        <option value="">Sem rota</option>
                        {(routes.data ?? [])
                            .filter((route) => route.active || route.id === values.routeId)
                            .map((route) => (
                                <option key={route.id} value={route.id}>
                                    {route.name}
                                </option>
                            ))}
                    </SelectInput>
                </Row>
            </FormSection>
        </>
    );
};
