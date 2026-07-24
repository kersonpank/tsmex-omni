import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveStateRegistration } from '../services/fiscal/resolveStateRegistration.js';
import { fetchNfeCompleta } from '../services/fiscal/fetchNfeCompleta.js';

const router = Router();

/**
 * Parse da chave de acesso NF-e / CT-e (44 dígitos).
 * Suporta modelo 55 (NF-e) e modelo 57 (CT-e).
 *
 * Nota: não reutiliza `lib/nfeChaveParser.ts` (parseNFeChave55) porque aquele
 * parser rejeita modelos diferentes de 55. Esta função suporta também CT-e (57).
 */
function parseChaveNFe(chave: string) {
  const digits = chave.replace(/\D/g, '');
  if (digits.length !== 44) return null;

  const cUF = digits.slice(0, 2);
  const aamm = digits.slice(2, 6);
  const cnpjEmit = digits.slice(6, 20);
  const mod = digits.slice(20, 22);
  const serie = digits.slice(22, 25);
  const nnf = digits.slice(25, 34);

  const year = parseInt(aamm.slice(0, 2), 10);
  const month = aamm.slice(2, 4);
  const fullYear = year >= 90 ? `19${aamm.slice(0, 2)}` : `20${aamm.slice(0, 2)}`;
  const emissionDate = `${fullYear}-${month}-01`;

  const ufMap: Record<string, string> = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
    '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
    '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
    '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
    '52': 'GO', '53': 'DF',
  };

  return {
    chave: digits,
    cUF,
    uf: ufMap[cUF] ?? cUF,
    aamm,
    cnpjEmit,
    mod,
    serie: String(parseInt(serie, 10)),
    nnf: String(parseInt(nnf, 10)),
    emissionDate,
  };
}

/**
 * Extrai a chave de 44 dígitos de uma string de input.
 * Aceita: chave pura (44 dígitos), ou URL de QR Code com params chNFe ou p.
 *
 * ATENÇÃO: sempre revalide o comprimento do retorno — se a extração falhar,
 * retorna os dígitos do input original, que pode ter comprimento diferente de 44.
 */
function extractChaveFromUrl(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 44) return digits;

  // QR Code NF-e contém URL com param chNFe ou p=CHAVE|...
  try {
    const url = new URL(input);
    const chNFe = url.searchParams.get('chNFe') ?? url.searchParams.get('p');
    if (chNFe) {
      const extracted = chNFe.split('|')[0].replace(/\D/g, '');
      if (extracted.length === 44) return extracted;
    }
  } catch {
    // não é URL, continua
  }
  return digits;
}

// GET /api/nfe/:chave
router.get('/:chave', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = decodeURIComponent(Array.isArray(req.params.chave) ? req.params.chave[0] : req.params.chave);
    const chave = extractChaveFromUrl(raw);

    if (!chave || chave.length !== 44) {
      throw new AppError('Chave NF-e inválida (deve ter 44 dígitos)', 400);
    }

    const parsed = parseChaveNFe(chave);
    if (!parsed) {
      throw new AppError('Não foi possível interpretar a chave NF-e', 400);
    }

    // Busca razão social do emitente via BrasilAPI (gratuita, sem autenticação) — cadastro
    // FEDERAL (Receita Federal), não tem Inscrição Estadual (registro ESTADUAL).
    let emitenteRazaoSocial: string | null = null;
    let emitenteTradeName: string | null = null;
    let emitenteMunicipio: string | null = null;
    let emitenteCep: string | null = null;
    let emitenteLogradouro: string | null = null;
    let emitenteNumero: string | null = null;
    let emitenteBairro: string | null = null;
    try {
      const cnpjRes = await axios.get(
        `https://brasilapi.com.br/api/cnpj/v1/${parsed.cnpjEmit}`,
        { timeout: 5000 }
      );
      emitenteRazaoSocial = cnpjRes.data?.razao_social ?? null;
      emitenteTradeName = cnpjRes.data?.nome_fantasia ?? null;
      emitenteMunicipio = cnpjRes.data?.municipio ?? null;
      emitenteCep = cnpjRes.data?.cep ? String(cnpjRes.data.cep).replace(/\D/g, '') : null;
      emitenteLogradouro = cnpjRes.data?.logradouro ?? null;
      emitenteNumero = cnpjRes.data?.numero ?? null;
      emitenteBairro = cnpjRes.data?.bairro ?? null;
    } catch {
      // BrasilAPI falhou — retorna sem razão social, não bloqueia operação
    }

    // Cascata: nossa base (grátis) > ACBr sob demanda via cons-chave (síncrono, persiste pra
    // próxima vez sair grátis também) > o que já temos da BrasilAPI acima. `hubId` decide qual
    // FiscalEmitter/CNPJ usar pra falar com a ACBr — sem ele (ex.: ADMIN sem hub selecionado
    // ainda), cai direto pro fallback parcial da BrasilAPI, sem erro.
    const hubId = typeof req.query.hubId === 'string' ? req.query.hubId : undefined;
    let cargoData: Awaited<ReturnType<typeof fetchNfeCompleta>> = null;
    try {
      cargoData = await fetchNfeCompleta(hubId, chave);
    } catch {
      // Busca completa é best-effort — nunca bloqueia o lookup da NF-e.
    }

    if (cargoData?.emitente?.razaoSocial) emitenteRazaoSocial = cargoData.emitente.razaoSocial;
    if (cargoData?.emitente?.municipio) emitenteMunicipio = cargoData.emitente.municipio;

    // IE (Inscrição Estadual): resolve pela fonte mais barata — Person já cadastrado > XML da
    // NF-e já baixado via Distribuição ACBr (grátis, já pago) > Sintegra (crédito, só se as
    // duas anteriores não resolverem). Nunca bloqueia a resposta se qualquer etapa falhar.
    let emitenteIe: string | undefined;
    let destinatarioIe: string | undefined;
    try {
      emitenteIe = await resolveStateRegistration(parsed.cnpjEmit, cargoData?.emitente?.ie);
      if (cargoData?.destinatario?.cnpj) {
        destinatarioIe = await resolveStateRegistration(cargoData.destinatario.cnpj, cargoData.destinatario.ie);
      }
    } catch {
      // Resolução de IE é best-effort — nunca bloqueia o lookup da NF-e.
    }

    res.json({
      success: true,
      data: {
        chave: parsed.chave,
        uf: parsed.uf,
        serie: parsed.serie,
        numero: parsed.nnf,
        emissionDate: parsed.emissionDate,
        cnpjEmitente: parsed.cnpjEmit,
        emitenteRazaoSocial,
        emitenteTradeName,
        emitenteMunicipio,
        emitenteCep,
        emitenteLogradouro,
        emitenteNumero,
        emitenteBairro,
        emitenteIe: emitenteIe ?? null,
        destinatario: cargoData?.destinatario?.cnpj
          ? {
              cnpj: cargoData.destinatario.cnpj,
              razaoSocial: cargoData.destinatario.razaoSocial || null,
              ie: destinatarioIe ?? null,
            }
          : null,
        modelo: parsed.mod === '55' ? 'NF-e' : parsed.mod === '57' ? 'CT-e' : parsed.mod,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as nfeRouter };
