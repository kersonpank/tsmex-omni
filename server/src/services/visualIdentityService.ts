import type { VisualIdentity } from '@prisma/client';
import prisma from '../lib/prisma.js';

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
  return toBrandingPublic(row);
}
