import React from 'react';
import { Link } from 'react-router-dom';
import { nfeDistribuicaoMonitorApi } from '../../../../lib/api';
import type { NfeDistribuicaoMonitorDetalhe } from '../../../../lib/api';
import { demandStatusLabel } from '../../lib/comercial';
import { dateTime, money } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { NFE_STATUS_LABEL } from '../../lib/sistema';
import { hasProblem } from '../../lib/sistemaNfe';
import { formatCnpjCpf } from '../../ui/form';
import { Kv, Loadable, Pill } from '../../ui/kit';
import { Drawer } from '../../ui/overlay';

const kgText = (value?: number) => (typeof value === 'number' ? `${value.toLocaleString('pt-BR')} kg` : '—');

/** Detalhe de uma NF-e da varredura: quem emitiu, a carga declarada e o que virou. */
export const NfeDetailDrawer: React.FC<{ documentId: string; onClose: () => void }> = ({ documentId, onClose }) => {
    const state = useResource<NfeDistribuicaoMonitorDetalhe>(`system:nfe-detail:${documentId}`, async () => (await nfeDistribuicaoMonitorApi.detail(documentId)).data, { staleMs: 30_000 });
    const doc = state.data;
    const cargo = doc?.cargoData ?? null;
    const order = doc?.convertedDemand?.order?.id;

    return (
        <Drawer
            open
            onClose={onClose}
            width={720}
            title="Detalhe da NF-e"
            subtitle={doc ? <span className="gx-mono">{doc.accessKey}</span> : undefined}
            badge={doc ? <Pill tone={hasProblem(doc.status) ? 'red' : 'neutral'} dot={hasProblem(doc.status)}>{NFE_STATUS_LABEL[doc.status] ?? 'Outra situação'}</Pill> : undefined}
        >
            <Loadable state={state}>
                {(data) => (
                    <div className="flex flex-col gap-6">
                        <div className="gx-inset px-4 py-1">
                            <Kv label="Descoberta em" value={dateTime(data.createdAt)} />
                            <Kv label="Emitente da nota" value={cargo?.emitente.razaoSocial ?? formatCnpjCpf(data.cnpjEmitente)} />
                            <Kv label="CNPJ do emitente" value={formatCnpjCpf(data.cnpjEmitente)} mono />
                            <Kv label="Destinada a" value={data.fiscalEmitter.hub ? `${data.fiscalEmitter.hub.code} · ${data.fiscalEmitter.hub.name}` : data.fiscalEmitter.displayName || '—'} />
                            {cargo ? (
                                <>
                                    <Kv label="Destinatário" value={cargo.destinatario.razaoSocial || '—'} />
                                    <Kv label="Transportador" value={cargo.transportador?.razaoSocial || '—'} />
                                    <Kv label="Valor da nota" value={money(cargo.valorTotalNota)} strong />
                                    <Kv label="Peso bruto" value={kgText(cargo.pesoBruto)} />
                                    <Kv label="Peso líquido" value={kgText(cargo.pesoLiquido)} />
                                    <Kv label="Volumes" value={cargo.quantidadeVolumes ?? '—'} />
                                </>
                            ) : null}
                        </div>

                        {hasProblem(data.status) && data.lastError ? <p className="gx-red-text text-[14px]">Último erro: {data.lastError}</p> : null}

                        {cargo ? (
                            cargo.produtos.length > 0 ? (
                                <div>
                                    <h3 className="gx-h2 mb-2">Produtos</h3>
                                    <div className="gx-scroll-x">
                                        <table className="gx-table">
                                            <thead>
                                                <tr>
                                                    <th>Descrição</th>
                                                    <th>NCM</th>
                                                    <th className="text-right">Qtd</th>
                                                    <th className="text-right">Unitário</th>
                                                    <th className="text-right">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {cargo.produtos.map((product, index) => (
                                                    <tr key={index}>
                                                        <td>{product.descricao}</td>
                                                        <td className="gx-mono">{product.ncm}</td>
                                                        <td className="gx-num text-right">{product.quantidade}</td>
                                                        <td className="gx-num text-right">{money(product.valorUnitario)}</td>
                                                        <td className="gx-num text-right">{money(product.valorTotal)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : null
                        ) : (
                            <p className="gx-muted text-[14px]">Os dados da carga ainda não estão disponíveis: o XML completo não foi baixado.</p>
                        )}

                        {data.convertedDemand ? (
                            <div className="gx-inset flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                                <p className="gx-soft text-[14px]">
                                    Virou a demanda {data.convertedDemand.orderNumber ? `nº ${data.convertedDemand.orderNumber}` : data.convertedDemand.id.slice(0, 8).toUpperCase()} · {demandStatusLabel(data.convertedDemand.status)}.
                                </p>
                                {order ? (
                                    <Link to={`/gestaos/pedidos?p=${order}`} className="gx-btn gx-btn-soft gx-btn-sm">
                                        Abrir o pedido
                                    </Link>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                )}
            </Loadable>
        </Drawer>
    );
};
