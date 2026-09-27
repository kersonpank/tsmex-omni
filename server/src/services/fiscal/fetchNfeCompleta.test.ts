import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { fetchNfeCompleta, type FetchNfeCompletaDeps } from './fetchNfeCompleta.js';
import { AcbrHttpError } from '../acbr/acbrHttp.js';
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
        putAcbrEmpresaDistNfeConfig: mock.fn(async () => ({ ok: true })),
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
        getDistribuicaoCheckpointStatus: mock.fn(async () => ({
            ambiente: 'homologacao' as const,
            ultimoNsu: '10',
            seeded: true,
            nextAllowedAt: null,
        })),
        parseNfeProcXml: mock.fn(() => FAKE_CARGO),
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

        assert.deepEqual(result, { cargo: FAKE_CARGO });
        assert.equal(findFiscalEmitterByHub.mock.callCount(), 0);
    });

    it('sem hubId — não chama ACBr, retorna cargo null', async () => {
        const solicitarEPersistirNsu = mock.fn(async () => ({ data: [], ultimo_nsu: 10 }));
        const deps = makeDeps({ solicitarEPersistirNsu });

        const result = await fetchNfeCompleta(null, CHAVE, deps);

        assert.deepEqual(result, { cargo: null });
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('ACBr não configurado — retorna cargo null', async () => {
        const solicitarEPersistirNsu = mock.fn(async () => ({ data: [], ultimo_nsu: 10 }));
        const deps = makeDeps({ isAcbrCredentialsConfigured: mock.fn(() => false), solicitarEPersistirNsu });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.deepEqual(result, { cargo: null });
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('Hub sem FiscalEmitter — retorna cargo null', async () => {
        const deps = makeDeps({ findFiscalEmitterByHub: mock.fn(async () => null) });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.deepEqual(result, { cargo: null });
    });

    it('emitente com CPF (não CNPJ) — não chama ACBr, retorna cargo null', async () => {
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

        assert.deepEqual(result, { cargo: null });
        assert.equal(solicitarEPersistirNsu.mock.callCount(), 0);
    });

    it('ACBr não retorna nenhum documento (chave desconhecida da SEFAZ) — retorna cargo null', async () => {
        const deps = makeDeps({ solicitarEPersistirNsu: mock.fn(async () => ({ data: [], ultimo_nsu: 10 })) });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.deepEqual(result, { cargo: null });
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

        assert.deepEqual(result, { cargo: FAKE_CARGO });
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

        assert.deepEqual(result, { cargo: FAKE_CARGO });
        assert.equal(manifestarCienciaOperacao.mock.callCount(), 1);
        assert.equal(baixarXmlDocumentoDistribuicao.mock.callCount(), 1);
        assert.equal(markManifested.mock.callCount(), 1);
        assert.equal(markXmlDownloaded.mock.callCount(), 1);
        assert.equal(setDistribuicaoNfeEnabled.mock.callCount(), 1);
    });

    it('documento tipo NFE_PROC (formato real da ACBr, resumo:false) — pula manifestação, baixa XML direto', async () => {
        // Payload real capturado ao vivo (2026-07-28): CNPJ citado só como transportador na NF-e
        // recebeu resumo:false (acesso total já liberado pela SEFAZ) — não deve tentar manifestar.
        const manifestarCienciaOperacao = mock.fn(async () => ({}));
        const baixarXmlDocumentoDistribuicao = mock.fn(async () => '<xml/>');
        const deps = makeDeps({
            solicitarEPersistirNsu: mock.fn(async () => ({
                documentos: [{
                    id: 'nfe_transportador_1',
                    tipo_documento: 'nota',
                    resumo: false,
                    chave_acesso: CHAVE,
                    emitente_cpf_cnpj: '12345678000199',
                }],
            })),
            upsertDiscovered: mock.fn(async () => ({
                id: 'doc-1',
                status: 'DISCOVERED',
                tipo: 'NFE_PROC',
                xmlStorageKey: null,
                resumoRaw: { id: 'nfe_transportador_1' },
            }) as any),
            manifestarCienciaOperacao,
            baixarXmlDocumentoDistribuicao,
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.deepEqual(result, { cargo: FAKE_CARGO });
        assert.equal(manifestarCienciaOperacao.mock.callCount(), 0, 'NFE_PROC não precisa de Ciência da Operação');
        assert.equal(baixarXmlDocumentoDistribuicao.mock.callCount(), 1, 'mesmo pulando manifestação, ainda baixa o XML');
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

    it('erro genérico (não rate-limit) em qualquer chamada ACBr — best-effort, retorna cargo null sem distribuicaoIndisponivel, nunca lança', async () => {
        const deps = makeDeps({
            solicitarEPersistirNsu: mock.fn(async () => {
                throw new Error('ACBr fora do ar');
            }),
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.deepEqual(result, { cargo: null });
    });

    it('rate-limit da SEFAZ (1 consulta/hora) — retorna distribuicaoIndisponivel com nextAllowedAt do checkpoint', async () => {
        const rateLimitErr = new AcbrHttpError(
            'ACBr /distribuicao/nfe HTTP 400: {"error":{"code":"ValidationFailed","message":"...Tente novamente em 57 minuto(s)."}}',
            400,
        );
        const getDistribuicaoCheckpointStatus = mock.fn(async (_cpfCnpj: string, _ambiente: 'homologacao' | 'producao') => ({
            ambiente: 'homologacao' as const,
            ultimoNsu: '10',
            seeded: true,
            nextAllowedAt: '2026-07-28T18:00:00.000Z',
        }));
        const deps = makeDeps({
            solicitarEPersistirNsu: mock.fn(async () => {
                throw rateLimitErr;
            }),
            getDistribuicaoCheckpointStatus,
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.equal(result.cargo, null);
        assert.equal(result.distribuicaoIndisponivel?.motivo, 'rate_limit');
        assert.equal(result.distribuicaoIndisponivel?.nextAllowedAt, '2026-07-28T18:00:00.000Z');
        assert.equal(getDistribuicaoCheckpointStatus.mock.callCount(), 1);
        const [cpfCnpj, ambiente] = getDistribuicaoCheckpointStatus.mock.calls[0].arguments;
        assert.equal(cpfCnpj, '11222333000144');
        assert.equal(ambiente, 'homologacao');
    });

    it('rate-limit da SEFAZ, mas releitura do checkpoint falha — ainda retorna motivo rate_limit sem nextAllowedAt', async () => {
        const rateLimitErr = new AcbrHttpError(
            'ACBr /distribuicao/nfe HTTP 400: {"error":{"message":"...Tente novamente em 10 minuto(s)."}}',
            400,
        );
        const deps = makeDeps({
            solicitarEPersistirNsu: mock.fn(async () => {
                throw rateLimitErr;
            }),
            getDistribuicaoCheckpointStatus: mock.fn(async () => {
                throw new Error('Postgres fora do ar');
            }),
        });

        const result = await fetchNfeCompleta(HUB_ID, CHAVE, deps);

        assert.equal(result.cargo, null);
        assert.equal(result.distribuicaoIndisponivel?.motivo, 'rate_limit');
        assert.equal(result.distribuicaoIndisponivel?.nextAllowedAt, undefined);
    });
});
