import React, { useEffect, useState } from 'react';
import { demandsApi, pricingApi } from '../../../../lib/api';
import type { Demand } from '../../../../types/index';
import { demandClientName, parseQuotePrice } from '../../lib/comercial';
import { kg, money } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { freightSummary } from '../../lib/comercialForms';
import type { PricingTable } from '../../../../types/index';
import { KEYS } from '../../lib/data';
import { Button, Field, Kv, ModeBadge, SelectInput, TextInput } from '../../ui/kit';
import { Drawer, useAction } from '../../ui/overlay';

const RISK_LABEL: Record<string, string> = { A: 'Risco A (alto)', B: 'Risco B (médio)', C: 'Risco C (baixo)' };
const INTENT_LABEL: Record<string, string> = { QUOTE_ONLY: 'Só cotação', COLLECT: 'Coleta no cliente', DROP_AT_HUB: 'Cliente leva ao hub' };

/** Cotar uma demanda: mesmo campo e mesma regra da gestão clássica (preço maior que zero). */
export const QuoteDrawer: React.FC<{ demand: Demand | null; onClose: () => void }> = ({ demand, onClose }) => {
    const { busy, run } = useAction();
    const [price, setPrice] = useState('');
    const [touched, setTouched] = useState(false);
    const [tableId, setTableId] = useState('');
    const tables = useResource<PricingTable[]>('pricing:tables:active', async () => (await pricingApi.listTables({ active: true })).data ?? [], { staleMs: 60_000 });

    useEffect(() => {
        setPrice('');
        setTouched(false);
        setTableId('');
    }, [demand?.id]);

    const parsed = parseQuotePrice(price);
    const error = touched && !parsed.ok ? (parsed as { error: string }).error : null;

    const submit = async () => {
        if (!demand) return;
        setTouched(true);
        if (!parsed.ok) return;
        const ok = await run('quote', () => demandsApi.quote(demand.id, { price: parsed.value, ...(tableId ? { tableId } : {}) }), {
            success: 'Cotação enviada.',
            error: 'Não foi possível enviar a cotação.',
        });
        if (ok) {
            invalidate('demands:', KEYS.summary);
            onClose();
        }
    };

    return (
        <Drawer
            open={Boolean(demand)}
            onClose={onClose}
            title="Cotar demanda"
            subtitle={demand ? `${demand.origin} → ${demand.destination}` : undefined}
            badge={<ModeBadge mode="manual" />}
            footer={
                <>
                    <Button variant="primary" loading={busy === 'quote'} disabled={!parsed.ok && touched} onClick={() => void submit()}>
                        Enviar cotação
                    </Button>
                    <Button variant="ghost" onClick={onClose}>
                        Cancelar
                    </Button>
                </>
            }
        >
            {demand ? (
                <form
                    className="flex flex-col gap-6"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <div className="gx-inset px-4 py-1">
                        <Kv label="Cliente" value={demandClientName(demand)} />
                        <Kv label="Mercadoria" value={demand.commodity || '—'} />
                        <Kv label="Peso" value={kg(demand.weight)} />
                        <Kv label="Volume" value={demand.volume != null ? `${demand.volume} m³` : '—'} />
                        <Kv label="Valor da nota" value={money(demand.nfValue)} />
                        <Kv label="Risco" value={RISK_LABEL[demand.riskClass] ?? demand.riskClass} />
                        <Kv label="Intenção" value={INTENT_LABEL[demand.intentType] ?? '—'} />
                    </div>
                    <Field label="Valor da cotação (R$)" error={error} hint="O preço é decisão sua: o sistema só registra e avisa o cliente.">
                        <TextInput
                            inputMode="decimal"
                            autoFocus
                            placeholder="0,00"
                            value={price}
                            aria-invalid={Boolean(error)}
                            onChange={(event) => setPrice(event.target.value)}
                            onBlur={() => setTouched(true)}
                        />
                    </Field>
                    <Field label="Tabela de preço usada (opcional)" hint="Fica registrada na cotação para auditoria. O valor acima continua sendo o que vale.">
                        <SelectInput value={tableId} onChange={(event) => setTableId(event.target.value)} aria-label="Tabela de preço">
                            <option value="">Sem tabela</option>
                            {(tables.data ?? []).map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.description} · {freightSummary(t)}
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                </form>
            ) : null}
        </Drawer>
    );
};
