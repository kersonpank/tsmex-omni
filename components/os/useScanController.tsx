import React, { useCallback, useState } from 'react';
import type { HubCargoItem } from '../../types/index';
import { useScanFlow } from './useScanFlow';
import type { ScanFinal } from './lib/intake';
import CargoItemSheet from './pages/CargoItemSheet';
import EntrySheet from './pages/entry/EntrySheet';

const Scanner = React.lazy(() => import('./ui/Scanner'));

/**
 * Controlador de leitura compartilhado por Receber e Cargas: abre o leitor, segue o fluxo
 * (entrada da NF-e, item, aviso) e desenha as folhas. `onChanged` recarrega a tela chamadora.
 */
export function useScanController(hubId: string | null, onChanged: () => void) {
    const flow = useScanFlow(hubId);
    const [scanOpen, setScanOpen] = useState(false);
    const [entry, setEntry] = useState<HubCargoItem | null>(null);
    const [selected, setSelected] = useState<{ item: HubCargoItem; note?: string } | null>(null);
    const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

    const apply = useCallback((result: ScanFinal) => {
        if (result.kind === 'entry') setEntry(result.item);
        else if (result.kind === 'item') setSelected({ item: result.item, note: result.note });
        else setMessage({ kind: result.kind, text: result.message });
    }, []);

    const handleCode = useCallback(
        async (code: string) => {
            setScanOpen(false);
            setMessage(null);
            apply(await flow.run(code));
        },
        [apply, flow],
    );

    /** Toque num item de lista: aguardando → entrada; triagem → preparar e entrar; demais → item. */
    const openItem = useCallback(
        async (item: HubCargoItem) => {
            setMessage(null);
            if (item.kind === 'intake' && item.bucket === 'awaiting') setEntry(item);
            else if (item.kind === 'fiscal_document' && item.fiscalDocumentId) {
                apply(await flow.prepareFiscal(item.fiscalDocumentId));
                onChanged();
            } else setSelected({ item });
        },
        [apply, flow, onChanged],
    );

    const overlays = (
        <>
            {scanOpen ? (
                <React.Suspense fallback={null}>
                    <Scanner onCode={(code) => void handleCode(code)} onClose={() => setScanOpen(false)} />
                </React.Suspense>
            ) : null}
            {entry && hubId ? (
                <EntrySheet
                    item={entry}
                    hubId={hubId}
                    onClose={() => setEntry(null)}
                    onDone={(order) => {
                        setEntry(null);
                        onChanged();
                        if (order) setSelected({ item: order, note: 'Entrada confirmada. Etiquete os volumes.' });
                        else setMessage({ kind: 'info', text: 'Entrada confirmada. O pedido está no estoque.' });
                    }}
                />
            ) : null}
            {selected ? <CargoItemSheet item={selected.item} note={selected.note} onClose={() => setSelected(null)} /> : null}
        </>
    );

    return {
        openScanner: () => {
            setMessage(null);
            setScanOpen(true);
        },
        handleCode,
        openItem,
        busy: flow.busy,
        message,
        overlays,
    };
}
