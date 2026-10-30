import FFT from 'fft.js';

export interface Point { x: number; y: number }
export interface Coefficient { frequency: number; re: number; im: number }
export interface WiggleOptions { amplitude: number; rate: number; time: number; seed: number }
export interface HarmonicBlendOptions { progress: number; seed: number }

function randomTarget(seed: number, step: number): number {
    if (step === 0) return 0;
    let bits = (seed ^ Math.imul(step, 0x9e3779b9)) >>> 0;
    bits = Math.imul(bits ^ (bits >>> 16), 0x21f0aaad);
    bits = Math.imul(bits ^ (bits >>> 15), 0x735a2d97);
    return ((bits ^ (bits >>> 15)) >>> 0) / 0xffffffff * 2 - 1;
}

function wiggleNoise(options: WiggleOptions, harmonic: number, axis: number): number {
    const position = options.time * options.rate;
    const step = Math.floor(position);
    const fraction = position - step;
    const blend = fraction * fraction * (3 - 2 * fraction);
    const seed = options.seed ^ Math.imul(harmonic, 0x45d9f3b) ^ Math.imul(axis + 1, 0x27d4eb2d);
    const start = randomTarget(seed, step);
    return start + (randomTarget(seed, step + 1) - start) * blend;
}

export function wiggleCoefficient(coefficient: Coefficient, options?: WiggleOptions): Coefficient {
    const harmonic = Math.abs(coefficient.frequency);
    if (!options || !harmonic || !options.amplitude) return coefficient;
    const magnitude = Math.hypot(coefficient.re, coefficient.im) * options.amplitude * harmonic / (harmonic + 1);
    return {
        frequency: coefficient.frequency,
        re: coefficient.re + magnitude * wiggleNoise(options, coefficient.frequency, 0),
        im: coefficient.im + magnitude * wiggleNoise(options, coefficient.frequency, 1),
    };
}

export function sampleCountFor(maxFrequency: number): number {
    return 2 ** Math.ceil(Math.log2(Math.max(2048, 8 * (2 * maxFrequency + 1))));
}

export function transformContour(points: Point[], maxFrequency: number): Coefficient[] {
    const count = points.length;
    if (count < 2 || !Number.isInteger(Math.log2(count))) {
        throw new Error('Contour sample count must be a power of two greater than one.');
    }
    if (!Number.isInteger(maxFrequency) || maxFrequency < 0 || maxFrequency >= count / 2) {
        throw new Error('Maximum frequency must be a nonnegative integer below Nyquist.');
    }
    const fft = new FFT(count);
    const input = fft.createComplexArray();
    points.forEach((point, index) => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Nonfinite contour point.');
        input[2 * index] = point.x;
        input[2 * index + 1] = point.y;
    });
    const output = fft.createComplexArray();
    fft.transform(output, input);
    return Array.from({ length: 2 * maxFrequency + 1 }, (_, index) => {
        const frequency = index - maxFrequency;
        const bin = (frequency + count) % count;
        return { frequency, re: output[2 * bin] / count, im: output[2 * bin + 1] / count };
    });
}

export function reconstructContour(coefficients: Coefficient[], frequency: number, count: number, breathingStrength = 0, wiggle?: WiggleOptions, blend?: HarmonicBlendOptions): Point[] {
    if (!Number.isInteger(frequency) || frequency < 0) throw new Error('Invalid reconstruction frequency.');
    if (!Number.isFinite(breathingStrength) || Math.abs(breathingStrength) > 1) throw new Error('Breathing strength must be between -1 and 1.');
    if (wiggle && (!Number.isFinite(wiggle.amplitude) || wiggle.amplitude < 0 || wiggle.amplitude > 1 ||
        !Number.isFinite(wiggle.rate) || wiggle.rate <= 0 || !Number.isFinite(wiggle.time) || wiggle.time < 0 || !Number.isSafeInteger(wiggle.seed))) {
        throw new Error('Invalid Wiggly settings.');
    }
    if (blend && (!Number.isFinite(blend.progress) || blend.progress < 0 || blend.progress > 1 || !Number.isSafeInteger(blend.seed))) {
        throw new Error('Invalid harmonic blend settings.');
    }
    if (count < 2 || !Number.isInteger(Math.log2(count)) || 2 * frequency >= count) {
        throw new Error('Reconstruction requires a power-of-two count above Nyquist.');
    }
    const fft = new FFT(count);
    const spectrum = fft.createComplexArray();
    for (const coefficient of coefficients) {
        if (Math.abs(coefficient.frequency) > frequency) continue;
        const bin = (coefficient.frequency + count) % count;
        const harmonic = Math.abs(coefficient.frequency);
        const gain = 1 + breathingStrength * harmonic / (harmonic + 1);
        const wiggled = wiggleCoefficient(coefficient, wiggle);
        const randomMagnitude = blend && harmonic ? Math.hypot(coefficient.re, coefficient.im) * 3 * (1 - blend.progress) * harmonic / (harmonic + 1) : 0;
        const randomSeed = blend ? blend.seed ^ Math.imul(coefficient.frequency, 0x45d9f3b) : 0;
        const randomRe = randomMagnitude ? randomMagnitude * randomTarget(randomSeed, 1) : 0;
        const randomIm = randomMagnitude ? randomMagnitude * randomTarget(randomSeed ^ 0x27d4eb2d, 1) : 0;
        const letterGain = blend && harmonic ? blend.progress : 1;
        spectrum[2 * bin] = (coefficient.re * gain * letterGain + randomRe + (wiggled.re - coefficient.re)) * count;
        spectrum[2 * bin + 1] = (coefficient.im * gain * letterGain + randomIm + (wiggled.im - coefficient.im)) * count;
    }
    const output = fft.createComplexArray();
    fft.inverseTransform(output, spectrum);
    return Array.from({ length: count }, (_, index) => ({ x: output[2 * index], y: output[2 * index + 1] }));
}