import React, { useEffect, useRef, useState } from 'react';
import { ordersFreightApi } from '../../../../../lib/api';
import type { CteCancelEligibility, FreightDocumentSummary } from '../../../../../types/index';
import { dateTime } from '../../../lib/format';
import { CANCEL_REASON_MAX, CANCEL_REASON_MIN, cancelReasonCheck, readableFiscalMessage } from '../../../lib/freteDoc';
import { Button, Field, TextArea } from '../../../ui/kit';

/**
 * Cancelar CT-e autorizado. Primeiro o servidor diz se pode (prazo de 7 dias, viagem, MDF-e, fatura);
 * só então pede o motivo (15 a 255 caracteres). O pedido ao provedor é uma única chamada: se vier
 * "pendente", o CT-e continua valendo e a pessoa consulta depois.
 */
export const CancelCteForm: React.FC<{
    orderId: string;
    doc: FreightDocumentSummary;
    busy: boolean;
    onSubmit: (reason: string) => Promise<boolean>;
    onClose: () => void;
}> = ({ orderId, doc, busy, onSubmit, onClose }) => {
    const [info, setInfo] = useState<CteCancelEligibility | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        ordersFreightApi
            .cteCancelEligibility(orderId, doc.id)
            .then((body) => alive.current && setInfo(body.data ?? null))
            .catch((cause) => alive.current && setLoadError(readableFiscalMessage((cause as { response?: { data?: { error?: string } } })?.response?.data?.error, 'Não foi possível conferir se o CT-e pode ser cancelado.')));
        return () => {
            alive.current = false;
        };
    }, [orderId, doc.id]);

    const check = cancelReasonCheck(reason);
    const deadline = info?.deadline ? dateTime(info.deadline) : null;

    return (
        <form
            className="gx-inset flex flex-col gap-3 px-4 py-3.5"
            aria-label="Cancelar CT-e"
            onSubmit={(event) => {
                event.preventDefault();
                if (busy || !check.ok || !info?.canCancel) return;
                void onSubmit(reason.trim());
            }}
        >
            <p className="gx-soft text-[13px]">
                O CT-e só pode ser cancelado até 7 dias depois de autorizado{deadline ? ` (até ${deadline})` : ''} e antes de a carga sair em viagem.
            </p>
            {loadError ? (
                <p role="alert" className="gx-red-text text-[13.5px] font-semibold">
                    {loadError}
                </p>
            ) : !info ? (
                <p className="gx-muted text-[13.5px]">Conferindo se pode cancelar…</p>
            ) : !info.canCancel ? (
                <p role="status" className="gx-red-text text-[13.5px] font-semibold">
                    Não dá para cancelar: {info.blockReason ?? 'o CT-e já saiu do prazo ou da fase de cancelamento.'}
                </p>
            ) : (
                <>
                    <Field label="Motivo do cancelamento" hint={`${check.length} de ${CANCEL_REASON_MIN} a ${CANCEL_REASON_MAX} caracteres`}>
                        <TextArea
                            value={reason}
                            maxLength={CANCEL_REASON_MAX}
                            disabled={busy}
                            placeholder="Ex.: pagador informado errado no CT-e"
                            onChange={(event) => setReason(event.target.value)}
                        />
                    </Field>
                    <div>
                        <Button type="submit" variant="danger" loading={busy} disabled={!check.ok}>
                            {busy ? 'Cancelando…' : 'Confirmar cancelamento do CT-e'}
                        </Button>
                    </div>
                </>
            )}
            <div>
                <Button size="sm" disabled={busy} onClick={onClose}>
                    Fechar
                </Button>
            </div>
        </form>
    );
};
