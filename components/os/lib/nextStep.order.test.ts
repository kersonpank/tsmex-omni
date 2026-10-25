import { describe, expect, it } from 'vitest';
import { orderNextStep } from './nextStep';

describe('orderNextStep', () => {
    const base = { volumeM3: 1, freightDocState: 'emitted' as const, inTrip: false };
    it('segue etiquetas → cubagem → frete → viagem', () => {
        expect(orderNextStep({ ...base, labelsPrinted: false }).action).toBe('labels');
        expect(orderNextStep({ ...base, volumeM3: 0.001 }).action).toBe('cubage');
        expect(orderNextStep({ ...base, freightDocState: 'none' }).action).toBe('freight');
        expect(orderNextStep({ ...base, freightDocState: 'rejected' }).action).toBe('freight');
        expect(orderNextStep(base).action).toBe('trip');
    });
    it('pula etiquetas quando não rastreadas e fecha quando já em viagem', () => {
        expect(orderNextStep({ ...base, volumeM3: 0 }).action).toBe('cubage');
        expect(orderNextStep({ ...base, inTrip: true }).action).toBe('none');
        expect(orderNextStep({ ...base, freightDocState: 'in_flight' }).action).toBe('none');
    });
});
