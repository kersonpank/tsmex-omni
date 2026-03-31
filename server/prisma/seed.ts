import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import axios from 'axios';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting seed...\n');

    // Create vehicle types
    console.log('📦 Creating vehicle types...');
    const vehicleTypes = await Promise.all([
        prisma.vehicleType.upsert({
            where: { code: 'MOTO' },
            update: {},
            create: {
                code: 'MOTO',
                name: 'Moto',
                maxWeight: 20,
                maxVolume: 0.1,
                maxValue: 5000,
                enclosed: false,
            }
        }),
        prisma.vehicleType.upsert({
            where: { code: 'PASSEIO' },
            update: {},
            create: {
                code: 'PASSEIO',
                name: 'Veículo de Passeio',
                maxWeight: 300,
                maxVolume: 1.5,
                maxValue: 50000,
                enclosed: true,
            }
        }),
        prisma.vehicleType.upsert({
            where: { code: 'VAN' },
            update: {},
            create: {
                code: 'VAN',
                name: 'Van',
                maxWeight: 1500,
                maxVolume: 8,
                maxValue: 200000,
                enclosed: true,
            }
        }),
        prisma.vehicleType.upsert({
            where: { code: 'VUC' },
            update: {},
            create: {
                code: 'VUC',
                name: 'VUC (Veículo Urbano de Carga)',
                maxWeight: 3000,
                maxVolume: 18,
                maxValue: 300000,
                enclosed: true,
            }
        }),
        prisma.vehicleType.upsert({
            where: { code: 'TRES_QUARTOS' },
            update: {},
            create: {
                code: 'TRES_QUARTOS',
                name: '¾ (Três Quartos)',
                maxWeight: 4500,
                maxVolume: 25,
                maxValue: 400000,
                enclosed: true,
            }
        }),
        prisma.vehicleType.upsert({
            where: { code: 'TOCO' },
            update: {},
            create: {
                code: 'TOCO',
                name: 'Toco',
                maxWeight: 8000,
                maxVolume: 35,
                maxValue: 500000,
                enclosed: true,
            }
        }),
        prisma.vehicleType.upsert({
            where: { code: 'TRUCK' },
            update: {},
            create: {
                code: 'TRUCK',
                name: 'Truck',
                maxWeight: 14000,
                maxVolume: 45,
                maxValue: 800000,
                enclosed: true,
            }
        }),
        prisma.vehicleType.upsert({
            where: { code: 'CARRETA' },
            update: {},
            create: {
                code: 'CARRETA',
                name: 'Carreta Baú',
                maxWeight: 27000,
                maxVolume: 100,
                maxValue: 2000000,
                enclosed: true,
            }
        }),
        prisma.vehicleType.upsert({
            where: { code: 'BITREM' },
            update: {},
            create: {
                code: 'BITREM',
                name: 'Bitrem',
                maxWeight: 40000,
                maxVolume: 150,
                maxValue: 3000000,
                enclosed: true,
            }
        }),
    ]);
    console.log(`   ✅ Created ${vehicleTypes.length} vehicle types`);

    // Create HUBs
    console.log('🏭 Creating HUBs...');
    const hubs = await Promise.all([
        prisma.hub.upsert({
            where: { code: 'SP-GRU' },
            update: {},
            create: {
                code: 'SP-GRU',
                name: 'HUB São Paulo - Guarulhos',
                city: 'Guarulhos',
                state: 'SP',
                coverageCities: ['São Paulo', 'Guarulhos', 'Osasco', 'Santo André', 'São Bernardo'],
                canOrchestrate: true,
            }
        }),
        prisma.hub.upsert({
            where: { code: 'IMP-MA' },
            update: {},
            create: {
                code: 'IMP-MA',
                name: 'HUB Imperatriz',
                city: 'Imperatriz',
                state: 'MA',
                coverageCities: ['Imperatriz', 'Buriticupu', 'Açailândia', 'Arame', 'Barra do Corda'],
                canOrchestrate: true,
            }
        }),
        prisma.hub.upsert({
            where: { code: 'SLZ-MA' },
            update: {},
            create: {
                code: 'SLZ-MA',
                name: 'HUB São Luís',
                city: 'São Luís',
                state: 'MA',
                coverageCities: ['São Luís', 'São José de Ribamar', 'Raposa', 'Paço do Lumiar'],
                canOrchestrate: false,
            }
        }),
        prisma.hub.upsert({
            where: { code: 'FOR-CE' },
            update: {},
            create: {
                code: 'FOR-CE',
                name: 'HUB Fortaleza',
                city: 'Fortaleza',
                state: 'CE',
                coverageCities: ['Fortaleza', 'Caucaia', 'Maracanaú', 'Maranguape'],
                canOrchestrate: true,
            }
        }),
    ]);
    console.log(`   ✅ Created ${hubs.length} HUBs`);

    // Create pricing routes
    console.log('🛤️ Creating pricing routes...');
    const routes = await Promise.all([
        prisma.pricingRoute.upsert({
            where: { id: 'route-sp-ma' },
            update: {},
            create: {
                id: 'route-sp-ma',
                name: 'CD SP-GRU > CD SM-MARANHÃO',
                originCode: 'SP-GRU',
                originName: 'São Paulo - Guarulhos',
                destCode: 'IMP-MA',
                destName: 'Imperatriz - MA',
            }
        }),
        prisma.pricingRoute.upsert({
            where: { id: 'route-sp-ce' },
            update: {},
            create: {
                id: 'route-sp-ce',
                name: 'CD SP-GRU > CD FORTALEZA',
                originCode: 'SP-GRU',
                originName: 'São Paulo - Guarulhos',
                destCode: 'FOR-CE',
                destName: 'Fortaleza - CE',
            }
        }),
    ]);
    console.log(`   ✅ Created ${routes.length} pricing routes`);

    // Create sample pricing tables
    console.log('💰 Creating pricing tables...');
    const pricingTables = await Promise.all([
        prisma.pricingTable.upsert({
            where: { id: 'table-general-sp-ma' },
            update: {},
            create: {
                id: 'table-general-sp-ma',
                description: 'FRETE PADRÃO SP > MA',
                type: 'GENERAL',
                routeId: 'route-sp-ma',
                freightValue: 1.15,
                freightUnit: 'RS_KG',
                minFreightValue: 180,
                minFreightUnit: 'RS',
                adValoremPercent: 10,
                grisPercent: 0.3,
                tollValue: 35,
                tollUnit: 'FIXED',
                cubeEnabled: true,
                cubeFactor: 300,
                icmsIncluded: false,
                icmsPercent: 12,
                priority: 0,
            }
        }),
        prisma.pricingTable.upsert({
            where: { id: 'table-eletro-sp-ma' },
            update: {},
            create: {
                id: 'table-eletro-sp-ma',
                description: 'ELETROPORTÁTEIS ** 10% + ICMS',
                type: 'GENERAL',
                routeId: 'route-sp-ma',
                freightValue: 10,
                freightUnit: 'PERCENT',
                adValoremPercent: 15,
                grisPercent: 0.5,
                cubeEnabled: true,
                cubeFactor: 300,
                icmsIncluded: false,
                icmsPercent: 12,
                priority: 10,
            }
        }),
        prisma.pricingTable.upsert({
            where: { id: 'table-geladeira-sp-ma' },
            update: {},
            create: {
                id: 'table-geladeira-sp-ma',
                description: 'GELADEIRA ** 15% + ICMS',
                type: 'GENERAL',
                routeId: 'route-sp-ma',
                freightValue: 15,
                freightUnit: 'PERCENT',
                adValoremPercent: 15,
                grisPercent: 0.5,
                cubeEnabled: true,
                cubeFactor: 300,
                icmsIncluded: false,
                icmsPercent: 12,
                priority: 10,
            }
        }),
    ]);
    console.log(`   ✅ Created ${pricingTables.length} pricing tables`);

    // Create min freight ranges
    console.log('📊 Creating min freight ranges...');
    await prisma.minFreightRange.createMany({
        data: [
            { pricingTableId: 'table-general-sp-ma', minWeight: 0, maxWeight: 50, value: 180 },
            { pricingTableId: 'table-general-sp-ma', minWeight: 50, maxWeight: 100, value: 250 },
            { pricingTableId: 'table-general-sp-ma', minWeight: 100, maxWeight: 500, value: 400 },
            { pricingTableId: 'table-general-sp-ma', minWeight: 500, maxWeight: null, value: 600 },
        ],
        skipDuplicates: true,
    });
    console.log('   ✅ Created min freight ranges');

    // Create NF species (espécies para notas fiscais)
    console.log('📋 Creating NF species...');
    const speciesNames = ['Palete', 'Caixa', 'Engradado', 'Volume'];
    for (const name of speciesNames) {
        await prisma.nfSpecies.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }
    console.log(`   ✅ Created ${speciesNames.length} NF species`);

    // Create admin user
    console.log('👤 Creating admin user...');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const adminUser = await prisma.user.upsert({
        where: { email: 'admin@tsmex.com' },
        update: {},
        create: {
            email: 'admin@tsmex.com',
            password: hashedPassword,
            roles: ['ADMIN'],
            admin: {
                create: {
                    name: 'Administrador TSM EX',
                }
            }
        },
        include: { admin: true }
    });
    console.log(`   ✅ Admin user created: ${adminUser.email}`);

    // Create sample client with Account
    console.log('🏢 Creating sample client with Account...');
    const clientPassword = await bcrypt.hash('cliente123', 10);
    
    // Create Account first
    const account = await prisma.account.upsert({
        where: { id: 'account-exemplo-123' },
        update: {},
        create: {
            id: 'account-exemplo-123',
            name: 'Empresa Exemplo LTDA',
            accountType: 'COMPANY',
            companies: {
                create: {
                    cnpj: '12.345.678/0001-90',
                    legalName: 'Empresa Exemplo LTDA',
                    tradeName: 'Exemplo',
                    city: 'São Paulo',
                    state: 'SP',
                    isPrimary: true,
                }
            },
            contacts: {
                create: {
                    name: 'João Silva',
                    role: 'Gerente de Logística',
                    email: 'joao@exemplo.com',
                    phone: '(11) 99999-9999',
                    isPrimary: true,
                }
            }
        },
        include: {
            companies: true,
            contacts: true,
        }
    });
    
    const primaryCompany = account.companies[0];
    
    const clientUser = await prisma.user.upsert({
        where: { email: 'cliente@exemplo.com' },
        update: {},
        create: {
            email: 'cliente@exemplo.com',
            password: clientPassword,
            roles: ['CLIENT'],
            accountId: account.id,
            client: {
                create: {
                    companyName: 'Empresa Exemplo LTDA',
                    tradeName: 'Exemplo',
                    document: '12.345.678/0001-90',
                    contactName: 'João Silva',
                    phone: '(11) 99999-9999',
                    defaultOrigin: 'São Paulo, SP',
                    accountId: account.id,
                    accountCompanyId: primaryCompany.id,
                }
            }
        },
        include: { client: true }
    });
    console.log(`   ✅ Client user created: ${clientUser.email} with Account`);

    // Create sample link
    console.log('🚛 Creating sample link...');
    const truckType = vehicleTypes.find(v => v.code === 'TRUCK');
    if (truckType) {
        const linkPassword = await bcrypt.hash('link123', 10);
        const linkUser = await prisma.user.upsert({
            where: { email: 'motorista@exemplo.com' },
            update: {},
            create: {
                email: 'motorista@exemplo.com',
                password: linkPassword,
                roles: ['LINK'],
                link: {
                    create: {
                        name: 'Carlos Motorista',
                        document: '123.456.789-00',
                        phone: '(11) 98888-8888',
                        vehicleTypeId: truckType.id,
                        vehiclePlate: 'ABC-1234',
                        vehicleYear: 2022,
                        homeBase: 'São Paulo, SP',
                        coverageStates: ['SP', 'MG', 'RJ', 'MA', 'CE'],
                        approvalStatus: 'APPROVED',
                        active: true,
                        score: 4.8,
                    }
                }
            },
            include: { link: true }
        });
        console.log(`   ✅ Link user created: ${linkUser.email}`);
    }

    // Create LLM providers (pre-configured)
    console.log('🤖 Creating LLM providers...');
    await Promise.all([
        prisma.lLMProvider.upsert({
            where: { code: 'gemini' },
            update: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiFormat: 'gemini', isBuiltIn: true },
            create: {
                code: 'gemini',
                name: 'Google Gemini',
                apiFormat: 'gemini',
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                supportsTools: true,
                isBuiltIn: true,
            }
        }),
        prisma.lLMProvider.upsert({
            where: { code: 'openai' },
            update: { baseUrl: 'https://api.openai.com/v1', apiFormat: 'openai', isBuiltIn: true },
            create: {
                code: 'openai',
                name: 'OpenAI',
                apiFormat: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                supportsTools: true,
                isBuiltIn: true,
            }
        }),
        prisma.lLMProvider.upsert({
            where: { code: 'deepseek' },
            update: { baseUrl: 'https://api.deepseek.com', apiFormat: 'openai', isBuiltIn: true },
            create: {
                code: 'deepseek',
                name: 'DeepSeek',
                apiFormat: 'openai',
                baseUrl: 'https://api.deepseek.com',
                supportsTools: true,
                isBuiltIn: true,
            }
        }),
        prisma.lLMProvider.upsert({
            where: { code: 'anthropic' },
            update: { baseUrl: 'https://api.anthropic.com/v1', apiFormat: 'anthropic', isBuiltIn: true },
            create: {
                code: 'anthropic',
                name: 'Anthropic Claude',
                apiFormat: 'anthropic',
                baseUrl: 'https://api.anthropic.com/v1',
                supportsTools: true,
                isBuiltIn: true,
            }
        }),
        prisma.lLMProvider.upsert({
            where: { code: 'groq' },
            update: { baseUrl: 'https://api.groq.com/openai/v1', apiFormat: 'openai', isBuiltIn: true },
            create: {
                code: 'groq',
                name: 'Groq',
                apiFormat: 'openai',
                baseUrl: 'https://api.groq.com/openai/v1',
                supportsTools: true,
                isBuiltIn: true,
            }
        }),
        prisma.lLMProvider.upsert({
            where: { code: 'together' },
            update: { baseUrl: 'https://api.together.xyz/v1', apiFormat: 'openai', isBuiltIn: true },
            create: {
                code: 'together',
                name: 'Together AI',
                apiFormat: 'openai',
                baseUrl: 'https://api.together.xyz/v1',
                supportsTools: true,
                isBuiltIn: true,
            }
        }),
    ]);
    console.log('   ✅ Created 6 LLM providers');

    // Create states and cities
    console.log('🗺️ Creating states and cities...');
    await seedStatesAndCities(prisma);
    console.log('   ✅ States and cities created');

    console.log('\n✨ Seed completed successfully!\n');
    console.log('📋 Test credentials:');
    console.log('   Admin: admin@tsmex.com / admin123');
    console.log('   Client: cliente@exemplo.com / cliente123');
    console.log('   Link: motorista@exemplo.com / link123');
}

