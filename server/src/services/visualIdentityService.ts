import type { VisualIdentity } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { getObjectDownloadUrl } from '../lib/objectStorage.js';

const LOGO_SIGNED_URL_TTL_SECONDS = 86400; // 24h — suficiente para abrir o preview e imprimir

function shouldDropLegacyLogoUrl(logoUrl: string | null): boolean {
  if (!logoUrl) return true;
  const normalized = logoUrl.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('minio:9000')) return true;
  if (normalized.includes('localhost:9000')) return true;
  if (normalized.startsWith('http://')) return true;
  if (normalized.includes('{') || normalized.includes('}')) return true;
  return false;
}

export async function resolveStoredLogoUrl(logoUrl: string | null, logoStorageKey: string | null): Promise<string | null> {
  const key = logoStorageKey?.trim();
  if (!key) return logoUrl;
  try {
    return await getObjectDownloadUrl(key, LOGO_SIGNED_URL_TTL_SECONDS);
  } catch {
    return shouldDropLegacyLogoUrl(logoUrl) ? null : logoUrl;
  }
}

export const VISUAL_IDENTITY_ID = 'default';

export type BrandingPublic = {
  legalName: string | null;
  tradeName: string | null;
  cnpjDisplay: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  footerNote: string | null;
  logoUrl: string | null;
};

export function toBrandingPublic(row: VisualIdentity): BrandingPublic {
  return {
    legalName: row.legalName,
    tradeName: row.tradeName,
    cnpjDisplay: row.cnpjDisplay,
    phone: row.phone,
    email: row.email,
    addressLine: row.addressLine,
    footerNote: row.footerNote,
    logoUrl: row.logoUrl,
  };
}

export async function getBrandingForDocuments(): Promise<BrandingPublic | null> {
  const row = await prisma.visualIdentity.findUnique({ where: { id: VISUAL_IDENTITY_ID } });
  if (!row) return null;
  const base = toBrandingPublic(row);
  return { ...base, logoUrl: await resolveStoredLogoUrl(base.logoUrl, row.logoStorageKey) };
}

export async function getBrandingForFiscalEmitter(fiscalEmitterId?: string | null): Promise<BrandingPublic | null> {
  if (!fiscalEmitterId) return getBrandingForDocuments();

  const emitter = await prisma.fiscalEmitter.findUnique({
    where: { id: fiscalEmitterId },
    include: { person: true, hub: true },
  });
  if (!emitter) return getBrandingForDocuments();

  const addressLine = [
    emitter.person.address,
    emitter.person.number,
    emitter.person.neighborhood,
    emitter.person.city,
    emitter.person.state,
    emitter.person.cep,
  ].filter(Boolean).join(', ');

  return {
    legalName: emitter.person.legalName,
    tradeName: emitter.tradeName ?? emitter.person.tradeName,
    cnpjDisplay: emitter.person.document,
    phone: emitter.hub?.phone ?? null,
    email: emitter.hub?.email ?? null,
    addressLine: addressLine || null,
    footerNote: emitter.footerNote,
    logoUrl: await resolveStoredLogoUrl(emitter.logoUrl, emitter.logoStorageKey),
  };
}
