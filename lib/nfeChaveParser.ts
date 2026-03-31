/**
 * Parser da chave de acesso NFe Modelo 55 (44 dígitos)
 * Estrutura: UF(2) + AAMM(4) + CNPJ(14) + Mod(2) + Serie(3) + NNF(9) + TipoEmissao(1) + Codigo(8) + DV(1)
 */

export interface NFeChaveParsed {
  uf: string;
  aamm: string;
  cnpj: string;
  modelo: string;
  serie: string;
  nnf: string;
  emissionDate: string; // YYYY-MM-DD (dia 01 do mês)
  isValid: boolean;
}

export function parseNFeChave55(chave: string): NFeChaveParsed | null {
  if (!chave || typeof chave !== 'string') return null;
  const digits = chave.replace(/\D/g, '');
  if (digits.length !== 44) return null;

  const modelo = digits.slice(20, 22);
  if (modelo !== '55') return null;

  const uf = digits.slice(0, 2);
  const aamm = digits.slice(2, 6);
  const cnpj = digits.slice(6, 20);
  const serie = digits.slice(22, 25);
  const nnf = digits.slice(25, 34);

  const year = aamm.slice(0, 2);
  const month = aamm.slice(2, 4);
  const fullYear = parseInt(year, 10) >= 90 ? `19${year}` : `20${year}`;
  const emissionDate = `${fullYear}-${month}-01`;

  return {
    uf,
    aamm,
    cnpj,
    modelo,
    serie,
    nnf,
    emissionDate,
    isValid: true,
  };
}
