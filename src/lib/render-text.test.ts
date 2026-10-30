import { describe, expect, it } from 'vitest';
import type { FourierFont } from './font-data';
import { motionPadding, renderText } from './render-text';
import { reconstructContour } from './fourier';

const font: FourierFont = {
    version: 1, family: 'Test', style: 'Regular', coordinates: 'x-right-y-up', unitsPerEm: 1000,
    ascender: 800, descender: -200, lineGap: 100, maxFrequency: 1, sampling: 'uniform-arc-length',
    glyphs: {
        ' ': { advanceWidth: 250, bounds: { xMin: 0, xMax: 0, yMin: 0, yMax: 0 }, contours: [] },
        A: {
            advanceWidth: 600, bounds: { xMin: -100, xMax: 500, yMin: 0, yMax: 600 }, contours: [{
                sampleCount: 2048, coefficients: [
                    { frequency: -1, re: 0, im: 0 }, { frequency: 0, re: 200, im: 300 }, { frequency: 1, re: 400, im: 0 },
                ]
            }]
        },
    }, kerning: { AA: -50 },
};

describe('JSON-only text layout', () => {
    it('uses advances and kerning, but never kerns across line breaks', () => {
        const layout = renderText(font, 'AA\nA A', 1);
        expect(layout.glyphs.map(({ x, y }) => [x, y])).toEqual([[0, 0], [550, 0], [0, 1100], [850, 1100]]);
        expect(layout.lineCount).toBe(2);
    });
    it('normalizes line endings and tabs and warns about unsupported input', () => {
        const layout = renderText(font, 'A\tA?A\r\nA', 1);
        expect(layout.glyphs.map(({ x }) => x)).toEqual([0, 1600, 2450, 0]);
        expect(layout.unsupported).toEqual(['?']);
        expect(layout.lineCount).toBe(2);
    });
    it('bounds reconstructed overhangs and preserves independent closed contours', () => {
        const layout = renderText(font, 'A', 1);
        expect(layout.viewBox.x).toBeLessThan(-200);
        expect(layout.viewBox.y).toBeLessThan(-700);
        expect(layout.glyphs[0].path.endsWith('Z')).toBe(true);
        const donut = structuredClone(font);
        donut.glyphs.A.contours.push({
            sampleCount: 2048, coefficients: [
                { frequency: -1, re: 100, im: 0 }, { frequency: 0, re: 200, im: 300 }, { frequency: 1, re: 0, im: 0 },
            ]
        });
        expect(renderText(donut, 'A', 1).glyphs[0].path.match(/M/g)).toHaveLength(2);
        expect(renderText(donut, 'A', 1).glyphs[0].path.match(/Z/g)).toHaveLength(2);
    });
    it.each(['', '   ', '\n', '?'])('has finite nonzero bounds for %j', (text) => {
        const { viewBox } = renderText(font, text, 0);
        expect(viewBox.width).toBeGreaterThan(0);
        expect(viewBox.height).toBeGreaterThan(0);
        expect(Object.values(viewBox).every(Number.isFinite)).toBe(true);
    });
    it('rejects out-of-range frequencies and caps text', () => {
        expect(() => renderText(font, 'A', 2)).toThrow();
        expect(renderText(font, 'A'.repeat(501), 0).glyphs).toHaveLength(500);
    });
    it('modulates nonzero harmonics around fixed contour centers without changing source data or spacing', () => {
        const original = JSON.stringify(font);
        const base = renderText(font, 'AA', 1);
        const expanded = renderText(font, 'AA', 1, 0.4);
        const contracted = renderText(font, 'AA', 1, -0.4);
        expect(expanded.glyphs[0].path).not.toBe(base.glyphs[0].path);
        expect(contracted.glyphs[0].path).not.toBe(expanded.glyphs[0].path);
        expect(expanded.glyphs.map(({ x, y }) => [x, y])).toEqual(base.glyphs.map(({ x, y }) => [x, y]));
        const points = reconstructContour(font.glyphs.A.contours[0].coefficients, 1, 2048, 0.4);
        expect(points.reduce((sum, point) => sum + point.x, 0) / points.length).toBeCloseTo(200, 10);
        expect(points.reduce((sum, point) => sum + point.y, 0) / points.length).toBeCloseTo(300, 10);
        expect(points[0].x).toBeCloseTo(680, 10);
        expect(renderText(font, 'AA', 1, 0)).toEqual(base);
        expect(JSON.stringify(font)).toBe(original);
    });
    it('keeps DC-only geometry still and validates breathing strength', () => {
        expect(renderText(font, 'A', 0, 0.5)).toEqual(renderText(font, 'A', 0));
        for (const strength of [NaN, Infinity, -1.1, 1.1]) {
            expect(() => renderText(font, 'A', 1, strength)).toThrow(/Breathing/);
        }
    });
    it('keeps Wiggly layout fixed, bounds combined displacement, and restores cached static paths', () => {
        const base = renderText(font, 'AA', 1);
        const original = JSON.stringify(font);
        const options = { amplitude: 0.5, rate: 2, time: 0.7, seed: 5 };
        const animated = renderText(font, 'AA', 1, 0.5, options);
        expect(animated.glyphs[0].path).not.toBe(base.glyphs[0].path);
        expect(animated.glyphs.map(({ x, y }) => [x, y])).toEqual(base.glyphs.map(({ x, y }) => [x, y]));
        const padding = motionPadding(font, 1, 0.5, 0.5);
        expect(padding).toBeCloseTo(200 * (0.5 + Math.SQRT2 * 0.5), 10);
        expect(motionPadding(font, 1, 0.5, 0.5, 'AA?')).toBe(padding);
        expect(motionPadding(font, 1, 0.5, 0.5, ' ?')).toBe(0);
        expect(motionPadding(font, 0, 0.5, 0.5)).toBe(0);
        expect(animated.viewBox.x).toBeGreaterThanOrEqual(base.viewBox.x - padding);
        expect(animated.viewBox.x + animated.viewBox.width).toBeLessThanOrEqual(base.viewBox.x + base.viewBox.width + padding);
        expect(renderText(font, 'AA', 1)).toEqual(base);
        expect(JSON.stringify(font)).toBe(original);
    });
    it('unwraps letters in order and settles on the cached static layout', () => {
        const original = JSON.stringify(font);
        const base = renderText(font, 'AA', 1);
        const start = renderText(font, 'AA', 1, 0, undefined, { time: 0, duration: 0.7, delay: 0.12, seed: 12 });
        const halfway = renderText(font, 'AA', 1, 0, undefined, { time: 0.35, duration: 0.7, delay: 0.12, seed: 12 });
        const firstSettled = renderText(font, 'AA', 1, 0, undefined, { time: 0.7, duration: 0.7, delay: 0.12, seed: 12 });
        const allSettled = renderText(font, 'AA', 1, 0, undefined, { time: 0.82, duration: 0.7, delay: 0.12, seed: 12 });
        const secondStarts = renderText(font, 'AA', 1, 0, undefined, { time: 0.12, duration: 0.7, delay: 0.12, seed: 12, startSize: 0.1 });
        expect(start.glyphs[0].path).not.toBe(base.glyphs[0].path);
        expect(start.glyphs[1].path).not.toBe(base.glyphs[1].path);
        expect(start.glyphs.map(({ scale }) => scale)).toEqual([0, 0]);
        expect(start.glyphs.map(({ opacity }) => opacity)).toEqual([1, 0]);
        expect(secondStarts.glyphs.map(({ opacity }) => opacity)).toEqual([1, 1]);
        expect(secondStarts.glyphs[1].scale).toBeCloseTo(0.1);
        expect(halfway.glyphs[0].scale).toBeCloseTo(0.5);
        expect(halfway.glyphs[1].scale).toBeGreaterThan(0);
        expect(halfway.glyphs[1].scale).toBeLessThan(halfway.glyphs[0].scale);
        expect(firstSettled.glyphs[0].path).toBe(base.glyphs[0].path);
        expect(firstSettled.glyphs[0].scale).toBe(1);
        expect(firstSettled.glyphs[1].path).not.toBe(base.glyphs[1].path);
        expect(allSettled).toEqual(base);
        expect(JSON.stringify(font)).toBe(original);
    });
    it('bounds unwrapping even when Wiggly is enabled with a small amplitude', () => {
        const base = renderText(font, 'AA', 1);
        const padding = motionPadding(font, 1, 0.5, 0.01, 'AA', true);
        for (let seed = 0; seed < 30; seed++) {
            const frame = renderText(font, 'AA', 1, 0.5, { amplitude: 0.01, rate: 1, time: 0.5, seed },
                { time: 0.03, duration: 0.7, delay: 0, seed, startSize: 1 });
            expect(frame.viewBox.x).toBeGreaterThanOrEqual(base.viewBox.x - padding);
            expect(frame.viewBox.y).toBeGreaterThanOrEqual(base.viewBox.y - padding);
            expect(frame.viewBox.x + frame.viewBox.width).toBeLessThanOrEqual(base.viewBox.x + base.viewBox.width + padding);
            expect(frame.viewBox.y + frame.viewBox.height).toBeLessThanOrEqual(base.viewBox.y + base.viewBox.height + padding);
        }
    });
    it('uses the selected easing for reveal progress and starts from the configured size', () => {
        const scaleAt = (easing: 'linear' | 'ease-in' | 'ease-out' | 'smooth', startSize = 0) => renderText(
            font, 'A', 1, 0, undefined, { time: 0.175, duration: 0.7, delay: 0, seed: 12, easing, startSize },
        ).glyphs[0].scale;
        expect(scaleAt('linear')).toBeCloseTo(0.25);
        expect(scaleAt('ease-in')).toBeCloseTo(0.0625);
        expect(scaleAt('ease-out')).toBeCloseTo(0.4375);
        expect(scaleAt('smooth')).toBeCloseTo(0.15625);
        expect(scaleAt('smooth', 0.2)).toBeCloseTo(0.2 + 0.8 * 0.15625);
    });
});