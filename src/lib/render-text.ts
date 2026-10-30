import type { FourierFont, FourierGlyph } from './font-data';
import { MAX_TEXT_LENGTH } from './font-data';
import { reconstructContour, sampleCountFor, type HarmonicBlendOptions, type WiggleOptions } from './fourier';

interface Shape { path: string; minX: number; minY: number; maxX: number; maxY: number }
export interface PlacedGlyph { character: string; path: string; x: number; y: number; scale: number; opacity: number }
export interface TextLayout {
    glyphs: PlacedGlyph[];
    unsupported: string[];
    viewBox: { x: number; y: number; width: number; height: number };
    lineCount: number;
}

const cache = new WeakMap<FourierFont, { frequency: number; breathingStrength: number; shapes: Map<string, Shape> }>();

export type UnwrapEasing = 'linear' | 'ease-in' | 'ease-out' | 'smooth';
export interface UnwrappingOptions { time: number; duration: number; delay: number; seed: number; easing?: UnwrapEasing; startSize?: number }

function easeProgress(progress: number, easing: UnwrapEasing): number {
    switch (easing) {
        case 'linear': return progress;
        case 'ease-in': return progress * progress;
        case 'ease-out': return 1 - (1 - progress) ** 2;
        case 'smooth': return progress * progress * (3 - 2 * progress);
    }
    return progress;
}

function makeShape(glyph: FourierGlyph, frequency: number, count: number, breathingStrength: number, wiggle?: WiggleOptions, blend?: HarmonicBlendOptions): Shape {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const paths = glyph.contours.map((contour, index) => {
        const points = reconstructContour(contour.coefficients, frequency, count, breathingStrength, wiggle ? { ...wiggle, seed: wiggle.seed + index * 9973 } : undefined, blend ? { ...blend, seed: blend.seed + index * 9973 } : undefined);
        return points.map((point, index) => {
            const screenY = -point.y;
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, screenY);
            maxY = Math.max(maxY, screenY);
            return `${index ? 'L' : 'M'}${point.x.toFixed(3)} ${screenY.toFixed(3)}`;
        }).join('') + 'Z';
    });
    return { path: paths.join(''), minX, minY, maxX, maxY };
}

export function motionPadding(font: FourierFont, frequency: number, breathingAmplitude: number, wiggleAmplitude: number, text?: string, unwrapping = false): number {
    let padding = 0;
    const glyphs = text === undefined ? Object.values(font.glyphs) : [...new Set([...text])].flatMap((character) => Object.hasOwn(font.glyphs, character) ? [font.glyphs[character]] : []);
    for (const glyph of glyphs) {
        for (const contour of glyph.contours) {
            const displacement = contour.coefficients.reduce((sum, coefficient) => {
                const harmonic = Math.abs(coefficient.frequency);
                return harmonic > frequency ? sum : sum + Math.hypot(coefficient.re, coefficient.im) * harmonic / (harmonic + 1);
            }, 0);
            const dc = contour.coefficients.find((coefficient) => coefficient.frequency === 0);
            const centerOffset = unwrapping && dc ? Math.hypot(
                dc.re - (glyph.bounds.xMin + glyph.bounds.xMax) / 2,
                dc.im - (glyph.bounds.yMin + glyph.bounds.yMax) / 2,
            ) : 0;
            // Unwrap replaces the original harmonics with offsets up to 3x their magnitude.
            const unwrapGain = unwrapping ? 2 + 3 * Math.SQRT2 : 0;
            padding = Math.max(padding, displacement * (breathingAmplitude + Math.SQRT2 * wiggleAmplitude + unwrapGain) + centerOffset);
        }
    }
    return padding;
}

