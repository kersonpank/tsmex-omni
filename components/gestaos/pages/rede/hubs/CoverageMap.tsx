import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoCity } from '../../../../../lib/api';
import { Button } from '../../../ui/kit';
import { IconCheck, IconClose, IconRefresh } from '../../../ui/icons';

type TeiaPoint = [number, number];
type CoveredCity = GeoCity & { served: boolean };

export type CoverageViewport = { south: number; west: number; north: number; east: number };

export interface CoverageMapProps {
    seat: { lat: number; lng: number } | null;
    cities: CoveredCity[];
    nearby: GeoCity[];
    polygon: TeiaPoint[];
    onTeia: (polygon: TeiaPoint[]) => void;
    onClearTeia: () => void;
    onToggle: (ibgeCode: string) => void;
    onAdd: (ibgeCode: string) => void;
    onViewport: (bounds: CoverageViewport, zoom: number) => void;
    busy?: boolean;
    path?: Array<{ lat: number; lng: number }>;
    /** Modo rota: cidades fora da rota ficam em cinza neutro (sem o vermelho de "Não atende"). */
    routeMode?: boolean;
}

const MIN_NEARBY_ZOOM = 8;
const MAX_TEIA_POINTS = 300;
const BLUE = '#1a44d9';
const LIGHT = '#f8faff';
const GRAY = '#64748b';

function cityMarker(city: GeoCity, status: string, options: L.CircleMarkerOptions) {
    const label = document.createElement('span');
    label.textContent = `${city.name}/${city.state} · ${status}`;
    return L.circleMarker([city.lat, city.lng], options)
        .bindTooltip(label, { direction: 'top', offset: [0, -6] });
}

