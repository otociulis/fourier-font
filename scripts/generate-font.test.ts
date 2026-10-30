import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateFont, parseSourceFont, sampleGlyphContours, ALPHABET } from './generate-font';
import { parseFontJson, type FourierFont } from '../src/lib/font-data';
import { reconstructContour, sampleCountFor } from '../src/lib/fourier';
import { BUNDLED_FONTS } from '../src/lib/bundled-fonts';

const sources = await Promise.all(BUNDLED_FONTS.map(async (entry) => ({
    ...entry,
    source: parseSourceFont(await readFile(new URL(`../${entry.sourceFile}`, import.meta.url))),
    license: { name: 'OFL-1.1' as const, text: await readFile(new URL(`../fonts/${entry.id}/OFL.txt`, import.meta.url), 'utf8'), source: entry.sourceUrl },
})));

describe.each(sources)('$label generation and validation', ({ source, family, license, id }) => {
    let font: FourierFont;
    beforeAll(() => { font = generateFont(source, 100, { family, license }); }, 30000);

    it('ships reproducible renamed data with the complete original license', async () => {
        const bundled = parseFontJson(await readFile(new URL(`../public/fonts/${id}.fourier.json`, import.meta.url), 'utf8'));
        expect(bundled).toEqual(font);
        expect(bundled.family).toBe(family);
        expect(bundled.license).toEqual(license);
        if (id === 'roboto-mono') {
            expect(new Set(Object.values(font.glyphs).map((glyph) => glyph.advanceWidth)).size).toBe(1);
            expect(font.kerning).toEqual({});
        }
    });
    it('covers the entire initial alphabet with finite, roundtrippable data', () => {
        expect(Object.keys(font.glyphs)).toHaveLength(ALPHABET.length);
        expect(parseFontJson(JSON.stringify(font))).toEqual(font);
        expect(font.glyphs[' '].contours).toEqual([]);
        expect(Object.values(font.glyphs).slice(0, -1).every((glyph) => glyph.contours.length > 0)).toBe(true);
    });

    it.each(['B', '8', 'i', 'j', 'g', '.', '?', '!'])('preserves the independent contours of %s and improves reconstruction', (character) => {
        const glyph = source.charToGlyph(character);
        const samples = sampleGlyphContours(glyph, sampleCountFor(100));
        expect(font.glyphs[character].contours).toHaveLength(samples.length);
        expect(samples.length).toBe(glyph.path.commands.filter((command) => command.type === 'M').length);
        const errors = [5, 20, 100].map((frequency) => {
            let squaredError = 0;
            samples.forEach((points, contourIndex) => {
                const result = reconstructContour(font.glyphs[character].contours[contourIndex].coefficients, frequency, points.length);
                points.forEach((point, index) => { squaredError += (point.x - result[index].x) ** 2 + (point.y - result[index].y) ** 2; });
            });
            return Math.sqrt(squaredError / (samples.length * sampleCountFor(100)));
        });
        expect(errors[1]).toBeLessThanOrEqual(errors[0] + 1e-9);
        expect(errors[2]).toBeLessThanOrEqual(errors[1] + 1e-9);
        console.log(`${character}: ${samples.length} contours; RMS font units at K=5/20/100: ${errors.map((error) => error.toFixed(3)).join(' / ')}`);
    });

    it('produces deterministic data', () => {
        expect(JSON.stringify(generateFont(source, 0))).toBe(JSON.stringify(generateFont(source, 0)));
    });

    it('rejects malformed, oversized and inconsistent imports', () => {
        expect(() => parseFontJson('{')).toThrow();
        expect(() => parseFontJson(' '.repeat(10 * 1024 * 1024 + 1))).toThrow(/10 MiB/);
        for (const patch of [{ version: 2 }, { maxFrequency: 501 }, { maxFrequency: 20 }, { ascender: -1e9 }, { glyphs: {} }, { unitsPerEm: 0 }]) {
            expect(() => parseFontJson(JSON.stringify({ ...font, ...patch }))).toThrow(/Invalid Fourier font/);
        }
        const invalid = structuredClone(font);
        invalid.glyphs.A.contours[0].coefficients[0].frequency = 99;
        expect(() => parseFontJson(JSON.stringify(invalid))).toThrow(/ordered/);
        invalid.glyphs.A.contours[0].coefficients[0].re = Infinity;
        expect(() => parseFontJson(JSON.stringify(invalid))).toThrow();
    });
});