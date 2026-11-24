import React from 'react';
import { backupApi, type BackupKindStatus } from '../../../../lib/api';
import { relative } from '../../lib/format';
import { useResource } from '../../lib/resource';
import { Button, Loadable, Panel, Pill, Skeleton } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

const LABEL: Record<BackupKindStatus['kind'], string> = {
    DATABASE: 'Banco de dados (a cada hora, cifrado, fora do servidor)',
    OBJECTS: 'Arquivos: XML, comprovantes, certificados',
    RESTORE_TEST: 'Teste de restauração (semanal)',
};

const size = (bytes: number | null) => (bytes == null ? '' : bytes > 1e9 ? ` · ${(bytes / 1e9).toFixed(1)} GB` : ` · ${(bytes / 1e6).toFixed(1)} MB`);

/**
 * Backup e contingência: o último sucesso de cada cópia e o pacote para reabrir a operação no
 * sistema legado se o TSM ficar fora do ar (o mesmo pacote sai a cada hora para o destino externo).
 */
export const BackupPanel: React.FC = () => {
    const state = useResource('system:backup-status', async () => (await backupApi.status()).data, { staleMs: 30_000 });
    const { busy, run } = useAction();

    const download = () =>
        run('contingency', async () => {
            const blob = await backupApi.contingencyCsv();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `contingencia-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }, { success: 'Pacote de contingência baixado.', error: 'O pacote não foi gerado.' });

    return (
        <Panel
            title="Backup e contingência"
            hint="Se algo der errado no servidor, os dados voltam destas cópias. O pacote de contingência lista o que está em aberto para continuar no sistema legado."
            mode="autopilot"
            actions={<Button size="sm" loading={busy === 'contingency'} onClick={() => void download()}>Baixar pacote de contingência</Button>}
        >
            <Loadable state={state} skeleton={<Skeleton rows={3} />}>
                {(data) => (
                    <ul className="flex flex-col gap-2.5">
                        {!data?.monitored ? <li className="gx-muted text-[13px]">Monitor de backup desligado neste ambiente (só produção tem o serviço de backup).</li> : null}
                        {(data?.kinds ?? []).map((k) => (
                            <li key={k.kind} className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[14px]">{LABEL[k.kind]}</span>
                                <span className="flex items-center gap-2">
                                    <span className="gx-muted text-[12.5px]">{k.lastOkAt ? `${relative(k.lastOkAt)}${size(k.lastSizeBytes)}` : 'nunca'}</span>
                                    <Pill tone={k.stale ? 'red' : 'neutral'} dot title={k.lastRunOk === false && k.lastDetail ? k.lastDetail : undefined}>
                                        {k.stale ? 'Atrasado' : 'Em dia'}
                                    </Pill>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Loadable>
        </Panel>
    );
};
