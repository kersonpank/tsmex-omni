import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '../../../ui/kit';
import { IconCheck, IconClose, IconRefresh } from '../../../ui/icons';

export interface CoverageMapProps {
    seat: { lat: number; lng: number } | null;
    cities: Array<{ ibgeCode: string; name: string; state: string; lat: number; lng: number; served: boolean }>;
    onTeia: (polygon: Array<[number, number]>) => void;
    onToggle: (ibgeCode: string) => void;
    busy?: boolean;
}

export const CoverageMap: React.FC<CoverageMapProps> = ({ seat, cities, onTeia, onToggle, busy = false }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const seatLayerRef = useRef<L.LayerGroup | null>(null);
    const citiesLayerRef = useRef<L.LayerGroup | null>(null);
    const drawingLayerRef = useRef<L.LayerGroup | null>(null);

    const [isDrawing, setIsDrawing] = useState(false);
    const [drawingPoints, setDrawingPoints] = useState<Array<[number, number]>>([]);

    const isDrawingRef = useRef(isDrawing);
    isDrawingRef.current = isDrawing;

    const drawingPointsRef = useRef(drawingPoints);
    drawingPointsRef.current = drawingPoints;

    const onTeiaRef = useRef(onTeia);
    onTeiaRef.current = onTeia;

    const onToggleRef = useRef(onToggle);
    onToggleRef.current = onToggle;

    const hasFittedRef = useRef(false);
    const prevCitiesCountRef = useRef(cities.length);

    // Inicialização do mapa Leaflet imperativo
    useEffect(() => {
        if (!containerRef.current) return;

        const tileUrl =
            (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ??
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

        const map = L.map(containerRef.current, {
            center: [-14.235, -51.925],
            zoom: 4,
            doubleClickZoom: true,
            zoomControl: true,
        });

        L.tileLayer(tileUrl, {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
        }).addTo(map);

        const seatLayer = L.layerGroup().addTo(map);
        const citiesLayer = L.layerGroup().addTo(map);
        const drawingLayer = L.layerGroup().addTo(map);

        seatLayerRef.current = seatLayer;
        citiesLayerRef.current = citiesLayer;
        drawingLayerRef.current = drawingLayer;
        mapRef.current = map;

        // Clique no mapa durante desenho adiciona vértice
        map.on('click', (e: L.LeafletMouseEvent) => {
            if (!isDrawingRef.current) return;
            const pt: [number, number] = [e.latlng.lat, e.latlng.lng];
            setDrawingPoints((prev) => {
                if (prev.length > 0) {
                    const last = prev[prev.length - 1];
                    if (Math.abs(last[0] - pt[0]) < 0.00001 && Math.abs(last[1] - pt[1]) < 0.00001) {
                        return prev;
                    }
                }
                return [...prev, pt];
            });
        });

        // Duplo clique fecha a teia se tiver >= 3 pontos
        map.on('dblclick', (e: L.LeafletMouseEvent) => {
            if (!isDrawingRef.current) return;
            L.DomEvent.stopPropagation(e);
            const pts = drawingPointsRef.current;
            if (pts.length >= 3) {
                setIsDrawing(false);
                setDrawingPoints([]);
                onTeiaRef.current(pts);
            }
        });

        const resizeTimer = setTimeout(() => {
            map.invalidateSize();
        }, 120);
        // Drawer/aba pode abrir com o contêiner sem tamanho: reajusta sempre que ele mudar.
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
        observer?.observe(containerRef.current);

        return () => {
            clearTimeout(resizeTimer);
            observer?.disconnect();
            // Com StrictMode o mapa é recriado: o enquadramento inicial precisa ser refeito.
            hasFittedRef.current = false;
            map.remove();
            mapRef.current = null;
            seatLayerRef.current = null;
            citiesLayerRef.current = null;
            drawingLayerRef.current = null;
        };
    }, []);

    // Modo desenho: cursor crosshair e desabilitar doubleClickZoom
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (isDrawing) {
            map.doubleClickZoom.disable();
            map.getContainer().style.cursor = 'crosshair';
        } else {
            map.doubleClickZoom.enable();
            map.getContainer().style.cursor = '';
        }
    }, [isDrawing]);

    // Renderização dos vértices e polyline da teia em desenho
    useEffect(() => {
        const layer = drawingLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        if (drawingPoints.length > 0) {
            L.polyline(drawingPoints, {
                dashArray: '6, 6',
                color: '#1a44d9',
                weight: 2.5,
            }).addTo(layer);

            if (drawingPoints.length >= 3) {
                L.polyline([drawingPoints[drawingPoints.length - 1], drawingPoints[0]], {
                    dashArray: '3, 6',
                    color: '#1a44d9',
                    opacity: 0.5,
                    weight: 1.5,
                }).addTo(layer);
            }

            drawingPoints.forEach((pt, idx) => {
                L.circleMarker(pt, {
                    radius: idx === 0 ? 5 : 4,
                    fillColor: idx === 0 ? '#1a44d9' : '#ffffff',
                    color: '#1a44d9',
                    weight: 2,
                    fillOpacity: 1,
                }).addTo(layer);
            });
        }
    }, [drawingPoints]);

    // Renderização do marcador destacado da sede (sem ícone de imagem default)
    useEffect(() => {
        const layer = seatLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        if (seat) {
            const halo = L.circleMarker([seat.lat, seat.lng], {
                radius: 12,
                fillColor: '#ffc400',
                fillOpacity: 0.35,
                stroke: false,
                interactive: false,
            });
            const core = L.circleMarker([seat.lat, seat.lng], {
                radius: 7,
                fillColor: '#ffc400',
                fillOpacity: 1,
                color: '#0c1535',
                weight: 2.5,
            });
            core.bindTooltip('Sede do Hub', { direction: 'top', offset: [0, -8] });
            halo.addTo(layer);
            core.addTo(layer);
        }
    }, [seat]);

    // Renderização das cidades (Atende = azul cheio, Não atende = cinza/vermelho vazado)
    useEffect(() => {
        const layer = citiesLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        for (const city of cities) {
            const marker = L.circleMarker([city.lat, city.lng], {
                radius: city.served ? 6 : 5,
                fillColor: city.served ? '#1a44d9' : '#ffffff',
                fillOpacity: city.served ? 0.9 : 0.15,
                color: city.served ? '#ffffff' : '#cf1a2a',
                weight: city.served ? 1.5 : 2,
            });

            const status = city.served ? 'Atende' : 'Não atende';
            marker.bindTooltip(`${city.name}/${city.state} — ${status} · clique para alternar`, {
                direction: 'top',
                offset: [0, -6],
            });

            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (isDrawingRef.current) {
                    const pt: [number, number] = [city.lat, city.lng];
                    setDrawingPoints((prev) => {
                        const last = prev[prev.length - 1];
                        return last && last[0] === pt[0] && last[1] === pt[1] ? prev : [...prev, pt];
                    });
                    return;
                }
                onToggleRef.current(city.ibgeCode);
            });

            marker.addTo(layer);
        }
    }, [cities]);

    // fitBounds na primeira carga e quando a lista sai de vazia
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const points: Array<[number, number]> = [];
        if (seat) points.push([seat.lat, seat.lng]);
        for (const c of cities) points.push([c.lat, c.lng]);

        const wentFromEmpty = prevCitiesCountRef.current === 0 && cities.length > 0;
        prevCitiesCountRef.current = cities.length;

        if (points.length > 0) {
            if (!hasFittedRef.current || wentFromEmpty) {
                hasFittedRef.current = true;
                map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12 });
            }
        }
    }, [seat, cities]);

    const handleCloseTeia = () => {
        const pts = drawingPoints;
        if (pts.length < 3) return;
        setIsDrawing(false);
        setDrawingPoints([]);
        onTeia(pts);
    };

    const handleCancelDrawing = () => {
        setIsDrawing(false);
        setDrawingPoints([]);
    };

    const handleUndoPoint = () => {
        setDrawingPoints((prev) => prev.slice(0, -1));
    };

    return (
        <div className={`gx-map-root ${isDrawing ? 'gx-map-drawing-active' : ''}`}>
            <div ref={containerRef} className="gx-map-canvas" />

            {/* Barra de desenho da teia */}
            <div className="gx-map-toolbar">
                {!isDrawing ? (
                    <Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={() => {
                            setDrawingPoints([]);
                            setIsDrawing(true);
                        }}
                    >
                        Desenhar teia
                    </Button>
                ) : (
                    <>
                        <span className="font-medium text-[12.5px] px-1 text-slate-800 dark:text-slate-100">
                            {drawingPoints.length === 0
                                ? 'Clique no mapa para traçar'
                                : `${drawingPoints.length} ponto${drawingPoints.length === 1 ? '' : 's'}`}
                        </span>
                        <Button
                            size="sm"
                            variant="primary"
                            icon={<IconCheck size={14} />}
                            disabled={drawingPoints.length < 3 || busy}
                            onClick={handleCloseTeia}
                        >
                            Fechar teia
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={drawingPoints.length === 0 || busy}
                            onClick={handleUndoPoint}
                        >
                            Desfazer ponto
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            icon={<IconClose size={14} />}
                            disabled={busy}
                            onClick={handleCancelDrawing}
                        >
                            Cancelar
                        </Button>
                    </>
                )}
            </div>

            {/* Legenda compacta */}
            <div className="gx-map-legend" aria-label="Legenda do mapa">
                <div className="flex items-center gap-1.5">
                    <span className="gx-map-dot-served" aria-hidden="true" />
                    <span>Atende</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="gx-map-dot-unserved" aria-hidden="true" />
                    <span>Não atende</span>
                </div>
                {seat ? (
                    <div className="flex items-center gap-1.5">
                        <span className="gx-map-dot-seat" aria-hidden="true" />
                        <span>Sede</span>
                    </div>
                ) : null}
            </div>

            {/* Indicador de carregamento */}
            {busy ? (
                <div className="gx-map-busy-scrim">
                    <IconRefresh size={18} className="animate-spin" />
                    <span>Buscando cidades na teia...</span>
                </div>
            ) : null}
        </div>
    );
};

export default CoverageMap;
