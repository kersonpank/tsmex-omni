import { describe, expect, it } from 'vitest';
import { partyFixForRejection } from './partyFix';

describe('atalho de correção de IE', () => {
    it.each([
        ['Código 422: Rejeição: IE do remetente não vinculada ao CNPJ', 'remetente'],
        ['Código 427: Rejeição: IE do destinatário não vinculada ao CNPJ [Motivo: 2.1.1. IE não cadastrada no CCC]', 'destinatario'],
        ['IE do destinatario inválida', 'destinatario'],
        ['IE do tomador não cadastrada', 'tomador'],
        ['IE do expedidor inválida', 'expedidor'],
        ['IE do recebedor não vinculada', 'recebedor'],
        ['IE DO REMETENTE inválida', 'remetente'],
        ['IE inválida', null], ['CFOP inválido', null], ['', null], [null, null],
    ])('%s → %s', (reason, role) => expect(partyFixForRejection(reason)).toBe(role));
});
