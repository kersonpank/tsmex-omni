export const documentDigits = (value: string) => value.replace(/\D/g, '');

export function isValidCpf(value: string): boolean {
    const digits = documentDigits(value);
    if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
    for (const size of [9, 10]) {
        const sum = [...digits.slice(0, size)].reduce((total, digit, index) => total + Number(digit) * (size + 1 - index), 0);
        const check = (sum * 10) % 11;
        if (Number(digits[size]) !== (check === 10 ? 0 : check)) return false;
    }
    return true;
}

export function isValidCnpj(value: string): boolean {
    const digits = documentDigits(value);
    if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
    for (const weights of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
        const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
        const remainder = sum % 11;
        const check = remainder < 2 ? 0 : 11 - remainder;
        if (Number(digits[weights.length]) !== check) return false;
    }
    return true;
}

export function isValidCpfCnpj(value: string): boolean {
    const digits = documentDigits(value);
    return digits.length === 11 ? isValidCpf(digits) : digits.length === 14 && isValidCnpj(digits);
}
