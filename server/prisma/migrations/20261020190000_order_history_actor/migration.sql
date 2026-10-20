-- Autor do evento no histórico do pedido (evento com porquê). Aditiva e idempotente.
ALTER TABLE "OrderHistory" ADD COLUMN IF NOT EXISTS "actorUserId" TEXT;
