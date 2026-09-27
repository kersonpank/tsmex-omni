import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { fetchNfeCompleta } from '../services/fiscal/fetchNfeCompleta.js';
import prisma from '../lib/prisma.js';
import { getCargoDataFromDistribuicaoDocument } from '../services/fiscal/nfeDistribuicaoCargoData.js';

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

    let emitenteRazaoSocial: string | null = null;
    let emitenteTradeName: string | null = null;
    let emitenteMunicipio: string | null = null;
    let emitenteCep: string | null = null;
    let emitenteLogradouro: string | null = null;
    let emitenteNumero: string | null = null;
    let emitenteBairro: string | null = null;

    // Leitura estritamente local. Este GET nunca consulta a ACBr/SEFAZ.
    const localDocument = await prisma.nfeDistribuicaoDocumento.findUnique({
      where: { accessKey: chave }, select: { tipo: true, xmlStorageKey: true },
    });
    const cargoData = localDocument ? await getCargoDataFromDistribuicaoDocument(localDocument).catch(() => null) : null;

    if (cargoData?.emitente?.razaoSocial) emitenteRazaoSocial = cargoData.emitente.razaoSocial;
    if (cargoData?.emitente?.municipio) emitenteMunicipio = cargoData.emitente.municipio;

    // IE (Inscrição Estadual): resolve pela fonte mais barata — Person já cadastrado > XML da
    // NF-e já baixado via Distribuição ACBr (grátis, já pago) > Sintegra (crédito, só se as
    // duas anteriores não resolverem). Nunca bloqueia a resposta se qualquer etapa falhar.
    const emitenteIe = cargoData?.emitente?.ie;
    const destinatarioIe = cargoData?.destinatario?.ie;

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
              // Diferente do emitente, o destinatário não tem enriquecimento externo (BrasilAPI)
              // — o XML da Distribuição NF-e é a única fonte de endereço disponível.
              municipio: cargoData.destinatario.municipio || null,
              uf: cargoData.destinatario.uf || null,
              cep: cargoData.destinatario.cep || null,
              logradouro: cargoData.destinatario.logradouro || null,
              numero: cargoData.destinatario.numero || null,
              bairro: cargoData.destinatario.bairro || null,
              // `2` = isento de inscrição — só esse valor autoriza marcar Person.stateRegistration
              // = 'ISENTO' automaticamente (ver HubArrivalSheet.tsx); `9` (não contribuinte) ou
              // ausência do campo não vira isenção, fica em branco pra revisão humana.
              indIEDest: cargoData.destinatario.indIEDest ?? null,
            }
          : null,
        // Presente independente de o Hub ser ou não o destinatário — a NF-e pode declarar um
        // transportador diferente de quem está bipando (ex.: Hub é a transportadora contratada).
        transportador: cargoData?.transportador?.cnpj
          ? {
              cnpj: cargoData.transportador.cnpj,
              razaoSocial: cargoData.transportador.razaoSocial || null,
              ie: cargoData.transportador.ie ?? null,
            }
          : null,
        // Presente só quando a busca completa falhou por um motivo acionável na UI (hoje: só
        // rate-limit de 1h/CNPJ da SEFAZ) — permite mostrar o motivo real em vez de um "não
        // identificado" genérico (ver EntradaTab.tsx).
        distribuicaoIndisponivel: null,
        modelo: parsed.mod === '55' ? 'NF-e' : parsed.mod === '57' ? 'CT-e' : parsed.mod,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Consulta potencialmente cobrada, isolada da operação e disponível apenas a ADMIN.
router.post('/:chave/fetch-from-provider', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  let audit: { chave?: string; hubId?: string } = {};
  try {
    const chave = extractChaveFromUrl(decodeURIComponent(Array.isArray(req.params.chave) ? req.params.chave[0] : req.params.chave));
    if (chave.length !== 44) throw new AppError('Chave NF-e inválida (deve ter 44 dígitos)', 400);
    const hubId = typeof req.body?.hubId === 'string' ? req.body.hubId : undefined;
    if (!hubId) throw new AppError('Informe o Hub para a consulta explícita ao provedor.', 400);
    audit = { chave, hubId };
    const result = await fetchNfeCompleta(hubId, chave);
    await prisma.fiscalProviderRequestAudit.create({ data: {
      provider: 'ACBR', action: 'NFE_CONS_CHAVE', userId: req.user!.id, hubId, accessKey: chave,
      status: result.cargo ? 'SUCCESS' : 'NOT_FOUND', result: { found: Boolean(result.cargo), unavailable: result.distribuicaoIndisponivel ? { ...result.distribuicaoIndisponivel } : null },
    } });
    res.json({ success: true, data: result, warning: 'Esta ação pode consumir crédito do provedor fiscal.' });
  } catch (error) {
    if (audit.chave) await prisma.fiscalProviderRequestAudit.create({ data: {
      provider: 'ACBR', action: 'NFE_CONS_CHAVE', userId: req.user!.id, hubId: audit.hubId,
      accessKey: audit.chave, status: 'FAILED', result: { error: error instanceof Error ? error.message : String(error) },
    } }).catch(() => undefined);
    next(error);
  }
});

export { router as nfeRouter };
