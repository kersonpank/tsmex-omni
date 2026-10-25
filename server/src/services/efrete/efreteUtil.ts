export function digits(s: string | null | undefined): string {
    return (s ?? '').replace(/\D/g, '');
}

export function normalizeEfreteAddressNumber(value: string | null | undefined): string {
    // v8.2, glossário de erros: somente números; imóvel sem numeração deve usar 0, nunca S/N.
    return digits(value) || '0';
}

export function normalizeEfreteCep(value: string | null | undefined, label = 'Endereço'): string {
    const cep = digits(value);
    if (cep.length !== 8) throw new Error(`${label}: informe um CEP válido com 8 dígitos para a eFrete.`);
    return cep;
}

export function splitPhone(phone: string | null | undefined): { ddd: number; numero: number } | undefined {
    const d = digits(phone);
    if (d.length < 10) return undefined;
    return { ddd: Number(d.slice(0, 2)), numero: Number(d.slice(2)) };
}
