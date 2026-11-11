-- Divergencia de chegada (avaria/falta) vira alerta operacional: semente da fila de excecoes.
ALTER TYPE "SystemAlertCategory" ADD VALUE IF NOT EXISTS 'OPERATIONAL_ARRIVAL_DIVERGENCE';
