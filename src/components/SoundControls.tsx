import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, SegmentedControl, Select, Slider } from '@mantine/core';
import { Play, Square, Volume2 } from 'lucide-react';
import type { FourierFont } from '../lib/font-data';
import { FontPlayer, type SoundMode, type SoundVoicing } from '../lib/sound';

interface Props {
    font: FourierFont | null;
    text: string;
    frequency: number;
    wiggleAmplitude: number;
    wiggleRate: number;
}

export default function SoundControls({ font, text, frequency, wiggleAmplitude, wiggleRate }: Props) {
    const [mode, setMode] = useState<SoundMode>('speech');
    const [voicing, setVoicing] = useState<SoundVoicing>('tone');
    const [basePitches, setBasePitches] = useState<Record<SoundMode, number>>({ speech: 140, sing: 196 });
    const basePitchHz = basePitches[mode];
    const [questionRise, setQuestionRise] = useState(4);
    const [exclamationLift, setExclamationLift] = useState(4);
    const [exclamationFall, setExclamationFall] = useState(2);
    const [wordPausePercent, setWordPausePercent] = useState(143);
    const [letterDurations, setLetterDurations] = useState<Record<SoundMode, number>>({ speech: 140, sing: 210 });
    const letterDurationMs = letterDurations[mode];
    const [glidePercent, setGlidePercent] = useState(29);
    const [spaceGlides, setSpaceGlides] = useState<Record<SoundMode, number>>({ speech: 0, sing: 29 });
    const spaceGlidePercent = spaceGlides[mode];
    const [dotPausePercent, setDotPausePercent] = useState(214);
    const minimumPause = letterDurationMs * wordPausePercent / 100;
    const glideDurationMs = letterDurationMs * glidePercent / 100;
    const spaceGlideMs = letterDurationMs * spaceGlidePercent / 100;
    const sentencePauseMs = letterDurationMs * dotPausePercent / 100;
    const [playing, setPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const player = useRef<FontPlayer | null>(null);
    const sequence = useRef(0);

    useEffect(() => {
        return () => {
            sequence.current++;
            player.current?.stop();
            player.current = null;
        };
    }, []);

    useEffect(() => {
        sequence.current++;
        player.current?.stop();
        player.current = null;
        setPlaying(false);
    }, [font, text, frequency, mode, voicing, basePitchHz, questionRise, exclamationLift, exclamationFall, minimumPause, letterDurationMs, glideDurationMs, spaceGlideMs, sentencePauseMs, wiggleAmplitude, wiggleRate]);

    function stop(): void {
        sequence.current++;
        player.current?.stop();
        player.current = null;
        setPlaying(false);
    }

    async function play(): Promise<void> {
        if (!font) return;
        stop();
        const current = sequence.current;
        const fail = (reason: unknown) => {
            if (sequence.current !== current) return;
            player.current?.stop();
            setPlaying(false);
            setError(reason instanceof Error ? reason.message : 'Sound playback failed.');
        };
        const instance = new FontPlayer(() => {
            if (sequence.current === current) setPlaying(false);
        }, fail);
        player.current = instance;
        setError(null);
        setPlaying(true);
        try {
            await instance.play(font, text, {
                mode, voicing, basePitchHz, questionRise, exclamationLift, exclamationFall, frequency, minimumPause: minimumPause / 1000, letterDurationMs, glideDurationMs, spaceGlideMs, sentencePauseMs, wiggleAmplitude, wiggleRate,
                seed: crypto.getRandomValues(new Uint32Array(1))[0],
            });
        } catch (reason) { fail(reason); }
    }

    return (
        <section className="control-section sound-section" aria-label="Sound controls">
            <div className="section-heading"><span className="section-index">07</span><h2>Sound</h2><Volume2 aria-hidden="true" size={17} /></div>
            <Select label="Performance mode" value={mode} onChange={(value) => { if (value === 'speech' || value === 'sing') setMode(value); }} data={[{ value: 'speech', label: 'Speech' }, { value: 'sing', label: 'Sing' }]} allowDeselect={false} />
            <SegmentedControl aria-label="Sound voicing" fullWidth mt="sm" value={voicing} onChange={(value) => { if (value === 'tone' || value === 'chords') setVoicing(value); }} data={[{ value: 'tone', label: 'Tone' }, { value: 'chords', label: 'Chords' }]} />
            <div className="frequency-heading" style={{ marginTop: 16 }}><span>Letter duration</span><span>{letterDurationMs} ms</span></div>
            <Slider thumbLabel="Letter duration" value={letterDurationMs} onChange={(value) => setLetterDurations((current) => ({ ...current, [mode]: value }))} min={40} max={1000} step={10} label={(value) => `${value} ms`} size="sm" className="breathing-slider" />
            <div className="frequency-heading" style={{ marginTop: 16 }}><span>Base pitch</span><span>{basePitchHz} Hz</span></div>
            <Slider thumbLabel="Base pitch" value={basePitchHz} onChange={(value) => setBasePitches((current) => ({ ...current, [mode]: value }))} min={80} max={400} step={1} label={(value) => `${value} Hz`} size="sm" className="breathing-slider" />
            {mode === 'speech' && <>
                <div className="frequency-heading"><span>Question rise</span><span>+{questionRise} st</span></div>
                <Slider thumbLabel="Question rise" value={questionRise} onChange={setQuestionRise} min={0} max={12} step={0.5} label={(value) => `+${value} st`} size="sm" className="breathing-slider" />
                <div className="frequency-heading"><span>Exclamation lift</span><span>+{exclamationLift} st</span></div>
                <Slider thumbLabel="Exclamation lift" value={exclamationLift} onChange={setExclamationLift} min={0} max={12} step={0.5} label={(value) => `+${value} st`} size="sm" className="breathing-slider" />
                <div className="frequency-heading"><span>Exclamation fall</span><span>-{exclamationFall} st</span></div>
                <Slider thumbLabel="Exclamation fall" value={exclamationFall} onChange={setExclamationFall} min={0} max={12} step={0.5} label={(value) => `-${value} st`} size="sm" className="breathing-slider" />
                <p className="sound-description">Semitones (st) relative to each glyph's pitch. Exclamation fall ends below that pitch, not below the lift.</p>
            </>}
            <p className="sound-description">Pauses and glides are percentages of Letter duration.</p>
            <div className="frequency-heading" style={{ marginTop: 16 }}><span>Minimum word pause</span><span>{wordPausePercent}% ({Math.round(minimumPause)} ms)</span></div>
            <Slider thumbLabel="Minimum word pause" value={wordPausePercent} onChange={setWordPausePercent} min={25} max={500} step={1} disabled={spaceGlideMs > 0} label={(value) => `${value}%`} size="sm" className="breathing-slider" />
            <div className="frequency-heading"><span>Glide duration</span><span>{glidePercent}% ({Math.round(glideDurationMs)} ms)</span></div>
            <Slider thumbLabel="Glide duration" value={glidePercent} onChange={setGlidePercent} min={0} max={100} step={1} label={(value) => `${value}%`} size="sm" className="breathing-slider" />
            <div className="frequency-heading"><span>Space glide</span><span>{spaceGlidePercent}% ({Math.round(spaceGlideMs)} ms)</span></div>
            <Slider thumbLabel="Space glide" value={spaceGlidePercent} onChange={(value) => setSpaceGlides((current) => ({ ...current, [mode]: value }))} min={0} max={500} step={1} label={(value) => `${value}%`} size="sm" className="breathing-slider" />
            <div className="frequency-heading"><span>Dot pause</span><span>{dotPausePercent}% ({Math.round(sentencePauseMs)} ms)</span></div>
            <Slider thumbLabel="Dot pause" value={dotPausePercent} onChange={setDotPausePercent} min={25} max={1000} step={1} label={(value) => `${value}%`} size="sm" className="breathing-slider" />
            {mode === 'speech' && <p className="sound-description">? raises the last word; ! adds a lift and fall. Both use the Dot pause duration.</p>}
            <p className="sound-description">{voicing === 'chords' ? 'One blended chord per letter: root, third and fifth weighted by font harmonics. ' : 'One clear tone per letter, pitched from its font harmonics. '}{spaceGlideMs > 0 ? 'Spaces sustain a glide into the next word. Set Space glide to 0% for silent word pauses. ' : 'Random word pauses range from 1 to 2 times the minimum. '}{mode === 'sing' ? 'Melody uses Wiggly amplitude and frequency, even when visual Wiggly is off. ' : ''}Letters glide smoothly within words. Synthetic sound, not spoken words. Editing settings stops playback.</p>
            <Group gap="xs" mt="sm">
                <Button leftSection={<Play aria-hidden="true" size={15} />} onClick={() => { void play(); }} disabled={!font || !frequency || !text.trim() || playing}>Play sound</Button>
                <Button variant="default" leftSection={<Square aria-hidden="true" size={15} />} onClick={stop} disabled={!playing}>Stop</Button>
            </Group>
            <span className="sound-status" role="status">{playing ? `Playing ${mode}` : 'Sound idle'}</span>
            {error && <Alert color="red" title="Sound unavailable" mt="sm" role="alert">{error}</Alert>}
        </section>
    );
}
