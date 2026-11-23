import type { Manifest } from '../../../../../types/index';

/** Chegada, conferência, entrega e conclusão da viagem pela torre. Implementado pela frente A3. */
export const DocaStep = ({ trip, onChanged }: { trip: Manifest; onChanged: () => void }) => (trip && onChanged ? null : null);
