
import prisma from './src/lib/prisma.js';

async function main() {
    console.log('🔍 Checking LLM Configuration...\n');

    // 1. Providers
    const providers = await prisma.lLMProvider.findMany({
        include: { apiKey: true, models: true }
    });

    console.log(`📦 Found ${providers.length} providers:`);

    for (const p of providers) {
        console.log(`  - [${p.code}] ${p.name} (Active: ${p.active})`);
        console.log(`    🔑 API Key: ${p.apiKey ? '✅ Configured (' + p.apiKey.keyPreview + ')' : '❌ MISSING'}`);
        console.log(`    🤖 Models: ${p.models.length}`);

        for (const m of p.models) {
            console.log(`      • [${m.modelId}] ${m.name}`);
            console.log(`        Active: ${m.active}, Default: ${m.isDefault}`);
            console.log(`        Caps: ${m.capabilities.join(', ')}`);
        }
        console.log('');
    }

    // 2. Active Chat Model Check
    console.log('🧪 Simulating /models/active?capability=chat logic:');

    // Try default
    let model = await prisma.lLMModel.findFirst({
        where: {
            active: true,
            isDefault: true,
            capabilities: { has: 'chat' }
        },
        include: { provider: { include: { apiKey: true } } }
    });

    if (model) {
        console.log(`  ✅ Found DEFAULT chat model: ${model.name} (${model.provider.name})`);
        console.log(`  🔑 Has API Key? ${!!model.provider.apiKey}`);
    } else {
        console.log('  ⚠️ No DEFAULT chat model found. Falling back to any active...');

        model = await prisma.lLMModel.findFirst({
            where: {
                active: true,
                capabilities: { has: 'chat' }
            },
            include: { provider: { include: { apiKey: true } } }
        });

        if (model) {
            console.log(`  ✅ Found ACTIVE chat model: ${model.name} (${model.provider.name})`);
            console.log(`  🔑 Has API Key? ${!!model.provider.apiKey}`);
        } else {
            console.log('  ❌ NO ACTIVE CHAT MODEL FOUND!');
        }
    }
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
