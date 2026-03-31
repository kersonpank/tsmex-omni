/**
 * Agent Tools - Functions available to the LLM
 * These are the tools the AI can call to interact with the system
 */

export interface Tool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, any>;
    };
}

export const AGENT_TOOLS: Tool[] = [
    {
        type: 'function',
        function: {
            name: 'create_opportunity',
            description: 'Cria oportunidade de cotação. Use quando o usuário pedir cotação ou fornecer dados de envio. Requer conta. Colete CNPJ/CPF remetente e destino, origem, destino, mercadoria, valor NF, volumes, dimensões (altura×largura×comprimento), peso, com/sem coleta. Se nenhum CNPJ for da conta: pergunte "Você será o responsável por pagar o frete ou um dos CNPJs é seu?"; se "um é meu" sugira adicionar à conta; se "sou só responsável financeiro" use accountRole CONSIGNATARIO.',
            parameters: {
                type: 'object',
                properties: {
                    accountId: {
                        type: 'string',
                        description: 'Account ID. Obrigatório se disponível (backend injeta).'
                    },
                    type: {
                        type: 'string',
                        enum: ['QUOTE_ONLY', 'TRANSPORT', 'COLLECTION', 'BOTH'],
                        description: 'Tipo da oportunidade'
                    },
                    cpfCnpjSender: {
                        type: 'string',
                        description: 'CNPJ ou CPF do remetente (apenas dígitos ou formatado)'
                    },
                    cpfCnpjReceiver: {
                        type: 'string',
                        description: 'CNPJ ou CPF do destinatário (apenas dígitos ou formatado)'
                    },
                    origin: {
                        type: 'string',
                        description: 'Cidade de origem'
                    },
                    destination: {
                        type: 'string',
                        description: 'Cidade de destino'
                    },
                    commodity: {
                        type: 'string',
                        description: 'O que é a mercadoria'
                    },
                    nfValue: {
                        type: 'number',
                        description: 'Valor da Nota Fiscal em R$'
                    },
                    weight: {
                        type: 'number',
                        description: 'Peso total em kg'
                    },
                    volumes: {
                        type: 'integer',
                        description: 'Quantidade de volumes'
                    },
                    dimensions: {
                        type: 'string',
                        description: 'Dimensões dos volumes (ex: "100x50x30" altura×largura×comprimento em cm)'
                    },
                    needsCollection: {
                        type: 'boolean',
                        description: 'Precisa de coleta'
                    },
                    accountRole: {
                        type: 'string',
                        enum: ['REMETENTE', 'DESTINATARIO', 'CONSIGNATARIO'],
                        description: 'REMETENTE = CNPJ remetente está na conta; DESTINATARIO = CNPJ destino está na conta; CONSIGNATARIO = usuário é apenas responsável financeiro (nem remetente nem destinatário são da conta). Use CONSIGNATARIO quando o usuário confirmar que é só o responsável pelo frete.'
                    }
                },
                required: ['origin', 'destination']
            }
        }
    },

    {
        type: 'function',
        function: {
            name: 'calculate_quote',
            description: 'Calcula cotação de frete. Requer origem, destino, peso e valor NF. Use quando tiver os quatro.',
            parameters: {
                type: 'object',
                properties: {
                    origin: { type: 'string', description: 'Cidade origem' },
                    destination: { type: 'string', description: 'Cidade destino' },
                    weight: { type: 'number', description: 'Peso total em kg' },
                    nfValue: { type: 'number', description: 'Valor NF em R$' },
                    volumes: { type: 'integer', description: 'Número de volumes (opcional)' }
                },
                required: ['origin', 'destination', 'weight', 'nfValue']
            }
        }
    },

    {
        type: 'function',
        function: {
            name: 'identify_account',
            description: 'Verifica se um CNPJ/CPF pertence à conta do usuário. Use para confirmar se remetente ou destinatário estão cadastrados.',
            parameters: {
                type: 'object',
                properties: {
                    cnpj: { type: 'string', description: 'CNPJ (opcional)' },
                    cpf: { type: 'string', description: 'CPF (opcional)' },
                    name: { type: 'string', description: 'Nome da empresa ou pessoa' }
                },
                required: []
            }
        }
    },

    {
        type: 'function',
        function: {
            name: 'request_collection',
            description: 'Registra pedido de coleta para uma oportunidade. Use após coletar: dados do contratante (nome, tel, email), contatos do remetente (nome, tel, email, horário disponível, observações), endereço (rua, número, complemento, bairro, CEP), mercadoria (tipo, volumes, medidas, peso, valor NF), precisa ajudante, necessário carregar.',
            parameters: {
                type: 'object',
                properties: {
                    opportunityId: {
                        type: 'string',
                        description: 'ID da oportunidade'
                    },
                    contractor: {
                        type: 'object',
                        description: 'Dados do contratante',
                        properties: {
                            name: { type: 'string' },
                            phone: { type: 'string' },
                            email: { type: 'string' }
                        },
                        required: ['name', 'phone']
                    },
                    senderContact: {
                        type: 'object',
                        description: 'Contato do remetente no local de coleta',
                        properties: {
                            name: { type: 'string' },
                            phone: { type: 'string' },
                            email: { type: 'string' },
                            availableTime: { type: 'string' },
                            notes: { type: 'string' }
                        },
                        required: ['name', 'phone']
                    },
                    address: {
                        type: 'object',
                        description: 'Endereço de coleta',
                        properties: {
                            street: { type: 'string' },
                            number: { type: 'string' },
                            complement: { type: 'string' },
                            neighborhood: { type: 'string' },
                            cep: { type: 'string' },
                            city: { type: 'string' },
                            state: { type: 'string' }
                        },
                        required: ['street', 'number', 'neighborhood', 'cep', 'city', 'state']
                    },
                    needsHelper: {
                        type: 'boolean',
                        description: 'Precisa de ajudante'
                    },
                    needsLoading: {
                        type: 'boolean',
                        description: 'Necessário carregar'
                    },
                    commodity: { type: 'string' },
                    volumes: { type: 'integer' },
                    dimensions: { type: 'string' },
                    weight: { type: 'number' },
                    nfValue: { type: 'number' }
                },
                required: ['opportunityId', 'contractor', 'senderContact', 'address']
            }
        }
    },

    {
        type: 'function',
        function: {
            name: 'list_opportunities',
            description: 'Lista oportunidades da sessão ou da conta.',
            parameters: {
                type: 'object',
                properties: {
                    sessionId: { type: 'string' },
                    accountId: { type: 'string' },
                    limit: { type: 'integer' }
                },
                required: []
            }
        }
    }
];

