/** Opções alinhadas ao catálogo MVP do backend (cteTaxRules). */

export const CTE_CFOP_SELECT_OPTIONS = [
  { code: '6351', label: 'Transporte para serviço da mesma natureza' },
  { code: '6352', label: 'Transporte a estabelecimento industrial' },
  { code: '6353', label: 'Transporte a estabelecimento comercial' },
  { code: '6354', label: 'Transporte a comunicação' },
  { code: '6355', label: 'Transporte a energia' },
  { code: '6356', label: 'Transporte a produtor rural' },
  { code: '6357', label: 'Transporte a não contribuinte' },
  { code: '6360', label: 'Transporte a contribuinte substituto' },
  { code: '6932', label: 'Prestação iniciada em UF diversa' },
  { code: '6949', label: 'Outra prestação de serviço' },
  { code: '7358', label: 'Transporte para o exterior' },
] as const;

export const CTE_CST_SELECT_OPTIONS = [
  { code: '00', label: 'Tributada integralmente' },
  { code: '20', label: 'Com redução de base de cálculo' },
  { code: '40', label: 'Isenta' },
  { code: '41', label: 'Não tributada' },
  { code: '51', label: 'Diferimento' },
  { code: '90', label: 'Outras' },
] as const;
