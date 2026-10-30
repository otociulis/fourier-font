import { describe, expect, it } from 'vitest';
import { reconstructContour, sampleCountFor, transformContour, type Point } from './fourier';

function circle(direction = 1): Point[] {
    return Array.from({ length: 256 }, (_, index) => {
        const angle = direction * 2 * Math.PI * index / 256;
        return { x: 17 + 3 * Math.cos(angle), y: -9 + 3 * Math.sin(angle) };
    });
}

function error(source: Point[], result: Point[]): number {
    return source.reduce((sum, point, index) => sum + (point.x - result[index].x) ** 2 + (point.y - result[index].y) ** 2, 0) / source.length;
}

describe('signed complex Fourier contours', () => {
    it.each([1, -1])('preserves translation and traversal direction %s', (direction) => {
        const source = circle(direction);
        const coefficients = transformContour(source, 20);
        expect(coefficients.find((coefficient) => coefficient.frequency === 0)).toMatchObject({ re: 17, im: -9 });
        expect(coefficients.find((coefficient) => coefficient.frequency === direction)?.re).toBeCloseTo(3, 12);
        const result = reconstructContour(coefficients, 20, source.length);
        expect(Math.sqrt(error(source, result))).toBeLessThan(1e-9);
    });

    it('retains DC when no harmonics are selected', () => {
        const points = reconstructContour(transformContour(circle(), 20), 0, 256);
        expect(points.every((point) => Math.abs(point.x - 17) < 1e-10 && Math.abs(point.y + 9) < 1e-10)).toBe(true);
    });

    it('reduces sampled squared error as harmonics are retained', () => {
        const source = circle().map((point, index) => ({ x: point.x + Math.cos(14 * Math.PI * index / 256), y: point.y }));
        const coefficients = transformContour(source, 20);
        const errors = [0, 1, 5, 7, 20].map((frequency) => error(source, reconstructContour(coefficients, frequency, 256)));
        errors.slice(1).forEach((value, index) => expect(value).toBeLessThanOrEqual(errors[index] + 1e-12));
        expect(errors.at(-1)).toBeLessThan(1e-20);
    });

    it('selects safe FFT sample counts and rejects invalid transforms', () => {
        expect(sampleCountFor(100)).toBe(2048);
        expect(sampleCountFor(500)).toBeGreaterThan(1000);
        expect(() => transformContour(circle().slice(1), 20)).toThrow(/power of two/);
        expect(() => transformContour(circle(), 128)).toThrow(/Nyquist/);
    });
    it('smoothly randomizes harmonics with repeatable seeds and fixed DC', () => {
        const coefficients = transformContour(circle(), 20);
        const original = structuredClone(coefficients);
        const options = { amplitude: 0.5, rate: 1, time: 1.4, seed: 42 };
        const result = reconstructContour(coefficients, 20, 256, 0, options);
        expect(result).toEqual(reconstructContour(coefficients, 20, 256, 0, options));
        expect(result).not.toEqual(reconstructContour(coefficients, 20, 256, 0, { ...options, seed: 43 }));
        expect(result).not.toEqual(reconstructContour(coefficients, 20, 256, 0, { ...options, time: 2.4 }));
        expect(result).toEqual(reconstructContour(coefficients, 20, 256, 0, { ...options, time: 0.7, rate: 2 }));
        expect(result.reduce((sum, point) => sum + point.x, 0) / result.length).toBeCloseTo(17, 10);
        expect(result.reduce((sum, point) => sum + point.y, 0) / result.length).toBeCloseTo(-9, 10);
        const before = reconstructContour(coefficients, 20, 256, 0, { ...options, time: 1 - 1e-6 });
        const after = reconstructContour(coefficients, 20, 256, 0, { ...options, time: 1 + 1e-6 });
        expect(error(before, after)).toBeLessThan(1e-15);
        expect(coefficients).toEqual(original);
    });
    it('blends seeded random harmonics into the original contour', () => {
        const coefficients = transformContour(circle(), 20);
        const original = structuredClone(coefficients);
        const random = reconstructContour(coefficients, 20, 256, 0, undefined, { progress: 0, seed: 42 });
        expect(random).not.toEqual(reconstructContour(coefficients, 20, 256));
        expect(random).toEqual(reconstructContour(coefficients, 20, 256, 0, undefined, { progress: 0, seed: 42 }));
        expect(reconstructContour(coefficients, 20, 256, 0, undefined, { progress: 1, seed: 42 })).toEqual(reconstructContour(coefficients, 20, 256));
        expect(coefficients).toEqual(original);
        expect(() => reconstructContour(coefficients, 20, 256, 0, undefined, { progress: 1.1, seed: 42 })).toThrow(/blend/);
    });
    it('adds Wiggly and Breathing independently and makes zero amplitude or K=0 static', () => {
        const coefficients = transformContour(circle(), 20);
        const options = { amplitude: 0.3, rate: 0.5, time: 2, seed: 7 };
        const base = reconstructContour(coefficients, 20, 256);
        const breathing = reconstructContour(coefficients, 20, 256, 0.4);
        const wiggly = reconstructContour(coefficients, 20, 256, 0, options);
        const combined = reconstructContour(coefficients, 20, 256, 0.4, options);
        combined.forEach((point, index) => {
            expect(point.x).toBeCloseTo(breathing[index].x + wiggly[index].x - base[index].x, 10);
            expect(point.y).toBeCloseTo(breathing[index].y + wiggly[index].y - base[index].y, 10);
        });
        expect(reconstructContour(coefficients, 20, 256, 0, { ...options, amplitude: 0 })).toEqual(base);
        expect(reconstructContour(coefficients, 20, 256, 0, { ...options, time: 0 })).toEqual(base);
        expect(reconstructContour(coefficients, 0, 256, 0.4, options)).toEqual(reconstructContour(coefficients, 0, 256));
        for (const patch of [{ time: NaN }, { rate: 0 }, { amplitude: -1 }, { seed: Infinity }]) {
            expect(() => reconstructContour(coefficients, 20, 256, 0, { ...options, ...patch })).toThrow(/Wiggly/);
        }
    });
});