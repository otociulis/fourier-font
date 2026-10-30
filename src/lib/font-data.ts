import { z } from 'zod';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 500;
const coordinate = z.number().finite().min(-1e7).max(1e7);
const coefficientSchema = z.object({ frequency: z.number().int(), re: coordinate, im: coordinate });
const contourSchema = z.object({
    sampleCount: z.number().int().min(2).max(32768).refine((count) => Number.isInteger(Math.log2(count))),
    coefficients: z.array(coefficientSchema).min(1).max(1001),
});
export const fontSchema = z.object({
    version: z.literal(1),
    family: z.string().min(1).max(200),
    style: z.string().max(200),
    coordinates: z.literal('x-right-y-up'),
    unitsPerEm: z.number().finite().positive().max(16384),
    ascender: coordinate,
    descender: coordinate,
    lineGap: z.number().finite().nonnegative().max(1e7),
    maxFrequency: z.number().int().min(0).max(500),
    sampling: z.literal('uniform-arc-length'),
    license: z.object({
        name: z.literal('OFL-1.1'),
        text: z.string().min(1).max(20000),
        source: z.string().url().max(2048),
    }).optional(),
    glyphs: z.record(z.string(), z.object({
        advanceWidth: z.number().finite().nonnegative().max(1e7),
        bounds: z.object({ xMin: coordinate, yMin: coordinate, xMax: coordinate, yMax: coordinate }),
        contours: z.array(contourSchema).max(128),
    })),
    kerning: z.record(z.string(), coordinate),
}).superRefine((font, context) => {
    const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    const characters = Object.keys(font.glyphs);
    if (characters.length === 0 || characters.length > 128) issue('Expected 1 to 128 glyphs.');
    if (font.ascender <= font.descender) issue('Ascender must be above descender.');
    if (!font.glyphs[' '] || font.glyphs[' '].advanceWidth <= 0 || font.glyphs[' '].contours.length) {
        issue('A blank space glyph with a positive advance is required.');
    }
    for (const [character, glyph] of Object.entries(font.glyphs)) {
        if ([...character].length !== 1 || /[\r\n\t]/.test(character)) issue('Glyph keys must be individual printable characters.');
        if (glyph.bounds.xMin > glyph.bounds.xMax || glyph.bounds.yMin > glyph.bounds.yMax) issue('Invalid glyph bounds.');
        for (const contour of glyph.contours) {
            if (contour.sampleCount <= 2 * font.maxFrequency) issue('Contour sample count is below Nyquist.');
            if (contour.coefficients.length !== 2 * font.maxFrequency + 1) issue('Inconsistent coefficient count.');
            if (contour.coefficients.some((coefficient, index) => coefficient.frequency !== index - font.maxFrequency)) {
                issue('Coefficients must be ordered from -maxFrequency through +maxFrequency.');
            }
        }
    }
    if (Object.keys(font.kerning).length > 16384) issue('Too many kerning pairs.');
    for (const pair of Object.keys(font.kerning)) {
        if ([...pair].length !== 2 || [...pair].some((character) => !Object.hasOwn(font.glyphs, character))) issue('Invalid kerning pair.');
    }
});

export type FourierFont = z.infer<typeof fontSchema>;
export type FourierGlyph = FourierFont['glyphs'][string];

export function parseFontJson(json: string): FourierFont {
    if (new TextEncoder().encode(json).byteLength > MAX_FILE_BYTES) throw new Error('JSON must be 10 MiB or smaller.');
    const result = fontSchema.safeParse(JSON.parse(json) as unknown);
    if (!result.success) throw new Error(`Invalid Fourier font: ${result.error.issues[0].message}`);
    return result.data;
}