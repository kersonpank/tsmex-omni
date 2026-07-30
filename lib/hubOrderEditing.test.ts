import { describe, expect, it } from 'vitest';
import {
  canEditHubOrder,
  hubOrderEditPath,
  isSafeAppPath,
  parseHubOrderEditId,
} from './hubOrderEditing';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

describe('hubOrderEditing', () => {
  it('gera e interpreta o deep link de edição do pedido no Hub', () => {
    const path = hubOrderEditPath(ORDER_ID);
    const search = new URLSearchParams(path.split('?')[1]);

    expect(path).toBe(`/hub?tab=pedidos&mode=edit&orderId=${ORDER_ID}`);
    expect(parseHubOrderEditId(search)).toBe(ORDER_ID);
  });

  it('ignora contexto incompleto ou ID inválido', () => {
    expect(parseHubOrderEditId(new URLSearchParams('tab=pedidos'))).toBeNull();
    expect(parseHubOrderEditId(new URLSearchParams('tab=pedidos&mode=edit&orderId=123'))).toBeNull();
  });

  it('permite edição somente para ADMIN ou HUB com entrada', () => {
    expect(canEditHubOrder({ roles: ['ADMIN'] })).toBe(true);
    expect(canEditHubOrder({ roles: ['HUB'], permissions: ['entrada'] })).toBe(true);
    expect(canEditHubOrder({ roles: ['HUB'], profile: { hub: { permissions: ['pedidos'] } } })).toBe(false);
    expect(canEditHubOrder({ roles: ['CLIENT'] })).toBe(false);
  });

  it('preserva o comportamento legado do HUB sem restrições explícitas', () => {
    expect(canEditHubOrder({ roles: ['HUB'], permissions: [] })).toBe(true);
  });

  it('aceita somente caminhos internos como retorno', () => {
    expect(isSafeAppPath('/hub?tab=pedidos')).toBe(true);
    expect(isSafeAppPath('//example.com/path')).toBe(false);
    expect(isSafeAppPath('https://example.com')).toBe(false);
  });
});