export const CoverageMap: React.FC<CoverageMapProps> = ({
    seat, cities, nearby, polygon, onTeia, onClearTeia, onToggle, onAdd, onViewport, busy = false, path, routeMode = false,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const layersRef = useRef<{
        seat: L.LayerGroup;
        covered: L.LayerGroup;
        nearby: L.LayerGroup;
        polygon: L.LayerGroup;
        sketch: L.LayerGroup;
        path: L.LayerGroup;
    } | null>(null);
    const initialView = useRef({ seat, cities });
    const handlers = useRef({ onTeia, onToggle, onAdd, onViewport, busy });
    handlers.current = { onTeia, onToggle, onAdd, onViewport, busy };

    const [draft, setDraft] = useState<TeiaPoint[] | null>(null);
    const draftRef = useRef<TeiaPoint[] | null>(null);
    const [zoom, setZoom] = useState(4);
    const isDrawing = draft !== null;

    const updateDraft = useCallback((points: TeiaPoint[] | null) => {
        draftRef.current = points;
        setDraft(points);
    }, []);

    const addPoint = useCallback((point: TeiaPoint) => {
        const points = draftRef.current;
        if (points === null || points.length >= MAX_TEIA_POINTS) return;
        const last = points[points.length - 1];
        if (last && Math.abs(last[0] - point[0]) < 0.00001 && Math.abs(last[1] - point[1]) < 0.00001) return;
        updateDraft([...points, point]);
    }, [updateDraft]);

    const closeTeia = useCallback(() => {
        const points = draftRef.current;
        if (!points || points.length < 3 || handlers.current.busy) return;
        updateDraft(null);
        handlers.current.onTeia(points);
    }, [updateDraft]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const tileUrl =
            (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ??
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

        const map = L.map(container, { scrollWheelZoom: false });
        L.tileLayer(tileUrl, {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
        }).addTo(map);

        map.createPane('gx-map-nearby-pane').style.zIndex = '410';
        map.createPane('gx-map-path-pane').style.zIndex = '415';
        map.createPane('gx-map-covered-pane').style.zIndex = '420';
        map.createPane('gx-map-badge-pane').style.zIndex = '425';
        map.createPane('gx-map-seat-pane').style.zIndex = '430';
        layersRef.current = {
            polygon: L.layerGroup().addTo(map),
            sketch: L.layerGroup().addTo(map),
            nearby: L.layerGroup().addTo(map),
            path: L.layerGroup().addTo(map),
            covered: L.layerGroup().addTo(map),
            seat: L.layerGroup().addTo(map),
        };
        mapRef.current = map;

        const { seat: startingSeat, cities: startingCities } = initialView.current;
        if (startingCities.length > 0) {
            const bounds = L.latLngBounds(startingCities.map(({ lat, lng }) => [lat, lng]));
            if (startingSeat) bounds.extend([startingSeat.lat, startingSeat.lng]);
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
        } else if (startingSeat) {
            map.setView([startingSeat.lat, startingSeat.lng], 9);
        } else {
            map.setView([-14.235, -51.925], 4);
        }

        const reportViewport = () => {
            const bounds = map.getBounds();
            const currentZoom = map.getZoom();
            setZoom(currentZoom);
            handlers.current.onViewport({
                south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast(),
            }, currentZoom);
        };
        map.on('moveend', reportViewport);
        reportViewport();

        map.on('click', (e: L.LeafletMouseEvent) => {
            const { lat, lng } = e.latlng.wrap();
            addPoint([lat, lng]);
        });
        map.on('dblclick', (e: L.LeafletMouseEvent) => {
            const event = e.originalEvent as PointerEvent & {
                sourceCapabilities?: { firesTouchEvents: boolean };
                _simulated?: boolean;
            };
            if (event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents || event._simulated) return;
            closeTeia();
        });

        const resizeTimer = setTimeout(() => map.invalidateSize(), 120);
        // O drawer pode abrir com o contêiner sem tamanho.
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
        observer?.observe(container);

        return () => {
            clearTimeout(resizeTimer);
            observer?.disconnect();
            map.off('moveend', reportViewport);
            map.remove();
            mapRef.current = null;
            layersRef.current = null;
        };
    }, [addPoint, closeTeia]);

    useEffect(() => {
        if (isDrawing) mapRef.current?.doubleClickZoom.disable();
        else mapRef.current?.doubleClickZoom.enable();
    }, [isDrawing]);

    useEffect(() => {
        const layer = layersRef.current?.polygon;
        if (!layer) return;
        layer.clearLayers();
        if (polygon.length < 3) return;
        L.polygon(polygon, {
            color: BLUE, weight: 2, fillColor: BLUE, fillOpacity: 0.18, interactive: false,
        }).addTo(layer);
    }, [polygon]);

    useEffect(() => {
        const layer = layersRef.current?.sketch;
        if (!layer) return;
        layer.clearLayers();
        if (!draft?.length) return;

        L.polyline(draft, { dashArray: '6, 6', color: BLUE, weight: 2.5, interactive: false }).addTo(layer);
        if (draft.length >= 3) {
            L.polyline([draft[draft.length - 1], draft[0]], {
                dashArray: '3, 6', color: BLUE, opacity: 0.5, weight: 1.5, interactive: false,
            }).addTo(layer);
        }
        draft.forEach((point, index) => {
            L.circleMarker(point, {
                radius: index === 0 ? 5 : 4,
                fillColor: index === 0 ? BLUE : LIGHT,
                color: BLUE, weight: 2, fillOpacity: 1, interactive: false,
            }).addTo(layer);
        });
    }, [draft]);

    useEffect(() => {
        const layer = layersRef.current?.seat;
        if (!layer) return;
        layer.clearLayers();
        if (!seat) return;

        const position: TeiaPoint = [seat.lat, seat.lng];
        L.circleMarker(position, {
            pane: 'gx-map-seat-pane', radius: 12, fillColor: '#ffc400', fillOpacity: 0.35, stroke: false, interactive: false,
        }).addTo(layer);
        L.circleMarker(position, {
            pane: 'gx-map-seat-pane', radius: 7, fillColor: '#ffc400', fillOpacity: 1, color: '#0c1535', weight: 2.5,
        }).bindTooltip('Sede do hub', { direction: 'top', offset: [0, -8] }).addTo(layer);
    }, [seat]);

    useEffect(() => {
        const layer = layersRef.current?.path;
        if (!layer) return;
        layer.clearLayers();
        if (!path || path.length === 0) return;

        if (path.length >= 2) {
            L.polyline(path.map((p) => [p.lat, p.lng]), {
                pane: 'gx-map-path-pane',
                color: BLUE,
                weight: 3.5,
                opacity: 0.85,
                interactive: false,
            }).addTo(layer);
        }

        const hasSeatAtStart = seat != null && path.length > 0 &&
            Math.abs(path[0].lat - seat.lat) < 0.0001 && Math.abs(path[0].lng - seat.lng) < 0.0001;
        const stopsStartIdx = hasSeatAtStart ? 1 : 0;

        for (let i = stopsStartIdx; i < path.length; i++) {
            const point = path[i];
            const stopNum = i - stopsStartIdx + 1;
            const icon = L.divIcon({
                className: 'gx-route-stop-badge',
                html: `<span>${stopNum}</span>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10],
            });
            L.marker([point.lat, point.lng], {
                pane: 'gx-map-badge-pane',
                icon,
                interactive: false,
            }).addTo(layer);
        }
    }, [path, seat]);

    useEffect(() => {
        const layer = layersRef.current?.covered;
        if (!layer) return;
        layer.clearLayers();

        for (const city of cities) {
            const status = routeMode
                ? (city.served ? 'Na rota · Remover da rota' : 'Fora da rota · Adicionar à rota')
                : (city.served ? 'Atende · Alterar para Não atende' : 'Não atende · Alterar para Atende');
            const neutral = routeMode && !city.served;
            cityMarker(city, status, {
                pane: 'gx-map-covered-pane',
                radius: city.served ? 6 : 5,
                fillColor: city.served ? BLUE : neutral ? GRAY : LIGHT,
                fillOpacity: city.served ? 0.95 : neutral ? 0.9 : 0.15,
                color: city.served ? LIGHT : neutral ? LIGHT : '#cf1a2a',
                weight: city.served ? 1.5 : neutral ? 1 : 2,
            }).on('click', (e: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(e);
                if (draftRef.current) addPoint([city.lat, city.lng]);
                else if (!handlers.current.busy) handlers.current.onToggle(city.ibgeCode);
            }).addTo(layer);
        }
    }, [cities, addPoint, routeMode]);

    const showNearby = zoom >= MIN_NEARBY_ZOOM;
    useEffect(() => {
        const layer = layersRef.current?.nearby;
        if (!layer) return;
        layer.clearLayers();
        if (!showNearby) return;

        for (const city of nearby) {
            cityMarker(city, 'Fora da cobertura · Adicionar como Atende', {
                pane: 'gx-map-nearby-pane', radius: 4, fillColor: GRAY, fillOpacity: 0.9, color: LIGHT, weight: 1,
            }).on('click', (e: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(e);
                if (draftRef.current) addPoint([city.lat, city.lng]);
                else if (!handlers.current.busy) handlers.current.onAdd(city.ibgeCode);
            }).addTo(layer);
        }
    }, [nearby, showNearby, addPoint]);

    return (
        <div className={isDrawing ? 'gx-map-root gx-map-drawing-active' : 'gx-map-root'}>
            <div className="gx-map-toolbar" role="group" aria-label="Ferramentas da teia">
                {draft === null ? (
                    <>
                        <Button className="gx-map-tool-button" size="sm" variant="primary" disabled={busy}
                            onClick={() => {
                                if (polygon.length > 0) onClearTeia();
                                updateDraft([]);
                            }}
                        >
                            Desenhar teia
                        </Button>
                        {polygon.length > 0 ? (
                            <Button className="gx-map-tool-button" size="sm" disabled={busy} onClick={onClearTeia}>
                                Limpar teia
                            </Button>
                        ) : null}
                    </>
                ) : (
                    <>
                        <Button className="gx-map-tool-button" size="sm" variant="primary" icon={<IconCheck size={14} />}
                            disabled={draft.length < 3} onClick={closeTeia}
                        >
                            Fechar teia
                        </Button>
                        <Button className="gx-map-tool-button" size="sm" disabled={draft.length === 0}
                            onClick={() => updateDraft(draft.slice(0, -1))}
                        >
                            Desfazer ponto
                        </Button>
                        <Button className="gx-map-tool-button" size="sm" icon={<IconClose size={14} />} onClick={() => updateDraft(null)}>
                            Cancelar
                        </Button>
                        <span className="gx-map-point-count" aria-live="polite">
                            {draft.length} {draft.length === 1 ? 'ponto' : 'pontos'}
                            {draft.length === MAX_TEIA_POINTS ? ' (limite)' : ''}
                        </span>
                        {draft.length === 0 ? <p className="gx-map-drawing-hint gx-map-hint">Toque no mapa para traçar.</p> : null}
                    </>
                )}
            </div>

            <div className="gx-map-frame">
                <div ref={containerRef} className="gx-map-canvas" role="region" aria-label="Mapa de cobertura do hub" />
                {busy ? (
                    <div className="gx-map-busy-scrim" role="status">
                        <IconRefresh size={18} className="motion-safe:animate-spin" />
                        <span>Buscando cidades na teia…</span>
                    </div>
                ) : null}
            </div>

            <div className="gx-map-legend" role="group" aria-label="Legenda do mapa">
                <span><i className="gx-map-dot-served" aria-hidden="true" />{routeMode ? 'Na rota' : 'Atende'}</span>
                {routeMode ? (
                    <span><i className="gx-map-dot-nearby" aria-hidden="true" />Fora da rota</span>
                ) : (
                    <>
                        <span><i className="gx-map-dot-unserved" aria-hidden="true" />Não atende</span>
                        <span><i className="gx-map-dot-nearby" aria-hidden="true" />Fora da cobertura</span>
                    </>
                )}
                <span><i className="gx-map-dot-seat" aria-hidden="true" />Sede</span>
            </div>
            {!showNearby ? <p className="gx-map-hint">Aproxime para ver as cidades da região</p> : null}
        </div>
    );
};

export default CoverageMap;
