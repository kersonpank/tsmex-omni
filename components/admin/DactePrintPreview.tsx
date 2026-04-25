import React from 'react';
import type { BrandingForDocuments } from '../../types/index';

interface DactePrintPreviewProps {
  payload: any;
  branding?: BrandingForDocuments | null;
  onClose: () => void;
}

/** Rótulos PT alinhados ao cartão de frete (OrderFreightCalculationSection). */
const FREIGHT_COMPONENT_LABELS: Record<string, string> = {
  freightBase: 'Frete Peso',
  adValorem: 'Ad Valorem',
  gris: 'GRIS',
  toll: 'Pedágio',
  dispatch: 'Despacho',
  others: 'Outros',
  icms: 'ICMS',
};

function ParteBox({ title, parte }: { title: string; parte?: any }) {
  return (
    <section className="border border-black p-1">
      <div className="text-[10px] font-bold uppercase">{title}</div>
      <div className="text-[10px] font-semibold">{parte?.nome ?? '-'}</div>
      <div className="text-[9px]">CNPJ/CPF: {parte?.document ?? '-'} IE: {parte?.ie ?? '-'}</div>
      <div className="text-[9px]">{parte?.endereco ?? '-'} {parte?.municipio ?? ''}/{parte?.uf ?? ''} CEP: {parte?.cep ?? '-'}</div>
    </section>
  );
}

