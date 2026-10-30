import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HubCargoItem } from '../../types/index';
import { useScanFlow } from './useScanFlow';
import type { ScanFinal } from './lib/intake';
import CargoItemSheet from './pages/CargoItemSheet';
import CollectionDetailSheet from './pages/CollectionDetailSheet';
import CollectionRequestSheet from './pages/CollectionRequestSheet';
import EntrySheet from './pages/entry/EntrySheet';

const Scanner = React.lazy(() => import('./ui/Scanner'));

/**
 * Controlador de leitura compartilhado por Receber e Cargas: abre o leitor, segue o fluxo
 * (entrada da NF-e, item, aviso) e desenha as folhas. `onChanged` recarrega a tela chamadora.
 */
export function useScanController(hubId: string | null, onChanged: () => void) {
    const navigate = useNavigate();
    const flow = useScanFlow(hubId);
    const [scanOpen, setScanOpen] = useState(false);
    const [entry, setEntry] = useState<HubCargoItem | null>(null);
    const [collection, setCollection] = useState<HubCargoItem | null>(null);
    const [collectFor, setCollectFor] = useState<HubCargoItem | null>(null);
    const [selected, setSelected] = useState<{ item: HubCargoItem; note?: string } | null>(null);
    const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

    const apply = useCallback(
        (result: ScanFinal) => {
            if (result.kind === 'entry') {
                // Coleta solicitada: mostra o detalhe antes (dar entrada ou cancelar).
                if (result.item.collectionRequest) setCollection(result.item);
                else setEntry(result.item);
            }
            else if (result.kind === 'item' && !result.note && result.item.bucket === 'stock' && result.item.orderId) {
                navigate(`/hubs/pedidos/${result.item.orderId}`, { state: { item: result.item } });
            } else if (result.kind === 'item') setSelected({ item: result.item, note: result.note });
            else setMessage({ kind: result.kind, text: result.message });
        },
        [navigate],
    );

    const handleCode = useCallback(
        async (code: string) => {
            setScanOpen(false);
            setMessage(null);
            apply(await flow.run(code));
        },
        [apply, flow],
    );

    /** Toque num item de lista: aguardando → entrada; triagem → preparar e entrar; pedido aqui → página do pedido. */
    const openItem = useCallback(
        async (item: HubCargoItem) => {
            setMessage(null);
            if (item.kind === 'order' && item.bucket === 'stock' && item.orderId) {
                navigate(`/hubs/pedidos/${item.orderId}`, { state: { item } });
            } else if (item.kind === 'intake' && item.bucket === 'awaiting') {
                if (item.collectionRequest) setCollection(item);
                else setEntry(item);
            }
            else if (item.kind === 'fiscal_document' && item.fiscalDocumentId) {
                apply(await flow.prepareFiscal(item.fiscalDocumentId));
                onChanged();
            } else setSelected({ item });
        },
        [apply, flow, navigate, onChanged],
    );

    const overlays = (
        <>
            {scanOpen ? (
                <React.Suspense fallback={null}>
                    <Scanner onCode={(code) => void handleCode(code)} onClose={() => setScanOpen(false)} />
                </React.Suspense>
            ) : null}
            {collectFor && hubId ? (
                <CollectionRequestSheet
                    hubId={hubId}
                    attachTo={collectFor}
                    onClose={() => setCollectFor(null)}
                    onDone={() => {
                        setCollectFor(null);
                        onChanged();
                    }}
                />
            ) : null}
            {collection ? (
                <CollectionDetailSheet
                    item={collection}
                    onClose={() => setCollection(null)}
                    onReceive={(item) => {
                        setCollection(null);
                        setEntry(item);
                    }}
                    onCancelled={() => {
                        setCollection(null);
                        onChanged();
                    }}
                />
            ) : null}
            {entry && hubId ? (
                <EntrySheet
                    item={entry}
                    hubId={hubId}
                    onClose={() => setEntry(null)}
                    onDone={(order) => {
                        setEntry(null);
                        onChanged();
                        // Próximo passo da roda: etiquetas e documento do frete, na página do pedido.
                        if (order?.orderId) navigate(`/hubs/pedidos/${order.orderId}`, { state: { item: order, fromEntry: true } });
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
        /** Solicitar coleta desta NF (entrada que já aguarda, sem criar outra). */
        requestCollectionFor: setCollectFor,
        busy: flow.busy,
        message,
        overlays,
    };
}
