import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFontJson, type FourierGlyph } from './font-data';
import { FontPlayer, glyphPitch, makeScore, synthesizeNote, type SoundSettings, type ToneState } from './sound';

const font = parseFontJson(readFileSync(new URL('../../public/fonts/dancing-script.fourier.json', import.meta.url), 'utf8'));
const settings: SoundSettings = { mode: 'speech', voicing: 'tone', basePitchHz: 140, questionRise: 4, exclamationLift: 4, exclamationFall: 2, frequency: 20, minimumPause: 0.2, letterDurationMs: 140, glideDurationMs: 40, spaceGlideMs: 0, sentencePauseMs: 800, wiggleAmplitude: 0.1, wiggleRate: 1, seed: 42 };

describe('glyph score', () => {
    it('sets exact letter lengths without changing pitch, bridges or sentence pauses', () => {
        for (const mode of ['speech', 'sing'] as const) {
            for (const voicing of ['tone', 'chords'] as const) {
                for (const letterDurationMs of [40, 100, 420, 1000]) {
                    const options = { ...settings, mode, voicing, letterDurationMs, spaceGlideMs: 120 };
                    const score = makeScore(font, 'Ab C.D', options);
                    const letters = score.notes.filter((note) => !note.bridge);
                    expect(letters.map((note) => note.duration)).toEqual(Array(4).fill(letterDurationMs / 1000));
                    expect(score.notes.find((note) => note.bridge)?.duration).toBe(0.12);
                    expect(score.duration).toBeCloseTo(4 * letterDurationMs / 1000 + 0.12 + options.sentencePauseMs / 1000);
                    const reference = makeScore(font, 'Ab C.D', { ...options, letterDurationMs: 140 });
                    expect(letters.map((note) => note.pitch)).toEqual(reference.notes.filter((note) => !note.bridge).map((note) => note.pitch));
                    const state: ToneState = { phase: 0, pitch: score.notes[0].pitch };
                    for (const note of score.notes) {
                        const samples = synthesizeNote(font.glyphs[note.character], note, options, state, 48000);
                        expect(samples.length).toBe(Math.round((note.start + note.duration) * 48000) - Math.round(note.start * 48000));
                        expect(samples.every(Number.isFinite)).toBe(true);
                    }
                }
            }
        }
        for (const letterDurationMs of [0, 39, 1001, NaN]) {
            expect(() => makeScore(font, 'A', { ...settings, letterDurationMs })).toThrow('Invalid sound settings');
        }
    });

    it('transposes glyph pitches using the configured base in both modes', () => {
        for (const mode of ['speech', 'sing'] as const) {
            const low = makeScore(font, 'Ab', { ...settings, mode, basePitchHz: 100 });
            const high = makeScore(font, 'Ab', { ...settings, mode, basePitchHz: 200 });
            high.notes.forEach((note, index) => expect(note.pitch).toBeCloseTo(low.notes[index].pitch * 2));
        }
    });

    it('uses configurable question and exclamation ranges and ignores them in Sing', () => {
        for (const voicing of ['tone', 'chords'] as const) {
            for (const amount of [0, 0.5, 6, 12]) {
                const options = { ...settings, voicing, glideDurationMs: 0, questionRise: amount, exclamationLift: amount, exclamationFall: amount };
                for (const ending of ['?', '!']) {
                    const note = makeScore(font, `A${ending}`, options).notes[0];
                    const state: ToneState = { phase: 0, pitch: note.pitch };
                    synthesizeNote(font.glyphs.A, note, options, state);
                    expect(state.pitch / note.pitch).toBeCloseTo(2 ** ((ending === '?' ? amount : -amount) / 12), 4);
                    if (ending === '!') {
                        const peakNote = { ...note, duration: note.duration * 0.6 };
                        synthesizeNote(font.glyphs.A, peakNote, options, state);
                        expect(state.pitch / note.pitch).toBeCloseTo(2 ** (amount / 12), 4);
                    }
                    const singing = { ...options, mode: 'sing' as const };
                    const singNote = makeScore(font, 'A', singing).notes[0];
                    expect(synthesizeNote(font.glyphs.A, singNote, singing)).toEqual(
                        synthesizeNote(font.glyphs.A, singNote, { ...singing, questionRise: 0, exclamationLift: 0, exclamationFall: 0 }),
                    );
                }
            }
        }
    });

    it('rejects invalid pitch controls', () => {
        for (const overrides of [{ basePitchHz: 79 }, { basePitchHz: 401 }, { basePitchHz: NaN }, { questionRise: -1 }, { questionRise: 13 }, { exclamationLift: Infinity }, { exclamationFall: -1 }]) {
            expect(() => makeScore(font, 'A?', { ...settings, ...overrides })).toThrow('Invalid sound settings');
        }
    });

    it('applies speech intonation to only the final word and uses sentence silence instead of a space bridge', () => {
        for (const ending of ['?', '!']) {
            const options = { ...settings, spaceGlideMs: 120 };
            const score = makeScore(font, `Hello World${ending} \n Next`, options);
            expect(score.notes.some((note) => note.character === ending)).toBe(false);
            const marked = score.notes.filter((note) => note.intonation);
            expect(marked.map((note) => note.character).join('')).toBe('World');
            expect(marked.every((note) => note.intonation?.kind === (ending === '?' ? 'question' : 'exclamation'))).toBe(true);
            const last = marked.at(-1)!;
            const next = score.notes.find((note) => note.character === 'N')!;
            expect(next.bridge).toBeUndefined();
            expect(next.legato).toBe(false);
            expect(last.connectsNext).toBe(false);
            expect(next.start - last.start - last.duration).toBeCloseTo(options.sentencePauseMs / 1000);
            expect(makeScore(font, `A${ending}${ending}B`, options).notes[1].start - 0.14).toBeCloseTo(2 * options.sentencePauseMs / 1000);
        }
    });

    it('synthesizes a question rise and exclamation lift/fall in either voicing, without changing Sing', () => {
        for (const voicing of ['tone', 'chords'] as const) {
            const options = { ...settings, voicing, glideDurationMs: 0 };
            for (const ending of ['?', '!']) {
                const note = makeScore(font, `A${ending}`, options).notes[0];
                const state: ToneState = { phase: 0, pitch: note.pitch };
                const samples = synthesizeNote(font.glyphs.A, note, options, state);
                const ratio = ending === '?' ? 2 ** (4 / 12) : 2 ** (-2 / 12);
                expect(state.pitch / note.pitch).toBeCloseTo(ratio, 5);
                expect(samples.every(Number.isFinite)).toBe(true);
                expect(samples).not.toEqual(synthesizeNote(font.glyphs.A, { ...note, intonation: undefined }, options));
                const singing = { ...options, mode: 'sing' as const };
                const score = makeScore(font, `A${ending}`, singing);
                expect(score.notes.map((note) => note.character)).toEqual(['A', ending]);
                expect(score.notes.every((note) => note.intonation === undefined)).toBe(true);
                expect(synthesizeNote(font.glyphs.A, note, singing)).toEqual(
                    synthesizeNote(font.glyphs.A, { ...note, intonation: undefined }, singing),
                );
            }
        }
    });

    it('uses the exact configured dot silence without bridging, extra trailing whitespace pauses or melody steps', () => {
        for (const mode of ['speech', 'sing'] as const) {
            for (const voicing of ['tone', 'chords'] as const) {
                for (const sentencePauseMs of [100, 800, 5000]) {
                    const options = { ...settings, mode, voicing, spaceGlideMs: 300, sentencePauseMs };
                    const score = makeScore(font, 'A. \t\nB..C.', options);
                    expect(score.notes.map((note) => note.character)).toEqual(['A', 'B', 'C']);
                    expect(score.notes.every((note) => !note.bridge && !note.legato && !note.connectsNext)).toBe(true);
                    const [a, b, c] = score.notes;
                    expect(b.start - a.start - a.duration).toBeCloseTo(sentencePauseMs / 1000);
                    expect(c.start - b.start - b.duration).toBeCloseTo(2 * sentencePauseMs / 1000);
                    expect(score.duration - c.start - c.duration).toBeCloseTo(sentencePauseMs / 1000);
                    expect(score.notes.map((note) => note.pitch)).toEqual(makeScore(font, 'ABC', options).notes.map((note) => note.pitch));
                }
            }
        }
    });

    it('plays question and exclamation marks as supported glyphs', () => {
        const score = makeScore(font, 'A?!', { ...settings, mode: 'sing' });
        expect(score.notes.map((note) => note.character)).toEqual(['A', '?', '!']);
        for (const character of ['.', '?', '!']) {
            expect(font.glyphs[character].contours.length).toBeGreaterThan(0);
        }
        for (const note of score.notes.slice(1)) {
            expect(synthesizeNote(font.glyphs[note.character], note, { ...settings, mode: 'sing' }).some((value) => Math.abs(value) > 0.001)).toBe(true);
        }
        for (const sentencePauseMs of [-1, 0, 10001, NaN]) {
            expect(() => makeScore(font, 'A.B', { ...settings, sentencePauseMs })).toThrow('Invalid sound settings');
        }
    });

    it('bridges word boundaries once, without changing letter order or melody', () => {
        for (const mode of ['speech', 'sing'] as const) {
            const options = { ...settings, mode, spaceGlideMs: 300 };
            const score = makeScore(font, ' A \t\n@ B C ', options, () => 0);
            const letters = score.notes.filter((note) => !note.bridge);
            const silent = makeScore(font, 'A B C', { ...options, spaceGlideMs: 0 }, () => 0);
            expect(letters.map((note) => note.character)).toEqual(['A', 'B', 'C']);
            expect(letters.map((note) => note.pitch)).toEqual(silent.notes.map((note) => note.pitch));
            const bridges = score.notes.filter((note) => note.bridge);
            expect(bridges).toHaveLength(2);
            expect(bridges.map((note) => note.duration)).toEqual([0.3, 0.3]);
            expect(bridges.map((note) => note.pitch)).toEqual(letters.slice(1).map((note) => note.pitch));
            expect(score.notes[0].legato).toBe(false);
            expect(score.notes.at(-1)!.connectsNext).toBe(false);
            for (let index = 1; index < score.notes.length; index++) {
                expect(score.notes[index].start).toBeCloseTo(score.notes[index - 1].start + score.notes[index - 1].duration);
                expect(score.notes[index].legato).toBe(true);
            }
        }
    });

    it('sustains continuous audio through configurable bridges for all modes and voicings', () => {
        for (const mode of ['speech', 'sing'] as const) {
            for (const voicing of ['tone', 'chords'] as const) {
                for (const spaceGlideMs of [10, 300, 2000]) {
                    const options = { ...settings, mode, voicing, spaceGlideMs, wiggleAmplitude: 0 };
                    const score = makeScore(font, 'A B', options);
                    const state: ToneState = { phase: 0, pitch: score.notes[0].pitch };
                    let length = 0;
                    let last = 0;
                    for (const note of score.notes) {
                        const expected = voicing === 'tone' ? Math.sin(state.phase) * 0.22
                            : (state.chordPhases ?? [0, 0, 0]).reduce((sum, phase, index) => sum + Math.sin(phase) * (state.chordWeights?.[index] ?? 0), 0) * 0.22;
                        const samples = synthesizeNote(font.glyphs[note.character], note, options, state, 48000);
                        if (note.legato) {
                            expect(samples[0]).toBeCloseTo(expected, 6);
                            expect(Math.abs(samples[0] - last)).toBeLessThan(0.025);
                        }
                        if (note.bridge) {
                            expect(Math.abs(state.pitch - note.pitch)).toBeLessThan(0.01);
                            const energy = samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
                            expect(energy).toBeGreaterThan(0.001);
                        }
                        length += samples.length;
                        last = samples[samples.length - 1];
                    }
                    expect(length).toBe(Math.round(score.duration * 48000));
                }
            }
        }
    });

    it('plays each supported glyph in order, bounding randomized word pauses by the selected minimum', () => {
        for (const random of [0, 0.2, 0.75, 1]) {
            const score = makeScore(font, 'Ab \t\n @Cd', settings, () => random);
            expect(score.notes.map((note) => note.character)).toEqual(['A', 'b', 'C', 'd']);
            expect(score.notes[1].start).toBeCloseTo(0.14);
            const gap = score.notes[2].start - score.notes[1].start - 0.14;
            expect(gap).toBeCloseTo(settings.minimumPause * (1 + random));
            expect(gap).toBeGreaterThanOrEqual(settings.minimumPause - 1e-10);
            expect(gap).toBeLessThanOrEqual(settings.minimumPause * 2 + 1e-10);
        }
    });

    describe('playback scheduling', () => {
        afterEach(() => {
            vi.useRealTimers();
            vi.unstubAllGlobals();
        });

        it.each(['normal', 'timer-stall', 'generation-stall'])('schedules non-overlapping letters or reports missed deadlines: %s', async (scenario) => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            const starts: { start: number; duration: number }[] = [];
            const filters: { type: string; frequency: { value: number }; Q: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
            const gainConnect = vi.fn();
            class TestAudioContext {
                sampleRate = 48000;
                state = 'running';
                destination = {};
                onstatechange: (() => void) | null = null;
                get currentTime() { return Date.now() / 1000; }
                async resume() {}
                async close() { this.state = 'closed'; }
                createGain() { return { gain: { value: 1 }, connect: gainConnect, disconnect() {} }; }
                createBiquadFilter() {
                    const filter = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
                    filters.push(filter);
                    return filter;
                }
                createBuffer(_channels: number, length: number, sampleRate: number) {
                    expect(sampleRate).toBe(this.sampleRate);
                    return {
                        duration: length / sampleRate,
                        copyToChannel() {
                            if (scenario === 'generation-stall') vi.setSystemTime(Date.now() + 1000);
                        },
                    };
                }
                createBufferSource() {
                    return {
                        buffer: { duration: 0 },
                        onended: null,
                        connect() {},
                        disconnect() {},
                        start(time: number) { starts.push({ start: time, duration: this.buffer.duration }); },
                    };
                }
            }
            vi.stubGlobal('AudioContext', TestAudioContext);
            for (const mode of ['speech', 'sing'] as const) {
                starts.length = 0;
                const ended = vi.fn();
                const error = vi.fn();
                const player = new FontPlayer(ended, error);
                await player.play(font, 'B8ijg B8ijg', { ...settings, mode });
                const scheduled = starts.length;
                if (scenario === 'timer-stall') vi.setSystemTime(Date.now() + 5000);
                await vi.advanceTimersByTimeAsync(10000);
                expect(starts).toHaveLength(scenario === 'normal' ? 10 : scheduled);
                if (scenario === 'generation-stall') expect(starts).toHaveLength(0);
                for (let index = 1; index < starts.length; index++) {
                    const gap = starts[index].start - starts[index - 1].start - starts[index - 1].duration;
                    if (index === 5) expect(gap).toBeGreaterThanOrEqual(settings.minimumPause - 1e-10);
                    else expect(gap).toBeCloseTo(0, 10);
                }
                if (scenario !== 'normal') {
                    expect(ended).not.toHaveBeenCalled();
                    expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('fell behind') }));
                } else {
                    expect(ended).toHaveBeenCalledExactlyOnceWith();
                    expect(error).not.toHaveBeenCalled();
                }
                expect(vi.getTimerCount()).toBe(0);
                const filter = filters.at(-1)!;
                expect(filter.type).toBe('highpass');
                expect(filter.frequency.value).toBe(60);
                expect(filter.Q.value).toBe(Math.SQRT1_2);
                expect(gainConnect).toHaveBeenLastCalledWith(filter);
                expect(filter.connect).toHaveBeenCalledOnce();
                expect(filter.disconnect).toHaveBeenCalledOnce();
            }
        });
    });

    it('uses longer notes and changing pitches for singing, without changing text order', () => {
        const speech = makeScore(font, 'Hello', settings);
        const sing = makeScore(font, 'Hello', { ...settings, mode: 'sing', letterDurationMs: 420 });
        expect(sing.notes.map((note) => note.character)).toEqual(speech.notes.map((note) => note.character));
        expect(new Set(sing.notes.map((note) => note.pitch)).size).toBeGreaterThan(1);
        expect(sing.duration).toBeGreaterThan(speech.duration);
    });

    it('caps Unicode code points and handles empty/unsupported input', () => {
        expect(makeScore(font, 'A'.repeat(501), settings).notes).toHaveLength(500);
        expect(makeScore(font, '@@\t\n', settings).notes).toEqual([]);
        expect(makeScore(font, '', settings).duration).toBe(0);
    });

    it('creates exactly one non-overlapping note per letter, including multi-contour letters', () => {
        for (const mode of ['speech', 'sing'] as const) {
            const score = makeScore(font, 'B8ijg B8ijg', { ...settings, mode });
            expect(score.notes.map((note) => note.character).join('')).toBe('B8ijgB8ijg');
            expect(score.notes).toHaveLength(10);
            for (let index = 1; index < score.notes.length; index++) {
                const gap = score.notes[index].start - score.notes[index - 1].start - score.notes[index - 1].duration;
                if (index === 5) expect(gap).toBeGreaterThanOrEqual(settings.minimumPause - 1e-10);
                else expect(gap).toBeCloseTo(0, 10);
            }
            expect(score.notes.map((note) => note.legato)).toEqual([false, true, true, true, true, false, true, true, true, true]);
            expect(score.notes.map((note) => note.connectsNext)).toEqual([true, true, true, true, false, true, true, true, true, false]);
        }
    });

    it('rejects invalid settings rather than scheduling invalid audio', () => {
        for (const overrides of [{ frequency: -1 }, { frequency: 501 }, { minimumPause: 0 }, { glideDurationMs: -1 }, { glideDurationMs: 1001 }, { glideDurationMs: NaN }, { spaceGlideMs: -1 }, { spaceGlideMs: 5001 }, { spaceGlideMs: NaN }, { wiggleRate: 0 }, { wiggleAmplitude: NaN }]) {
            expect(() => makeScore(font, 'A', { ...settings, ...overrides })).toThrow('Invalid sound settings');
        }
        expect(() => makeScore(font, 'A B', settings, () => NaN)).toThrow('Invalid pause randomness');
    });
});

