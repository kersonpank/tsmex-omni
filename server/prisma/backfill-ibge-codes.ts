import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeText(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
}

function parseCityState(str: string): { city: string; state: string } | null {
    if (!str) return null;
    const match = str.match(/^(.*)[,-]\s*([a-zA-Z]{2})$/);
    if (match) {
        return {
            city: match[1].trim(),
            state: match[2].toUpperCase().trim()
        };
    }
    return null;
}

async function main() {
    console.log('Iniciando script de backfill de códigos IBGE...');

    // Load states and cities in memory
    const states = await prisma.state.findMany({
        include: { cities: true }
    });

    const stateMap = new Map<string, typeof states[0]>();
    for (const state of states) {
        stateMap.set(state.code.toUpperCase(), state);
    }

    function findIbgeCode(city: string | null | undefined, state: string | null | undefined): string | null {
        const cleanState = (state ?? '').toUpperCase().trim();
        const cleanCity = (city ?? '').trim();
        if (!cleanState || !cleanCity) return null;

        const stateRecord = stateMap.get(cleanState);
        if (!stateRecord) return null;

        const targetNormalized = normalizeText(cleanCity);
        const matched = stateRecord.cities.find(c => normalizeText(c.name) === targetNormalized);
        return matched ? matched.ibgeCode : null;
    }

    // 1. Backfill Person
    const persons = await prisma.person.findMany({
        where: { cityIbgeCode: null }
    });
    console.log(`Encontradas ${persons.length} pessoas para analisar.`);
    let personsUpdated = 0;
    for (const person of persons) {
        if (!person.city || !person.state) continue;
        const code = findIbgeCode(person.city, person.state);
        if (code) {
            await prisma.person.update({
                where: { id: person.id },
                data: { cityIbgeCode: code }
            });
            personsUpdated++;
        }
    }
    console.log(`Pessoas atualizadas: ${personsUpdated}/${persons.length}`);

    // 2. Backfill Hub
    const hubs = await prisma.hub.findMany({
        where: { cityIbgeCode: null }
    });
    console.log(`Encontrados ${hubs.length} hubs para analisar.`);
    let hubsUpdated = 0;
    for (const hub of hubs) {
        if (!hub.city || !hub.state) continue;
        const code = findIbgeCode(hub.city, hub.state);
        if (code) {
            await prisma.hub.update({
                where: { id: hub.id },
                data: { cityIbgeCode: code }
            });
            hubsUpdated++;
        }
    }
    console.log(`Hubs atualizados: ${hubsUpdated}/${hubs.length}`);

    // 3. Backfill AccountCompany
    const companies = await prisma.accountCompany.findMany({
        where: { cityIbgeCode: null }
    });
    console.log(`Encontradas ${companies.length} empresas de conta para analisar.`);
    let companiesUpdated = 0;
    for (const company of companies) {
        if (!company.city || !company.state) continue;
        const code = findIbgeCode(company.city, company.state);
        if (code) {
            await prisma.accountCompany.update({
                where: { id: company.id },
                data: { cityIbgeCode: code }
            });
            companiesUpdated++;
        }
    }
    console.log(`Empresas atualizadas: ${companiesUpdated}/${companies.length}`);

    // 4. Backfill Order (origemPrestacao & fimPrestacao)
    const orders = await prisma.order.findMany({
        where: {
            OR: [
                { origemIbgeCode: null },
                { fimIbgeCode: null }
            ]
        }
    });
    console.log(`Encontrados ${orders.length} pedidos para analisar.`);
    let ordersUpdated = 0;
    for (const order of orders) {
        let updateData: any = {};
        if (!order.origemIbgeCode && order.origemPrestacao) {
            const parsed = parseCityState(order.origemPrestacao);
            if (parsed) {
                const code = findIbgeCode(parsed.city, parsed.state);
                if (code) updateData.origemIbgeCode = code;
            }
        }
        if (!order.fimIbgeCode && order.fimPrestacao) {
            const parsed = parseCityState(order.fimPrestacao);
            if (parsed) {
                const code = findIbgeCode(parsed.city, parsed.state);
                if (code) updateData.fimIbgeCode = code;
            }
        }

        if (Object.keys(updateData).length > 0) {
            await prisma.order.update({
                where: { id: order.id },
                data: updateData
            });
            ordersUpdated++;
        }
    }
    console.log(`Pedidos atualizados: ${ordersUpdated}/${orders.length}`);
    console.log('Script de backfill concluído com sucesso!');
}

main()
    .catch((e) => {
        console.error('Erro durante o backfill:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
