import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { fetchNfeCompleta, type FetchNfeCompletaDeps } from './fetchNfeCompleta.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

const HUB_ID = '550e8400-e29b-41d4-a716-446655440020';
const CHAVE = '35260512345678000190550010000000012345678901';

const FAKE_CARGO: ParsedNfeCargo = {
    chave: CHAVE,
    emitente: { cnpj: '12345678000199', razaoSocial: 'Emitente Fake', ie: '110042490114' },
    destinatario: { cnpj: '98765432000188', razaoSocial: 'Destinatario Fake', ie: '206283703315' },
    produtos: [],
    valorTotalNota: 100,
};

function makeDeps(overrides: Partial<FetchNfeCompletaDeps> = {}): FetchNfeCompletaDeps {
    return {
        findCargoDataForChave: mock.fn(async () => undefined),
        isAcbrCredentialsConfigured: mock.fn(() => true),
        findFiscalEmitterByHub: mock.fn(async () => ({
            id: 'emitter-1',
            environment: 'HOMOLOGACAO',
            distribuicaoNfeEnabled: true,
            person: { document: '11222333000144' },
        })),
        setDistribuicaoNfeEnabled: mock.fn(async () => {}),
        solicitarEPersistirNsu: mock.fn(async () => ({ data: [], ultimo_nsu: 10 })),
        manifestarCienciaOperacao: mock.fn(async () => ({})),
        baixarXmlDocumentoDistribuicao: mock.fn(async () => '<xml/>'),
        uploadBase64Object: mock.fn(async () => ({ storageKey: 'key-1' }) as any),
        upsertDiscovered: mock.fn(async () => ({
            id: 'doc-1',
            status: 'DISCOVERED',
            tipo: 'NFE_PROC',
            xmlStorageKey: null,
            resumoRaw: { id: 'acbr-doc-id-1' },
        }) as any),
        markManifested: mock.fn(async () => true),
        markXmlDownloaded: mock.fn(async () => true),
        getCargoDataFromDistribuicaoDocument: mock.fn(async () => FAKE_CARGO),
        ...overrides,
    };
}

