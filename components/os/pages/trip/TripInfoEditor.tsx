import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { manifestsApi } from '../../../../lib/api';
import type { TripGroup } from '../../lib/trip';
import { OsBadge, OsButton } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';

/**
 * Grupos sem formulário próprio no O.S.: cadastro, documentos, carga e rota.
 * Cadastro abre a ficha do transportador no O.S. MDF-e emite daqui. CT-e por pedido e CIOT
 * ainda abrem a tela atual — transitório até a etapa Documentos (NORTE A7), sinalizado na folha.
 */

const TripInfoEditor: React.FC<{
    manifestId: string;
    linkId?: string | null;
    group: TripGroup;
    onClose: () => void;
    onDone: () => void;
}> = ({ manifestId, linkId, group, onClose, onDone }) => {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    const all = [...group.blocking, ...group.warnings];
    const codes = new Set(all.map((i) => i.code));
    const cteOrders = all.filter((i) => i.code === 'CTE_AUTHORIZATION_REQUIRED' && i.field).map((i) => i.field as string);
    const canEmitMdfe = codes.has('MDFE_AUTHORIZATION_REQUIRED') && cteOrders.length === 0;

    const emitMdfe = async () => {
        setBusy(true);
        setNotice(null);
        try {
            const body = await manifestsApi.emitMdfe(manifestId);
            setNotice({ ok: true, text: body.message ?? (body.pending ? 'MDF-e em processamento.' : 'MDF-e emitido.') });
            window.setTimeout(onDone, 1500);
        } catch (cause) {
            setNotice({ ok: false, text: apiErrorMessage(cause, 'Não foi possível emitir o MDF-e.') });
            setBusy(false);
        }
    };

    const legacyNote = (
        <p className="mt-3 text-[12px] leading-relaxed text-tower-400">
            Abre a tela atual do sistema — transitório até a estação Documentos do O.S.
        </p>
    );

    return (
        <OsSheet title={group.title} onClose={onClose}>
            <ul className="flex flex-col gap-2">
                {all.map((issue, i) => (
                    <li key={`${issue.code}-${issue.field ?? i}`} className="flex items-start gap-2 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                        <OsBadge tone={issue.severity === 'blocking' ? 'bad' : 'warn'}>
                            {issue.severity === 'blocking' ? 'bloqueia' : 'aviso'}
                        </OsBadge>
                        <span className="text-[13px] leading-snug text-tower-700 dark:text-tower-200">{issue.message}</span>
                    </li>
                ))}
            </ul>

            {notice ? (
                <p
                    className={`mt-3 rounded-lg p-3 text-[13px] font-semibold ${
                        notice.ok ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300' : 'bg-brand-red-500/10 text-brand-red-600 dark:text-brand-red-400'
                    }`}
                >
                    {notice.text}
                </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-2">
                {group.key === 'documents' && canEmitMdfe ? (
                    <OsButton full disabled={busy} onClick={() => void emitMdfe()}>
                        {busy ? 'Emitindo…' : 'Emitir MDF-e'}
                    </OsButton>
                ) : null}
                {group.key === 'documents' && cteOrders.length > 0 ? (
                    <>
                        {cteOrders.map((orderId) => (
                            <OsButton key={orderId} full variant="secondary" onClick={() => navigate(`/orders/${orderId}`)}>
                                Emitir CT-e do pedido {orderId.slice(0, 8)}
                            </OsButton>
                        ))}
                        {legacyNote}
                    </>
                ) : null}
                {group.key === 'documents' && codes.has('CIOT_REQUIRED') ? (
                    <>
                        <OsButton full variant="secondary" onClick={() => navigate(`/manifests/${manifestId}`)}>
                            Emitir CIOT
                        </OsButton>
                        {legacyNote}
                    </>
                ) : null}
                {group.key === 'registry' ? (
                    <>
                        <p className="text-[13px] leading-relaxed text-tower-500 dark:text-tower-300">
                            São dados de cadastro do transportador, do veículo e do motorista: completados uma vez, valem para as
                            próximas viagens.
                        </p>
                        {linkId ? (
                            <OsButton full onClick={() => navigate(`/hubs/transportadores/${linkId}?viagem=${manifestId}`)}>
                                Completar ficha do transportador
                            </OsButton>
                        ) : (
                            <p className="text-[13px] text-tower-500">Escolha o transportador da viagem primeiro.</p>
                        )}
                    </>
                ) : null}
                {group.key === 'cargo' ? (
                    <p className="text-[13px] text-tower-500 dark:text-tower-300">
                        Adicione pedidos montando a viagem a partir da fila em Viagens.
                    </p>
                ) : null}
            </div>
        </OsSheet>
    );
};

export default TripInfoEditor;
