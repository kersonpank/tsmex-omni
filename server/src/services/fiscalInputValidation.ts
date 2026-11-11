type FiscalAddress = { neighborhood?: string | null; cep?: string | null; address?: string | null; number?: string | null; city?: string | null; state?: string | null; cityIbgeCode?: string | null };
export function hasCompleteFiscalAddress(p: FiscalAddress | null | undefined) {
    return Boolean(p?.neighborhood?.trim() && /^\d{8}$/.test((p.cep ?? '').replace(/\D/g, '')) && p.address?.trim() && p.number?.trim() && p.city?.trim() && /^[A-Za-z]{2}$/.test(p.state ?? '') && /^\d{7}$/.test(p.cityIbgeCode ?? ''));
}
