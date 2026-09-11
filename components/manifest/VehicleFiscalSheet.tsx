// components/manifest/VehicleFiscalSheet.tsx
import React from 'react';
import type { VehicleType } from '../../types/index';

export interface VehicleFormState {
  vehicleTypeId: string;
  vehiclePlate: string;
  vehicleYear: string;
  trailerPlate: string;
  trailer2Plate: string;
  trailer3Plate: string;
  vehicleAxles: string;
  rntrc: string;
  carrierType: string;
  vehicleOwnerDocument: string;
  vehicleOwnerName: string;
  vehicleChassi: string;
  vehicleRenavam: string;
  vehicleBodyType: string;
  vehicleWheelType: string;
}

interface Props {
  vehicleForm: VehicleFormState;
  setVehicleForm: React.Dispatch<React.SetStateAction<VehicleFormState>>;
  vehicleTypes: VehicleType[];
  savingVehicle: boolean;
  onClose: () => void;
  onSave: () => void;
  fieldClass: string;
}

const DEFAULT_WHEEL = 'Cavalo';
const DEFAULT_BODY = 'NaoAplicavel';

function getSmartDefaults(name: string, code: string): { vehicleWheelType?: string; vehicleBodyType?: string } {
  const n = name.toLowerCase();
  const c = (code ?? '').toLowerCase();
  const has = (...terms: string[]) => terms.some((t) => n.includes(t) || c.includes(t));

  if (has('truck')) return { vehicleWheelType: 'Truck', vehicleBodyType: 'FechadaOuBau' };
  if (has('toco')) return { vehicleWheelType: 'Toco' };
  if (has('van', 'utilitário', 'utilitario', 'passeio')) return { vehicleWheelType: 'Toco', vehicleBodyType: 'FechadaOuBau' };
  if (has('carreta', 'cavalo', 'bitrem', 'rodotrem')) return { vehicleWheelType: 'Cavalo' };
  if (has('sider')) return { vehicleBodyType: 'Sider' };
  if (has('granel')) return { vehicleBodyType: 'Granelera' };
  if (has('container', 'contêiner', 'conteiner')) return { vehicleBodyType: 'PortaContainer' };
  return {};
}

