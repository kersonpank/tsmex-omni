import type { StatusTone } from './demandStatusUi';

export const manifestStatusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
};

export const manifestStatusTone: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_ACCEPT: 'warning',
  ACCEPTED: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  REJECTED: 'danger',
};
