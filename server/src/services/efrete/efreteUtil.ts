export function digits(s: string | null | undefined): string {
    return (s ?? '').replace(/\D/g, '');
}

export function splitPhone(phone: string | null | undefined): { ddd: number; numero: number } | undefined {
    let d = digits(phone);
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (!/^\d{10,11}$/.test(d) || Number(d.slice(0, 2)) < 11) return undefined;
    return { ddd: Number(d.slice(0, 2)), numero: Number(d.slice(2)) };
}
