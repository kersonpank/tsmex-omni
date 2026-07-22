import type { Driver, Link, Person } from '@prisma/client';
import { resolveIbgeMunicipio } from '../acbr/acbrIbge.js';
import { efreteAuthedPost } from './efreteAuth.js';
import { digits, splitPhone } from './efreteUtil.js';

async function buildEndereco(person: Person | null | undefined): Promise<Record<string, unknown>> {
    if (!person) throw new Error('Pessoa sem endereço cadastrado — obrigatório para registro na eFrete.');
    const cMun = await resolveIbgeMunicipio(person.city, person.state, person.cityIbgeCode);
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
export async function ensureMotoristaRegistrado(driver: Driver & { person: Person | null }): Promise<void> {
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
        { versao: 2 },
    );
}

/** Gravar Proprietário — RNTRC validado pela ANTT no momento do registro. */
export async function ensureProprietarioRegistrado(link: Link & { person: Person | null }): Promise<void> {
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
        { versao: 3 },
    );
}

/** Gravar Veículo — NumeroDeEixos é crítico pro cálculo de piso mínimo ANTT. */
export async function ensureVeiculoRegistrado(link: Link): Promise<void> {
    if (!link.vehicleChassi) throw new Error(`Link ${link.name}: chassi do veículo obrigatório para registro na eFrete.`);
    if (!link.vehicleAxles) throw new Error(`Link ${link.name}: número de eixos obrigatório para registro na eFrete (piso mínimo ANTT).`);
    if (!link.rntrc) throw new Error(`Link ${link.name}: RNTRC obrigatório para registro do veículo na eFrete.`);

    await efreteAuthedPost<EfreteGravarResponse>(
        '/services/veiculos/gravar',
        {
            Veiculo: {
                Chassi: link.vehicleChassi,
                NumeroDeEixos: link.vehicleAxles,
                Placa: link.vehiclePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7),
                RNTRC: digits(link.rntrc).padStart(9, '0').slice(0, 9),
                ...(link.vehicleRenavam ? { Renavam: Number(digits(link.vehicleRenavam)) } : {}),
                TipoCarroceria: link.vehicleBodyType || 'NaoAplicavel',
                TipoRodado: link.vehicleWheelType || 'NaoAplicavel',
            },
        },
        { versao: 1 },
    );
}