describe('fetchNfeCompleta', () => {
    it('cache local (findCargoDataForChave) — retorna direto, nunca chama ACBr', async () => {
        const findFiscalEmitterByHub = mock.fn(async () => null);
        const deps = makeDeps({
            findCargoDataForChave: mock.fn(async () => FAKE_CARGO),
            findFiscalEmitterByHub,
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.deepEqual(result, FAKE_CARGO);
        assert.equal(findFiscalEmitterByHub.mock.callCount(), 0);
    });

    it('sem hubId — não chama ACBr, retorna null', async () => {
        const solicitarEPersistirNsu = mock.fn(async () => ({ data: [], ultimo_nsu: 10 }));
        const deps = makeDeps({ solicitarEPersistirNsu });

        const result = await fetchNfeCompleta(null, CHAVE, deps);

        assert.equal(result, null);
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('ACBr não configurado — retorna null', async () => {
        const solicitarEPersistirNsu = mock.fn(async () => ({ data: [], ultimo_nsu: 10 }));
        const deps = makeDeps({ isAcbrCredentialsConfigured: mock.fn(() => false), solicitarEPersistirNsu });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.equal(result, null);
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('Hub sem FiscalEmitter — retorna null', async () => {
        const deps = makeDeps({ findFiscalEmitterByHub: mock.fn(async () => null) });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.equal(result, null);
    });

    it('emitente com CPF (não CNPJ) — não chama ACBr, retorna null', async () => {
        const solicitarEPersistirNsu = mock.fn(async () => ({ data: [], ultimo_nsu: 10 }));
        const deps = makeDeps({
            findFiscalEmitterByHub: mock.fn(async () => ({
                id: 'e1',
                environment: 'HOMOLOGACAO',
                distribuicaoNfeEnabled: true,
                person: { document: '12345678901' },
            })),
            solicitarEPersistirNsu,
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.equal(result, null);
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('ACBr não retorna nenhum documento (chave desconhecida da SEFAZ) — retorna null', async () => {
        const deps = makeDeps({ solicitarEPersistirNsu: mock.fn(async () => ({ data: [], ultimo_nsu: 10 })) });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.equal(result, null);
    });

    it('documento já tinha XML baixado (upsertDiscovered idempotente) — pula manifestar/baixar', async () => {
        const manifestarCienciaOperacao = mock.fn(async () => ({}));
        const baixarXmlDocumentoDistribuicao = mock.fn(async () => '<xml/>');
        const deps = makeDeps({
            solicitarEPersistirNsu: mock.fn(async () => ({
                data: [{ nfeProc: { NFe: { infNFe: { Id: `NFe${CHAVE}`, emit: { CNPJ: '12345678000199' } } } } }],
                ultimo_nsu: 10,
            })),
            upsertDiscovered: mock.fn(async () => ({
                id: 'doc-1',
                status: 'READY_FOR_TRIAGE',
                tipo: 'NFE_PROC',
                xmlStorageKey: 'already-there.xml',
                resumoRaw: {},
            }) as any),
            manifestarCienciaOperacao,
            baixarXmlDocumentoDistribuicao,
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.deepEqual(result, FAKE_CARGO);
        assert.equal(manifestarCienciaOperacao.mock.callCount(), 0);
        assert.equal(baixarXmlDocumentoDistribuicao.mock.callCount(), 0);
    });

    it('documento novo (DISCOVERED) — manifesta, baixa XML, persiste e liga distribuicaoNfeEnabled', async () => {
        const manifestarCienciaOperacao = mock.fn(async () => ({}));
        const baixarXmlDocumentoDistribuicao = mock.fn(async () => '<xml/>');
        const markManifested = mock.fn(async () => true);
        const markXmlDownloaded = mock.fn(async () => true);
        const setDistribuicaoNfeEnabled = mock.fn(async () => {});
        const deps = makeDeps({
            findFiscalEmitterByHub: mock.fn(async () => ({
                id: 'emitter-1',
                environment: 'HOMOLOGACAO',
                distribuicaoNfeEnabled: false,
                person: { document: '11222333000144' },
            })),
            solicitarEPersistirNsu: mock.fn(async () => ({
                data: [{ resNFe: { chNFe: CHAVE, CNPJ: '12345678000199' } }],
                ultimo_nsu: 10,
            })),
            manifestarCienciaOperacao,
            baixarXmlDocumentoDistribuicao,
            markManifested,
            markXmlDownloaded,
            setDistribuicaoNfeEnabled,
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.deepEqual(result, FAKE_CARGO);
        assert.equal(manifestarCienciaOperacao.mock.callCount(), 1);
        assert.equal(baixarXmlDocumentoDistribuicao.mock.callCount(), 1);
        assert.equal(markManifested.mock.callCount(), 1);
        assert.equal(markXmlDownloaded.mock.callCount(), 1);
        assert.equal(setDistribuicaoNfeEnabled.mock.callCount(), 1);
    });

    it('distribuicaoNfeEnabled já true — não tenta ligar de novo', async () => {
        const setDistribuicaoNfeEnabled = mock.fn(async () => {});
        const deps = makeDeps({
            solicitarEPersistirNsu: mock.fn(async () => ({
                data: [{ resNFe: { chNFe: CHAVE, CNPJ: '12345678000199' } }],
                ultimo_nsu: 10,
            })),
            setDistribuicaoNfeEnabled,
        });

        await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.equal(setDistribuicaoNfeEnabled.mock.callCount(), 0);
    });

    it('erro em qualquer chamada ACBr — best-effort, retorna null, nunca lança', async () => {
        const deps = makeDeps({
            solicitarEPersistirNsu: mock.fn(async () => {
                throw new Error('ACBr fora do ar');
            }),
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.equal(result, null);
    });
});
