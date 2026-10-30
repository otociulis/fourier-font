import { MAX_TEXT_LENGTH, type FourierFont, type FourierGlyph } from './font-data';
import { wiggleCoefficient } from './fourier';

export type SoundMode = 'speech' | 'sing';
export type SoundVoicing = 'tone' | 'chords';
export interface SoundSettings {
    mode: SoundMode;
    voicing: SoundVoicing;
    basePitchHz: number;
    questionRise: number;
    exclamationLift: number;
    exclamationFall: number;
    frequency: number;
    minimumPause: number;
    glideDurationMs: number;
    spaceGlideMs: number;
    sentencePauseMs: number;
    letterDurationMs: number;
    wiggleAmplitude: number;
    wiggleRate: number;
    seed: number;
}
export interface GlyphNote {
    character: string;
    start: number;
    duration: number;
    pitch: number;
    legato: boolean;
    connectsNext: boolean;
    bridge?: boolean;
    intonation?: { kind: 'question' | 'exclamation'; start: number; duration: number };
}
export interface Score { notes: GlyphNote[]; duration: number }
export interface ToneState { phase: number; pitch: number; chordPhases?: number[]; chordWeights?: number[] }

const SAMPLE_RATE = 24000;
const melody = [0, 2, 4, 7, 4, 2, 0, -3];
const chordRatios = [1, 2 ** (4 / 12), 2 ** (7 / 12)];

function smoothstep(value: number): number {
    const progress = Math.min(1, Math.max(0, value));
    return progress * progress * (3 - 2 * progress);
}

function glyphSpectrum(glyph: FourierGlyph, settings: SoundSettings, time = 0, character = ''): { pitch: number | null; weights: number[] } {
    let magnitude = 0;
    let weighted = 0;
    const bands = [0, 0, 0];
    glyph.contours.forEach((contour, index) => {
        for (const coefficient of contour.coefficients) {
            const harmonic = Math.abs(coefficient.frequency);
            if (!harmonic || harmonic > settings.frequency) continue;
            const moved = wiggleCoefficient(coefficient, settings.mode === 'sing' ? {
                amplitude: settings.wiggleAmplitude, rate: settings.wiggleRate, time,
                seed: settings.seed + (character.codePointAt(0) ?? 0) * 131 + index * 9973,
            } : undefined);
            const weight = Math.hypot(moved.re, moved.im);
            magnitude += weight;
            weighted += weight * harmonic;
            bands[(harmonic - 1) % 3] += weight;
        }
    });
    if (!magnitude) return { pitch: null, weights: [1, 0, 0] };
    // Compress the spectral centroid into one octave, rather than playing its partials.
    const octave = Math.min(1, Math.log2(weighted / magnitude) / 3);
    return {
        pitch: settings.basePitchHz * 2 ** octave,
        weights: bands.map((band, index) => 0.5 * band / magnitude + (index === 0 ? 0.5 : 0)),
    };
}

export function glyphPitch(glyph: FourierGlyph, settings: SoundSettings, time = 0, character = ''): number | null {
    return glyphSpectrum(glyph, settings, time, character).pitch;
}

