import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { costAgreementsApi, type HubCommissionAgreementRow, type LinkCostAgreementRow } from '../../../../lib/api';
import { useAction } from '../../ui/overlay';
import { Button, Chip, EmptyState, Loadable, Panel, Pill } from '../../ui/kit';
import { money } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { COST_MODE_LABEL, HubAgreementDrawer, LinkAgreementDrawer } from './AgreementForms';

/** Encerrar em dois passos (sem `confirm`): primeiro o botão pede confirmação na própria linha. */
const CloseButton: React.FC<{ id: string; busy: string | null; onClose: (id: string) => Promise<void> }> = ({ id, busy, onClose }) => {
    const [asking, setAsking] = useState(false);
    const key = `close:${id}`;
    if (!asking) {
        return (
            <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsking(true)}>
                Encerrar
            </Button>
        );
    }
    return (
        <span className="inline-flex gap-1.5">
            <Button size="sm" variant="danger" loading={busy === key} disabled={busy != null && busy !== key} onClick={() => void onClose(id).then(() => setAsking(false))}>
                Confirmar
            </Button>
            <Button size="sm" disabled={busy != null} onClick={() => setAsking(false)}>
                Voltar
            </Button>
        </span>
    );
};

const rateText = (row: LinkCostAgreementRow) => (row.costMode === 'PER_M3' ? `${money(row.ratePerM3)} por m³` : row.costMode === 'PER_KG' ? `${money(row.ratePerKg)} por kg` : money(row.flatRate));

export const AcordosTab: React.FC = () => {
    const [showClosed, setShowClosed] = useState(false);
    const [creating, setCreating] = useState<'link' | 'hub' | null>(null);
    const { busy, run } = useAction();
    const active = showClosed ? undefined : true;
    const links = useResource<LinkCostAgreementRow[]>(`agreements:link:${showClosed}`, async () => (await costAgreementsApi.listLink({ active })).data ?? [], { staleMs: 30_000 });
    const hubs = useResource<HubCommissionAgreementRow[]>(`agreements:hub:${showClosed}`, async () => (await costAgreementsApi.listHub({ active })).data ?? [], { staleMs: 30_000 });

    const close = (kind: 'link' | 'hub') => async (id: string) => {
        await run(`close:${id}`, () => (kind === 'link' ? costAgreementsApi.closeLink(id) : costAgreementsApi.closeHub(id)), {
            success: 'Acordo encerrado.',
            error: kind === 'link' ? 'O acordo não foi encerrado.' : 'A comissão não foi encerrada.',
        });
        invalidate('agreements:');
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="gx-inset flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <p className="gx-soft max-w-[70ch] text-[14px]">
                    Sem acordo de custo, a margem da viagem fica incompleta: o custo do transportador não é estimado e a comissão do hub conta zero.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Chip active={showClosed} onClick={() => setShowClosed((value) => !value)}>Mostrar encerrados</Chip>
                    <Link to="/gestao?cat=finance" className="gx-btn gx-btn-ghost gx-btn-sm">Gerir acordos na gestão clássica</Link>
                </div>
            </div>

            <Panel title="Transportador por rota e veículo" mode="manual" actions={<Button variant="primary" onClick={() => setCreating('link')}>Novo acordo</Button>} padded={false}>
                <Loadable state={links} isEmpty={(list) => list.length === 0} empty={<div className="px-5 pb-5"><EmptyState title="Nenhum acordo de transportador." hint="Cadastre o valor combinado por rota e veículo para a margem sair completa." /></div>}>
                    {(list) => (
                        <div className="gx-scroll-x px-2">
                            <table className="gx-table">
                                <thead>
                                    <tr><th>Transportador</th><th>Rota</th><th>Veículo</th><th>Cobrança</th><th className="text-right">Valor</th><th /></tr>
                                </thead>
                                <tbody>
                                    {list.map((row) => (
                                        <tr key={row.id} className={row.active ? '' : 'opacity-60'}>
                                            <td className="font-semibold">{row.link?.name ?? row.linkId.slice(0, 8)}</td>
                                            <td>{row.originCity} → {row.destinationCity}</td>
                                            <td className="gx-mono">{row.vehicleTypeCode}</td>
                                            <td>{COST_MODE_LABEL[row.costMode]}</td>
                                            <td className="gx-num text-right">{rateText(row)}</td>
                                            <td className="text-right">{row.active ? <CloseButton id={row.id} busy={busy} onClose={close('link')} /> : <Pill>Encerrado</Pill>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Loadable>
            </Panel>

            <Panel title="Comissão do hub parceiro" mode="manual" actions={<Button variant="primary" onClick={() => setCreating('hub')}>Nova comissão</Button>} padded={false}>
                <Loadable state={hubs} isEmpty={(list) => list.length === 0} empty={<div className="px-5 pb-5"><EmptyState title="Nenhuma comissão de hub." hint="Sem comissão cadastrada, o hub parceiro conta zero na margem." /></div>}>
                    {(list) => (
                        <div className="gx-scroll-x px-2">
                            <table className="gx-table">
                                <thead>
                                    <tr><th>Hub</th><th className="text-right">Taxa por pedido</th><th className="text-right">% do frete</th><th /></tr>
                                </thead>
                                <tbody>
                                    {list.map((row) => (
                                        <tr key={row.id} className={row.active ? '' : 'opacity-60'}>
                                            <td className="font-semibold">{row.hub?.name ?? row.hubId.slice(0, 8)}</td>
                                            <td className="gx-num text-right">{money(row.handlingFeePerOrder)}</td>
                                            <td className="gx-num text-right">{row.percentOfFreight != null ? `${row.percentOfFreight}%` : '—'}</td>
                                            <td className="text-right">{row.active ? <CloseButton id={row.id} busy={busy} onClose={close('hub')} /> : <Pill>Encerrado</Pill>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Loadable>
            </Panel>

            {creating === 'link' ? <LinkAgreementDrawer onClose={() => setCreating(null)} /> : null}
            {creating === 'hub' ? <HubAgreementDrawer onClose={() => setCreating(null)} /> : null}
        </div>
    );
};