const VehicleFiscalSheet: React.FC<Props> = ({
  vehicleForm,
  setVehicleForm,
  vehicleTypes,
  savingVehicle,
  onClose,
  onSave,
  fieldClass,
}) => {
  const handleTypeChange = (vehicleTypeId: string) => {
    const type = vehicleTypes.find((t) => t.id === vehicleTypeId);
    if (!type) {
      setVehicleForm((f) => ({ ...f, vehicleTypeId }));
      return;
    }
    const wheelIsDefault = !vehicleForm.vehicleWheelType || vehicleForm.vehicleWheelType === DEFAULT_WHEEL;
    const bodyIsDefault = !vehicleForm.vehicleBodyType || vehicleForm.vehicleBodyType === DEFAULT_BODY;
    const smart = getSmartDefaults(type.name, (type as any).code ?? '');
    setVehicleForm((f) => ({
      ...f,
      vehicleTypeId,
      ...(wheelIsDefault && smart.vehicleWheelType ? { vehicleWheelType: smart.vehicleWheelType } : {}),
      ...(bodyIsDefault && smart.vehicleBodyType ? { vehicleBodyType: smart.vehicleBodyType } : {}),
    }));
  };

  const selectedType = vehicleTypes.find((t) => t.id === vehicleForm.vehicleTypeId);
  const showTrailerEmphasis = selectedType
    ? ['carreta', 'cavalo', 'bitrem', 'rodotrem'].some(
        (k) =>
          selectedType.name.toLowerCase().includes(k) ||
          ((selectedType as any).code ?? '').toLowerCase().includes(k),
      )
    : false;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar composição veicular" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="vehicle-title"
        className="mobile-enter relative max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-2xl md:rounded-2xl md:p-6"
      >
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
        <h2 id="vehicle-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">Composição veicular</h2>
        <p className="mt-2 text-sm leading-6 text-tower-600 dark:text-tower-300">
          Cadastre os dados usados no CIOT e MDF-e. Placa, chassi, eixos e RNTRC são obrigatórios.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {/* Tipo de veículo */}
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-bold">Tipo de veículo*</label>
            <select value={vehicleForm.vehicleTypeId} onChange={(e) => handleTypeChange(e.target.value)} className={fieldClass}>
              <option value="">Selecione</option>
              {vehicleTypes.filter((t) => t.active).map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({(t as any).code})</option>
              ))}
            </select>
          </div>

          {/* Placa principal + Chassi — required pair */}
          <div>
            <label className="mb-2 block text-sm font-bold">
              Placa principal* <span className="font-normal text-tower-500">(7 chars)</span>
            </label>
            <input
              value={vehicleForm.vehiclePlate}
              onChange={(e) => setVehicleForm((f) => ({ ...f, vehiclePlate: e.target.value.toUpperCase() }))}
              maxLength={8}
              placeholder="ABC1D23"
              className={`${fieldClass} font-mono uppercase`}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">
              Chassi* <span className="font-normal text-tower-500">(17 chars)</span>
            </label>
            <input
              value={vehicleForm.vehicleChassi}
              onChange={(e) => setVehicleForm((f) => ({ ...f, vehicleChassi: e.target.value.toUpperCase() }))}
              maxLength={17}
              placeholder="17 caracteres"
              className={`${fieldClass} uppercase`}
            />
          </div>

          {/* Eixos + RNTRC — required for CIOT */}
          <div>
            <label className="mb-2 block text-sm font-bold">Número de eixos*</label>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={vehicleForm.vehicleAxles}
              onChange={(e) => setVehicleForm((f) => ({ ...f, vehicleAxles: e.target.value }))}
              placeholder="Ex: 6"
              className={fieldClass}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">RNTRC*</label>
            <input
              inputMode="numeric"
              value={vehicleForm.rntrc}
              onChange={(e) => setVehicleForm((f) => ({ ...f, rntrc: e.target.value.replace(/\D/g, '') }))}
              placeholder="8 ou 9 dígitos"
              className={fieldClass}
            />
          </div>

          {/* Tipo transportador */}
          <div>
            <label className="mb-2 block text-sm font-bold">Tipo do transportador</label>
            <select value={vehicleForm.carrierType} onChange={(e) => setVehicleForm((f) => ({ ...f, carrierType: e.target.value }))} className={fieldClass}>
              <option value="TAC">TAC</option>
              <option value="ETC">ETC</option>
              <option value="CTC">CTC</option>
              <option value="FROTA">Frota própria</option>
            </select>
          </div>

          {/* RENAVAM — visible, warning if empty */}
          <div>
            <label className="mb-2 block text-sm font-bold">
              RENAVAM <span className="font-normal text-tower-500">(recomendado)</span>
            </label>
            <input
              inputMode="numeric"
              value={vehicleForm.vehicleRenavam}
              onChange={(e) => setVehicleForm((f) => ({ ...f, vehicleRenavam: e.target.value.replace(/\D/g, '') }))}
              className={fieldClass}
            />
          </div>

          {/* Carroceria + Rodado — promoted from details, smart-defaulted */}
          <div>
            <label className="mb-2 block text-sm font-bold">Tipo de carroceria</label>
            <select value={vehicleForm.vehicleBodyType} onChange={(e) => setVehicleForm((f) => ({ ...f, vehicleBodyType: e.target.value }))} className={fieldClass}>
              <option value="NaoAplicavel">Não aplicável</option>
              <option value="Aberta">Aberta</option>
              <option value="FechadaOuBau">Fechada / baú</option>
              <option value="Granelera">Graneleira</option>
              <option value="PortaContainer">Porta-contêiner</option>
              <option value="Sider">Sider</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">Tipo de rodado</label>
            <select value={vehicleForm.vehicleWheelType} onChange={(e) => setVehicleForm((f) => ({ ...f, vehicleWheelType: e.target.value }))} className={fieldClass}>
              <option value="Cavalo">Cavalo</option>
              <option value="Truck">Truck</option>
              <option value="Toco">Toco</option>
              <option value="NaoAplicavel">Não aplicável</option>
            </select>
          </div>

          {/* Ano */}
          <div>
            <label className="mb-2 block text-sm font-bold">Ano</label>
            <input
              type="number"
              inputMode="numeric"
              value={vehicleForm.vehicleYear}
              onChange={(e) => setVehicleForm((f) => ({ ...f, vehicleYear: e.target.value }))}
              placeholder="2024"
              className={fieldClass}
            />
          </div>

          {/* Reboque 1 — emphasized when carreta/cavalo type */}
          <div>
            <label className={`mb-2 block text-sm font-bold${showTrailerEmphasis ? ' text-brand-700 dark:text-brand-300' : ''}`}>
              Reboque 1{showTrailerEmphasis ? '*' : ''}
            </label>
            <input
              value={vehicleForm.trailerPlate}
              onChange={(e) => setVehicleForm((f) => ({ ...f, trailerPlate: e.target.value.toUpperCase() }))}
              maxLength={8}
              placeholder={showTrailerEmphasis ? 'Placa da carreta' : 'Opcional'}
              className={`${fieldClass} font-mono uppercase`}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">Reboque 2</label>
            <input
              value={vehicleForm.trailer2Plate}
              onChange={(e) => setVehicleForm((f) => ({ ...f, trailer2Plate: e.target.value.toUpperCase() }))}
              maxLength={8}
              placeholder="Opcional"
              className={`${fieldClass} font-mono uppercase`}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">Reboque 3</label>
            <input
              value={vehicleForm.trailer3Plate}
              onChange={(e) => setVehicleForm((f) => ({ ...f, trailer3Plate: e.target.value.toUpperCase() }))}
              maxLength={8}
              placeholder="Opcional"
              className={`${fieldClass} font-mono uppercase`}
            />
          </div>

          {/* Proprietário — kept in details */}
          <details className="sm:col-span-2 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <summary className="admin-focus cursor-pointer list-none rounded-lg text-sm font-bold text-brand-700 dark:text-brand-300">
              + Proprietário do veículo, se diferente
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-bold">Nome / razão social</label>
                <input value={vehicleForm.vehicleOwnerName} onChange={(e) => setVehicleForm((f) => ({ ...f, vehicleOwnerName: e.target.value }))} className={fieldClass} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-bold">CPF / CNPJ</label>
                <input inputMode="numeric" value={vehicleForm.vehicleOwnerDocument} onChange={(e) => setVehicleForm((f) => ({ ...f, vehicleOwnerDocument: e.target.value }))} className={fieldClass} />
              </div>
            </div>
          </details>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">
            Cancelar
          </button>
          <button type="button" onClick={onSave} disabled={savingVehicle} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            {savingVehicle ? 'Salvando…' : 'Salvar e usar'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default VehicleFiscalSheet;