// Seed states and cities from IBGE API
async function seedStatesAndCities(prisma: PrismaClient) {
    try {
        // Check if states already exist
        const existingStates = await prisma.state.count();
        if (existingStates > 0) {
            console.log('   ⏭️  States already exist, skipping...');
            return;
        }

        // Fetch states from IBGE API
        const statesResponse = await axios.get('https://servicodados.ibge.gov.br/api/v1/localidades/estados', {
            timeout: 30000,
        });

        const statesData = statesResponse.data;

        // Create states
        for (const stateData of statesData) {
            await prisma.state.create({
                data: {
                    code: stateData.sigla,
                    name: stateData.nome,
                    ibgeCode: String(stateData.id),
                }
            });
        }

        console.log(`   ✅ Created ${statesData.length} states`);

        // Fetch cities for each state (in batches to avoid timeout)
        let totalCities = 0;
        for (const stateData of statesData) {
            try {
                const citiesResponse = await axios.get(
                    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateData.id}/municipios`,
                    { timeout: 30000 }
                );

                const citiesData = citiesResponse.data;
                const state = await prisma.state.findUnique({
                    where: { code: stateData.sigla }
                });

                if (state) {
                    // Create cities in batches
                    const batchSize = 100;
                    for (let i = 0; i < citiesData.length; i += batchSize) {
                        const batch = citiesData.slice(i, i + batchSize);
                        await prisma.city.createMany({
                            data: batch.map((cityData: any) => ({
                                stateId: state.id,
                                name: cityData.nome,
                                ibgeCode: String(cityData.id),
                            })),
                            skipDuplicates: true,
                        });
                    }
                    totalCities += citiesData.length;
                    console.log(`   ✅ Created ${citiesData.length} cities for ${stateData.nome}`);
                }
            } catch (error: any) {
                console.error(`   ⚠️  Error fetching cities for ${stateData.nome}:`, error.message);
            }
        }

        console.log(`   ✅ Total cities created: ${totalCities}`);
    } catch (error: any) {
        console.error('   ❌ Error seeding states and cities:', error.message);
        // Don't throw - allow seed to continue even if this fails
    }
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
