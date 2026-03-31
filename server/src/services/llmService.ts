/**
 * LLM Service - Universal interface for multiple AI providers
 * Uses provider's apiFormat to determine how to call the API
 * Supports: OpenAI-compatible (OpenAI, DeepSeek, Groq, Together), Gemini, Anthropic
 */

import prisma from '../lib/prisma.js';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, any>;
    };
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface LLMResponse {
    text: string;
    toolCalls?: ToolCall[];
    tokensUsed?: number;
    model: string;
}

interface ProviderConfig {
    apiFormat: string;    // "openai" | "gemini" | "anthropic"
    baseUrl: string;
    apiKey: string;
}

interface TestResult {
    success: boolean;
    latencyMs: number;
    response?: string;
    error?: string;
}

interface CallOptions {
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    maxTokens?: number;
}

export interface ActiveModelConfig {
    modelId: string;
    provider: {
        apiFormat: string;
        baseUrl: string;
        apiKey: string;
    };
}

/**
 * Test a model connection to verify it's working
 */
export async function testModelConnection(
    provider: ProviderConfig,
    modelId: string
): Promise<TestResult> {
    const start = Date.now();

    try {
        const response = await callLLM(provider, {
            model: modelId,
            messages: [{ role: 'user', content: 'Say "Hello, I am working!" in exactly those words.' }],
        });

        return {
            success: true,
            latencyMs: Date.now() - start,
            response: response.text.slice(0, 100),
        };
    } catch (error: any) {
        return {
            success: false,
            latencyMs: Date.now() - start,
            error: error.message || 'Connection failed',
        };
    }
}

/**
 * Main function to call any LLM based on provider's apiFormat
 */
export async function callLLM(
    provider: ProviderConfig,
    options: CallOptions
): Promise<LLMResponse> {
    switch (provider.apiFormat) {
        case 'openai':
            return callOpenAIFormat(provider, options);
        case 'gemini':
            return callGeminiFormat(provider, options);
        case 'anthropic':
            return callAnthropicFormat(provider, options);
        default:
            // Default to OpenAI format (most common)
            return callOpenAIFormat(provider, options);
    }
}

// ==================== OPENAI-COMPATIBLE FORMAT ====================
// Works with: OpenAI, DeepSeek, Groq, Together, Ollama, etc.

async function callOpenAIFormat(
    provider: ProviderConfig,
    options: CallOptions
): Promise<LLMResponse> {
    const url = `${provider.baseUrl}/chat/completions`;

    const body: Record<string, any> = {
        model: options.model,
        messages: options.messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: options.maxTokens || 4096,
    };

    if (options.tools && options.tools.length > 0) {
        body.tools = options.tools;
        body.tool_choice = 'auto';
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({})) as any;
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];

    return {
        text: choice?.message?.content || '',
        toolCalls: choice?.message?.tool_calls,
        tokensUsed: data.usage?.total_tokens,
        model: options.model,
    };
}

// ==================== GEMINI FORMAT ====================

async function callGeminiFormat(
    provider: ProviderConfig,
    options: CallOptions
): Promise<LLMResponse> {
    const url = `${provider.baseUrl}/models/${options.model}:generateContent?key=${provider.apiKey}`;

    // Convert messages to Gemini format
    const contents = options.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));

    const systemMessage = options.messages.find(m => m.role === 'system');

    const body: Record<string, any> = {
        contents,
        generationConfig: {
            maxOutputTokens: options.maxTokens || 4096,
        },
    };

    if (systemMessage) {
        body.systemInstruction = { parts: [{ text: systemMessage.content }] };
    }

    // Add tools if present (Gemini uses different format)
    if (options.tools && options.tools.length > 0) {
        body.tools = [{
            functionDeclarations: options.tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
            }))
        }];
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({})) as any;
        throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Extract text and function calls
    const textPart = parts.find((p: any) => p.text);
    const functionCalls = parts.filter((p: any) => p.functionCall);

    const toolCalls: ToolCall[] = functionCalls.map((fc: any, index: number) => ({
        id: `gemini-${Date.now()}-${index}`,
        type: 'function',
        function: {
            name: fc.functionCall.name,
            arguments: JSON.stringify(fc.functionCall.args),
        }
    }));

    return {
        text: textPart?.text || '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model: options.model,
    };
}

// ==================== ANTHROPIC FORMAT ====================

async function callAnthropicFormat(
    provider: ProviderConfig,
    options: CallOptions
): Promise<LLMResponse> {
    const url = `${provider.baseUrl}/messages`;

    const systemMessage = options.messages.find(m => m.role === 'system');
    const chatMessages = options.messages.filter(m => m.role !== 'system');

    const body: Record<string, any> = {
        model: options.model,
        max_tokens: options.maxTokens || 4096,
        messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
    };

    if (systemMessage) {
        body.system = systemMessage.content;
    }

    if (options.tools && options.tools.length > 0) {
        body.tools = options.tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
        }));
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({})) as any;
        throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const content = data.content || [];

    // Check for tool use
    const toolUse = content.find((c: any) => c.type === 'tool_use');
    if (toolUse) {
        return {
            text: '',
            toolCalls: [{
                id: toolUse.id,
                type: 'function',
                function: {
                    name: toolUse.name,
                    arguments: JSON.stringify(toolUse.input),
                }
            }],
            tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens,
            model: options.model,
        };
    }

    const textContent = content.find((c: any) => c.type === 'text');
    return {
        text: textContent?.text || '',
        tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens,
        model: options.model,
    };
}