export function makeScore(font: FourierFont, text: string, settings: SoundSettings, random = Math.random): Score {
    if (!Number.isInteger(settings.frequency) || settings.frequency < 0 || settings.frequency > font.maxFrequency ||
        !Number.isFinite(settings.basePitchHz) || settings.basePitchHz < 80 || settings.basePitchHz > 400 ||
        [settings.questionRise, settings.exclamationLift, settings.exclamationFall].some((value) => !Number.isFinite(value) || value < 0 || value > 12) ||
        !Number.isFinite(settings.minimumPause) || settings.minimumPause < 0.01 || settings.minimumPause > 5 ||
        !Number.isFinite(settings.glideDurationMs) || settings.glideDurationMs < 0 || settings.glideDurationMs > 1000 ||
        !Number.isFinite(settings.spaceGlideMs) || settings.spaceGlideMs < 0 || settings.spaceGlideMs > 5000 ||
        !Number.isFinite(settings.sentencePauseMs) || settings.sentencePauseMs < 10 || settings.sentencePauseMs > 10000 ||
        !Number.isFinite(settings.letterDurationMs) || settings.letterDurationMs < 40 || settings.letterDurationMs > 1000 ||
        !Number.isFinite(settings.wiggleAmplitude) || settings.wiggleAmplitude < 0 || settings.wiggleAmplitude > 0.5 ||
        !Number.isFinite(settings.wiggleRate) || settings.wiggleRate < 0.05 || settings.wiggleRate > 2 ||
        !Number.isSafeInteger(settings.seed) || !['speech', 'sing'].includes(settings.mode) || !['tone', 'chords'].includes(settings.voicing)) {
        throw new Error('Invalid sound settings.');
    }
    const notes: GlyphNote[] = [];
    let time = 0;
    let inGap = false;
    let letterIndex = 0;
    let sentenceGap = false;
    let wordStart = 0;
    const pitches = new Map<string, number>();
    const normalized = [...text.replace(/\r\n?/g, '\n')].slice(0, MAX_TEXT_LENGTH);
    for (const character of normalized) {
        const speechEnding = settings.mode === 'speech' && (character === '?' || character === '!');
        if (character === '.' || speechEnding) {
            if (speechEnding && !sentenceGap && notes.length > wordStart) {
                const start = notes[wordStart].start;
                const end = notes.at(-1)!;
                const intonation: NonNullable<GlyphNote['intonation']> = {
                    kind: character === '?' ? 'question' : 'exclamation',
                    start, duration: end.start + end.duration - start,
                };
                for (const note of notes.slice(wordStart)) {
                    if (!note.bridge) note.intonation = intonation;
                }
            }
            time += settings.sentencePauseMs / 1000;
            inGap = true;
            sentenceGap = true;
            continue;
        }
        const glyph = Object.hasOwn(font.glyphs, character) ? font.glyphs[character] : undefined;
        if (/\s/u.test(character) || !glyph?.contours.length) {
            if (!inGap) {
                const value = random();
                if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid pause randomness.');
                time += settings.minimumPause * (1 + value);
            }
            inGap = true;
            continue;
        }
        const previous = notes.at(-1);
        if (inGap || !previous) wordStart = notes.length;
        const bridge = inGap && !sentenceGap && previous !== undefined && settings.spaceGlideMs > 0;
        const legato = previous !== undefined && (!inGap || bridge);
        if (legato) previous.connectsNext = true;
        inGap = false;
        sentenceGap = false;
        const singing = settings.mode === 'sing';
        const duration = settings.letterDurationMs / 1000;
        let basePitch = pitches.get(character);
        if (basePitch === undefined) {
            basePitch = glyphPitch(glyph, settings) ?? settings.basePitchHz;
            pitches.set(character, basePitch);
        }
        const pitch = basePitch * (singing ? 2 ** (melody[letterIndex++ % melody.length] / 12) : 1);
        if (bridge) {
            const start = previous.start + previous.duration;
            const bridgeDuration = settings.spaceGlideMs / 1000;
            notes.push({ character, start, duration: bridgeDuration, pitch, legato: true, connectsNext: true, bridge: true });
            time = start + bridgeDuration;
            wordStart = notes.length;
        }
        notes.push({ character, start: time, duration, pitch, legato, connectsNext: false });
        time += duration;
    }
    return { notes, duration: time };
}

function intonationRatio(note: GlyphNote, time: number, settings: SoundSettings): number {
    if (!note.intonation) return 1;
    const progress = (note.start + time - note.intonation.start) / note.intonation.duration;
    const semitones = note.intonation.kind === 'question' ? settings.questionRise * smoothstep(progress)
        : progress < 0.6 ? settings.exclamationLift * smoothstep(progress / 0.6)
            : settings.exclamationLift - (settings.exclamationLift + settings.exclamationFall) * smoothstep((progress - 0.6) / 0.4);
    return 2 ** (semitones / 12);
}

