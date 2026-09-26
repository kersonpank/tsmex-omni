import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { interpretMdfeStatus, xmlConfirmsMdfeAuthorization } from './acbrMdfeEmit.js';

const key = '1'.repeat(44);
const protocol = '123456789012345';

describe('evidência de autorização MDF-e', () => {
    it('status textual ou chave isolada permanece em processamento', () => {
        assert.equal(interpretMdfeStatus({ status: 'autorizado', chave: key }).state, 'processing');
        assert.equal(interpretMdfeStatus({ chave: key, autorizacao: { numero_protocolo: protocol } }).state, 'processing');
    });

    it('exige chave, protocolo e XML do mesmo documento com cStat 100', () => {
        const status = interpretMdfeStatus({ status: 'autorizado', chave: key, protocolo: protocol });
        assert.equal(status.state, 'authorized');
        const xml = `<mdfeProc><protMDFe><infProt><chMDFe>${key}</chMDFe><nProt>${protocol}</nProt><cStat>100</cStat></infProt></protMDFe></mdfeProc>`;
        assert.equal(xmlConfirmsMdfeAuthorization(xml, key, protocol), true);
        assert.equal(xmlConfirmsMdfeAuthorization(xml, '2'.repeat(44), protocol), false);
        assert.equal(xmlConfirmsMdfeAuthorization(xml, key, '1'), false);
        assert.equal(xmlConfirmsMdfeAuthorization(xml.replace('<cStat>100</cStat>', '<cStat>204</cStat>'), key, protocol), false);
    });
});
