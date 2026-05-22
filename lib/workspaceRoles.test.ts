import { describe, expect, it } from 'vitest';
import {
  getMatchingRolesForRoute,
  getWorkspacesForRoles,
  getWorkspacePath,
  resolveReturnToForRole,
  sanitizeReturnTo,
} from './workspaceRoles';

describe('getWorkspacesForRoles', () => {
  it('retorna workspaces na ordem ADMIN, HUB, LINK, CLIENT', () => {
    const list = getWorkspacesForRoles(['CLIENT', 'HUB', 'ADMIN']);
    expect(list.map((w) => w.role)).toEqual(['ADMIN', 'HUB', 'CLIENT']);
  });

  it('ignora papéis desconhecidos', () => {
    const list = getWorkspacesForRoles(['CLIENT']);
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe('/client');
  });
});

describe('getWorkspacePath', () => {
  it('mapeia cada papel ao path correto', () => {
    expect(getWorkspacePath('HUB')).toBe('/hub');
    expect(getWorkspacePath('CLIENT')).toBe('/client');
  });
});

describe('getMatchingRolesForRoute', () => {
  it('intersecta papéis do usuário com allowedRoles', () => {
    expect(getMatchingRolesForRoute(['CLIENT', 'HUB'], ['HUB'])).toEqual(['HUB']);
  });

  it('sem allowedRoles retorna todos os papéis do usuário', () => {
    expect(getMatchingRolesForRoute(['CLIENT', 'HUB'], undefined)).toEqual(['CLIENT', 'HUB']);
  });
});

describe('sanitizeReturnTo', () => {
  it('aceita path interno', () => {
    expect(sanitizeReturnTo('/hub/fila', '/client')).toBe('/hub/fila');
  });

  it('rejeita URL externa e usa fallback', () => {
    expect(sanitizeReturnTo('//evil.com', '/client')).toBe('/client');
    expect(sanitizeReturnTo('', '/client')).toBe('/client');
  });
});

describe('resolveReturnToForRole', () => {
  it('mantém returnTo quando compatível com o papel', () => {
    expect(resolveReturnToForRole('/hub', 'HUB')).toBe('/hub');
    expect(resolveReturnToForRole('/client', 'CLIENT')).toBe('/client');
  });

  it('usa home do papel quando returnTo é de outro painel', () => {
    expect(resolveReturnToForRole('/hub', 'CLIENT')).toBe('/client');
    expect(resolveReturnToForRole('/client', 'HUB')).toBe('/hub');
  });
});
