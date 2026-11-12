import React, { useState } from 'react';
import clsx from 'clsx';
import { ordersFreightApi } from '../../../../lib/api';
import { OsButton } from '../../ui/kit';
import { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

export type AverbacaoOrder = { orderId: string; calcId: string; orderNumber: string };

/**
 * Seguro da carga na saída. Emitente com averbação eletrônica (AT&M): o operador não digita nada —
 * cada CT-e é averbado sozinho; aqui só o estado e a ação "Tentar averbar agora". A digitação manual
 * fica escondida atrás de "contingência". Sem averbação eletrônica, o campo é o de sempre.
 */
const AverbacaoSection: React.FC<{
    electronic: boolean;
    value: string;
    onChange: (value: string) => void;
    orders: AverbacaoOrder[];
}> = ({ electronic, value, onChange, orders }) => {
    const [manual, setManual] = useState(false);
    const [results, setResults] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);

    const retry = async (orderId: string, calcId: string) => {
        setBusy(calcId);
        try {
            const res = await ordersFreightApi.averbar(orderId, calcId);
            const record = res.data.averbacao;
            setResults((prev) => ({
                ...prev,
                [calcId]: res.success ? `Averbado${record?.numeroAverbacao ? ` (${record.numeroAverbacao})` : ''}` : (res.data.outcome.message ?? record?.lastError ?? 'Averbação não concluída.'),
            }));
        } catch (cause) {
            setResults((prev) => ({ ...prev, [calcId]: apiErrorMessage(cause, 'Não foi possível averbar agora.') }));
        } finally {
            setBusy(null);
        }
    };

    const showField = !electronic || manual;
    return (
        <>
            {electronic ? (
                <div className="mt-4 rounded-xl bg-tower-100 p-3 text-[13px] dark:bg-tower-800">
                    <p className="font-bold text-tower-800 dark:text-tower-100">Seguro: averbado automaticamente a cada CT-e</p>
                    <p className={clsx('mt-1', orders.length ? 'font-semibold text-brand-red-600 dark:text-brand-red-400' : 'text-tower-500 dark:text-tower-300')}>
                        {orders.length ? `Averbação pendente em ${orders.length} pedido(s).` : 'Nenhuma averbação pendente.'}
                    </p>
                </div>
            ) : null}
            {showField ? (
                <label className="mt-4 block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                    Averbação do seguro
                    <input
                        type="text"
                        value={value}
                        maxLength={500}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Número da averbação (vários: separe por vírgula)"
                        className={clsx(osFieldClass, 'mt-1.5')}
                    />
                </label>
            ) : null}
            {orders.length ? (
                <div className="mt-3 rounded-xl border border-tower-200 p-3 text-[13px] dark:border-tower-700">
                    <p className="font-bold text-tower-700 dark:text-tower-200">Averbação eletrônica pendente</p>
                    <ul className="mt-2 space-y-2">
                        {orders.map((item) => (
                            <li key={item.calcId} className="flex items-center justify-between gap-3">
                                <span className="text-tower-600 dark:text-tower-300">
                                    Pedido {item.orderNumber}
                                    {results[item.calcId] ? <span className="block text-[12px] text-tower-500">{results[item.calcId]}</span> : null}
                                </span>
                                <OsButton disabled={busy === item.calcId} onClick={() => void retry(item.orderId, item.calcId)}>
                                    {busy === item.calcId ? 'Averbando…' : 'Tentar averbar agora'}
                                </OsButton>
                            </li>
                        ))}
                    </ul>
                    {!electronic || manual ? (
                        <p className="mt-2 text-[12px] text-tower-500">Se a AT&amp;M estiver fora, informe a averbação manualmente acima: ela prevalece e fica registrada no histórico.</p>
                    ) : null}
                </div>
            ) : null}
            {electronic && !manual ? (
                <button type="button" onClick={() => setManual(true)} className="mt-3 min-h-11 text-[12px] font-semibold text-tower-500 underline dark:text-tower-400">
                    Informar averbação manualmente (contingência)
                </button>
            ) : null}
        </>
    );
};

export default AverbacaoSection;
