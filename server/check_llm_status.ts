/**
 * Script to check LLM configuration status
 * Run with: npx tsx check_llm_status.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔍 Checking LLM Configuration Status...\n');

    // Check providers
    const providers = await prisma.lLMProvider.findMany({
        include: {
            models: {
                where: { active: true },
                orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
            },
            apiKey: true
        },
        orderBy: { name: 'asc' }
    });

    console.log('📦 Providers:');
    for (const provider of providers) {
        console.log(`\n  ${provider.name} (${provider.code})`);
        console.log(`    Format: ${provider.apiFormat}`);
        console.log(`    Base URL: ${provider.baseUrl}`);
        console.log(`    Active: ${provider.active ? '✅' : '❌'}`);
        console.log(`    API Key: ${provider.apiKey ? (provider.apiKey.active ? '✅ Configured' : '⚠️ Inactive') : '❌ Not configured'}`);
        if (provider.apiKey) {
            console.log(`    Key Preview: ${provider.apiKey.keyPreview}`);
        }

        const activeModels = provider.models.filter(m => m.active);
        console.log(`    Models (active): ${activeModels.length}`);
        for (const model of activeModels) {
            const isDefault = model.isDefault ? '⭐ DEFAULT' : '';
            const hasChat = model.capabilities.includes('chat') ? '💬' : '';
            console.log(`      - ${model.name} (${model.modelId}) ${isDefault} ${hasChat}`);
        }
    }

    // Check for chat-capable models with valid API keys
    console.log('\n\n🎯 Chat-Capable Models with Valid API Keys:');
    const chatModels = await prisma.lLMModel.findMany({
        where: {
            active: true,
            capabilities: { has: 'chat' },
            provider: {
                active: true,
                apiKey: {
                    active: true,
                    apiKey: { not: '' }
                }
            }
        },
        include: {
            provider: {
                include: { apiKey: true }
            }
        },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }]
    });

    if (chatModels.length === 0) {
        console.log('  ❌ No chat-capable models with valid API keys found!');
        console.log('\n  💡 To fix:');
        console.log('     1. Go to Settings > LLM');
        console.log('     2. Add an API key to a provider (e.g., Gemini)');
        console.log('     3. Create or activate a model with "chat" capability');
        console.log('     4. Mark it as default');
    } else {
        for (const model of chatModels) {
            const isDefault = model.isDefault ? '⭐ DEFAULT' : '';
            console.log(`  ✅ ${model.name} (${model.provider.name}) ${isDefault}`);
        }
    }

    // Check default chat model
    console.log('\n\n🔍 Default Chat Model:');
    const defaultChatModel = await prisma.lLMModel.findFirst({
        where: {
            active: true,
            isDefault: true,
            capabilities: { has: 'chat' }
        },
        include: {
            provider: {
                include: { apiKey: true }
            }
        }
    });

    if (defaultChatModel) {
        console.log(`  ✅ Found: ${defaultChatModel.name} (${defaultChatModel.provider.name})`);
        if (defaultChatModel.provider.apiKey?.active && defaultChatModel.provider.apiKey?.apiKey) {
            console.log(`  ✅ Has valid API key`);
        } else {
            console.log(`  ❌ Missing or inactive API key`);
        }
    } else {
        console.log('  ❌ No default chat model found');
    }
}

main()
    .catch((e) => {
        console.error('❌ Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