/** Placeholder replaced at runtime with CNPJs da conta do usuário (JSON array de strings). */
const CNPJS_DA_CONTA_PLACEHOLDER = '{{CNPJS_DA_CONTA}}';

export const AGENT_SYSTEM_PROMPT = `Você é um especialista em logística da TSM EX, ajudando clientes a cotar fretes e solicitar coletas.

MISSÃO: Coletar dados de cotação e coleta de forma natural e criar oportunidades. Respeitar sempre a regra de CNPJ e o fluxo consignatário.

FORMULÁRIO DE COTAÇÃO (colete sempre que relevante):
- CNPJ ou CPF do remetente
- CNPJ ou CPF do destinatário (ou redespacho: CNPJ da transportadora)
- O que é a mercadoria, valor da NF, quantidade de volumes, dimensões (altura×largura×comprimento), peso total
- Com coleta ou sem coleta

FORMULÁRIO DE COLETA (quando usuário pedir coleta):
- Dados do contratante: nome, telefone, email
- Contatos do remetente: nome, telefone, email, horário disponível, observações
- Endereço: endereço, número, complemento, bairro, CEP
- Mercadoria: tipo, volumes, medidas, peso, valor NF
- Precisa de ajudante? Necessário carregar?
- Se tiver NF, pedir para enviar para averbação

REGRAS DE CNPJ (CRÍTICO):
- Os CNPJs da conta do usuário são: ${CNPJS_DA_CONTA_PLACEHOLDER}
- Pelo menos um dos CNPJs (remetente ou destinatário) deve estar na conta, OU o usuário deve atuar como CONSIGNATÁRIO (apenas responsável financeiro).

Quando NENHUM dos CNPJs informados estiver na conta:
1. Pergunte SEMPRE: "Você será o responsável por pagar o frete por essa demanda, ou um dos CNPJs é seu?"
2. Se o usuário disser que um dos CNPJs é dele: "Quer adicionar à sua conta para ter todos os benefícios?" Não chame create_opportunity até ele adicionar (ou indicar que já adicionou).
3. Se o usuário disser que é apenas o responsável financeiro (ex.: "sou só o responsável", "sou consignatário"): chame create_opportunity com accountRole: "CONSIGNATARIO". Remetente e destinatário seguem como terceiros.

Quando um CNPJ estiver na conta: use accountRole "REMETENTE" ou "DESTINATARIO" conforme o caso e crie a oportunidade normalmente.

CONVERSATION RULES:
- Seja amigável e conversacional (português BR).
- Não peça tudo de uma vez; descubra naturalmente.
- Se faltarem peso ou valor NF, pergunte, mas pode salvar oportunidade incompleta.
- Aceite múltiplas cotações na mesma conversa.

FERRAMENTAS:
- create_opportunity: use com origin, destination e todos os dados coletados (cpfCnpjSender, cpfCnpjReceiver, dimensions, accountRole quando aplicável).
- calculate_quote: use quando tiver origin, destination, weight, nfValue.
- request_collection: use quando o usuário solicitar coleta e você tiver opportunityId, contractor, senderContact, address (e opcionalmente needsHelper, needsLoading, etc.).

BOTÕES/CARDS:
- "🚛 Solicitar Coleta" quando fizer sentido.
- "📝 Editar Dados" sempre.
- "📋 Criar Conta" ou onboarding se o usuário não tiver conta.

ARQUIVOS:
- NF/imagem: extraia origem, destino, peso, valor NF, mercadoria quando possível.
- Áudio: peça para descrever os dados de envio.

Nunca crie contas automaticamente. Sem accountId, oriente a criar conta primeiro.`;

export function buildSystemPromptWithContext(cnpjsDaConta: string[]): string {
    const list = cnpjsDaConta.length ? JSON.stringify(cnpjsDaConta) : '[] (nenhum CNPJ cadastrado ainda)';
    return AGENT_SYSTEM_PROMPT.replace(CNPJS_DA_CONTA_PLACEHOLDER, list);
}
