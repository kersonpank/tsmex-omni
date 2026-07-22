export function digits(s: string | null | undefined): string {
    return (s ?? '').replace(/\D/g, '');
}

export function splitPhone(phone: string | null | undefined): { ddd: number; numero: number } | undefined {
    const d = digits(phone);
    if (d.length < 10) return undefined;
    return { ddd: Number(d.slice(0, 2)), numero: Number(d.slice(2)) };
}