export function synthesizeNote(glyph: FourierGlyph, note: GlyphNote, settings: SoundSettings, state?: ToneState, sampleRate = SAMPLE_RATE): Float32Array<ArrayBuffer> {
    const samples = new Float32Array(Math.round((note.start + note.duration) * sampleRate) - Math.round(note.start * sampleRate));
    const singing = settings.mode === 'sing';
    const chords = settings.voicing === 'chords';
    const frames = singing ? Math.ceil(note.duration * 30) : 1;
    const basePitch = glyphPitch(glyph, settings);
    if (basePitch === null) return samples;
    const spectra = Array.from({ length: frames + 1 }, (_, index) =>
        glyphSpectrum(glyph, settings, singing ? note.start + index * note.duration / frames : 0, note.character));
    const pitches = spectra.map((spectrum) => singing ? note.pitch * (spectrum.pitch ?? basePitch) / basePitch : note.pitch);
    const connected = note.legato && state !== undefined;
    let phase = connected ? state.phase : 0;
    let finalPitch = note.pitch;
    const phases = connected && state.chordPhases ? [...state.chordPhases] : [phase, 0, 0];
    const initialWeights = connected && state.chordWeights ? state.chordWeights : spectra[0].weights;
    let finalWeights = initialWeights;
    const glideDuration = note.bridge ? note.duration : settings.glideDurationMs / 1000;
    const initialIntonation = singing ? 1 : intonationRatio(note, 0, settings);
    for (let index = 0; index < samples.length; index++) {
        const time = index / sampleRate;
        const position = time / note.duration * frames;
        const frame = Math.min(frames - 1, Math.floor(position));
        const blend = position - frame;
        const pitch = pitches[frame] * (1 - blend) + pitches[frame + 1] * blend;
        const envelope = Math.min(
            connected ? 1 : smoothstep(time / 0.012),
            note.connectsNext ? 1 : smoothstep((note.duration - time) / 0.035),
        );
        const vibrato = singing ? settings.wiggleAmplitude * 0.05 * Math.sin(2 * Math.PI * (4 + settings.wiggleRate) * (note.start + time)) : 0;
        const target = pitch * (1 + vibrato);
        const eased = glideDuration === 0 ? 1 : smoothstep(time / glideDuration);
        const fromPitch = connected ? state.pitch / initialIntonation : target;
        finalPitch = (connected ? fromPitch * (target / fromPitch) ** eased : target) *
            (singing ? 1 : intonationRatio(note, time, settings));
        if (chords) {
            finalWeights = spectra[frame].weights.map((weight, voice) => {
                const targetWeight = weight * (1 - blend) + spectra[frame + 1].weights[voice] * blend;
                return connected ? initialWeights[voice] + (targetWeight - initialWeights[voice]) * eased : targetWeight;
            });
            samples[index] = phases.reduce((sum, voicePhase, voice) => sum + Math.sin(voicePhase) * finalWeights[voice], 0) * envelope * 0.22;
            phases.forEach((voicePhase, voice) => {
                phases[voice] = (voicePhase + finalPitch * chordRatios[voice] * 2 * Math.PI / sampleRate) % (2 * Math.PI);
            });
        } else {
            samples[index] = Math.sin(phase) * envelope * 0.22;
        }
        phase = (phase + finalPitch * 2 * Math.PI / sampleRate) % (2 * Math.PI);
    }
    if (state) {
        state.phase = phase;
        state.pitch = finalPitch;
        if (chords) { state.chordPhases = phases; state.chordWeights = finalWeights; }
    }
    return samples;
}

export class FontPlayer {
    private context: AudioContext | null = null;
    private gain: GainNode | null = null;
    private highpass: BiquadFilterNode | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    stop(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        const context = this.context;
        this.context = null;
        this.gain?.disconnect();
        this.gain = null;
        this.highpass?.disconnect();
        this.highpass = null;
        if (context && context.state !== 'closed') {
            context.onstatechange = null;
            void context.close().catch((error: unknown) => this.onError(error));
        }
    }

    constructor(private onEnd: () => void, private onError: (error: unknown) => void) {}

    async play(font: FourierFont, text: string, settings: SoundSettings): Promise<void> {
        this.stop();
        const score = makeScore(font, text, settings);
        if (!score.notes.length || !settings.frequency) throw new Error('Enter supported glyphs and select at least one harmonic to play.');
        if (typeof AudioContext === 'undefined') throw new Error('This browser does not support Web Audio.');
        const context = new AudioContext();
        this.context = context;
        await context.resume();
        if (this.context !== context) return;
        const gain = context.createGain();
        this.gain = gain;
        gain.gain.value = 0.6;
        const highpass = context.createBiquadFilter();
        this.highpass = highpass;
        highpass.type = 'highpass';
        highpass.frequency.value = 60;
        highpass.Q.value = Math.SQRT1_2;
        gain.connect(highpass);
        highpass.connect(context.destination);
        const origin = context.currentTime + 0.05;
        let next = 0;
        const toneState: ToneState = { phase: 0, pitch: score.notes[0].pitch };
        const tick = () => {
            try {
                while (next < score.notes.length && origin + score.notes[next].start < context.currentTime + 0.6) {
                    const note = score.notes[next++];
                    if (origin + note.start < context.currentTime) {
                        throw new Error('Audio playback fell behind. Press Play to restart, or reduce text length and animation complexity.');
                    }
                    // Native-rate buffers avoid independent resampling at connected letter joins.
                    const samples = synthesizeNote(font.glyphs[note.character], note, settings, toneState, context.sampleRate);
                    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
                    buffer.copyToChannel(samples, 0);
                    const source = context.createBufferSource();
                    source.buffer = buffer;
                    source.connect(gain);
                    source.onended = () => source.disconnect();
                    const start = origin + Math.round(note.start * context.sampleRate) / context.sampleRate;
                    if (start < context.currentTime) {
                        source.disconnect();
                        throw new Error('Audio generation fell behind. Press Play to restart, or reduce font complexity.');
                    }
                    source.start(start);
                }
                if (context.currentTime >= origin + score.duration) {
                    this.stop();
                    this.onEnd();
                }
            } catch (error) {
                this.stop();
                this.onError(error);
            }
        };
        context.onstatechange = () => {
            if (context.state === 'suspended' && this.context === context) {
                this.stop();
                this.onError(new Error('Audio playback was interrupted. Press Play to restart.'));
            }
        };
        this.timer = setInterval(tick, 100);
        tick();
    }
}
