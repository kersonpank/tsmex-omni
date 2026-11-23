import React, { useEffect, useState } from 'react';
import { ordersFreightApi } from '../../../../../lib/api';
import { CTE_CFOP_SELECT_OPTIONS, cfopOptionSelectText } from '../../../../../lib/cteTaxCatalog';
import type { FreightDocumentSummary } from '../../../../../types/index';
import { Button, Field, SelectInput } from '../../../ui/kit';
import { Checkbox } from '../../../ui/form';

/**
 * CT-e rejeitado por CFOP: sugere o CFOP certo pela prévia fiscal do servidor, a pessoa confere
 * (e diz se a carga foi entregue direto no hub) e reenvia mantendo o valor do frete.
 */
export const RetryCfopForm: React.FC<{
    orderId: string;
    doc: FreightDocumentSummary;
    busy: boolean;
    onSubmit: (input: { cfop: string; deliveredDirectlyToHub: boolean }) => Promise<boolean>;
    onClose: () => void;
}> = ({ orderId, doc, busy, onSubmit, onClose }) => {
    const [cfop, setCfop] = useState('');
    const [hint, setHint] = useState<string | null>(null);
    const [direct, setDirect] = useState(false);

    useEffect(() => {
        let alive = true;
        ordersFreightApi
            .ctePreflight(orderId, doc.id)
            .then((body) => {
                if (alive) setCfop((current) => current || body.data?.tax.cfop?.code || '');
            })
            .catch(() => alive && setHint('Não foi possível sugerir o CFOP. Escolha no catálogo.'));
        return () => {
            alive = false;
        };
    }, [orderId, doc.id]);

    return (
        <form
            className="gx-inset flex flex-col gap-3 px-4 py-3.5"
            aria-label="Corrigir CFOP e reenviar"
            onSubmit={(event) => {
                event.preventDefault();
                if (busy || !cfop) return;
                void onSubmit({ cfop, deliveredDirectlyToHub: direct });
            }}
        >
            <Field label="CFOP para o reenvio" hint={hint ?? undefined}>
                <SelectInput value={cfop} disabled={busy} required onChange={(event) => setCfop(event.target.value)}>
                    <option value="">Escolha o CFOP</option>
                    {CTE_CFOP_SELECT_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code} title={option.labelFull}>
                            {cfopOptionSelectText(option)}
                        </option>
                    ))}
                </SelectInput>
            </Field>
            <Checkbox
                checked={direct}
                disabled={busy}
                onChange={setDirect}
                label="A carga foi entregue diretamente neste hub"
                hint="Usa a cidade e a UF do hub atual como início da prestação neste CT-e."
            />
            <p className="gx-muted text-[13px]">O valor do frete será mantido. Confira o CFOP e o início da prestação antes de reenviar.</p>
            <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" loading={busy} disabled={!cfop}>
                    {busy ? 'Reenviando…' : 'Corrigir e reenviar CT-e'}
                </Button>
                <Button disabled={busy} onClick={onClose}>
                    Cancelar
                </Button>
            </div>
        </form>
    );
};
