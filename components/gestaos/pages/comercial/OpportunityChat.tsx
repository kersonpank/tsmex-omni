import React, { useState } from 'react';
import { chatMessagesApi } from '../../../../lib/api';
import { dateTime } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { Button, EmptyState, Loadable } from '../../ui/kit';

interface ChatMessage {
    id: string;
    role: string;
    content: string;
    createdAt: string;
    attachments?: Array<{ id: string; fileName?: string | null }>;
}

const ROLE_LABEL: Record<string, string> = { user: 'Cliente', assistant: 'Assistente', system: 'Sistema' };

const Conversation: React.FC<{ sessionId: string }> = ({ sessionId }) => {
    const state = useResource<ChatMessage[]>(`demands:chat:${sessionId}`, async () => ((await chatMessagesApi.getBySession(sessionId)).data?.messages ?? []) as ChatMessage[], { staleMs: 60_000 });
    return (
        <Loadable state={state} isEmpty={(list) => list.length === 0} empty={<EmptyState title="Conversa sem mensagens." />}>
            {(list) => (
                <ul className="gx-inset flex max-h-[360px] flex-col gap-3 overflow-y-auto p-4" aria-label="Mensagens do chat">
                    {list.map((message) => (
                        <li key={message.id}>
                            <p className="gx-muted text-[12.5px]">
                                {ROLE_LABEL[message.role] ?? 'Mensagem'} · {dateTime(message.createdAt)}
                            </p>
                            <p className="whitespace-pre-wrap text-[14px]">{message.content}</p>
                            {message.attachments?.length ? <p className="gx-muted text-[12.5px]">Anexos: {message.attachments.map((a) => a.fileName ?? 'arquivo').join(', ')}</p> : null}
                        </li>
                    ))}
                </ul>
            )}
        </Loadable>
    );
};

/** Conversa do chat que originou a oportunidade (só leitura; carrega ao abrir). */
export const OpportunityChat: React.FC<{ sessionId: string | null | undefined }> = ({ sessionId }) => {
    const [open, setOpen] = useState(false);
    if (!sessionId) return null;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="gx-h2">Conversa do chat</h3>
                <Button size="sm" variant="soft" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                    {open ? 'Ocultar conversa' : 'Ver conversa'}
                </Button>
            </div>
            {open ? <Conversation sessionId={sessionId} /> : null}
        </div>
    );
};
