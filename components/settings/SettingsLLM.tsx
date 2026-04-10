import React, { useState, useEffect } from 'react';

interface LLMProvider {
    id: string;
    name: string;
    code: string;
    apiFormat: string;
    baseUrl: string;
    supportsTools: boolean;
    isBuiltIn: boolean;
    active: boolean;
    apiKey?: {
        id: string;
        keyPreview: string;
        label?: string;
        active: boolean;
    };
    models: LLMModel[];
}

interface LLMModel {
    id: string;
    providerId: string;
    name: string;
    modelId: string;
    description?: string;
    capabilities: string[];
    contextWindow: number;
    maxOutput: number;
    inputPrice?: number;
    outputPrice?: number;
    isDefault: boolean;
    active: boolean;
    totalCalls: number;
    provider?: { name: string; code: string };
}

interface ChatLLMConfig {
    id: string;
    selectionMode: 'FIXED' | 'ROTATION' | 'LOAD_BALANCE';
    fixedModelId?: string;
    fixedModel?: LLMModel;
    rotationModels?: Array<{
        id: string;
        modelId: string;
        model: LLMModel;
        weight: number;
        order: number;
        active: boolean;
    }>;
    active: boolean;
}

const API_URL = import.meta.env.DEV ? 'http://localhost:3002/api' : '/api';

const CAPABILITIES = [
    { value: 'chat', label: 'Chat' },
    { value: 'tools', label: 'Function Calling' },
    { value: 'vision', label: 'Visão' },
    { value: 'json_mode', label: 'JSON Mode' },
];