const DactePrintPreview: React.FC<DactePrintPreviewProps> = ({ payload, branding, onClose }) => {
  const emitente = payload?.emitente ?? {};
  const mercadoria = payload?.mercadoria ?? {};
  const componentes = payload?.componentesFrete ?? {};
  const impostos = payload?.impostos?.icms ?? payload?.icms;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/60 p-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #dacte-print, #dacte-print * { visibility: visible; }
          #dacte-print { position: absolute; inset: 0; margin: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      `}</style>
      <div className="no-print mx-auto mb-3 flex max-w-6xl justify-end gap-2">
        <button onClick={() => window.print()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Imprimir</button>
        <button onClick={onClose} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-tower-800">Fechar</button>
      </div>

      <div id="dacte-print" className="mx-auto max-w-6xl bg-white p-3 font-sans text-black">
        <div className="grid grid-cols-[1.15fr_1fr] border border-black">
          <section className="border-r border-black p-1">
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <div className="flex h-20 items-center justify-center">
                {branding?.logoUrl ? <img src={branding.logoUrl} className="max-h-16 max-w-full object-contain" /> : <span className="text-lg font-bold">TSM EX</span>}
              </div>
              <div className="text-[10px]">
                <div className="text-center text-xs font-bold">IDENTIFICAÇÃO DO EMITENTE</div>
                <div className="font-bold">{emitente.nome ?? branding?.legalName ?? '-'}</div>
                <div>{emitente.endereco ?? branding?.addressLine ?? '-'}</div>
                <div>{emitente.municipio ?? ''}/{emitente.uf ?? ''} CEP: {emitente.cep ?? '-'}</div>
                <div>Fone: {emitente.fone ?? branding?.phone ?? '-'}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 border-t border-black text-[10px]">
              <div><b>CNPJ:</b> {emitente.document ?? branding?.cnpjDisplay ?? '-'}</div>
              <div><b>IE:</b> {emitente.ie ?? '-'}</div>
              <div><b>RNTRC:</b> {emitente.rntrc ?? '-'}</div>
            </div>
          </section>

          <section className="grid grid-cols-[1fr_130px]">
            <div className="border-r border-black text-center">
              <div className="text-lg font-bold">{payload?.documentLabel === 'DACTE' ? 'DACTE' : 'MINUTA'}</div>
              <div className="text-[10px]">Documento Auxiliar do Conhecimento de Transporte Eletrônico</div>
              <div className="grid grid-cols-5 border-y border-black text-[10px]">
                <div><b>Série</b><br />{payload?.serie ?? 1}</div>
                <div><b>Número</b><br />{payload?.numero ?? '-'}</div>
                <div><b>Modal</b><br />Rodoviário</div>
                <div><b>Modelo</b><br />{payload?.modelo ?? '57'}</div>
                <div><b>Protocolo</b><br />{payload?.protocolo ?? '-'}</div>
              </div>
              <div className="p-1 text-[9px]">
                <div className="mb-1 font-bold">Controle do Fisco</div>
                <div className="mx-auto h-10 w-80 overflow-hidden bg-[repeating-linear-gradient(90deg,#000_0_2px,#fff_2px_4px,#000_4px_5px,#fff_5px_8px)]" />
                <div className="mt-1 break-all">Chave: {payload?.chaveAcesso ?? payload?.codigoBarras ?? 'Documento interno sem chave SEFAZ'}</div>
              </div>
            </div>
            <div className="p-1 text-center text-[10px]">
              <b>Autorização</b><br />{payload?.autorizacaoEm ?? '-'}
              <div className="mt-2 flex h-24 items-center justify-center border border-black text-[9px]">QR Code</div>
              <div className="mt-1 break-all text-[7px]">{payload?.qrCodeUrl ?? '-'}</div>
            </div>
          </section>
        </div>

        {payload?.watermark && <div className="border-x border-black bg-tower-100 p-1 text-center text-xs font-bold">{payload.watermark}</div>}

        <div className="grid grid-cols-[1.15fr_1fr] border-x border-b border-black">
          <div className="border-r border-black">
            <div className="grid grid-cols-2 text-[10px]">
              <div className="border-b border-r border-black p-1"><b>Tipo CT-e</b><br />Normal</div>
              <div className="border-b border-black p-1"><b>Tipo Serviço</b><br />{payload?.tipoServico ?? 'Normal'}</div>
              <div className="border-b border-r border-black p-1"><b>CFOP - Natureza</b><br />{payload?.cfop ?? '-'} - {payload?.ide?.naturezaOperacao ?? 'TRANSPORTE RODOVIARIO DE CARGAS'}</div>
              <div className="border-b border-black p-1"><b>Emissão</b><br />{payload?.ide?.dataHoraEmissao ?? '-'}</div>
              <div className="border-b border-r border-black p-1"><b>Origem Prestação</b><br />{payload?.origemPrestacao ?? '-'}</div>
              <div className="border-b border-black p-1"><b>Destino Prestação</b><br />{payload?.destinoPrestacao ?? '-'}</div>
            </div>
            <ParteBox title="Remetente" parte={payload?.remetente} />
            <ParteBox title="Destinatário" parte={payload?.destinatario} />
            <ParteBox title="Expedidor" parte={payload?.expedidor} />
            <ParteBox title="Recebedor" parte={payload?.recebedor} />
            <ParteBox title="Tomador" parte={payload?.tomador} />
            <section className="border-t border-black p-1 text-[10px]">
              <div className="text-center font-bold">Observações Gerais</div>
              <div>{payload?.observacoes ?? branding?.footerNote ?? '-'}</div>
            </section>
          </div>

          <div>
            <div className="grid grid-cols-2 text-[10px]">
              <section className="border-b border-r border-black p-1">
                <div className="text-center font-bold">Componentes do Frete</div>
                {Object.entries(componentes).map(([k, v]) => Number(v) > 0 && (
                  <div key={k} className="flex justify-between gap-1">
                    <span>{FREIGHT_COMPONENT_LABELS[k] ?? k}</span>
                    <span>{Number(v).toFixed(2)}</span>
                  </div>
                ))}
              </section>
              <section className="border-b border-black p-1">
                <div className="text-center font-bold">Mercadoria</div>
                <div>Prod. Predomin.: {mercadoria.produtoPredominante ?? '-'}</div>
                <div>Peso bruto: {mercadoria.pesoBruto ?? 0}</div>
                <div>Peso faturado: {mercadoria.pesoFaturado ?? 0}</div>
                <div>Cubagem: {mercadoria.cubagemM3 ?? 0}</div>
                <div>Volumes: {mercadoria.volumes ?? 0}</div>
                <div>Valor carga: R$ {Number(mercadoria.valorTotal ?? 0).toFixed(2)}</div>
              </section>
            </div>
            <section className="border-b border-black p-1 text-[10px]">
              <div className="text-center font-bold">Informações Relativas ao Imposto</div>
              <div className="grid grid-cols-4">
                <div>CST: {impostos?.cst ?? '-'}</div>
                <div>Base: R$ {Number(impostos?.base ?? 0).toFixed(2)}</div>
                <div>Alíquota: {Number(impostos?.aliquota ?? 0).toFixed(2)}%</div>
                <div>ICMS: R$ {Number(impostos?.valor ?? 0).toFixed(2)}</div>
              </div>
            </section>
            <section className="border-b border-black p-1 text-[10px]">
              <div className="flex justify-between text-sm font-bold"><span>Frete Total (R$)</span><span>{Number(payload?.freightTotal ?? payload?.valorTotal ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between text-sm font-bold"><span>Valor a Receber (R$)</span><span>{Number(payload?.valorReceber ?? payload?.valorTotal ?? 0).toFixed(2)}</span></div>
            </section>
            <section className="p-1 text-[10px]">
              <div className="text-center font-bold">Documentos Originários</div>
              <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] gap-0.5 border-b border-black py-0.5 font-semibold">
                <span>Tipo</span>
                <span>Série/Nº</span>
                <span className="break-all">Chave NF-e</span>
                <span>CNPJ emit.</span>
              </div>
              {(payload?.documentosOriginarios ?? []).map((doc: any, idx: number) => (
                <div key={`${doc.serieNumero}-${idx}`} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] gap-0.5 border-b border-tower-200 py-0.5 last:border-b-0">
                  <span>{doc.tipo}</span>
                  <span className="break-all">{doc.serieNumero}</span>
                  <span className="break-all font-mono text-[8px] leading-tight">{doc.chaveNFe ?? '-'}</span>
                  <span className="break-all">{doc.cnpjEmitente ?? '-'}</span>
                </div>
              ))}
            </section>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr_1fr_120px] border-x border-b border-black text-[10px]">
          <div className="p-1">Nome/RG</div>
          <div className="border-l border-black p-1">Assinatura/Carimbo</div>
          <div className="border-l border-black p-1">Chegada Data/Hora ___/___/___ __:__<br />Saída Data/Hora ___/___/___ __:__</div>
          <div className="border-l border-black p-1">CT-e/Minuta Nº<br />{payload?.numero ?? '-'}</div>
        </div>
      </div>
    </div>
  );
};

export default DactePrintPreview;
