import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pointInPolygon, polygonBBox } from './pointInPolygon.js';

const square: Array<[number, number]> = [[0, 0], [0, 4], [4, 4], [4, 0]];

describe('pointInPolygon', () => {
    it('includes points inside an open square and on its boundary', () => {
        assert.equal(pointInPolygon([2, 2], square), true);
        assert.equal(pointInPolygon([0, 2], square), true);
        assert.equal(pointInPolygon([2, 4], square), true);
    });

    it('excludes points outside a square', () => {
        assert.equal(pointInPolygon([5, 2], square), false);
        assert.equal(pointInPolygon([2, -1], square), false);
        assert.equal(pointInPolygon([0, 5], square), false);
    });

    it('excludes the cutout of a concave U-shaped polygon', () => {
        const polygon: Array<[number, number]> = [
            [0, 0], [0, 6], [6, 6], [6, 4], [2, 4], [2, 2], [6, 2], [6, 0],
        ];

        assert.equal(pointInPolygon([4, 1], polygon), true);
        assert.equal(pointInPolygon([1, 3], polygon), true);
        assert.equal(pointInPolygon([4, 5], polygon), true);
        assert.equal(pointInPolygon([4, 3], polygon), false);
    });

    it('accepts a closed polygon with its first vertex repeated', () => {
        const closedSquare = [...square, square[0]];

        assert.equal(pointInPolygon([2, 2], closedSquare), true);
        assert.equal(pointInPolygon([0, 0], closedSquare), true);
        assert.equal(pointInPolygon([2, -1], closedSquare), false);
    });
});

describe('polygonBBox', () => {
    it('returns the limits of each coordinate across all vertices', () => {
        assert.deepEqual(polygonBBox([[-2, 10], [6, -1], [3, -7], [-2, 10]]), {
            minLat: -2,
            maxLat: 6,
            minLng: -7,
            maxLng: 10,
        });
    });
});
