import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import opentype from 'opentype.js';
import { svgPathProperties } from 'svg-path-properties';
import { fontSchema, type FourierFont } from '../src/lib/font-data';
import { sampleCountFor, transformContour, type Point } from '../src/lib/fourier';
import { BUNDLED_FONTS } from '../src/lib/bundled-fonts';

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.?! ';

export function parseSourceFont(buffer: Uint8Array): opentype.Font {
    return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
}

export function sampleGlyphContours(glyph: opentype.Glyph, count: number): Point[][] {
    const paths: opentype.Path[] = [];
    let current: opentype.Path | undefined;
    for (const command of glyph.path.commands) {
        if (command.type === 'M') {
            current = new opentype.Path();
            paths.push(current);
        }
        if (!current) throw new Error(`Glyph ${glyph.name} starts without a move command.`);
        current.commands.push(command);
    }
    return paths.flatMap((path) => {
        if (path.commands.at(-1)?.type !== 'Z') path.close();
        const properties = new svgPathProperties(path.toPathData(6));
        const length = properties.getTotalLength();
        if (!Number.isFinite(length)) throw new Error(`Invalid outline in glyph ${glyph.name}.`);
        if (length < 1e-9) return [];
        return [Array.from({ length: count }, (_, index) => properties.getPointAtLength(length * index / count))];
    });
}

export function generateFont(source: opentype.Font, maxFrequency = 100, metadata: { family?: string; license?: FourierFont['license'] } = {}): FourierFont {
    if (!Number.isInteger(maxFrequency) || maxFrequency < 0 || maxFrequency > 500) {
        throw new Error('--max-frequency must be an integer from 0 to 500.');
    }
    const missing = [...ALPHABET.trim()].filter((character) => source.charToGlyphIndex(character) === 0);
    if (missing.length) throw new Error(`Missing required characters: ${missing.join(' ')}`);
    const glyphs: FourierFont['glyphs'] = {};
    const count = sampleCountFor(maxFrequency);
    for (const character of ALPHABET) {
        const glyph = source.charToGlyph(character);
        const box = character === ' ' ? { x1: 0, y1: 0, x2: 0, y2: 0 } : glyph.getBoundingBox();
        glyphs[character] = {
            advanceWidth: character === ' ' ? (glyph.index && glyph.advanceWidth ? glyph.advanceWidth : source.unitsPerEm / 3) : glyph.advanceWidth ?? source.unitsPerEm,
            bounds: { xMin: box.x1, yMin: box.y1, xMax: box.x2, yMax: box.y2 },
            contours: character === ' ' ? [] : sampleGlyphContours(glyph, count).map((points) => ({
                sampleCount: count,
                coefficients: transformContour(points, maxFrequency),
            })),
        };
    }
    const kerning: Record<string, number> = {};
    for (const left of ALPHABET) {
        for (const right of ALPHABET) {
            const value = source.getKerningValue(source.charToGlyph(left), source.charToGlyph(right));
            if (value) kerning[left + right] = value;
        }
    }
    return fontSchema.parse({
        version: 1,
        family: metadata.family ?? (source.names.fontFamily?.en || 'Imported font'),
        license: metadata.license,
        style: source.names.fontSubfamily?.en || 'Regular',
        coordinates: 'x-right-y-up',
        unitsPerEm: source.unitsPerEm,
        ascender: source.ascender,
        descender: source.descender,
        lineGap: Math.max(0, Number(source.tables.hhea?.lineGap) || 0),
        maxFrequency,
        sampling: 'uniform-arc-length',
        glyphs,
        kerning,
    });
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            input: { type: 'string' },
            output: { type: 'string' },
            family: { type: 'string' },
            license: { type: 'string' },
            'source-url': { type: 'string' },
            'max-frequency': { type: 'string', default: '100' },
        }
    });
    if (Boolean(values.input) !== Boolean(values.output)) throw new Error('--input and --output must be supplied together.');
    if (Boolean(values.license) !== Boolean(values['source-url'])) throw new Error('--license and --source-url must be supplied together.');
    if (!values.input && (values.family || values.license || values['source-url'])) throw new Error('Custom metadata requires --input and --output.');
    const jobs = values.input && values.output ? [{
        input: values.input, output: values.output, family: values.family, license: values.license, sourceUrl: values['source-url'],
    }] : BUNDLED_FONTS.map((font) => ({
        input: font.sourceFile, output: `public/fonts/${font.id}.fourier.json`, family: font.family,
        license: `${dirname(font.sourceFile)}/OFL.txt`, sourceUrl: font.sourceUrl,
    }));
    for (const job of jobs) {
        const source = parseSourceFont(await readFile(job.input));
        const font = generateFont(source, Number(values['max-frequency']), {
            family: job.family,
            license: job.license && job.sourceUrl ? { name: 'OFL-1.1', text: await readFile(job.license, 'utf8'), source: job.sourceUrl } : undefined,
        });
        const json = JSON.stringify(font);
        const output = resolve(job.output);
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, json + '\n');
        const contours = Object.values(font.glyphs).reduce((sum, glyph) => sum + glyph.contours.length, 0);
        console.log(`${font.family}: ${Object.keys(font.glyphs).length} glyphs, ${contours} contours, +/-${font.maxFrequency} harmonics, ${sampleCountFor(font.maxFrequency)} samples/contour.`);
        console.log(`${output} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB)`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}