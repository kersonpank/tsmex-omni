type LatLng = [lat: number, lng: number];

export function pointInPolygon([lat, lng]: LatLng, polygon: LatLng[]): boolean {
    if (polygon.length < 3) return false;

    let inside = false;
    let [previousLat, previousLng] = polygon[polygon.length - 1];

    for (const [edgeLat, edgeLng] of polygon) {
        const latDelta = edgeLat - previousLat;
        const lngDelta = edgeLng - previousLng;
        const crossProduct = latDelta * (lng - previousLng) - lngDelta * (lat - previousLat);

        if (
            crossProduct === 0
            && lat >= Math.min(previousLat, edgeLat) && lat <= Math.max(previousLat, edgeLat)
            && lng >= Math.min(previousLng, edgeLng) && lng <= Math.max(previousLng, edgeLng)
        ) {
            return true;
        }

        // Count intersections with a ray toward increasing longitude, using half-open edges at vertices.
        if ((previousLat > lat) !== (edgeLat > lat)) {
            const intersectionLng = previousLng + (lat - previousLat) * lngDelta / latDelta;
            if (lng < intersectionLng) inside = !inside;
        }

        previousLat = edgeLat;
        previousLng = edgeLng;
    }

    return inside;
}

export function polygonBBox(polygon: LatLng[]) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const [lat, lng] of polygon) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
    }

    return { minLat, maxLat, minLng, maxLng };
}
