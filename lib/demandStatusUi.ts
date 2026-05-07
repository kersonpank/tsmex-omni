import type { DemandStatus } from '../types/index';
import type { OrderStatus } from '../types/index';

/** Máximo de tons semânticos para status (plano UI) */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const demandStatusLabels: Record<DemandStatus, string> = {
  PENDING: 'Pendente',
  QUOTED: 'Cotado',
  APPROVED: 'Aprovado',
  ASSIGNED: 'Em manifesto',
  COLLECTED: 'Coletado',
  IN_TRANSIT: 'Em trânsito',
  AT_HUB: 'No hub',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

export const demandStatusTones: Record<DemandStatus, StatusTone> = {
  PENDING: 'warning',
  QUOTED: 'info',
  APPROVED: 'neutral',
  ASSIGNED: 'info',
  COLLECTED: 'info',
  IN_TRANSIT: 'info',
  AT_HUB: 'warning',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

export const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING: 'Pendente',
  IN_TRANSIT: 'Em trânsito',
  AT_HUB: 'No hub',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

export const orderStatusTones: Record<OrderStatus, StatusTone> = {
  PENDING: 'warning',
  IN_TRANSIT: 'info',
  AT_HUB: 'warning',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};
