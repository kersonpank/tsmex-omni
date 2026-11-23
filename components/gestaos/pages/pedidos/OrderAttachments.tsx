import React, { useRef } from 'react';
import { formatApiError, ordersApi } from '../../../../lib/api';
import { dateTime } from '../../lib/format';
import { attachmentBody, attachmentProblem, formatFileSize, friendlyOrderError, isImageAttachment } from '../../lib/pedidoDrawer';
import { invalidate, useResource } from '../../lib/resource';
import { ConfirmButton } from '../../ui/form';
import { Button, Loadable, Skeleton } from '../../ui/kit';
import { useAction, useToast } from '../../ui/overlay';
import { DrawerBlock } from './DrawerBlock';

interface AttachmentRow {
    id: string;
    createdAt?: string | null;
    attachment?: { id?: string; fileName?: string | null; mimeType?: string | null; size?: number | null; downloadUrl?: string | null } | null;
}

const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
    });

/** Anexos do pedido: listar, enviar (base64) e remover com confirmação. Mesma API da tela clássica. */
export const OrderAttachments: React.FC<{ orderId: string }> = ({ orderId }) => {
    const key = `orders:attachments:${orderId}`;
    const toast = useToast();
    const { busy, run } = useAction();
    const input = useRef<HTMLInputElement>(null);
    const state = useResource<AttachmentRow[]>(key, async () => ((await ordersApi.listAttachments(orderId)).data ?? []) as AttachmentRow[], { staleMs: 15_000 });

    const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const problem = attachmentProblem(file);
        if (problem) {
            toast.error(problem);
            return;
        }
        const ok = await run(
            'attach',
            async () => {
                try {
                    await ordersApi.addAttachment(orderId, attachmentBody(await toBase64(file), file));
                } catch (cause) {
                    throw new Error(friendlyOrderError(cause instanceof Error && !('response' in cause) ? cause.message : formatApiError(cause)));
                }
            },
            { success: `${file.name} anexado.`, error: 'O arquivo não foi enviado.' },
        );
        if (ok) invalidate(key, 'orders:list');
    };

    const remove = async (item: AttachmentRow) => {
        const target = item.attachment?.id ?? item.id;
        const ok = await run('detach', () => ordersApi.removeAttachment(orderId, target), { success: 'Anexo removido.', error: 'O anexo não foi removido.' });
        if (ok) invalidate(key, 'orders:list');
        return ok;
    };

    return (
        <DrawerBlock title="Anexos" mode="manual">
            <Loadable
                state={state}
                skeleton={<Skeleton rows={2} height={40} />}
                isEmpty={(rows) => rows.length === 0}
                empty={<p className="gx-muted text-[13.5px]">Nenhum anexo neste pedido.</p>}
            >
                {(rows) => (
                    <ul className="flex flex-col">
                        {rows.map((item) => {
                            const file = item.attachment;
                            const meta = [isImageAttachment(file?.mimeType, file?.fileName) ? 'Imagem' : null, formatFileSize(file?.size), item.createdAt ? dateTime(item.createdAt) : null].filter((part) => part && part !== '—');
                            return (
                                <li key={item.id} className="gx-hair-b flex flex-wrap items-center justify-between gap-2 py-2.5 last:border-b-0">
                                    <div className="min-w-0">
                                        {file?.downloadUrl ? (
                                            <a href={file.downloadUrl} target="_blank" rel="noreferrer" className="gx-royal-text block truncate text-[14px] font-semibold underline">
                                                {file.fileName ?? 'Arquivo'}
                                            </a>
                                        ) : (
                                            <span className="block truncate text-[14px] font-semibold">{file?.fileName ?? 'Arquivo'}</span>
                                        )}
                                        <span className="gx-muted text-[12.5px]">{meta.join(' · ')}</span>
                                    </div>
                                    <ConfirmButton label="Remover" confirmLabel="Remover mesmo?" disabled={busy !== null} onConfirm={() => remove(item)} />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Loadable>
            <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Escolher arquivo para anexar" data-testid="attach-input" onChange={(event) => void pick(event)} />
            <div className="mt-3">
                <Button size="sm" variant="soft" loading={busy === 'attach'} disabled={busy !== null} onClick={() => input.current?.click()}>
                    Anexar arquivo
                </Button>
                <span className="gx-muted ml-3 text-[12.5px]">PDF, imagem ou documento, até 10 MB.</span>
            </div>
        </DrawerBlock>
    );
};
