import type { ManifestReadiness } from '../../../../../types/index';
import type { ManifestWithLegs } from '../../../../os/lib/arrival';
import { KEYS } from '../../../lib/data';
import { invalidate } from '../../../lib/resource';
import type { TripPermissions, TripStep } from '../../../lib/viagemWork';

export interface StepProps {
    trip: ManifestWithLegs;
    readiness: ManifestReadiness | null;
    perms: TripPermissions;
    goto: (step: TripStep) => void;
}

/** Depois de qualquer escrita: renova a viagem, a prontidão e as listas que dependem delas. */
export const refreshTrip = () => invalidate(KEYS.manifests, 'manifest:', KEYS.exceptions);
