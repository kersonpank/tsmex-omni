import type { Driver, Link, Person } from '@prisma/client';
import { requireSelectedIbge } from '../selectedCity.js';
import { efreteAuthedPost } from './efreteAuth.js';
import { digits, splitPhone } from './efreteUtil.js';
import type { EfreteEnvironment } from './efreteConfig.js';

async function buildEndereco(person: Person | null | undefined): Promise<Record<string, unknown>> {
    if (!person) throw new Error('Pessoa sem endereço cadastrado — obrigatório para registro na eFrete.');
    const cMun = await requireSelectedIbge(person.city, person.state, person.cityIbgeCode);
    return {
        Bairro: person.neighborhood || 'Centro',
        CEP: digits(person.cep).padStart(8, '0').slice(0, 8),
        CodigoMunicipio: Number(cMun),
        Rua: person.address || 'S/N',
        Numero: person.number || 'S/N',
        ...(person.complement ? { Complemento: person.complement } : {}),
    };
}

interface EfreteGravarResponse {
    Sucesso?: boolean;
    Excecao?: { Mensagem?: string; Codigo?: string };
}

/** Gravar Motorista — idempotente (existe → atualiza; não existe → cria). Sempre antes de emitir operação. */
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

/** Gravar Proprietário — RNTRC validado pela ANTT no momento do registro. */
export async function ensureProprietarioRegistrado(link: Link & { person: Person | null }, environment: EfreteEnvironment): Promise<void> {
    if (!link.rntrc) throw new Error(`Link ${link.name}: RNTRC obrigatório para registro de Proprietário na eFrete.`);
    const doc = digits(link.vehicleOwnerDocument || link.document);

    await efreteAuthedPost<EfreteGravarResponse>(
        '/services/proprietarios/gravarV2',
        {
            CNPJ: doc, // campo se chama CNPJ no manual, mas aceita CPF (11) ou CNPJ (14)
            Endereco: await buildEndereco(link.person),
            RNTRC: digits(link.rntrc).padStart(9, '0').slice(0, 9),
            RazaoSocial: link.vehicleOwnerName || link.name,
        },
        { versao: 3, environment },
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
                RNTRC: digits(unit.rntrc).padStart(9, '0').slice(0, 9),
                Renavam: Number(digits(unit.renavam)),
                TipoCarroceria: unit.bodyType || 'NaoAplicavel',
                TipoRodado: unit.wheelType || 'NaoAplicavel',
            },
        },
        { versao: 1, environment },
    );
}
