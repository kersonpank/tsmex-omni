import { api } from '../../../../../lib/api';
import { useResource } from '../../../lib/resource';
import type { ChatLlmConfig, LlmModel, LlmProvider } from '../../../lib/sistemaLlm';

/** Leituras dos modelos de IA. Todas as chaves começam com `system:llm` para `invalidate`. */

export const LLM_KEY = 'system:llm';

const list = <T,>(path: string) => async () => ((await api.get<{ data: T[] }>(`/settings/llm/${path}`)).data.data ?? []) as T[];

export function useLlm() {
    const providers = useResource<LlmProvider[]>(`${LLM_KEY}:providers`, list<LlmProvider>('providers'), { staleMs: 30_000 });
    const models = useResource<LlmModel[]>(`${LLM_KEY}:models`, list<LlmModel>('models'), { staleMs: 30_000 });
    const chatConfig = useResource<{ config: ChatLlmConfig | null }>(`${LLM_KEY}:chat-config`, async () => ({ config: (await api.get<{ data: ChatLlmConfig | null }>('/settings/llm/chat-config')).data.data ?? null }), { staleMs: 30_000 });
    return { providers, models, chatConfig };
}
