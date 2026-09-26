// components/manifest/TripResponsiblePanel.tsx
import React from 'react';
import StatusBadge from '../ui/StatusBadge';
import type { Manifest, Link, Driver, ManifestReadiness, ManifestReadinessIssue } from '../../types/index';
import { describeIssues, manifestCompositionSummary } from './vehicleUnitDraft';

const ISSUE_CTA_LABEL: Record<string, string> = {
  VEHICLE_PLATE_PENDING: 'Completar veículo',
  VEHICLE_CHASSI_PENDING: 'Completar veículo',
  VEHICLE_AXLES_PENDING: 'Completar veículo',
  VEHICLE_RNTRC_PENDING: 'Completar veículo',
  VEHICLE_RENAVAM_PENDING: 'Completar veículo',
  TRAILER_UNIT_PENDING: 'Completar reboque',
  LINK_PERSON_ADDRESS_PENDING: 'Completar endereço do proprietário',
  DRIVER_REQUIRED: 'Cadastrar motorista',
  DRIVER_CNH_PENDING: 'Completar motorista',
  DRIVER_BIRTH_DATE_PENDING: 'Completar motorista',
  DRIVER_ADDRESS_PENDING: 'Completar motorista',
};

const PendingIssuesList: React.FC<{
  issues: ManifestReadinessIssue[];
  onOpenVehicleSheet: () => void;
  onOpenDriverFiscalSheet: () => void;
  onOpenOwnerPersonSheet: () => void;
}> = ({ issues, onOpenVehicleSheet, onOpenDriverFiscalSheet, onOpenOwnerPersonSheet }) => {
  const blocking = issues.filter((item) => item.severity === 'blocking');
  if (!blocking.length) return null;

  const resolve = (code: string) => {
    if (code === 'LINK_PERSON_ADDRESS_PENDING') return onOpenOwnerPersonSheet;
    if (code.startsWith('VEHICLE_') || code === 'TRAILER_UNIT_PENDING') return onOpenVehicleSheet;
    return onOpenDriverFiscalSheet;
  };

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30">
      <div className="flex items-start gap-2 border-b border-amber-200 px-4 py-3 dark:border-amber-800">
        <span className="text-base">⚠️</span>
        <div>
          <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
            {blocking.length === 1 ? '1 pendência bloqueia o avanço' : `${blocking.length} pendências bloqueiam o avanço`}
          </p>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
            Resolva cada item abaixo. São exigências reais do CIOT/MDF-e — sem elas a oferta da viagem não pode ser enviada.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-amber-200 dark:divide-amber-800">
        {blocking.map((item) => (
          <li key={`${item.code}:${item.field ?? ''}`} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-amber-900 dark:text-amber-100">{item.message}</span>
            <button
              type="button"
              onClick={resolve(item.code)}
              className="admin-focus min-h-9 shrink-0 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"
            >
              {ISSUE_CTA_LABEL[item.code] ?? 'Resolver'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const JourneySection: React.FC<{ eyebrow: string; title: string; description?: string; children: React.ReactNode }> = ({
  eyebrow,
  title,
  description,
  children,
}) => (
  <section>
    <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-600">{eyebrow}</p>
    <h1 className="mt-2 text-2xl font-bold tracking-tight text-tower-950 dark:text-tower-50">{title}</h1>
    {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-tower-600 dark:text-tower-300">{description}</p>}
    <div className="mt-7">{children}</div>
  </section>
);

interface Props {
  manifest: Manifest;
  readiness: ManifestReadiness | null;
  canEditPlanning: boolean;
  showAssignForm: boolean;
  setShowAssignForm: (v: boolean) => void;
  showDriverForm: boolean;
  setShowDriverForm: (v: boolean) => void;
  responsibleSearch: string;
  setResponsibleSearch: (v: string) => void;
  driverSearch: string;
  setDriverSearch: (v: string) => void;
  vehicleSearch: string;
  setVehicleSearch: (v: string) => void;
  filteredResponsibleLinks: Link[];
  filteredDrivers: Driver[];
  vehicleMatches: Link[];
  assignLinkId: string;
  setAssignLinkId: (v: string) => void;
  /** Callback to select a responsible link by id */
  onAssignLink: (linkId: string) => void;
  /** Callback to open the driver search panel (fetches drivers) */
  onOpenDriverSearch: () => void;
  /** Callback to directly select an existing driver (sets responsible + driver) */
  onSelectDriver: (driver: Driver) => void;
  /** Callback to open the driver fiscal sheet (create or edit) */
  onOpenDriverFiscalSheet: (driver?: Driver | null) => void;
  /** Callback to open the vehicle fiscal sheet */
  onOpenVehicleSheet: (link?: Link) => void;
  /** Callback to open the owner (Link) address/IE sheet */
  onOpenOwnerPersonSheet: () => void;
  /** Callback to open the "cadastrar novo motorista" quick-create modal */
  onOpenLinkQuickCreate: () => void;
  fieldClass: string;
}

const TripResponsiblePanel: React.FC<Props> = ({
  manifest,
  readiness,
  canEditPlanning,
  showAssignForm,
  setShowAssignForm,
  showDriverForm,
  setShowDriverForm,
  responsibleSearch,
  setResponsibleSearch,
  driverSearch,
  setDriverSearch,
  vehicleSearch,
  setVehicleSearch,
  filteredResponsibleLinks,
  filteredDrivers,
  vehicleMatches,
  setAssignLinkId,
  onAssignLink,
  onOpenDriverSearch,
  onSelectDriver,
  onOpenDriverFiscalSheet,
  onOpenVehicleSheet,
  onOpenOwnerPersonSheet,
  onOpenLinkQuickCreate,
  fieldClass,
}) => (
  <JourneySection
    eyebrow="Etapa 5"
    title="Responsável, motorista e veículo"
    description="Pesquise os cadastros existentes por nome, documento ou placa. Se não encontrar, cadastre no contexto e volte com a informação já selecionada."
  >
    {manifest.linkId && (
      <PendingIssuesList
        issues={readiness?.steps?.responsible?.issues ?? []}
        onOpenVehicleSheet={() => onOpenVehicleSheet(manifest.link)}
        onOpenDriverFiscalSheet={() => onOpenDriverFiscalSheet(manifest.driver)}
        onOpenOwnerPersonSheet={onOpenOwnerPersonSheet}
      />
    )}

    {/* Summary card */}
    <div className="overflow-hidden rounded-2xl border border-tower-200 dark:border-tower-700">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Responsável no app</p>
            <p className="mt-1 text-base font-bold text-tower-900 dark:text-tower-50">{manifest.link?.name ?? 'Não selecionado'}</p>
            {manifest.link ? (
              <p className="mt-1 text-xs text-tower-500">
                {manifest.link.document} · RNTRC {manifest.link.tractionUnit?.rntrcHolderPerson?.rntrc || manifest.link.rntrc || 'não informado'}
              </p>
            ) : null}
          </div>
          <StatusBadge label={manifest.link ? 'Selecionado' : 'Pendente'} tone={manifest.link ? 'success' : 'warning'} />
        </div>
      </div>
      <div className="border-t border-tower-200 p-4 dark:border-tower-700">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Motorista fiscal</p>
        {manifest.driver ? (
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-tower-500">Nome</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.driver.name}</dd></div>
            <div><dt className="text-tower-500">CPF</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.driver.document}</dd></div>
            <div><dt className="text-tower-500">CNH</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.driver.cnhNumber || 'Não informada'}</dd></div>
            <div>
              <dt className="text-tower-500">Validade</dt>
              <dd className="font-bold text-tower-900 dark:text-tower-50">
                {manifest.driver.cnhExpiry ? new Date(manifest.driver.cnhExpiry).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Não informada'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-tower-500">Nenhum motorista vinculado.</p>
        )}
      </div>
      <div className="border-t border-tower-200 p-4 dark:border-tower-700">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Composição veicular</p>
        {manifestCompositionSummary(manifest).length ? (
          <div className="mt-3">
            <ul className="space-y-2">
              {manifestCompositionSummary(manifest).map((unit) => (
                <li key={unit.plate} className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${
                      unit.role === 'TRACTION' ? 'bg-brand-950 text-white' : 'bg-tower-100 text-tower-800 dark:bg-tower-800 dark:text-tower-100'
                    }`}
                  >
                    {unit.plate}
                  </span>
                  <span className="text-xs text-tower-500">{unit.role === 'TRACTION' ? 'Cavalo' : 'Reboque'}</span>
                  {unit.issues.length ? (
                    <StatusBadge label={`Falta: ${describeIssues(unit.issues)}`} tone="warning" />
                  ) : (
                    <StatusBadge label="Pronta" tone="success" />
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-tower-500">
              {manifest.link?.vehicleType?.name || manifest.vehicleType?.name}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-tower-500">Composição ainda não cadastrada.</p>
        )}
      </div>
    </div>

    {/* Action buttons */}
    {canEditPlanning && (
      <div className="mt-4 flex flex-wrap gap-2">
        {!showAssignForm && (
          <button
            type="button"
            onClick={() => { setShowAssignForm(true); setShowDriverForm(false); setAssignLinkId(manifest.linkId || ''); }}
            className="admin-focus min-h-11 rounded-xl bg-tower-100 px-4 text-sm font-bold text-tower-700 hover:bg-tower-200 dark:bg-tower-800 dark:text-tower-300 dark:hover:bg-tower-700"
          >
            {manifest.linkId ? 'Trocar responsável' : 'Selecionar responsável'}
          </button>
        )}
        {manifest.linkId && !showDriverForm && (
          <button
            type="button"
            onClick={onOpenDriverSearch}
            className="admin-focus min-h-11 rounded-xl bg-tower-100 px-4 text-sm font-bold text-tower-700 hover:bg-tower-200 dark:bg-tower-800 dark:text-tower-300 dark:hover:bg-tower-700"
          >
            {manifest.driver ? 'Trocar motorista' : 'Selecionar motorista'}
          </button>
        )}
        {manifest.driver && (
          <button
            type="button"
            onClick={() => onOpenDriverFiscalSheet(manifest.driver)}
            className="admin-focus min-h-11 rounded-xl bg-tower-100 px-4 text-sm font-bold text-tower-700 hover:bg-tower-200 dark:bg-tower-800 dark:text-tower-300 dark:hover:bg-tower-700"
          >
            Editar motorista
          </button>
        )}
        {manifest.link && (
          <button
            type="button"
            onClick={() => onOpenVehicleSheet(manifest.link)}
            className="admin-focus min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700"
          >
            {manifestCompositionSummary(manifest).length ? 'Editar composição da viagem' : 'Escolher cavalo e implementos'}
          </button>
        )}
      </div>
    )}

    {/* Responsible search panel */}
    {showAssignForm && (
      <div className="mt-5 rounded-2xl border border-tower-200 p-4 dark:border-tower-700">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-tower-900 dark:text-tower-50">Pesquisar responsável</h2>
          <button
            type="button"
            onClick={() => setShowAssignForm(false)}
            className="admin-focus min-h-10 rounded-lg px-3 text-sm font-bold text-tower-500 hover:bg-tower-100 dark:hover:bg-tower-800"
          >
            Fechar
          </button>
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Nome, CPF/CNPJ ou placa</span>
          <input
            type="search"
            autoFocus
            value={responsibleSearch}
            onChange={(e) => setResponsibleSearch(e.target.value)}
            placeholder="Comece a digitar para filtrar"
            className={fieldClass}
          />
        </label>
        <div className="mt-3 divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
          {filteredResponsibleLinks.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => onAssignLink(link.id)}
              className="admin-focus flex min-h-16 w-full items-center justify-between gap-3 px-3 text-left hover:bg-tower-100 dark:hover:bg-tower-800"
            >
              <span>
                <strong className="block text-sm text-tower-900 dark:text-tower-50">{link.name}</strong>
                <span className="mt-1 block text-xs text-tower-500">{link.document} · {link.vehiclePlate || 'sem placa'}</span>
              </span>
              <span className="text-sm font-bold text-brand-700 dark:text-brand-300">Usar</span>
            </button>
          ))}
          {!filteredResponsibleLinks.length && (
            <p className="px-3 py-4 text-sm text-tower-500">Nenhum responsável aprovado encontrado.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenLinkQuickCreate}
          className="admin-focus mt-3 min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700"
        >
          + Cadastrar transportador
        </button>
      </div>
    )}

    {/* Driver search panel */}
    {showDriverForm && manifest.linkId && (
      <div className="mt-5 rounded-2xl border border-tower-200 p-4 dark:border-tower-700">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-tower-900 dark:text-tower-50">Pesquisar motorista</h2>
          <button
            type="button"
            onClick={() => setShowDriverForm(false)}
            className="admin-focus min-h-10 rounded-lg px-3 text-sm font-bold text-tower-500 hover:bg-tower-100 dark:hover:bg-tower-800"
          >
            Fechar
          </button>
        </div>
        <p className="mt-1 text-xs text-tower-500">
          Busque pelo CPF. O transportador e os veículos já escolhidos para a viagem permanecem os mesmos.
        </p>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Pesquisar por nome ou CPF</span>
          <input
            type="search"
            autoFocus
            value={driverSearch}
            onChange={(e) => setDriverSearch(e.target.value)}
            placeholder="Nome ou CPF do motorista"
            className={fieldClass}
          />
        </label>
        <div className="mt-3 divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
          {filteredDrivers.map((driver) => (
            <div key={driver.id} className="flex min-h-16 items-center justify-between gap-3 px-3">
              <button
                type="button"
                onClick={() => onSelectDriver(driver)}
                className="admin-focus min-w-0 flex-1 rounded-lg py-2 text-left"
              >
                <strong className="block truncate text-sm text-tower-900 dark:text-tower-50">{driver.name}</strong>
                <span className="mt-1 block text-xs text-tower-500">
                  CPF {driver.document} · CNH {driver.cnhNumber || 'não informada'}
                </span>
              </button>
              {(driver.linkId === manifest.linkId || driver.carriers?.some((carrier) => carrier.linkId === manifest.linkId)) && <button
                type="button"
                onClick={() => onOpenDriverFiscalSheet(driver)}
                className="admin-focus min-h-10 rounded-lg px-3 text-xs font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30"
              >
                Editar
              </button>}
            </div>
          ))}
          {!filteredDrivers.length && (
            <p className="px-3 py-4 text-sm text-tower-500">Nenhum motorista encontrado por esse nome ou CPF.</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenDriverFiscalSheet(null)}
          className="admin-focus mt-3 min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700"
        >
          + Cadastrar motorista para {manifest.link?.name}
        </button>
      </div>
    )}

  </JourneySection>
);

export default TripResponsiblePanel;
