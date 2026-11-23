import React, { useState } from 'react';
import { fiscalEmittersApi } from '../../../../lib/api';
import { Button } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

/**
 * Baixar o certificado A1 do emitente. O sistema só pede o link temporário ao servidor e o mostra:
 * o conteúdo do arquivo nunca passa pela tela. O link expira em poucos minutos.
 */
export const CertificateDownload: React.FC<{ emitterId: string }> = ({ emitterId }) => {
    const { busy, run } = useAction();
    const [link, setLink] = useState<{ url: string; filename: string; minutes: number } | null>(null);

    const generate = async () => {
        setLink(null);
        await run(
            'cert-link',
            async () => {
                const response = await fiscalEmittersApi.certificateDownloadLink(emitterId);
                if (!response.data?.downloadUrl) throw new Error('O servidor não devolveu o link de download.');
                setLink({ url: response.data.downloadUrl, filename: response.data.filename, minutes: Math.max(1, Math.round((response.data.expiresInSeconds ?? 60) / 60)) });
            },
            { success: 'Link gerado.', error: 'Não foi possível gerar o link do certificado.' },
        );
    };

    return (
        <div className="gx-inset flex flex-col gap-2.5 px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="gx-soft min-w-0 flex-1 basis-56 text-[13.5px]">Baixe uma cópia do certificado enviado. O link é temporário e só administradores o geram.</p>
                <Button size="sm" variant="soft" loading={busy === 'cert-link'} disabled={busy != null && busy !== 'cert-link'} onClick={() => void generate()}>
                    Gerar link de download
                </Button>
            </div>
            {link ? (
                <p className="text-[13.5px]">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                        Baixar {link.filename}
                    </a>
                    <span className="gx-muted"> · vale por {link.minutes === 1 ? '1 minuto' : `${link.minutes} minutos`}</span>
                </p>
            ) : null}
        </div>
    );
};
