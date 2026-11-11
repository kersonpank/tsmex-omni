import { expect, it } from 'vitest';
import { manifestStatusLabel } from './manifestStatusUi';

it('distingue liberação operacional de aceite e preserva viagens antigas', () => {
  expect(manifestStatusLabel({ status: 'ACCEPTED', releaseSource: 'OPERATOR' })).toBe('Liberada pela operação');
  expect(manifestStatusLabel({ status: 'ACCEPTED', releaseSource: 'LINK' })).toBe('Aceito');
  expect(manifestStatusLabel({ status: 'ACCEPTED' })).toBe('Aceito');
  expect(manifestStatusLabel({ status: 'IN_PROGRESS', releaseSource: 'OPERATOR' })).toBe('Em andamento');
});
