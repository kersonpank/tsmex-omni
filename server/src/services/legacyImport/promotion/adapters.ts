import { paddedDocumentDigits, resolveLegacyDocument } from './documents.js';
import { text } from './source.js';

/**
 * Adaptadores: linha JSON do legado → linha "de CSV" (texto) com os apelidos de coluna que o
 * importador de cadastros (`importMasterData`) já entende. A regra de negócio (só preencher lacuna,
 * recusar DV/placa inválidos) continua toda no importador; aqui só se renomeiam e limpam campos.
 */
type Row = Record<string, string>;
type Data = Record<string, unknown>;

/** Pessoa e motorista saem da mesma listagem (`pessoas/json/lista`, filtrada por relação). */
export function personRow(d: Data): Row {
    const uf = text(d, 'uf');
    return {
        cnpj_cpf: paddedDocumentDigits(d.documento, d.tipodoc),
        nome: text(d, 'nome'),
        fantasia: text(d, 'fantasia'),
        cidade: text(d, 'cidade'),
        uf: /^[A-Za-z]{2}$/.test(uf) ? uf : '',
        // `endereco2` é o bairro (valores como CENTRO, ZONA RURAL, DISTRITO INDUSTRIAL).
        bairro: text(d, 'endereco2'),
    };
}

export function driverRow(d: Data): Row {
    const row = personRow(d);
    return { cpf: row.cnpj_cpf, nome: row.nome };
}

/** Peso/capacidade em kg: valores pequenos (1 a 499) são toneladas digitadas errado — não confiáveis. */
function kg(v: string): string {
    const n = Number(v.replace(/\D/g, ''));
    return n >= 500 ? String(n) : '';
}

function positive(v: string): string {
    const n = Number(v.replace(/\D/g, ''));
    return n > 0 ? String(n) : '';
}

export function vehicleRow(d: Data): Row {
    const owner = resolveLegacyDocument(d.proprietario);
    const year = positive(text(d, 'anomod')) || positive(text(d, 'anofab'));
    return {
        placa: text(d, 'placa'),
        // Texto do tipo ("CAVALO MECANICO", "S.REBQ. 3 EIXOS Aberta…") decide cavalo x reboque.
        tipo: text(d, 'tipvei'),
        marca: text(d, 'marca'),
        modelo: text(d, 'modelo'),
        chassi: text(d, 'chassi'),
        renavam: text(d, 'renavam').replace(/\D/g, ''),
        ano: year,
        eixos: positive(text(d, 'eixos')),
        tara: kg(text(d, 'tara')),
        capacidade_kgs: kg(text(d, 'capacidade_kgs')),
        uf_reg: text(d, 'uf_reg'),
        proprietario_cpf_cnpj: owner?.document ?? '',
        proprietario_nome: text(d, 'nome'),
    };
}
