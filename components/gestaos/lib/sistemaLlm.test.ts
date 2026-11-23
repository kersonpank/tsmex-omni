import { describe, expect, it } from 'vitest';
import { buildModelCreate, buildModelUpdate, buildProviderBody, chatConfigBody, chatReady, describeTest, emptyModelForm, emptyProviderForm, toggleCapability, validateModel, validateProvider, validWeight } from './sistemaLlm';

describe('provedor', () => {
    it('exige nome, código em minúsculas e endereço completo', () => {
        const errors = validateProvider(emptyProviderForm());
        expect(Object.keys(errors).sort()).toEqual(['baseUrl', 'code', 'name']);
        expect(validateProvider({ ...emptyProviderForm(), name: 'X', code: 'Meu Provedor', baseUrl: 'https://a.com/v1' }).code).toBeTruthy();
        expect(validateProvider({ ...emptyProviderForm(), name: 'X', code: 'meu-prov', baseUrl: 'ftp://a.com' }).baseUrl).toBeTruthy();
    });
    it('monta o corpo sem espaços sobrando', () => {
        expect(buildProviderBody({ name: ' Meu ', code: ' meu ', apiFormat: 'gemini', baseUrl: ' https://a.com/v1 ', supportsTools: false })).toEqual({ name: 'Meu', code: 'meu', apiFormat: 'gemini', baseUrl: 'https://a.com/v1', supportsTools: false });
    });
});

describe('modelo', () => {
    const base = { ...emptyModelForm(), providerId: 'p1', name: 'GPT', modelId: 'gpt-x' };
    it('valida campos obrigatórios e numéricos', () => {
        expect(validateModel(base, true)).toEqual({});
        expect(validateModel(emptyModelForm(), true)).toMatchObject({ providerId: expect.any(String), name: expect.any(String), modelId: expect.any(String) });
        expect(validateModel({ ...base, contextWindow: '0' }, true).contextWindow).toBeTruthy();
        expect(validateModel({ ...base, inputPrice: 'abc' }, true).inputPrice).toBeTruthy();
        expect(validateModel({ ...base, capabilities: [] }, true).capabilities).toBeTruthy();
    });
    it('criar leva provedor e identificador; editar não', () => {
        const form = { ...base, inputPrice: '0,5', description: ' d ' };
        expect(buildModelCreate(form)).toMatchObject({ providerId: 'p1', modelId: 'gpt-x', name: 'GPT', description: 'd', inputPrice: 0.5, contextWindow: 128000 });
        const update = buildModelUpdate(form);
        expect(update).not.toHaveProperty('providerId');
        expect(update).not.toHaveProperty('modelId');
    });
    it('alterna capacidade', () => {
        expect(toggleCapability(['chat'], 'vision')).toEqual(['chat', 'vision']);
        expect(toggleCapability(['chat', 'vision'], 'chat')).toEqual(['vision']);
    });
});

describe('teste e chat', () => {
    it('descreve o resultado do teste', () => {
        expect(describeTest({ working: true, latencyMs: 120, response: 'ok' })).toEqual({ ok: true, message: 'Funcionou em 120 ms: “ok”' });
        expect(describeTest({ working: false, error: 'chave inválida' }).message).toContain('chave inválida');
        expect(describeTest(undefined).ok).toBe(false);
    });
    it('só aceita para o chat modelo ativo, com chat e chave no provedor', () => {
        const providers = [{ id: 'p1', name: 'A', code: 'a', apiKey: { keyPreview: '1234', active: true } }, { id: 'p2', name: 'B', code: 'b', apiKey: null }];
        expect(chatReady({ id: 'm', providerId: 'p1', name: 'x', capabilities: ['chat'], isDefault: false, active: true }, providers)).toBe(true);
        expect(chatReady({ id: 'm', providerId: 'p2', name: 'x', capabilities: ['chat'], isDefault: false, active: true }, providers)).toBe(false);
        expect(chatReady({ id: 'm', providerId: 'p1', name: 'x', capabilities: ['tools'], isDefault: false, active: true }, providers)).toBe(false);
    });
    it('peso do rodízio de 1 a 10 e corpo da configuração', () => {
        expect(validWeight(0)).toBe(false);
        expect(validWeight(10)).toBe(true);
        expect(validWeight(11)).toBe(false);
        expect(chatConfigBody('FIXED', 'm1')).toEqual({ selectionMode: 'FIXED', fixedModelId: 'm1', active: true });
        expect(chatConfigBody('ROTATION')).toEqual({ selectionMode: 'ROTATION', active: true });
    });
});
