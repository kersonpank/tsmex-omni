import { describe, expect, it } from 'vitest';
import { getDefaultHomePath, syncRoleForPath } from './postLoginDefaultPath';

describe('getDefaultHomePath', () => {
  it('prioriza ADMIN sobre HUB e CLIENT e abre na Gestão V2', () => {
    expect(getDefaultHomePath(['CLIENT', 'HUB', 'ADMIN'])).toBe('/gestaos');
    expect(getDefaultHomePath(['ADMIN'])).toBe('/gestaos');
  });

  it('envia multi-papel sem admin para hub', () => {
    expect(getDefaultHomePath(['CLIENT', 'HUB'])).toBe('/hub');
  });
});

describe('syncRoleForPath', () => {
  it('retorna HUB para /hub quando usuário tem HUB', () => {
    expect(syncRoleForPath('/hub', ['CLIENT', 'HUB'])).toBe('HUB');
  });

  it('retorna CLIENT para /client', () => {
    expect(syncRoleForPath('/client', ['CLIENT', 'HUB'])).toBe('CLIENT');
  });

  it('retorna null se path não combina com papéis do usuário', () => {
    expect(syncRoleForPath('/gestao', ['CLIENT', 'HUB'])).toBeNull();
  });

  it('reconhece /gestaos como painel ADMIN', () => {
    expect(syncRoleForPath('/gestaos', ['HUB', 'ADMIN'])).toBe('ADMIN');
    expect(syncRoleForPath('/gestaos/viagens', ['ADMIN'])).toBe('ADMIN');
    expect(syncRoleForPath('/gestaos', ['HUB'])).toBeNull();
  });
});
