import prisma from '../src/lib/prisma.js';
import { syncDemandFromInvoices } from '../src/routes/orders.js';

/**
 * Backfill único: recalcula Demand.weight/units/volume/cubedWeight/nfValue a partir
 * das OrderInvoice (NFs/Declarações) de pedidos que já tinham NF anexada ANTES do fix
 * que passou a chamar syncDemandFromInvoices automaticamente nos endpoints de invoice
 * (POST/PATCH /orders/:id/invoices). Esses pedidos ficaram com dados de carga
 * zerados/placeholder mesmo tendo NF-e real vinculada.
 *
 * syncDemandFromInvoices já é idempotente e seguro de chamar sem pré-filtro: seu
 * guard interno (só sobrescreve campo quando soma das invoices > 0) garante que
 * pedidos que não precisam de correção simplesmente não geram um demand.update.
 */
async function main() {
    console.log('Iniciando backfill: sincronizar Demand a partir de OrderInvoice existentes...');

    const orders = await prisma.order.findMany({
        where: { invoicesRel: { some: {} } },
        select: { id: true },
    });
    console.log(`Encontrados ${orders.length} pedido(s) com ao menos uma NF/Declaração anexada.`);

    let processed = 0;
    let failed = 0;
    for (const order of orders) {
        try {
            await syncDemandFromInvoices(order.id);
            processed++;
        } catch (e) {
            failed++;
            console.error(`Falha ao sincronizar pedido ${order.id}:`, e instanceof Error ? e.message : e);
        }
    }

    console.log(`Backfill concluído: ${processed} pedido(s) processados, ${failed} falha(s).`);
}

main()
    .catch((err) => {
        console.error('Backfill falhou:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
