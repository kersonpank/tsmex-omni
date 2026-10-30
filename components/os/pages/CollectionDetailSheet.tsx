import React, { useState } from 'react';
import clsx from 'clsx';
import { intakeDemandsApi } from '../../../lib/api';
import type { HubCargoItem } from '../../../types/index';
import {
    AVERBACAO_NOTE,
    addressLine,
    buildWhatsappSummary,
    collectionBadge,
    formatGoogleMapsUrl,
    formatPhoneTelUrl,
    formatWhatsappContactUrl,
    shortDate,
} from '../lib/collection';
import { OsBadge, OsButton } from '../ui/kit';
import OsSheet, { apiErrorMessage, osFieldClass } from '../ui/Sheet';

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="mt-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-tower-400">{label}</p>
        <div className="text-[14px] text-tower-800 dark:text-tower-100">{children}</div>
    </div>
);

/** Detalhe de uma coleta solicitada: dar entrada quando a carga chegar, ou cancelar a solicitação. */
const CollectionDetailSheet: React.FC<{
    item: HubCargoItem;
    onClose: () => void;
    onReceive: (item: HubCargoItem) => void;
    onCancelled: () => void;
}> = ({ item, onClose, onReceive, onCancelled }) => {
    const cr = item.collectionRequest;
    const [cancelling, setCancelling] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!cr) return null;

    const cancel = async () => {
        if (!item.demandId || reason.trim().length < 3 || busy) return;
        setBusy(true);
        setError(null);
        try {
            await intakeDemandsApi.cancelCollection(item.demandId, reason.trim());
            onCancelled();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível cancelar a solicitação. Tente de novo.'));
        } finally {
            setBusy(false);
        }
    };

    const copySummary = async () => {
        try {
            const summary = buildWhatsappSummary(cr);
            await navigator.clipboard.writeText(summary);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            // fallback se clipboard API falhar
            setCopied(false);
        }
    };

    const ref = cr.referencePoint || cr.address.referencePoint;
    const access = cr.accessInstructions || cr.address.accessInstructions;

    return (
        <OsSheet
            title={cr.senderName}
            subtitle="Coleta solicitada"
            onClose={onClose}
            footer={
                cancelling ? (
                    <>
                        {error ? <p role="alert" className="mb-2 text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
                        <div className="flex gap-2">
                            <OsButton variant="secondary" className="flex-1" disabled={busy} onClick={() => setCancelling(false)}>
                                Voltar
                            </OsButton>
                            <OsButton variant="danger" className="flex-1" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>
                                {busy ? 'Cancelando…' : 'Cancelar solicitação'}
                            </OsButton>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col gap-2">
                        {item.allowedActions.confirmArrival ? (
                            <OsButton full onClick={() => onReceive(item)}>
                                Coleta realizada — dar entrada
                            </OsButton>
                        ) : null}
                        <div className="flex gap-2">
                            <OsButton variant="secondary" className="flex-1" onClick={() => void copySummary()}>
                                {copied ? '✓ Resumo copiado!' : 'Copiar resumo (WhatsApp)'}
                            </OsButton>
                            <OsButton variant="secondary" className="flex-1" onClick={() => setCancelling(true)}>
                                Cancelar coleta
                            </OsButton>
                        </div>
                    </div>
                )
            }
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                    <OsBadge tone="warn">{collectionBadge(cr)}</OsBadge>
                    {cr.windowLabel ? <OsBadge tone="neutral">{cr.windowLabel}</OsBadge> : null}
                    {cr.availabilityWindow ? <OsBadge tone="neutral">{cr.availabilityWindow}</OsBadge> : null}
                </div>
                <button
                    type="button"
                    onClick={() => void copySummary()}
                    className="rounded-lg border border-tower-200 px-2.5 py-1 text-[12px] font-bold text-tower-700 hover:border-brand-500 hover:text-brand-600 dark:border-tower-700 dark:text-tower-300"
                >
                    {copied ? '✓ Copiado!' : 'Copiar resumo'}
                </button>
            </div>

            {/* Contratante */}
            {cr.contractingPersonName && cr.contractingPersonName !== cr.senderName ? (
                <Fact label="Contratante / Solicitante">
                    <span className="font-semibold">{cr.contractingPersonName}</span>
                </Fact>
            ) : null}

            {/* Endereço com link para Google Maps */}
            <Fact label="Endereço de coleta">
                <a
                    href={formatGoogleMapsUrl(cr.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    title="Abrir no Google Maps"
                >
                    <span>{addressLine(cr.address) || 'Não informado'}</span>
                    <span className="text-[12px]">↗ Maps</span>
                </a>
                {ref ? <p className="mt-0.5 text-[13px] text-tower-600 dark:text-tower-300">Ponto de ref.: {ref}</p> : null}
                {access ? <p className="mt-0.5 text-[13px] text-tower-600 dark:text-tower-300">Acesso: {access}</p> : null}
            </Fact>

            {/* Contatos com telefone e WhatsApp */}
            {cr.contacts && cr.contacts.length > 0 ? (
                <Fact label="Contatos no local">
                    <div className="flex flex-col gap-1.5 pt-1">
                        {cr.contacts.map((c, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-tower-200 bg-tower-50/60 p-2 text-[13px] dark:border-tower-700 dark:bg-tower-800/50">
                                <span className="font-bold text-tower-900 dark:text-white">{c.name}</span>
                                {c.role ? <span className="text-tower-500">({c.role})</span> : null}
                                {c.phone ? (
                                    <div className="flex items-center gap-2">
                                        <a href={formatPhoneTelUrl(c.phone) ?? undefined} className="font-mono text-brand-600 hover:underline dark:text-brand-400">
                                            {c.phone}
                                        </a>
                                        {formatWhatsappContactUrl(c.phone) ? (
                                            <a
                                                href={formatWhatsappContactUrl(c.phone)!}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                                            >
                                                WhatsApp
                                            </a>
                                        ) : null}
                                    </div>
                                ) : null}
                                {c.email ? <span className="text-[12px] text-tower-400">{c.email}</span> : null}
                            </div>
                        ))}
                    </div>
                </Fact>
            ) : cr.contact ? (
                <Fact label="Contato no local">
                    <div className="flex items-center gap-2">
                        <span>{cr.contact}</span>
                        {formatWhatsappContactUrl(cr.contact) ? (
                            <a
                                href={formatWhatsappContactUrl(cr.contact)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                            >
                                WhatsApp
                            </a>
                        ) : null}
                    </div>
                </Fact>
            ) : null}

            <Fact label="Data desejada">{shortDate(cr.requestedDate) || '—'}</Fact>

            {/* Destinatário */}
            {cr.destinatarioName ? (
                <Fact label="Destinatário previsto">
                    <span className="font-semibold">{cr.destinatarioName}</span>
                </Fact>
            ) : null}

            {/* Mercadoria e volumes */}
            {cr.goodsDescription ? (
                <Fact label="Mercadoria">
                    <span className="font-medium">{cr.goodsDescription}</span>
                </Fact>
            ) : null}

            {cr.approxWeightKg || cr.approxUnits || cr.nfValue ? (
                <Fact label="Carga aproximada">
                    {[
                        cr.approxUnits ? `${cr.approxUnits} vol.` : null,
                        cr.approxWeightKg ? `${cr.approxWeightKg} kg` : null,
                        cr.nfValue ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cr.nfValue) : null,
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </Fact>
            ) : null}

            {/* Medidas dos volumes */}
            {cr.packageDimensions && cr.packageDimensions.length > 0 ? (
                <Fact label="Medidas dos volumes">
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        {cr.packageDimensions.map((d, i) => (
                            <span key={i} className="rounded-lg border border-tower-200 bg-tower-100/60 px-2 py-1 font-mono text-[12px] text-tower-800 dark:border-tower-700 dark:bg-tower-800 dark:text-tower-200">
                                {d.quantity}x {d.lengthCm}×{d.widthCm}×{d.heightCm} cm
                            </span>
                        ))}
                    </div>
                </Fact>
            ) : null}

            {/* Chaves das NF-e */}
            {cr.nfKeys.length > 0 ? (
                <Fact label={cr.nfKeys.length === 1 ? 'NF-e' : 'NF-e informadas'}>
                    <div className="flex flex-col gap-1 pt-0.5">
                        {cr.nfKeys.map((k) => (
                            <p key={k} className="break-all font-mono text-[12px] text-tower-700 dark:text-tower-200">
                                {k}
                            </p>
                        ))}
                        <p className="mt-1 text-[11px] text-tower-500">ℹ️ {AVERBACAO_NOTE}</p>
                    </div>
                </Fact>
            ) : null}

            {/* Serviço e observações */}
            <Fact label="Serviço">
                <div className="flex flex-wrap gap-1.5 pt-1">
                    <OsBadge tone={cr.needsHelper ? 'brand' : 'neutral'}>
                        {cr.needsHelper ? 'Com ajudante' : 'Sem ajudante'}
                    </OsBadge>
                    <OsBadge tone={cr.needsLoading ? 'brand' : 'neutral'}>
                        {cr.needsLoading ? 'Carga/descarga equipe' : 'Carregamento pelo remetente'}
                    </OsBadge>
                </div>
            </Fact>

            {cr.note ? <Fact label="Observação">{cr.note}</Fact> : null}

            {cancelling ? (
                <label className="mt-4 block text-[13px] font-bold text-tower-600 dark:text-tower-300">
                    Motivo do cancelamento
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        maxLength={300}
                        autoFocus
                        placeholder="Informe o motivo para a torre e histórico"
                        className={clsx(osFieldClass, 'mt-1.5 h-auto py-2.5')}
                    />
                </label>
            ) : null}
        </OsSheet>
    );
};

export default CollectionDetailSheet;
