// components/manifest/TripResponsiblePanel.tsx
import React from 'react';
import StatusBadge from '../ui/StatusBadge';
import type { Manifest, Link, Driver } from '../../types/index';

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
  fieldClass: string;
}

const TripResponsiblePanel: React.FC<Props> = ({
  manifest,
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
  fieldClass,
}) => (
  <JourneySection
    eyebrow="Etapa 5"
    title="Responsável, motorista e veículo"
    description="Pesquise os cadastros existentes por nome, documento ou placa. Se não encontrar, cadastre no contexto e volte com a informação já selecionada."
  >
    {/* Summary card */}
    <div className="overflow-hidden rounded-2xl border border-tower-200 dark:border-tower-700">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Responsável no app</p>
            <p className="mt-1 text-base font-bold text-tower-900 dark:text-tower-50">{manifest.link?.name ?? 'Não selecionado'}</p>
            {manifest.link ? (
              <p className="mt-1 text-xs text-tower-500">
                {manifest.link.document} · RNTRC {manifest.link.rntrc || 'não informado'}
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
                {manifest.driver.cnhExpiry ? new Date(manifest.driver.cnhExpiry).toLocaleDateString('pt-BR') : 'Não informada'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-tower-500">Nenhum motorista vinculado.</p>
        )}
      </div>
      <div className="border-t border-tower-200 p-4 dark:border-tower-700">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Composição veicular</p>
        {manifest.link?.vehiclePlate ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {[manifest.link.vehiclePlate, manifest.link.trailerPlate, manifest.link.trailer2Plate, manifest.link.trailer3Plate]
                .filter(Boolean)
                .map((plate, index) => (
                  <span
                    key={plate}
                    className={`rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${
                      index === 0 ? 'bg-brand-950 text-white' : 'bg-tower-100 text-tower-800 dark:bg-tower-800 dark:text-tower-100'
                    }`}
                  >
                    {plate}
                  </span>
                ))}
            </div>
            <p className="mt-2 text-xs text-tower-500">
              {manifest.link.vehicleType?.name || manifest.vehicleType?.name} ·{' '}
              {manifest.link.vehicleAxles ? `${manifest.link.vehicleAxles} eixos` : 'eixos não informados'} · Chassi{' '}
              {manifest.link.vehicleChassi || 'não informado'}
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
            {manifest.link.vehiclePlate ? 'Editar veículo' : 'Cadastrar veículo'}
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
          Busque em todos os responsáveis aprovados. Ao escolher, o responsável e o veículo dele acompanham o motorista.
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
                  {driver.link?.name ? ` · ${driver.link.name}` : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onOpenDriverFiscalSheet(driver)}
                className="admin-focus min-h-10 rounded-lg px-3 text-xs font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30"
              >
                Editar
              </button>
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

    {/* Vehicle plate search panel */}
    {manifest.link && canEditPlanning && (
      <div className="mt-5 rounded-2xl border border-tower-200 p-4 dark:border-tower-700">
        <h2 className="text-base font-bold text-tower-900 dark:text-tower-50">Localizar composição por placa</h2>
        <p className="mt-1 text-xs text-tower-500">
          Ao usar outra composição, o responsável proprietário dela também será selecionado.
        </p>
        <input
          type="search"
          value={vehicleSearch}
          onChange={(e) => setVehicleSearch(e.target.value)}
          placeholder="Ex: ABC1D23"
          className={`${fieldClass} mt-4 font-mono uppercase`}
        />
        {vehicleSearch && (
          <div className="mt-3 divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
            {vehicleMatches.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => onOpenVehicleSheet(link)}
                className="admin-focus flex min-h-16 w-full items-center justify-between gap-3 px-3 text-left hover:bg-tower-100 dark:hover:bg-tower-800"
              >
                <span>
                  <strong className="block font-mono text-sm text-tower-900 dark:text-tower-50">
                    {[link.vehiclePlate, link.trailerPlate, link.trailer2Plate, link.trailer3Plate].filter(Boolean).join(' + ')}
                  </strong>
                  <span className="mt-1 block text-xs text-tower-500">{link.name}</span>
                </span>
                <span className="text-sm font-bold text-brand-700 dark:text-brand-300">Usar</span>
              </button>
            ))}
            {!vehicleMatches.length && (
              <button
                type="button"
                onClick={() => onOpenVehicleSheet(manifest.link)}
                className="admin-focus min-h-14 w-full px-3 text-left text-sm font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30"
              >
                Placa não encontrada · cadastrar para {manifest.link.name}
              </button>
            )}
          </div>
        )}
      </div>
    )}
  </JourneySection>
);

export default TripResponsiblePanel;