/**
 * Get active model configuration from database for a specific capability
 * Uses ChatLLMConfig if available, otherwise falls back to default model
 * Prioritizes models with valid API keys
 */
export async function getActiveModel(capability: string = 'chat'): Promise<ActiveModelConfig> {
    // If capability is 'chat', check for ChatLLMConfig first
    if (capability === 'chat') {
        const chatConfig = await prisma.chatLLMConfig.findFirst({
            where: { active: true },
            include: {
                fixedModel: {
                    include: {
                        provider: {
                            include: { apiKey: true }
                        }
                    }
                },
                rotationModels: {
                    where: { active: true },
                    include: {
                        model: {
                            include: {
                                provider: {
                                    include: { apiKey: true }
                                }
                            }
                        }
                    },
                    orderBy: [{ order: 'asc' }, { weight: 'desc' }]
                }
            }
        });

        if (chatConfig && chatConfig.active) {
            // FIXED mode: use fixed model
            if (chatConfig.selectionMode === 'FIXED' && chatConfig.fixedModel) {
                const model = chatConfig.fixedModel;
                if (model.active && model.provider.active && model.provider.apiKey?.active && model.provider.apiKey?.apiKey) {
                    return {
                        modelId: model.modelId,
                        provider: {
                            apiFormat: model.provider.apiFormat,
                            baseUrl: model.provider.baseUrl,
                            apiKey: model.provider.apiKey.apiKey.trim()
                        }
                    };
                }
            }

            // ROTATION mode: select from rotation models
            if (chatConfig.selectionMode === 'ROTATION' && chatConfig.rotationModels.length > 0) {
                // Filter models with valid API keys
                const validModels = chatConfig.rotationModels.filter(rm => 
                    rm.model.active && 
                    rm.model.provider.active && 
                    rm.model.provider.apiKey?.active && 
                    rm.model.provider.apiKey?.apiKey
                );

                if (validModels.length > 0) {
                    // Simple round-robin based on order and weight
                    // For now, use first valid model (can be improved with weighted selection)
                    const selected = validModels[0].model;
                    return {
                        modelId: selected.modelId,
                        provider: {
                            apiFormat: selected.provider.apiFormat,
                            baseUrl: selected.provider.baseUrl,
                            apiKey: selected.provider.apiKey!.apiKey.trim()
                        }
                    };
                }
            }
        }
    }

    // Fallback to default model logic
    // First, try to find default model with that capability AND valid API key
    let model = await prisma.lLMModel.findFirst({
        where: {
            active: true,
            isDefault: true,
            capabilities: { has: capability },
            provider: {
                active: true,
                apiKey: {
                    active: true,
                    apiKey: { not: '' }
                }
            }
        },
        include: {
            provider: {
                include: { apiKey: true }
            }
        },
        orderBy: { updatedAt: 'desc' }
    });

    // Fallback: any active model with that capability AND valid API key
    if (!model) {
        model = await prisma.lLMModel.findFirst({
            where: {
                active: true,
                capabilities: { has: capability },
                provider: {
                    active: true,
                    apiKey: {
                        active: true,
                        apiKey: { not: '' }
                    }
                }
            },
            include: {
                provider: {
                    include: { apiKey: true }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });
    }

    // If still no model, try without API key requirement (for better error message)
    if (!model) {
        const modelWithoutKey = await prisma.lLMModel.findFirst({
            where: {
                active: true,
                capabilities: { has: capability }
            },
            include: {
                provider: {
                    include: { apiKey: true }
                }
            }
        });

        if (modelWithoutKey) {
            if (!modelWithoutKey.provider.apiKey) {
                throw new Error(
                    `No API key configured for provider: ${modelWithoutKey.provider.name}. ` +
                    `Please add an API key in Settings > LLM for the provider "${modelWithoutKey.provider.name}".`
                );
            }
            if (!modelWithoutKey.provider.apiKey.active) {
                throw new Error(
                    `API key is inactive for provider: ${modelWithoutKey.provider.name}. ` +
                    `Please activate the API key in Settings > LLM.`
                );
            }
            if (!modelWithoutKey.provider.apiKey.apiKey || modelWithoutKey.provider.apiKey.apiKey.trim() === '') {
                throw new Error(
                    `API key is empty for provider: ${modelWithoutKey.provider.name}. ` +
                    `Please configure a valid API key in Settings > LLM.`
                );
            }
        }

        throw new Error(
            `No active model found for capability: ${capability}. ` +
            `Please configure a model with a valid API key in Settings > LLM.`
        );
    }

    // Final validation
    if (!model.provider.apiKey) {
        throw new Error(
            `No API key configured for provider: ${model.provider.name}. ` +
            `Please add an API key in Settings > LLM.`
        );
    }

    if (!model.provider.apiKey.active) {
        throw new Error(
            `API key is inactive for provider: ${model.provider.name}. ` +
            `Please activate the API key in Settings > LLM.`
        );
    }

    if (!model.provider.apiKey.apiKey || model.provider.apiKey.apiKey.trim() === '') {
        throw new Error(
            `API key is empty for provider: ${model.provider.name}. ` +
            `Please configure a valid API key in Settings > LLM.`
        );
    }

    return {
        modelId: model.modelId,
        provider: {
            apiFormat: model.provider.apiFormat,
            baseUrl: model.provider.baseUrl,
            apiKey: model.provider.apiKey.apiKey.trim()
        }
    };
}

export default { testModelConnection, callLLM, getActiveModel };
