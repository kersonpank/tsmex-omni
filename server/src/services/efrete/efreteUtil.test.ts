import assert from 'node:assert/strict';
import { it } from 'node:test';
import { splitPhone } from './efreteUtil.js';

it('reutiliza o mesmo telefone com DDD e com prefixo brasileiro no payload CIOT', () => {
    for (const value of ['11999999999', '(11) 99999-9999', '+55 (11) 99999-9999']) assert.deepEqual(splitPhone(value), { ddd: 11, numero: 999999999 });
    for (const value of ['', '999999999', '00199999999', '111111111111111']) assert.equal(splitPhone(value), undefined);
});
