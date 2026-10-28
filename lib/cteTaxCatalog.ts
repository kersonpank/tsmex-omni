/**
 * Catálogo CFOP/CST alinhado ao backend `server/src/services/fiscal/cteTaxRules.ts`.
 * `labelFull` deve permanecer igual ao `label` de `CTE_CFOP_OPTIONS` no servidor.
 */

export interface CteCfopCatalogEntry {
    code: string;
    /** Texto curto na `<option>` (uma linha); `title` leva `labelFull`. */
    summary: string;
    /** Descrição oficial (mesma do servidor). */
    labelFull: string;
}

const INTERSTATE_AND_EXPORT_CFOPS: readonly CteCfopCatalogEntry[] = [
    {
        code: '6351',
        summary: 'Para execução de serviço da mesma natureza',
        labelFull: 'Prestação de serviço de transporte para execução de serviço da mesma natureza',
    },
    {
        code: '6352',
        summary: 'Transporte a estabelecimento industrial',
        labelFull: 'Prestação de serviço de transporte a estabelecimento industrial',
    },
    {
        code: '6353',
        summary: 'Transporte a estabelecimento comercial',
        labelFull: 'Prestação de serviço de transporte a estabelecimento comercial',
    },
    {
        code: '6354',
        summary: 'Transporte a prestador de comunicação',
        labelFull: 'Prestação de serviço de transporte a prestador de serviço de comunicação',
    },
    {
        code: '6355',
        summary: 'Transporte a geradora/distribuidora de energia',
        labelFull: 'Prestação de serviço de transporte a geradora/distribuidora de energia',
    },
    {
        code: '6356',
        summary: 'Transporte a produtor rural',
        labelFull: 'Prestação de serviço de transporte a produtor rural',
    },
    {
        code: '6357',
        summary: 'Transporte a não contribuinte',
        labelFull: 'Prestação de serviço de transporte a não contribuinte',
    },
    {
        code: '6359',
        summary: 'Transporte de mercadoria dispensada de nota fiscal',
        labelFull: 'Prestação de serviço de transporte de mercadoria dispensada de nota fiscal',
    },
    {
        code: '6360',
        summary: 'Transporte a contribuinte substituto',
        labelFull: 'Prestação de serviço de transporte a contribuinte substituto',
    },
    {
        code: '6932',
        summary: 'Prestação iniciada em UF diversa',
        labelFull: 'Prestação de serviço de transporte iniciada em UF diversa',
    },
    {
        code: '6949',
        summary: 'Outra prestação não especificada',
        labelFull: 'Outra prestação de serviço não especificada',
    },
    {
        code: '7358',
        summary: 'Transporte para o exterior',
        labelFull: 'Prestação de serviço de transporte para o exterior',
    },
] as const;

// Os correspondentes estaduais são previstos na relação de CFOP do MOC CT-e 4.00.
export const CTE_CFOP_SELECT_OPTIONS: readonly CteCfopCatalogEntry[] = [
    ...INTERSTATE_AND_EXPORT_CFOPS.filter((entry) => entry.code.startsWith('6')).map((entry) => ({
        ...entry,
        code: `5${entry.code.slice(1)}`,
    })),
    ...INTERSTATE_AND_EXPORT_CFOPS,
];

export function cfopOptionSelectText(entry: CteCfopCatalogEntry): string {
    return `${entry.code} | ${entry.summary}`;
}

export const CTE_CST_SELECT_OPTIONS = [
    { code: '00', label: 'Tributada integralmente' },
    { code: '20', label: 'Com redução de base de cálculo' },
    { code: '40', label: 'Isenta' },
    { code: '41', label: 'Não tributada' },
    { code: '51', label: 'Diferimento' },
    { code: '90', label: 'Outras' },
] as const;
