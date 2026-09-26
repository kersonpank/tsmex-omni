// components/manifest/vehicleUnitDraft.ts
// Rascunho de uma Unidade de Veículo no formulário de composição. Espelho de UX das regras do servidor
// (server/src/services/vehicleUnitRules.ts) — o servidor continua sendo a autoridade.
import type { Link, Manifest, VehicleUnit, VehicleUnitRole } from '../../types/index';
import type { VehicleUnitInput } from '../../lib/api';

export interface UnitDraft {
  /** Preenchido quando o rascunho veio de uma unidade já cadastrada (busca por placa). */
  unitId?: string;
  role: VehicleUnitRole;
  plate: string;
  chassi: string;
  renavam: string;
  axles: string;
  tareKg: string;
  capacityKg: string;
  capacityM3: string;
  rntrc: string;
  bodyType: string;
  wheelType: string;
  year: string;
  ownerDocument: string;
  ownerName: string;
  /** Responsável RNTRC: o proprietário do CRLV (padrão) ou outra pessoa (frota agregada). `rntrc` é o número DELE. */
  rntrcHolderMode: 'OWNER' | 'OTHER';
  rntrcHolderDocument: string;
  rntrcHolderName: string;
  mdfeOwnerType: string;
  licensedState: string;
  ownerState: string;
}

export const MAX_TRAILERS = 3;

