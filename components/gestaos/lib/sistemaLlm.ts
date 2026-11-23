/** Modelos de IA: validação e corpo das chamadas (provedor, modelo, configuração do chat). A chave nunca passa por aqui. */

export type ApiFormat = 'openai' | 'gemini' | 'anthropic';
export const API_FORMAT_LABEL: Record<ApiFormat, string> = { openai: 'Compatível com OpenAI', gemini: 'Gemini', anthropic: 'Anthropic' };

export const CAPABILITIES = [
    { value: 'chat', label: 'Chat' },
    { value: 'tools', label: 'Chamada de funções' },
    { value: 'vision', label: 'Visão' },
    { value: 'json_mode', label: 'Modo JSON' },
] as const;

export interface LlmProvider {
    id: string;
    name: string;
    code: string;
    apiFormat?: ApiFormat;
    baseUrl?: string;
    active?: boolean;
    isBuiltIn?: boolean;
    apiKey?: { keyPreview: string; label?: string | null; active?: boolean } | null;
}

export interface LlmModel {
    id: string;
    providerId?: string;
    name: string;
    modelId?: string;
    description?: string | null;
    capabilities?: string[];
    contextWindow?: number;
    maxOutput?: number;
    inputPrice?: number | null;
    outputPrice?: number | null;
    isDefault: boolean;
    active: boolean;
    totalCalls?: number;
    provider?: { name: string; code: string };
}

export interface ChatLlmConfig {
    id: string;
    selectionMode: 'FIXED' | 'ROTATION' | 'LOAD_BALANCE';
    fixedModelId?: string | null;
    fixedModel?: LlmModel | null;
    rotationModels?: Array<{ id: string; modelId: string; weight: number; order: number; active: boolean; model: LlmModel }>;
    active: boolean;
}

export const SELECTION_LABEL: Record<ChatLlmConfig['selectionMode'], string> = { FIXED: 'Um modelo fixo', ROTATION: 'Rodízio entre modelos', LOAD_BALANCE: 'Balanceamento de carga' };

/* ---------- Provedor ---------- */

export interface ProviderForm {
    name: string;
    code: string;
    apiFormat: ApiFormat;
    baseUrl: string;
    supportsTools: boolean;
}

export const emptyProviderForm = (): ProviderForm => ({ name: '', code: '', apiFormat: 'openai', baseUrl: '', supportsTools: true });

export function validateProvider(form: ProviderForm): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Informe o nome do provedor.';
    if (!form.code.trim()) errors.code = 'Informe o código.';
    else if (!/^[a-z0-9_-]+$/.test(form.code.trim())) errors.code = 'Use só letras minúsculas, números, hífen ou sublinhado.';
    try {
        const url = new URL(form.baseUrl.trim());
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocolo');
    } catch {
        errors.baseUrl = 'Informe o endereço completo da API, como https://api.exemplo.com/v1.';
    }
    return errors;
}

export const buildProviderBody = (form: ProviderForm) => ({ name: form.name.trim(), code: form.code.trim(), apiFormat: form.apiFormat, baseUrl: form.baseUrl.trim(), supportsTools: form.supportsTools });

/* ---------- Modelo ---------- */

export interface ModelForm {
    providerId: string;
    name: string;
    modelId: string;
    description: string;
    capabilities: string[];
    contextWindow: string;
    maxOutput: string;
    inputPrice: string;
    outputPrice: string;
}

export const emptyModelForm = (): ModelForm => ({ providerId: '', name: '', modelId: '', description: '', capabilities: ['chat', 'tools'], contextWindow: '128000', maxOutput: '4096', inputPrice: '', outputPrice: '' });

export function modelToForm(model: LlmModel): ModelForm {
    return {
        providerId: model.providerId ?? '',
        name: model.name,
        modelId: model.modelId ?? '',
        description: model.description ?? '',
        capabilities: model.capabilities ?? [],
        contextWindow: String(model.contextWindow ?? 8192),
        maxOutput: String(model.maxOutput ?? 4096),
        inputPrice: model.inputPrice != null ? String(model.inputPrice) : '',
        outputPrice: model.outputPrice != null ? String(model.outputPrice) : '',
    };
}

const num = (text: string): number => Number(text.trim().replace(',', '.'));
const positiveInt = (text: string) => Number.isInteger(num(text)) && num(text) > 0;
const optionalPrice = (text: string) => !text.trim() || (Number.isFinite(num(text)) && num(text) >= 0);

export function validateModel(form: ModelForm, isNew: boolean): Record<string, string> {
    const errors: Record<string, string> = {};
    if (isNew && !form.providerId) errors.providerId = 'Escolha o provedor.';
    if (!form.name.trim()) errors.name = 'Informe o nome de exibição.';
    if (isNew && !form.modelId.trim()) errors.modelId = 'Informe o identificador do modelo no provedor.';
    if (form.capabilities.length === 0) errors.capabilities = 'Marque pelo menos uma capacidade.';
    if (!positiveInt(form.contextWindow)) errors.contextWindow = 'Use um número inteiro maior que zero.';
    if (!positiveInt(form.maxOutput)) errors.maxOutput = 'Use um número inteiro maior que zero.';
    if (!optionalPrice(form.inputPrice)) errors.inputPrice = 'Preço inválido.';
    if (!optionalPrice(form.outputPrice)) errors.outputPrice = 'Preço inválido.';
    return errors;
}

function common(form: ModelForm) {
    return {
        name: form.name.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        capabilities: form.capabilities,
        contextWindow: Math.trunc(num(form.contextWindow)),
        maxOutput: Math.trunc(num(form.maxOutput)),
        ...(form.inputPrice.trim() ? { inputPrice: num(form.inputPrice) } : {}),
        ...(form.outputPrice.trim() ? { outputPrice: num(form.outputPrice) } : {}),
    };
}

export const buildModelCreate = (form: ModelForm) => ({ providerId: form.providerId, modelId: form.modelId.trim(), ...common(form) });
/** O servidor não deixa trocar provedor nem identificador de um modelo existente. */
export const buildModelUpdate = (form: ModelForm) => common(form);

export const toggleCapability = (current: string[], value: string): string[] => (current.includes(value) ? current.filter((c) => c !== value) : [...current, value]);

/* ---------- Teste ---------- */

export interface ModelTestResult {
    working?: boolean;
    latencyMs?: number;
    response?: string;
    error?: string;
}

export function describeTest(result: ModelTestResult | null | undefined): { ok: boolean; message: string } {
    if (!result) return { ok: false, message: 'O teste não devolveu resposta.' };
    if (result.working) {
        const reply = (result.response ?? '').trim().slice(0, 140);
        return { ok: true, message: `Funcionou em ${result.latencyMs ?? '?'} ms${reply ? `: “${reply}”` : '.'}` };
    }
    return { ok: false, message: result.error ? `Não funcionou: ${result.error}` : 'Não funcionou.' };
}

/* ---------- Configuração do chat ---------- */

/** Modelo que o chat pode usar: ativo, com chat e com chave ativa no provedor. */
export function chatReady(model: LlmModel, providers: LlmProvider[]): boolean {
    const provider = providers.find((p) => p.id === model.providerId);
    return model.active && (model.capabilities ?? []).includes('chat') && Boolean(provider?.apiKey && provider.apiKey.active !== false);
}

export const validWeight = (weight: number): boolean => Number.isInteger(weight) && weight >= 1 && weight <= 10;

export const chatConfigBody = (mode: 'FIXED' | 'ROTATION', fixedModelId?: string) => ({ selectionMode: mode, ...(mode === 'FIXED' && fixedModelId ? { fixedModelId } : {}), active: true });