const SettingsLLM: React.FC = () => {
    const [providers, setProviders] = useState<LLMProvider[]>([]);
    const [models, setModels] = useState<LLMModel[]>([]);
    const [chatConfig, setChatConfig] = useState<ChatLLMConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAddModel, setShowAddModel] = useState(false);
    const [showAddProvider, setShowAddProvider] = useState(false);
    const [showAddKey, setShowAddKey] = useState<string | null>(null);
    const [testingModel, setTestingModel] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

    // Form state for new model
    const [newModel, setNewModel] = useState({
        providerId: '',
        name: '',
        modelId: '',
        description: '',
        capabilities: ['chat', 'tools'],
        contextWindow: 128000,
        maxOutput: 4096,
        inputPrice: 0,
        outputPrice: 0,
    });

    // Form state for new provider
    const [newProvider, setNewProvider] = useState({
        name: '',
        code: '',
        apiFormat: 'openai',
        baseUrl: '',
        supportsTools: true,
    });

    // API key form
    const [apiKeyInput, setApiKeyInput] = useState('');

    const getToken = () => localStorage.getItem('token');

    const fetchData = async () => {
        try {
            setLoading(true);
            const headers = {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json'
            };

            const [providersRes, modelsRes, chatConfigRes] = await Promise.all([
                fetch(`${API_URL}/settings/llm/providers`, { headers }),
                fetch(`${API_URL}/settings/llm/models`, { headers }),
                fetch(`${API_URL}/settings/llm/chat-config`, { headers }),
            ]);

            if (!providersRes.ok || !modelsRes.ok) {
                throw new Error('Failed to fetch data');
            }

            const providersData = await providersRes.json();
            const modelsData = await modelsRes.json();
            const chatConfigData = chatConfigRes.ok ? await chatConfigRes.json() : { data: null };

            setProviders(providersData.data || []);
            setModels(modelsData.data || []);
            setChatConfig(chatConfigData.data || null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleSaveApiKey = async (providerId: string) => {
        try {
            const response = await fetch(`${API_URL}/settings/llm/api-keys`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ providerId, apiKey: apiKeyInput }),
            });

            if (!response.ok) throw new Error('Failed to save API key');

            setShowAddKey(null);
            setApiKeyInput('');
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleAddProvider = async () => {
        try {
            const response = await fetch(`${API_URL}/settings/llm/providers`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(newProvider),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to add provider');
            }

            setShowAddProvider(false);
            setNewProvider({
                name: '',
                code: '',
                apiFormat: 'openai',
                baseUrl: '',
                supportsTools: true,
            });
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleAddModel = async () => {
        try {
            const response = await fetch(`${API_URL}/settings/llm/models`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(newModel),
            });

            if (!response.ok) throw new Error('Failed to add model');

            setShowAddModel(false);
            setNewModel({
                providerId: '',
                name: '',
                modelId: '',
                description: '',
                capabilities: ['chat', 'tools'],
                contextWindow: 128000,
                maxOutput: 4096,
                inputPrice: 0,
                outputPrice: 0,
            });
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleSetDefault = async (modelId: string) => {
        try {
            const response = await fetch(`${API_URL}/settings/llm/models/${modelId}/set-default`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) throw new Error('Failed to set default');
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleToggleActive = async (modelId: string, currentActive: boolean) => {
        try {
            const response = await fetch(`${API_URL}/settings/llm/models/${modelId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ active: !currentActive }),
            });

            if (!response.ok) throw new Error('Failed to toggle');
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleTestModel = async (modelId: string) => {
        setTestingModel(modelId);
        setTestResult(null);

        try {
            const response = await fetch(`${API_URL}/settings/llm/models/${modelId}/test`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json',
                },
            });

            const result = await response.json();

            setTestResult({
                id: modelId,
                success: result.data?.working,
                message: result.data?.working
                    ? `✓ ${result.data.latencyMs}ms - ${result.data.response}`
                    : `✗ ${result.data?.error || 'Test failed'}`,
            });
        } catch (err: any) {
            setTestResult({
                id: modelId,
                success: false,
                message: err.message,
            });
        } finally {
            setTestingModel(null);
        }
    };

    const handleDeleteModel = async (modelId: string) => {
        if (!confirm('Tem certeza que deseja remover este modelo?')) return;

        try {
            const response = await fetch(`${API_URL}/settings/llm/models/${modelId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                },
            });

            if (!response.ok) throw new Error('Failed to delete');
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const toggleCapability = (cap: string) => {
        setNewModel(m => ({
            ...m,
            capabilities: m.capabilities.includes(cap)
                ? m.capabilities.filter(c => c !== cap)
                : [...m.capabilities, cap]
        }));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    const handleChatConfigChange = async (selectionMode: 'FIXED' | 'ROTATION', fixedModelId?: string) => {
        try {
            const response = await fetch(`${API_URL}/settings/llm/chat-config`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    selectionMode,
                    fixedModelId: selectionMode === 'FIXED' ? fixedModelId : undefined,
                    active: true,
                }),
            });

            if (!response.ok) throw new Error('Failed to update chat config');
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleAddRotationModel = async (modelId: string, weight: number) => {
        try {
            const response = await fetch(`${API_URL}/settings/llm/chat-config/rotation-models`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ modelId, weight }),
            });

            if (!response.ok) throw new Error('Failed to add rotation model');
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleRemoveRotationModel = async (rotationId: string) => {
        try {
            const response = await fetch(`${API_URL}/settings/llm/chat-config/rotation-models/${rotationId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${getToken()}`,
                },
            });

            if (!response.ok) throw new Error('Failed to remove rotation model');
            fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    // Get chat-capable models
    const chatModels = models.filter(m => 
        m.active && 
        m.capabilities.includes('chat') &&
        providers.find(p => p.id === m.providerId)?.apiKey
    );

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Modelos de IA</h2>
                    <p className="text-slate-500 mt-1">
                        Configure os modelos LLM usados no sistema
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowAddProvider(true)}
                        className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors"
                    >
                        + Provider
                    </button>
                    <button
                        onClick={() => setShowAddModel(true)}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
                    >
                        + Modelo
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                    {error}
                    <button onClick={() => setError(null)} className="ml-4 underline">Fechar</button>
                </div>
            )}

            {/* Chat Configuration */}
            <div className="bg-white rounded-2xl border-2 border-indigo-100 p-6">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Configuração do Chat</h3>
                <p className="text-sm text-slate-500 mb-6">
                    Escolha qual modelo LLM será usado no chat. Você pode usar um modelo fixo ou configurar rotação entre múltiplos modelos.
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-3">Modo de Seleção</label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="chatMode"
                                    checked={chatConfig?.selectionMode === 'FIXED'}
                                    onChange={() => handleChatConfigChange('FIXED', chatConfig?.fixedModelId)}
                                    className="w-4 h-4 text-indigo-600"
                                />
                                <span className="text-sm font-medium">Modelo Fixo</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="chatMode"
                                    checked={chatConfig?.selectionMode === 'ROTATION'}
                                    onChange={() => handleChatConfigChange('ROTATION')}
                                    className="w-4 h-4 text-indigo-600"
                                />
                                <span className="text-sm font-medium">Rotação</span>
                            </label>
                        </div>
                    </div>

                    {chatConfig?.selectionMode === 'FIXED' && (
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Modelo para Chat</label>
                            <select
                                value={chatConfig.fixedModelId || ''}
                                onChange={(e) => handleChatConfigChange('FIXED', e.target.value)}
                                className="w-full p-3 border rounded-xl"
                            >
                                <option value="">Selecione um modelo...</option>
                                {chatModels.map(m => (
                                    <option key={m.id} value={m.id}>
                                        {m.name} ({m.provider?.name})
                                    </option>
                                ))}
                            </select>
                            {chatConfig.fixedModel && (
                                <p className="text-xs text-slate-500 mt-2">
                                    Modelo atual: <strong>{chatConfig.fixedModel.name}</strong> ({chatConfig.fixedModel.provider?.name})
                                </p>
                            )}
                        </div>
                    )}

                    {chatConfig?.selectionMode === 'ROTATION' && (
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">Modelos na Rotação</label>
                            {chatConfig.rotationModels && chatConfig.rotationModels.length > 0 ? (
                                <div className="space-y-2">
                                    {chatConfig.rotationModels.map(rm => (
                                        <div key={rm.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                            <div>
                                                <span className="font-medium">{rm.model.name}</span>
                                                <span className="text-sm text-slate-500 ml-2">
                                                    ({rm.model.provider?.name}) • Peso: {rm.weight} • Ordem: {rm.order}
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveRotationModel(rm.id)}
                                                className="px-3 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg"
                                            >
                                                Remover
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500 mb-3">Nenhum modelo na rotação. Adicione modelos abaixo.</p>
                            )}
                            
                            <div className="mt-4 p-4 bg-slate-50 rounded-xl">
                                <label className="block text-sm font-medium text-slate-700 mb-2">Adicionar Modelo à Rotação</label>
                                <div className="flex gap-2">
                                    <select
                                        id="rotationModelSelect"
                                        className="flex-1 p-2 border rounded-lg"
                                        defaultValue=""
                                    >
                                        <option value="">Selecione um modelo...</option>
                                        {chatModels
                                            .filter(m => !chatConfig.rotationModels?.some(rm => rm.modelId === m.id))
                                            .map(m => (
                                                <option key={m.id} value={m.id}>
                                                    {m.name} ({m.provider?.name})
                                                </option>
                                            ))}
                                    </select>
                                    <input
                                        type="number"
                                        id="rotationWeight"
                                        min="1"
                                        max="10"
                                        defaultValue="1"
                                        placeholder="Peso"
                                        className="w-20 p-2 border rounded-lg"
                                    />
                                    <button
                                        onClick={() => {
                                            const select = document.getElementById('rotationModelSelect') as HTMLSelectElement;
                                            const weight = document.getElementById('rotationWeight') as HTMLInputElement;
                                            if (select.value) {
                                                handleAddRotationModel(select.value, parseInt(weight.value) || 1);
                                                select.value = '';
                                                weight.value = '1';
                                            }
                                        }}
                                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                                    >
                                        Adicionar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Providers & API Keys */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {providers.map(provider => (
                    <div key={provider.id} className={`bg-white rounded-2xl border-2 p-4 ${provider.isBuiltIn ? 'border-slate-100' : 'border-indigo-100'}`}>
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h3 className="font-bold text-slate-900">{provider.name}</h3>
                                <code className="text-xs text-slate-400">{provider.apiFormat}</code>
                            </div>
                            <span className={`text-xs px-2 py-1 rounded-full ${provider.apiKey ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                {provider.apiKey ? 'Configurado' : 'Sem chave'}
                            </span>
                        </div>

                        {provider.apiKey ? (
                            <div className="text-sm text-slate-500 mb-3">
                                Chave: <code className="bg-slate-100 px-2 py-0.5 rounded">{provider.apiKey.keyPreview}</code>
                            </div>
                        ) : null}

                        {showAddKey === provider.id ? (
                            <div className="space-y-2">
                                <input
                                    type="password"
                                    placeholder="Cole sua API key..."
                                    value={apiKeyInput}
                                    onChange={e => setApiKeyInput(e.target.value)}
                                    className="w-full p-2 border rounded-lg text-sm"
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleSaveApiKey(provider.id)}
                                        className="flex-1 py-1 bg-indigo-600 text-white rounded-lg text-sm"
                                    >
                                        Salvar
                                    </button>
                                    <button
                                        onClick={() => { setShowAddKey(null); setApiKeyInput(''); }}
                                        className="px-3 py-1 bg-slate-100 rounded-lg text-sm"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowAddKey(provider.id)}
                                className="w-full py-2 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-indigo-300 hover:text-indigo-600 text-sm transition-colors"
                            >
                                {provider.apiKey ? 'Atualizar Chave' : 'Adicionar Chave'}
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Models List */}
            <div className="bg-white rounded-2xl border-2 border-slate-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="font-bold text-slate-900">Modelos Configurados</h3>
                </div>

                <div className="divide-y divide-slate-100">
                    {models.length === 0 ? (
                        <div className="p-8 text-center text-slate-400">
                            Nenhum modelo configurado. Clique em "+ Modelo" para começar.
                        </div>
                    ) : (
                        models.map(model => (
                            <div key={model.id} className="px-6 py-4 flex items-center gap-4">
                                {/* Status indicator */}
                                <div className={`w-3 h-3 rounded-full ${model.isDefault ? 'bg-emerald-500' : model.active ? 'bg-sky-400' : 'bg-slate-300'}`} />

                                {/* Model info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-slate-900">{model.name}</span>
                                        <code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 truncate">
                                            {model.modelId}
                                        </code>
                                        {model.isDefault && (
                                            <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">
                                                PADRÃO
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-slate-500 mt-0.5 truncate">
                                        {model.provider?.name} • {model.capabilities.join(', ')} • {(model.contextWindow / 1000).toFixed(0)}K ctx
                                        {model.inputPrice ? ` • $${model.inputPrice}/$${model.outputPrice} per 1M` : ''}
                                    </div>
                                    {testResult?.id === model.id && (
                                        <div className={`text-sm mt-1 ${testResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                                            {testResult.message}
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button
                                        onClick={() => handleTestModel(model.id)}
                                        disabled={testingModel === model.id}
                                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {testingModel === model.id ? '...' : 'Testar'}
                                    </button>

                                    {!model.isDefault && (
                                        <button
                                            onClick={() => handleSetDefault(model.id)}
                                            className="px-3 py-1.5 text-xs font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-lg transition-colors"
                                        >
                                            Padrão
                                        </button>
                                    )}

                                    <button
                                        onClick={() => handleToggleActive(model.id, model.active)}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${model.active
                                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                            }`}
                                    >
                                        {model.active ? 'Off' : 'On'}
                                    </button>

                                    <button
                                        onClick={() => handleDeleteModel(model.id)}
                                        className="px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        🗑
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Add Model Modal */}
            {showAddModel && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-auto">
                        <h3 className="text-xl font-bold text-slate-900 mb-4">Adicionar Modelo</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Provider *</label>
                                <select
                                    value={newModel.providerId}
                                    onChange={e => setNewModel(m => ({ ...m, providerId: e.target.value }))}
                                    className="w-full p-3 border rounded-xl"
                                >
                                    <option value="">Selecione...</option>
                                    {providers.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome *</label>
                                    <input
                                        type="text"
                                        placeholder="GPT-4o"
                                        value={newModel.name}
                                        onChange={e => setNewModel(m => ({ ...m, name: e.target.value }))}
                                        className="w-full p-3 border rounded-xl"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Model ID *</label>
                                    <input
                                        type="text"
                                        placeholder="gpt-4o"
                                        value={newModel.modelId}
                                        onChange={e => setNewModel(m => ({ ...m, modelId: e.target.value }))}
                                        className="w-full p-3 border rounded-xl"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Descrição</label>
                                <input
                                    type="text"
                                    placeholder="Modelo otimizado para..."
                                    value={newModel.description}
                                    onChange={e => setNewModel(m => ({ ...m, description: e.target.value }))}
                                    className="w-full p-3 border rounded-xl"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Capabilities</label>
                                <div className="flex flex-wrap gap-2">
                                    {CAPABILITIES.map(cap => (
                                        <button
                                            key={cap.value}
                                            type="button"
                                            onClick={() => toggleCapability(cap.value)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${newModel.capabilities.includes(cap.value)
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                        >
                                            {cap.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Context Window</label>
                                    <input
                                        type="number"
                                        value={newModel.contextWindow}
                                        onChange={e => setNewModel(m => ({ ...m, contextWindow: parseInt(e.target.value) || 8192 }))}
                                        className="w-full p-3 border rounded-xl"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Max Output</label>
                                    <input
                                        type="number"
                                        value={newModel.maxOutput}
                                        onChange={e => setNewModel(m => ({ ...m, maxOutput: parseInt(e.target.value) || 4096 }))}
                                        className="w-full p-3 border rounded-xl"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Preço Input (USD/1M)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={newModel.inputPrice}
                                        onChange={e => setNewModel(m => ({ ...m, inputPrice: parseFloat(e.target.value) || 0 }))}
                                        className="w-full p-3 border rounded-xl"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Preço Output (USD/1M)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={newModel.outputPrice}
                                        onChange={e => setNewModel(m => ({ ...m, outputPrice: parseFloat(e.target.value) || 0 }))}
                                        className="w-full p-3 border rounded-xl"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={handleAddModel}
                                disabled={!newModel.providerId || !newModel.name || !newModel.modelId}
                                className="flex-1 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                                Adicionar
                            </button>
                            <button
                                onClick={() => setShowAddModel(false)}
                                className="px-6 py-3 bg-slate-100 font-medium rounded-xl hover:bg-slate-200 transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Provider Modal */}
            {showAddProvider && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-lg">
                        <h3 className="text-xl font-bold text-slate-900 mb-4">Adicionar Provider Customizado</h3>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Nome *</label>
                                    <input
                                        type="text"
                                        placeholder="Meu Provider"
                                        value={newProvider.name}
                                        onChange={e => setNewProvider(p => ({ ...p, name: e.target.value }))}
                                        className="w-full p-3 border rounded-xl"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Código *</label>
                                    <input
                                        type="text"
                                        placeholder="meu-provider"
                                        value={newProvider.code}
                                        onChange={e => setNewProvider(p => ({ ...p, code: e.target.value.toLowerCase().replace(/\s/g, '-') }))}
                                        className="w-full p-3 border rounded-xl"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Base URL *</label>
                                <input
                                    type="url"
                                    placeholder="https://api.example.com/v1"
                                    value={newProvider.baseUrl}
                                    onChange={e => setNewProvider(p => ({ ...p, baseUrl: e.target.value }))}
                                    className="w-full p-3 border rounded-xl"
                                />
                                <p className="text-xs text-slate-400 mt-1">Maioria das APIs usa formato OpenAI: /v1/chat/completions</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Formato da API</label>
                                <select
                                    value={newProvider.apiFormat}
                                    onChange={e => setNewProvider(p => ({ ...p, apiFormat: e.target.value }))}
                                    className="w-full p-3 border rounded-xl"
                                >
                                    <option value="openai">OpenAI-compatible (DeepSeek, Groq, etc.)</option>
                                    <option value="gemini">Google Gemini</option>
                                    <option value="anthropic">Anthropic Claude</option>
                                </select>
                            </div>

                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="supportsTools"
                                    checked={newProvider.supportsTools}
                                    onChange={e => setNewProvider(p => ({ ...p, supportsTools: e.target.checked }))}
                                    className="w-4 h-4"
                                />
                                <label htmlFor="supportsTools" className="text-sm text-slate-700">
                                    Suporta Function Calling (tools)
                                </label>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={handleAddProvider}
                                disabled={!newProvider.name || !newProvider.code || !newProvider.baseUrl}
                                className="flex-1 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                                Adicionar
                            </button>
                            <button
                                onClick={() => setShowAddProvider(false)}
                                className="px-6 py-3 bg-slate-100 font-medium rounded-xl hover:bg-slate-200 transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SettingsLLM;