export const normalizePlate = (value: string | null | undefined) => (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

export const emptyDraft = (role: VehicleUnitRole): UnitDraft => ({
  role,
  plate: '',
  chassi: '',
  renavam: '',
  axles: '',
  tareKg: '',
  capacityKg: '',
  capacityM3: '',
  rntrc: '',
  // Carroceria/rodado por papel: reboque não tem rodado próprio (corrige o "Carreta Baú" com rodado "Cavalo").
  bodyType: 'NaoAplicavel',
  wheelType: role === 'TRACTION' ? 'Cavalo' : 'NaoAplicavel',
  year: '',
  ownerDocument: '',
  ownerName: '',
  rntrcHolderMode: 'OWNER',
  rntrcHolderDocument: '',
  rntrcHolderName: '',
  mdfeOwnerType: '',
  licensedState: '',
  ownerState: '',
});

export function draftFromUnit(unit: VehicleUnit): UnitDraft {
  const holder = unit.rntrcHolderPerson ?? null;
  const holderIsOther = Boolean(unit.rntrcHolderPersonId && unit.rntrcHolderPersonId !== unit.ownerPersonId);
  return {
    unitId: unit.id,
    role: unit.role,
    plate: unit.plate,
    chassi: unit.chassi ?? '',
    renavam: unit.renavam ?? '',
    axles: unit.axles ? String(unit.axles) : '',
    tareKg: unit.tareKg ? String(unit.tareKg) : '',
    capacityKg: unit.capacityKg ? String(unit.capacityKg) : '',
    capacityM3: unit.capacityM3 != null ? String(unit.capacityM3) : '',
    // RNTRC efetivo = o da pessoa responsável; a coluna da unidade é legado.
    rntrc: (unit.rntrcHolderPerson !== undefined ? holder?.rntrc : unit.rntrc) ?? '',
    bodyType: unit.bodyType ?? 'NaoAplicavel',
    wheelType: unit.wheelType ?? (unit.role === 'TRACTION' ? 'Cavalo' : 'NaoAplicavel'),
    year: unit.year ? String(unit.year) : '',
    ownerDocument: unit.ownerDocument ?? unit.ownerPerson?.document ?? '',
    ownerName: unit.ownerName ?? unit.ownerPerson?.legalName ?? '',
    rntrcHolderMode: holderIsOther ? 'OTHER' : 'OWNER',
    rntrcHolderDocument: holderIsOther ? holder?.document ?? '' : '',
    rntrcHolderName: holderIsOther ? holder?.legalName ?? '' : '',
    mdfeOwnerType: unit.mdfeOwnerType ?? '',
    licensedState: unit.licensedState ?? '',
    ownerState: unit.ownerState ?? '',
  };
}

/** Rascunhos do cavalo e dos reboques a partir do Link (unidades; colunas legadas como fallback). */
export function draftsFromLink(link: Link | null | undefined): { traction: UnitDraft; trailers: UnitDraft[] } {
  if (!link) return { traction: emptyDraft('TRACTION'), trailers: [] };

  const traction = link.tractionUnit
    ? draftFromUnit(link.tractionUnit)
    : {
        ...emptyDraft('TRACTION'),
        plate: normalizePlate(link.vehiclePlate) && normalizePlate(link.vehiclePlate).length === 7 ? normalizePlate(link.vehiclePlate) : '',
        chassi: link.vehicleChassi ?? '',
        renavam: link.vehicleRenavam ?? '',
        axles: link.vehicleAxles ? String(link.vehicleAxles) : '',
        rntrc: link.rntrc ?? '',
        bodyType: link.vehicleBodyType ?? 'NaoAplicavel',
        wheelType: link.vehicleWheelType ?? 'Cavalo',
        year: link.vehicleYear ? String(link.vehicleYear) : '',
        ownerDocument: link.vehicleOwnerDocument ?? '',
        ownerName: link.vehicleOwnerName ?? '',
        rntrcHolderMode: 'OWNER' as const,
        rntrcHolderDocument: '',
        rntrcHolderName: '',
        mdfeOwnerType: '',
        licensedState: '',
        ownerState: '',
      };

  const slots: Array<[VehicleUnit | null | undefined, string | null | undefined]> = [
    [link.trailer1Unit, link.trailerPlate],
    [link.trailer2Unit, link.trailer2Plate],
    [link.trailer3Unit, link.trailer3Plate],
  ];
  const trailers = slots
    .map(([unit, legacyPlate]) => (unit ? draftFromUnit(unit) : normalizePlate(legacyPlate) ? { ...emptyDraft('TRAILER'), plate: normalizePlate(legacyPlate) } : null))
    .filter((draft): draft is UnitDraft => draft !== null);

  return { traction, trailers };
}

export function draftsFromManifest(manifest: Manifest): { traction: UnitDraft; trailers: UnitDraft[] } {
  const assignments = manifest.vehicleAssignments ?? [];
  if (!assignments.length) return { traction: emptyDraft('TRACTION'), trailers: [] };
  const traction = assignments.find((item) => item.slot === 0)?.vehicleUnit;
  return {
    traction: traction ? draftFromUnit(traction) : emptyDraft('TRACTION'),
    trailers: assignments.filter((item) => item.slot > 0).sort((a, b) => a.slot - b.slot).map((item) => draftFromUnit(item.vehicleUnit)),
  };
}

export type DraftField = 'plate' | 'chassi' | 'renavam' | 'axles' | 'rntrc';
export const DRAFT_FIELD_LABELS: Record<DraftField, string> = {
  plate: 'Placa',
  chassi: 'Chassi',
  renavam: 'RENAVAM',
  axles: 'Eixos',
  rntrc: 'RNTRC do responsável',
};

/** Campos que ainda faltam (ou estão com formato inválido) — vazio = unidade pronta para CIOT/MDF-e. */
export function draftIssues(draft: UnitDraft): Array<{ field: DraftField; reason: 'missing' | 'invalid' }> {
  const issues: Array<{ field: DraftField; reason: 'missing' | 'invalid' }> = [];
  const plate = normalizePlate(draft.plate);
  if (!plate) issues.push({ field: 'plate', reason: 'missing' });
  else if (plate.length !== 7) issues.push({ field: 'plate', reason: 'invalid' });

  const chassi = normalizePlate(draft.chassi);
  if (!chassi) issues.push({ field: 'chassi', reason: 'missing' });
  else if (chassi.length !== 17) issues.push({ field: 'chassi', reason: 'invalid' });

  const renavam = digits(draft.renavam);
  if (!renavam) issues.push({ field: 'renavam', reason: 'missing' });
  else if (renavam.length < 9 || renavam.length > 11) issues.push({ field: 'renavam', reason: 'invalid' });

  if (!draft.axles.trim()) issues.push({ field: 'axles', reason: 'missing' });
  else if (!Number.isInteger(Number(draft.axles)) || Number(draft.axles) < 1) issues.push({ field: 'axles', reason: 'invalid' });

  const rntrc = digits(draft.rntrc);
  if (draft.rntrcHolderMode === 'OTHER' && ![11, 14].includes(digits(draft.rntrcHolderDocument).length)) issues.push({ field: 'rntrc', reason: 'invalid' });
  else if (!rntrc) issues.push({ field: 'rntrc', reason: 'missing' });
  else if (rntrc.length < 8 || rntrc.length > 9) issues.push({ field: 'rntrc', reason: 'invalid' });

  return issues;
}

export const describeIssues = (issues: ReturnType<typeof draftIssues>) =>
  issues.map((i) => (i.reason === 'invalid' ? `${DRAFT_FIELD_LABELS[i.field]} inválido` : DRAFT_FIELD_LABELS[i.field])).join(', ');

/** Payload da API. Campos vazios viram null (limpa) — o servidor só ignora o que não é enviado. */
export function draftToInput(draft: UnitDraft): VehicleUnitInput {
  return {
    plate: normalizePlate(draft.plate),
    chassi: normalizePlate(draft.chassi) || null,
    renavam: digits(draft.renavam) || null,
    axles: draft.axles.trim() ? Number(draft.axles) : null,
    tareKg: draft.tareKg.trim() ? Number(draft.tareKg) : null,
    capacityKg: draft.capacityKg.trim() ? Number(draft.capacityKg) : null,
    capacityM3: draft.capacityM3.trim() ? Number(draft.capacityM3) : null,
    rntrc: digits(draft.rntrc) || null,
    bodyType: draft.bodyType || null,
    wheelType: draft.wheelType || null,
    year: draft.year.trim() ? Number(draft.year) : null,
    ownerDocument: digits(draft.ownerDocument) || null,
    ownerName: draft.ownerName.trim() || null,
    // Sem proprietário informado, o servidor usa o transportador como responsável padrão.
    ...(draft.rntrcHolderMode === 'OTHER'
      ? { rntrcHolderDocument: digits(draft.rntrcHolderDocument) || null, rntrcHolderName: draft.rntrcHolderName.trim() || null }
      : digits(draft.ownerDocument) ? { rntrcHolderSameAsOwner: true } : {}),
    mdfeOwnerType: (draft.mdfeOwnerType || null) as VehicleUnitInput['mdfeOwnerType'],
    licensedState: draft.licensedState.trim().toUpperCase() || null,
    ownerState: draft.ownerState.trim().toUpperCase() || null,
  };
}

/** Pendências da composição inteira do formulário (cavalo + reboques), na ordem de exibição. */
export function compositionDraftIssues(traction: UnitDraft, trailers: UnitDraft[]) {
  const all = [traction, ...trailers].map((draft, index) => ({
    label: index === 0 ? 'Cavalo' : `Reboque ${index}`,
    plate: normalizePlate(draft.plate),
    issues: draftIssues(draft),
  }));
  return all.filter((entry) => entry.issues.length > 0);
}

/** Composição do Link para exibição: cada placa com as pendências reais da unidade. */
export function linkCompositionSummary(link: Link | null | undefined) {
  const { traction, trailers } = draftsFromLink(link);
  return [traction, ...trailers]
    .filter((draft) => normalizePlate(draft.plate))
    .map((draft) => ({ role: draft.role, plate: normalizePlate(draft.plate), issues: draftIssues(draft) }));
}

export function manifestCompositionSummary(manifest: Manifest) {
  const { traction, trailers } = draftsFromManifest(manifest);
  return [traction, ...trailers].filter((draft) => normalizePlate(draft.plate))
    .map((draft) => ({ role: draft.role, plate: normalizePlate(draft.plate), issues: draftIssues(draft) }));
}

/** Novo reboque nasce com o responsável RNTRC do cavalo (mesmo transportador, na maioria dos casos). Editável. */
export function newTrailerDraft(traction: UnitDraft): UnitDraft {
  return {
    ...emptyDraft('TRAILER'),
    rntrc: traction.rntrc,
    rntrcHolderMode: traction.rntrcHolderMode,
    rntrcHolderDocument: traction.rntrcHolderDocument,
    rntrcHolderName: traction.rntrcHolderName,
  };
}
