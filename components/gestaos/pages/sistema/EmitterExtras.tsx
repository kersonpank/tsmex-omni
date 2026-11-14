import React, { useState } from 'react';
import { fiscalDistribuicaoApi, fiscalEmittersApi } from '../../../../lib/api';
import type { FiscalAcbrDiagnostics, FiscalEmitter, FiscalEmitterReadiness } from '../../../../types/index';
import { dateFull, dateTime } from '../../lib/format';
import { invalidate, useResource } from '../../lib/resource';
import { seedProblem } from '../../lib/sistemaForms';
import { certificateView } from '../../lib/sistema';
import { FormSection, onlyDigits } from '../../ui/form';
import { Button, Chip, Field, Kv, Loadable, Pill, TextInput } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

const yes = (ok: boolean | undefined, known = true) => (!known ? 'Não verificado' : ok ? 'Sim' : 'Não');

/** Checklist de prontidão (Copilot): o que falta para este emitente emitir, direto do servidor. */
export const ReadinessSection: React.FC<{ emitterId: string }> = ({ emitterId }) => {
    const readiness = useResource<FiscalEmitterReadiness>(`system:readiness:${emitterId}`, async () => (await fiscalEmittersApi.readiness(emitterId)).data, { staleMs: 10_000 });
    const diag = useResource<FiscalAcbrDiagnostics | null>('system:acbr-diagnostics', async () => (await fiscalEmittersApi.acbrDiagnostics().catch(() => null))?.data ?? null, { staleMs: 120_000 });
    return (
        <FormSection title="Checklist de prontidão" mode="copilot" hint="O sistema confere o cadastro e diz o que falta antes de emitir." cols={1}>
            <Loadable state={readiness}>
                {(r) => (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                            <Pill tone={r.readyForMinuta ? 'neutral' : 'yellow'} dot>Minuta: {r.readyForMinuta ? 'pronto' : 'pendente'}</Pill>
                            <Pill tone={r.readyForHomologation ? 'neutral' : 'yellow'} dot>Homologação: {r.readyForHomologation ? 'pronto' : 'pendente'}</Pill>
                            <Pill tone={r.readyForProduction ? 'neutral' : 'yellow'} dot>Produção: {r.readyForProduction ? 'pronto' : 'pendente'}</Pill>
                        </div>
                        {r.issues.length === 0 ? <p className="gx-soft text-[13.5px]">Nenhuma pendência encontrada.</p> : (
                            <ul className="gx-inset flex list-disc flex-col gap-1 py-3 pl-8 pr-4 text-[13.5px]">
                                {r.issues.map((issue) => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </Loadable>
            {diag.data ? (
                <div className="gx-inset px-4 py-1">
                    <Kv label="Credenciais da ACBr no servidor" value={yes(diag.data.acbrCredentialsConfigured)} />
                    <Kv label="Armazenamento de certificados (S3)" value={yes(diag.data.s3Configured)} />
                    <Kv label="Chave fiscal do servidor" value={yes(diag.data.fiscalSecretKeyConfigured)} />
                </div>
            ) : null}
        </FormSection>
    );
};

/** Certificado A1: arquivo + senha. A senha fica só na memória desta gaveta e vai uma vez no envio. */
export const CertificateSection: React.FC<{
    emitter: FiscalEmitter | null;
    file: File | null;
    password: string;
    problem: string | null;
    onFile: (file: File | null) => void;
    onPassword: (password: string) => void;
}> = ({ emitter, file, password, problem, onFile, onPassword }) => {
    const view = emitter ? certificateView(emitter) : null;
    return (
        <FormSection title="Certificado A1" hint="Enviado ao salvar o emitente. A senha não é guardada na tela." cols={1}>
            <div className="gx-inset px-4 py-1">
                <Kv label="Arquivo atual" value={emitter?.certificateFileName || 'Não enviado'} />
                <Kv label="Situação" value={view ? <Pill tone={view.tone} dot>{view.label}</Pill> : 'Sem certificado'} />
                <Kv label="Validade" value={emitter?.certificateExpiresAt ? dateFull(emitter.certificateExpiresAt) : '—'} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Novo certificado (.pfx ou .p12)" error={problem}>
                    <input type="file" accept=".pfx,.p12" className="gx-input" aria-label="Arquivo do certificado" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
                </Field>
                <Field label="Senha do certificado">
                    <TextInput type="password" autoComplete="new-password" value={password} disabled={!file} onChange={(event) => onPassword(event.target.value)} aria-label="Senha do certificado" />
                </Field>
            </div>
            {!emitter ? <p className="gx-muted text-[12.5px]">O emitente é criado primeiro; em seguida o certificado é enviado.</p> : null}
        </FormSection>
    );
};

/** Distribuição de NF-e: semear o NSU (chave ou número) e pedir a varredura agora. */
export const DistribuicaoSection: React.FC<{ emitter: FiscalEmitter }> = ({ emitter }) => {
    const { busy, run } = useAction();
    const [mode, setMode] = useState<'chave' | 'nsu'>('chave');
    const [value, setValue] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const checkpoint = emitter.distribuicaoNfeCheckpoint;
    const waiting = checkpoint?.nextAllowedAt && new Date(checkpoint.nextAllowedAt).getTime() > Date.now();

    const seed = async () => {
        const wrong = seedProblem(mode, value);
        setProblem(wrong);
        if (wrong) return;
        const ok = await run(
            'seed',
            () =>
                mode === 'nsu'
                    ? fiscalDistribuicaoApi.bootstrapNsu(emitter.id, onlyDigits(value))
                    : fiscalDistribuicaoApi.solicitar({
                          cpf_cnpj: emitter.person.document,
                          ambiente: emitter.environment === 'PRODUCAO' ? 'producao' : 'homologacao',
                          tipo_consulta: 'cons-chave',
                          cons_chave: onlyDigits(value),
                      }),
            { success: 'NSU semeado. A varredura já pode rodar.', error: 'Não foi possível semear o NSU. A SEFAZ aceita uma consulta por hora por CNPJ.' },
        );
        if (ok) {
            setValue('');
            invalidate('system:emitters', 'system:nfe');
        }
    };

    const syncNow = async () => {
        const ok = await run('sync', () => fiscalDistribuicaoApi.syncNow(emitter.id), { success: 'Varredura pedida. As notas aparecem na triagem em instantes.', error: 'Não foi possível pedir a varredura.' });
        if (ok) invalidate('system:nfe');
    };

    return (
        <FormSection title="Distribuição de NF-e" hint="Notas emitidas contra este CNPJ. A SEFAZ aceita uma consulta por hora." cols={1}>
            <div className="gx-inset px-4 py-1">
                <Kv label="Varredura automática" value={emitter.distribuicaoNfeEnabled ? 'Ligada (2 vezes ao dia)' : 'Desligada'} />
                <Kv label="Ponto de partida (NSU)" value={checkpoint ? (checkpoint.seeded ? `Semeado, último ${checkpoint.ultimoNsu}` : 'Ainda não semeado') : 'Sem CNPJ'} />
                {waiting && checkpoint?.nextAllowedAt ? <Kv label="Próxima consulta liberada" value={dateTime(checkpoint.nextAllowedAt)} /> : null}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Como semear">
                <Chip active={mode === 'chave'} onClick={() => { setMode('chave'); setValue(''); setProblem(null); }}>Com uma chave de NF-e</Chip>
                <Chip active={mode === 'nsu'} onClick={() => { setMode('nsu'); setValue(''); setProblem(null); }}>Com o último NSU</Chip>
            </div>
            <div className="flex flex-wrap items-end gap-3">
                <Field label={mode === 'chave' ? 'Chave da NF-e (44 dígitos)' : 'Último NSU'} error={problem} className="min-w-[260px] flex-1">
                    <TextInput inputMode="numeric" value={value} onChange={(event) => setValue(onlyDigits(event.target.value).slice(0, mode === 'chave' ? 44 : 18))} className="gx-mono" aria-label={mode === 'chave' ? 'Chave da NF-e' : 'Último NSU'} />
                </Field>
                <Button variant="soft" loading={busy === 'seed'} disabled={Boolean(busy)} onClick={() => void seed()}>
                    {mode === 'chave' ? 'Semear com esta chave' : 'Confirmar NSU'}
                </Button>
                <Button variant="primary" loading={busy === 'sync'} disabled={Boolean(busy) || !emitter.distribuicaoNfeEnabled || checkpoint?.seeded === false || Boolean(waiting)} onClick={() => void syncNow()}>
                    Buscar agora
                </Button>
            </div>
        </FormSection>
    );
};
