
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🛠️ Fixing LLM Models...\n');

    const modelsToCreate = [
        {
            providerCode: 'openai',
            name: 'GPT-4o',
            modelId: 'gpt-4o',
            capabilities: ['chat', 'tools', 'vision'],
            contextWindow: 128000,
            maxOutput: 4096,
            inputPrice: 5.00,
            outputPrice: 15.00,
            isDefault: true
        },
        {
            providerCode: 'gemini',
            name: 'Gemini 1.5 Pro',
            modelId: 'gemini-1.5-pro',
            capabilities: ['chat', 'tools', 'vision', 'json_mode'],
            contextWindow: 1048576,
            maxOutput: 8192,
            inputPrice: 3.50,
            outputPrice: 10.50,
            isDefault: true
        },
        {
            providerCode: 'anthropic',
            name: 'Claude 3.5 Sonnet',
            modelId: 'claude-3-5-sonnet-20240620',
            capabilities: ['chat', 'tools', 'vision'],
            contextWindow: 200000,
            maxOutput: 4096,
            inputPrice: 3.00,
            outputPrice: 15.00,
            isDefault: true
        },
        {
            providerCode: 'deepseek-chat',
            name: 'DeepSeek V3',
            modelId: 'deepseek-chat',
            capabilities: ['chat', 'tools', 'json_mode'],
            contextWindow: 64000,
            maxOutput: 4096,
            inputPrice: 0.14,
            outputPrice: 0.28,
            isDefault: true
        }
    ];

    for (const m of modelsToCreate) {
        const provider = await prisma.lLMProvider.findUnique({
            where: { code: m.providerCode }
        });

        if (!provider) {
            console.log(`⚠️ Provider ${m.providerCode} not found. Skipping.`);
            continue;
        }

        // Check if model exists
        const existing = await prisma.lLMModel.findFirst({
            where: { providerId: provider.id, modelId: m.modelId }
        });

        if (existing) {
            console.log(`✅ Model ${m.name} already exists.`);

            // Ensure it is active and default if needed
            if (!existing.active || (m.isDefault && !existing.isDefault)) {
                await prisma.lLMModel.update({
                    where: { id: existing.id },
                    data: { active: true, isDefault: m.isDefault }
                });
                console.log(`  Updated active/default status.`);
            }

        } else {
            console.log(`➕ Creating model ${m.name}...`);
            await prisma.lLMModel.create({
                data: {
                    providerId: provider.id,
                    name: m.name,
                    modelId: m.modelId,
                    capabilities: m.capabilities,
                    contextWindow: m.contextWindow,
                    maxOutput: m.maxOutput,
                    inputPrice: m.inputPrice,
                    outputPrice: m.outputPrice,
                    isDefault: m.isDefault,
                    active: true
                }
            });
            console.log(`  Created!`);
        }
    }

    console.log('\n✨ Done! Models are ready.');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
