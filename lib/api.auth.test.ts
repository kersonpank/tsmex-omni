import { expect, it } from 'vitest';
import api from './api';

it('401 em convite público preserva sessão e retorna o erro para a página', async () => {
  localStorage.setItem('token', 'existing-session');
  localStorage.setItem('user', 'existing-user');
  const handler = (api.interceptors.response as any).handlers.at(-1).rejected;
  const error = { response: { status: 401 }, config: { url: '/auth/claim-link' } };
  await expect(handler(error)).rejects.toBe(error);
  expect(localStorage.getItem('token')).toBe('existing-session');
  expect(localStorage.getItem('user')).toBe('existing-user');
  localStorage.clear();
});