export function renderText(font: FourierFont, text: string, frequency: number, breathingStrength = 0, wiggle?: WiggleOptions, unwrapping?: UnwrappingOptions): TextLayout {
    if (!Number.isInteger(frequency) || frequency < 0 || frequency > font.maxFrequency) throw new Error('Frequency outside font range.');
    if (!Number.isFinite(breathingStrength) || Math.abs(breathingStrength) > 1) throw new Error('Breathing strength must be between -1 and 1.');
    if (unwrapping && (!Number.isFinite(unwrapping.time) || unwrapping.time < 0 || !Number.isFinite(unwrapping.duration) || unwrapping.duration <= 0 || !Number.isFinite(unwrapping.delay) || unwrapping.delay < 0 || !Number.isSafeInteger(unwrapping.seed) || (unwrapping.startSize !== undefined && (!Number.isFinite(unwrapping.startSize) || unwrapping.startSize < 0 || unwrapping.startSize > 1)))) {
        throw new Error('Invalid unwrapping settings.');
    }
    let entry = wiggle || unwrapping ? undefined : cache.get(font);
    if (!entry || entry.frequency !== frequency || entry.breathingStrength !== breathingStrength) {
        entry = { frequency, breathingStrength, shapes: new Map() };
        if (!wiggle && !unwrapping) cache.set(font, entry);
    }
    const glyphs: PlacedGlyph[] = [];
    const unsupported = new Set<string>();
    const lineHeight = Math.max(font.unitsPerEm, font.ascender - font.descender + font.lineGap);
    let penX = 0;
    let baseline = 0;
    let previous = '';
    let lineCount = 1;
    let minX = 0;
    let minY = -font.ascender;
    let maxX = 0;
    let maxY = -font.descender;
    let characterIndex = 0;
    const normalized = [...text.replace(/\r\n?/g, '\n')].slice(0, MAX_TEXT_LENGTH).join('').replace(/\t/g, '    ');
    for (const character of normalized) {
        const currentIndex = characterIndex++;
        if (character === '\n') {
            penX = 0;
            baseline += lineHeight;
            lineCount++;
            maxY = Math.max(maxY, baseline - font.descender);
            previous = '';
            continue;
        }
        const glyph = Object.hasOwn(font.glyphs, character) ? font.glyphs[character] : undefined;
        if (!glyph) {
            unsupported.add(character);
            penX += font.glyphs[' '].advanceWidth;
            maxX = Math.max(maxX, penX);
            previous = '';
            continue;
        }
        if (previous) penX += font.kerning[previous + character] ?? 0;
        const shapeKey = unwrapping ? `${character}:${currentIndex}` : character;
        const progress = unwrapping ? Math.min(1, Math.max(0, (unwrapping.time - currentIndex * unwrapping.delay) / unwrapping.duration)) : 1;
        const easedProgress = easeProgress(progress, unwrapping?.easing ?? 'smooth');
        const scale = unwrapping ? (unwrapping.startSize ?? 0) + (1 - (unwrapping.startSize ?? 0)) * easedProgress : 1;
        const opacity = unwrapping && unwrapping.time < currentIndex * unwrapping.delay ? 0 : 1;
        let shape = entry.shapes.get(shapeKey);
        if (!shape) {
            shape = makeShape(
                glyph,
                frequency,
                sampleCountFor(font.maxFrequency),
                breathingStrength,
                wiggle ? { ...wiggle, seed: wiggle.seed + character.codePointAt(0)! * 131 } : undefined,
                unwrapping ? { progress: easedProgress, seed: unwrapping.seed + character.codePointAt(0)! * 131 + currentIndex * 65537 } : undefined,
            );
            entry.shapes.set(shapeKey, shape);
        }
        if (shape.path) {
            glyphs.push({ character, path: shape.path, x: penX, y: baseline, scale, opacity });
            minX = Math.min(minX, penX + shape.minX);
            maxX = Math.max(maxX, penX + shape.maxX);
            minY = Math.min(minY, baseline + shape.minY);
            maxY = Math.max(maxY, baseline + shape.maxY);
        }
        penX += glyph.advanceWidth;
        maxX = Math.max(maxX, penX);
        previous = character;
    }
    const padding = font.unitsPerEm * 0.15;
    return {
        glyphs,
        unsupported: [...unsupported],
        lineCount,
        viewBox: { x: minX - padding, y: minY - padding, width: Math.max(font.unitsPerEm, maxX - minX) + 2 * padding, height: Math.max(font.unitsPerEm, maxY - minY) + 2 * padding },
    };
}