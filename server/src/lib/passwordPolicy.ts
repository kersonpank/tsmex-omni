import { z } from 'zod';

/** Tamanho mínimo de senha nova (contas operam CT-e, faturas e dados pessoais). */
export const PASSWORD_MIN_LENGTH = 10;

// Sequências e senhas óbvias que passam no tamanho mas caem em qualquer lista de ataque.
const OBVIOUS = new Set([
    '1234567890', '0123456789', '12345678910', 'qwertyuiop', 'senha12345', 'password12',
    'transmesquita', 'tsmex12345', 'mudar12345', 'admin12345',
]);

function isTrivial(password: string): boolean {
    const lower = password.toLowerCase();
    if (OBVIOUS.has(lower)) return true;
    if (/^(.)\1+$/.test(password)) return true; // aaaaaaaaaa
    return false;
}

/**
 * Regra única de senha NOVA (cadastro, convite, troca, reset). Login continua aceitando qualquer
 * senha já cadastrada — a regra vale para o que é criado daqui em diante.
 */
export const newPasswordSchema = z
    .string()
    .min(PASSWORD_MIN_LENGTH, `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
    .max(128, 'A senha pode ter no máximo 128 caracteres.')
    .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'A senha precisa ter letras e números.')
    .refine((p) => !isTrivial(p), 'Essa senha é fácil demais de adivinhar. Escolha outra.');
