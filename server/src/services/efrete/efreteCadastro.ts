import type { Driver, Link, Person } from '@prisma/client';
import { requireSelectedIbge } from '../selectedCity.js';
import { efreteAuthedPost } from './efreteAuth.js';
import { digits, normalizeEfreteAddressNumber, normalizeEfreteCep, splitPhone } from './efreteUtil.js';
import type { EfreteEnvironment } from './efreteConfig.js';

async function buildEndereco(person: Person | null | undefined): Promise<Record<string, unknown>> {
    if (!person) throw new Error('Pessoa sem endereço cadastrado — obrigatório para registro na eFrete.');
    const cMun = await requireSelectedIbge(person.city, person.state, person.cityIbgeCode);
    return {
        Bairro: person.neighborhood || 'Centro',
        CEP: normalizeEfreteCep(person.cep, 'Endereço cadastrado'),
        CodigoMunicipio: Number(cMun),
        Rua: person.address || 'S/N',
        Numero: normalizeEfreteAddressNumber(person.number),
        ...(person.complement ? { Complemento: person.complement } : {}),
    };
}

interface EfreteGravarResponse {
    Sucesso?: boolean;
    Excecao?: { Mensagem?: string; Codigo?: string };
}

/**
 * Gravar Motorista — idempotente (existe → atualiza; não existe → cria). Sempre antes de emitir operação.
 * v8.2 MP08 exige endereço no cadastro; o bloco Motorista da operação (AP99) só leva CPF/CNH/celular.
 */
export async function ensureMotoristaRegistrado(driver: Driver & { person: Person | null }, environment: EfreteEnvironment): Promise<void> {
    if (!driver.cnhNumber) throw new Error(`Motorista ${driver.name}: CNH obrigatória para registro na eFrete.`);
    if (!driver.birthDate) throw new Error(`Motorista ${driver.name}: data de nascimento obrigatória para registro na eFrete.`);

    await efreteAuthedPost<EfreteGravarResponse>(
        '/services/motoristas/gravar',
        {
            CNH: driver.cnhNumber,
            CPF: digits(driver.document).padStart(11, '0').slice(0, 11),
            DataNascimento: driver.birthDate.toISOString(),
            Endereco: await buildEndereco(driver.person),
            Nome: driver.name,
            ...(splitPhone(driver.phone)
                ? { Telefones: { Celular: { DDD: splitPhone(driver.phone)!.ddd, Numero: splitPhone(driver.phone)!.numero } } }
                : {}),
        },
        { versao: 2, environment },
    );
}

/**
 * Proprietário para a eFrete = responsável RNTRC da unidade (quem responde na ANTT), com o documento,
 * nome e RNTRC do retrato da viagem e o endereço da pessoa.
 */
export interface EfreteProprietarioInput {
    document: string;
    name: string;
    rntrc: string | null;
    person: Person | null;
}

/** Proprietário legado: derivado do Link (viagens sem responsável RNTRC no retrato). */
export function proprietarioFromLink(link: Link & { person: Person | null }): EfreteProprietarioInput {
    return { document: link.vehicleOwnerDocument || link.document, name: link.vehicleOwnerName || link.name, rntrc: link.rntrc, person: link.person };
}

/** Gravar Proprietário — RNTRC validado pela ANTT no momento do registro. */
export async function ensureProprietarioRegistrado(proprietario: EfreteProprietarioInput, environment: EfreteEnvironment): Promise<void> {
    if (!proprietario.rntrc) throw new Error(`${proprietario.name}: RNTRC obrigatório para registro de Proprietário na eFrete.`);

    await efreteAuthedPost<EfreteGravarResponse>(
        '/services/proprietarios/gravarV2',
        {
            CNPJ: digits(proprietario.document), // campo se chama CNPJ no manual, mas aceita CPF (11) ou CNPJ (14)
            Endereco: await buildEndereco(proprietario.person),
            // TODO: validar em sandbox os 9 dígitos do manual eFrete versus 8 dígitos ANTT/massa de teste.
            RNTRC: digits(proprietario.rntrc).padStart(9, '0').slice(0, 9),
            RazaoSocial: proprietario.name,
        },
        { versao: 4, environment },
    );
}

/** Dados mínimos de uma unidade (cavalo ou reboque) para o Gravar Veículo da e-Frete. */
export interface EfreteVeiculoInput {
    plate: string;
    chassi?: string | null;
    renavam?: string | null;
    axles?: number | null;
    rntrc?: string | null;
    bodyType?: string | null;
    wheelType?: string | null;
}

/**
 * Gravar Veículo — uma chamada por placa da composição (cavalo e cada reboque).
 * NumeroDeEixos é crítico pro cálculo de piso mínimo ANTT; RENAVAM e RNTRC são obrigatórios por unidade.
 */
export async function ensureVeiculoRegistrado(unit: EfreteVeiculoInput, environment: EfreteEnvironment): Promise<void> {
    const plate = unit.plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7);
    if (!unit.chassi) throw new Error(`Veículo ${plate}: chassi obrigatório para registro na eFrete.`);
    if (!unit.axles) throw new Error(`Veículo ${plate}: número de eixos obrigatório para registro na eFrete (piso mínimo ANTT).`);
    if (!unit.rntrc) throw new Error(`Veículo ${plate}: RNTRC obrigatório para registro na eFrete.`);
    if (!unit.renavam) throw new Error(`Veículo ${plate}: RENAVAM obrigatório para registro na eFrete.`);

    await efreteAuthedPost<EfreteGravarResponse>(
        '/services/veiculos/gravar',
        {
            Veiculo: {
                Chassi: unit.chassi,
                NumeroDeEixos: unit.axles,
                Placa: plate,
                // TODO: validar em sandbox os 9 dígitos do manual eFrete versus 8 dígitos ANTT/massa de teste.
                RNTRC: digits(unit.rntrc).padStart(9, '0').slice(0, 9),
                Renavam: Number(digits(unit.renavam)),
                TipoCarroceria: unit.bodyType || 'NaoAplicavel',
                TipoRodado: unit.wheelType || 'NaoAplicavel',
            },
        },
        { versao: 1, environment },
    );
}