describe('glyph synthesis', () => {
    const note = makeScore(font, 'A', settings).notes[0];
    const energy = (samples: Float32Array) => samples.reduce((sum, value) => sum + value * value, 0) / samples.length;

    it('blends exactly three simultaneous chord voices using normalized font harmonic weights', () => {
        const glyph: FourierGlyph = {
            advanceWidth: 100, bounds: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
            contours: [{ sampleCount: 2048, coefficients: [
                { frequency: 1, re: 2, im: 0 }, { frequency: -2, re: 3, im: 0 }, { frequency: 3, re: 5, im: 0 },
            ] }],
        };
        const options: SoundSettings = { ...settings, voicing: 'chords' };
        const state: ToneState = { phase: 0, pitch: note.pitch };
        const samples = synthesizeNote(glyph, note, options, state);
        const weights = [0.6, 0.15, 0.25];
        const ratios = [1, 2 ** (4 / 12), 2 ** (7 / 12)];
        expect(state.chordWeights).toEqual(weights);
        for (let index = 0; index < samples.length; index++) {
            const time = index / 24000;
            const ease = (value: number) => {
                const t = Math.min(1, Math.max(0, value));
                return t * t * (3 - 2 * t);
            };
            const envelope = Math.min(ease(time / 0.012), ease((note.duration - time) / 0.035));
            const expected = ratios.reduce((sum, ratio, voice) => sum + weights[voice] * Math.sin(2 * Math.PI * note.pitch * ratio * time), 0);
            expect(samples[index]).toBeCloseTo(expected * envelope * 0.22, 6);
        }
        expect(samples).not.toEqual(synthesizeNote(glyph, note, settings));
        expect(makeScore(font, 'Ab Cd', options, () => 0)).toEqual(makeScore(font, 'Ab Cd', settings, () => 0));
    });

    it('preserves all chord phases and eases the blend between letters in Speech and Sing', () => {
        for (const mode of ['speech', 'sing'] as const) {
            const options: SoundSettings = { ...settings, mode, voicing: 'chords' };
            const score = makeScore(font, 'Ab A', options, () => 0);
            const state: ToneState = { phase: 0, pitch: score.notes[0].pitch };
            const left = synthesizeNote(font.glyphs.A, score.notes[0], options, state, 48000);
            const phases = [...state.chordPhases!];
            const weights = [...state.chordWeights!];
            const right = synthesizeNote(font.glyphs.b, score.notes[1], options, state, 48000);
            expect(right[0]).toBeCloseTo(phases.reduce((sum, phase, voice) => sum + Math.sin(phase) * weights[voice], 0) * 0.22, 6);
            expect(Math.abs(right[0] - left[left.length - 1])).toBeLessThan(0.025);
            expect(state.chordWeights).not.toEqual(weights);
            expect(state.chordWeights!.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
            expect(right.every(Number.isFinite)).toBe(true);
            expect(Math.max(...right.map(Math.abs))).toBeLessThanOrEqual(0.221);
            expect(synthesizeNote(font.glyphs.A, score.notes[2], options, state)[0]).toBe(0);
        }
    });

    it('produces finite, bounded, nonblank PCM with attack and release envelopes', () => {
        const samples = synthesizeNote(font.glyphs.A, note, settings);
        expect(samples).toHaveLength(Math.round(note.duration * 24000));
        expect(samples.every(Number.isFinite)).toBe(true);
        expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.221);
        expect(energy(samples)).toBeGreaterThan(0.00001);
        expect(samples[0]).toBe(0);
        expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.001);
    });

    it('derives different pitches from different glyphs and harmonic limits without mutating font data', () => {
        const original = JSON.stringify(font.glyphs.A);
        const base = synthesizeNote(font.glyphs.A, note, settings);
        const other = makeScore(font, 'B', settings).notes[0];
        expect(synthesizeNote(font.glyphs.B, other, settings)).not.toEqual(base);
        const lowSettings = { ...settings, frequency: 1 };
        expect(synthesizeNote(font.glyphs.A, makeScore(font, 'A', lowSettings).notes[0], lowSettings)).not.toEqual(base);
        expect(energy(synthesizeNote(font.glyphs.A, note, { ...settings, frequency: 0 }))).toBe(0);
        expect(JSON.stringify(font.glyphs.A)).toBe(original);
    });

    it('uses both signed harmonics across contours, excludes DC and respects the selected limit', () => {
        const glyph: FourierGlyph = {
            advanceWidth: 100, bounds: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
            contours: [{ sampleCount: 2048, coefficients: [
                { frequency: -1, re: 20, im: 30 }, { frequency: 0, re: 9999, im: 9999 },
                { frequency: 2, re: 40, im: -10 }, { frequency: 100, re: 90000, im: 10000 },
            ] }, { sampleCount: 2048, coefficients: [{ frequency: -3, re: 10, im: 0 }] }],
        };
        const low = glyphPitch(glyph, settings)!;
        const centroid = (Math.hypot(20, 30) + Math.hypot(40, 10) * 2 + 30) / (Math.hypot(20, 30) + Math.hypot(40, 10) + 10);
        expect(low).toBeCloseTo(140 * 2 ** (Math.log2(centroid) / 3));
        expect(glyphPitch(glyph, { ...settings, frequency: 100 })).toBe(280);
        expect(glyphPitch(glyph, { ...settings, frequency: 1 })).toBe(140);
        const noDc = structuredClone(glyph);
        noDc.contours[0].coefficients = noDc.contours[0].coefficients.filter((c) => c.frequency !== 0);
        expect(glyphPitch(noDc, settings)).toBe(low);
        noDc.contours[0].coefficients = noDc.contours[0].coefficients.filter((c) => c.frequency >= 0);
        expect(glyphPitch(noDc, settings)).not.toBe(low);
    });

    it('synthesizes only one sine frequency, not a stack of audible harmonics', () => {
        const samples = synthesizeNote(font.glyphs.A, note, settings);
        for (let index = 0; index < samples.length; index++) {
            const time = index / 24000;
            const ease = (value: number) => {
                const t = Math.min(1, Math.max(0, value));
                return t * t * (3 - 2 * t);
            };
            const envelope = Math.min(ease(time / 0.012), ease((note.duration - time) / 0.035));
            const expected = Math.sin(2 * Math.PI * note.pitch * time) * envelope * 0.22;
            expect(samples[index]).toBeCloseTo(expected, 6);
        }
    });

    it.each([0, 20, 40, 80, 160])('keeps phase and volume continuous with %s ms glide in both modes', (glideDurationMs) => {
        for (const mode of ['speech', 'sing'] as const) {
            const options = { ...settings, mode, glideDurationMs, wiggleAmplitude: 0 };
            const score = makeScore(font, 'AA A', options, () => 0);
            const first = { ...score.notes[0], pitch: 140 };
            const second = { ...score.notes[1], pitch: 280 };
            const state = { phase: 0, pitch: first.pitch };
            const left = synthesizeNote(font.glyphs.A, first, options, state);
            const boundaryPhase = state.phase;
            const right = synthesizeNote(font.glyphs.A, second, options, state);
            expect(right[0]).toBeCloseTo(Math.sin(boundaryPhase) * 0.22, 6);
            expect(Math.abs(right[0] - left[left.length - 1])).toBeLessThan(0.017);
            let phase = boundaryPhase;
            const glide = glideDurationMs / 1000;
            for (let index = 0; index < right.length; index++) {
                const time = index / 24000;
                const t = glide === 0 ? 1 : Math.min(1, time / glide);
                const pitch = 140 * 2 ** (t * t * (3 - 2 * t));
                const release = Math.min(1, Math.max(0, (second.duration - time) / 0.035));
                const envelope = release * release * (3 - 2 * release);
                expect(right[index]).toBeCloseTo(Math.sin(phase) * envelope * 0.22, 6);
                phase = (phase + pitch * 2 * Math.PI / 24000) % (2 * Math.PI);
            }
            if (glideDurationMs < second.duration * 1000) expect(state.pitch).toBeCloseTo(280);
            // A word boundary resets phase and restores a separate attack.
            const wordStart = synthesizeNote(font.glyphs.A, score.notes[2], options, state);
            expect(wordStart[0]).toBe(0);
            expect(Math.abs(right[right.length - 1])).toBeLessThan(0.001);
        }
    });

    it('uses deterministic time-varying Wiggly modulation only in singing', () => {
        const sing = { ...settings, mode: 'sing' as const };
        const singingNote = makeScore(font, 'AA', sing).notes[1];
        const samples = synthesizeNote(font.glyphs.A, singingNote, sing);
        expect(samples).toEqual(synthesizeNote(font.glyphs.A, singingNote, sing));
        expect(samples).not.toEqual(synthesizeNote(font.glyphs.A, singingNote, { ...sing, wiggleAmplitude: 0 }));
        expect(samples).not.toEqual(synthesizeNote(font.glyphs.A, singingNote, { ...sing, wiggleRate: 2 }));
        expect(synthesizeNote(font.glyphs.A, note, settings)).toEqual(synthesizeNote(font.glyphs.A, note, { ...settings, wiggleAmplitude: 0.5 }));
    });

    it('preserves joined samples and total duration at native device sample rates', () => {
        for (const sampleRate of [44100, 48000, 96000]) {
            for (const mode of ['speech', 'sing'] as const) {
                const options = { ...settings, mode };
                const score = makeScore(font, 'Hello', options);
                const state = { phase: 0, pitch: score.notes[0].pitch };
                let length = 0;
                let previousSample = 0;
                for (const note of score.notes) {
                    const phase = state.phase;
                    const samples = synthesizeNote(font.glyphs[note.character], note, options, state, sampleRate);
                    if (note.legato) {
                        expect(samples[0]).toBeCloseTo(Math.sin(phase) * 0.22, 6);
                        expect(Math.abs(samples[0] - previousSample)).toBeLessThan(0.025);
                    }
                    previousSample = samples[samples.length - 1];
                    length += samples.length;
                }
                expect(length).toBe(Math.round(score.duration * sampleRate));
            }
        }
    });
});
