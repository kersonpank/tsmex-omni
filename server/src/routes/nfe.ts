import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

/** Parse da chave NF-e 44 dígitos (Modelo 55 e 57/CT-e) */
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

/** Extrai a chave de 44 dígitos de uma URL de QR Code de NF-e */
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
    const raw = decodeURIComponent(req.params.chave as string);
    const chave = extractChaveFromUrl(raw);

    if (!chave || chave.length !== 44) {
      throw new AppError('Chave NF-e inválida (deve ter 44 dígitos)', 400);
    }

    const parsed = parseChaveNFe(chave);
    if (!parsed) {
      throw new AppError('Não foi possível interpretar a chave NF-e', 400);
    }

    // Busca razão social do emitente via BrasilAPI (gratuita, sem autenticação)
    let emitenteRazaoSocial: string | null = null;
    let emitenteTradeName: string | null = null;
    try {
      const cnpjRes = await axios.get(
        `https://brasilapi.com.br/api/cnpj/v1/${parsed.cnpjEmit}`,
        { timeout: 5000 }
      );
      emitenteRazaoSocial = cnpjRes.data?.razao_social ?? null;
      emitenteTradeName = cnpjRes.data?.nome_fantasia ?? null;
    } catch {
      // BrasilAPI falhou — retorna sem razão social, não bloqueia operação
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
        modelo: parsed.mod === '55' ? 'NF-e' : parsed.mod === '57' ? 'CT-e' : parsed.mod,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as nfeRouter };
