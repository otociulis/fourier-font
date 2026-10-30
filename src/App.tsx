import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, FileButton, Group, Loader, NumberInput, Select, Slider, Switch, Tabs, Textarea, Tooltip } from '@mantine/core';
import { Activity, ArrowDownToLine, ArrowUpFromLine, AudioLines, Check, CircleAlert, FileText, RotateCcw, Sparkles, Type, Volume2, Waves, Wind } from 'lucide-react';
import { MAX_FILE_BYTES, MAX_TEXT_LENGTH, parseFontJson, type FourierFont } from './lib/font-data';
import { renderText, type UnwrapEasing } from './lib/render-text';
import FourierPreview from './components/FourierPreview';
import SoundControls from './components/SoundControls';
import { BUNDLED_FONTS } from './lib/bundled-fonts';

const INITIAL_TEXT = 'Hello World\nHow are you doing today?';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Could not load this Fourier font.';
}

export default function App() {
    const [font, setFont] = useState<FourierFont | null>(null);
    const [filename, setFilename] = useState(`${BUNDLED_FONTS[0].id}.fourier.json`);
    const [selectedFont, setSelectedFont] = useState(BUNDLED_FONTS[0].id);
    const [text, setText] = useState(INITIAL_TEXT);
    const [frequency, setFrequency] = useState(20);
    const [fontSize, setFontSize] = useState(125);
    const [autoFit, setAutoFit] = useState(false);
    const [breathing, setBreathing] = useState(false);
    const [breathingAmplitude, setBreathingAmplitude] = useState(15);
    const [breathingRate, setBreathingRate] = useState(0.25);
    const [wiggly, setWiggly] = useState(false);
    const [wigglyAmplitude, setWigglyAmplitude] = useState(10);
    const [wigglyRate, setWigglyRate] = useState(1);
    const [unwrapping, setUnwrapping] = useState(false);
    const [unwrapSpeed, setUnwrapSpeed] = useState(1);
    const [unwrapEasing, setUnwrapEasing] = useState<UnwrapEasing>('smooth');
    const [unwrapStartSize, setUnwrapStartSize] = useState(10);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const resetFile = useRef<() => void>(null);
    const importSequence = useRef(0);
    const fontRequest = useRef<AbortController | null>(null);

    const loadBundledFont = useCallback(async (id: string) => {
        const bundled = BUNDLED_FONTS.find((entry) => entry.id === id);
        if (!bundled) throw new Error(`Unknown bundled font: ${id}`);
        const sequence = ++importSequence.current;
        fontRequest.current?.abort();
        const controller = new AbortController();
        fontRequest.current = controller;
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${import.meta.env.BASE_URL}fonts/${id}.fourier.json`, { signal: controller.signal });
            if (!response.ok) throw new Error(`Font request failed (${response.status}).`);
            const data = parseFontJson(await response.text());
            if (sequence !== importSequence.current) return;
            setFont(data);
            setFrequency((current) => Math.min(current, data.maxFrequency));
            setFilename(`${id}.fourier.json`);
            setSelectedFont(id);
        } catch (reason) {
            if (sequence === importSequence.current) setError(errorMessage(reason));
        } finally {
            if (sequence === importSequence.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadBundledFont(BUNDLED_FONTS[0].id);
        return () => { ++importSequence.current; fontRequest.current?.abort(); };
    }, [loadBundledFont]);

    async function importJson(file: File | null): Promise<void> {
        if (!file) return;
        const sequence = ++importSequence.current;
        fontRequest.current?.abort();
        setLoading(true);
        try {
            if (file.size > MAX_FILE_BYTES) throw new Error('JSON must be 10 MiB or smaller.');
            const data = parseFontJson(await file.text());
            if (sequence !== importSequence.current) return;
            setFont(data);
            setFilename(file.name);
            setSelectedFont('imported');
            setFrequency(Math.min(20, data.maxFrequency));
            setError(null);
        } catch (reason) {
            if (sequence === importSequence.current) setError(errorMessage(reason));
        } finally {
            if (sequence === importSequence.current) setLoading(false);
            resetFile.current?.();
        }
    }

    function downloadJson(): void {
        if (!font) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(font)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const layout = font ? renderText(font, text, frequency) : null;
    const contourCount = font ? Object.values(font.glyphs).reduce((sum, glyph) => sum + glyph.contours.length, 0) : 0;
    const marks = font ? [...new Set([0, Math.round(font.maxFrequency / 4), Math.round(font.maxFrequency / 2), Math.round(3 * font.maxFrequency / 4), font.maxFrequency])]
        .map((value) => ({ value, label: String(value) })) : [];

    return (
        <div className="app-shell">
            <header className="app-header">
                <a href={import.meta.env.BASE_URL} className="brand" aria-label="Fourier Type home">
                    <span className="brand-mark"><Waves aria-hidden="true" size={24} strokeWidth={1.7} /></span>
                    <span>Fourier Type<span className="brand-period">.</span></span>
                </a>
                <div className="header-status"><span className={`status-dot ${font ? 'ready' : ''}`} />{font ? 'Local workspace' : 'Opening workspace'}</div>
                <div className="version-label">TYPE LAB / 01</div>
            </header>

            <div className="workspace-heading">
                <div><div className="eyebrow">OUTLINES / FREQUENCIES / LETTERFORMS</div><h1>Handwriting, in harmonics.</h1></div>
                <Group gap="xs">
                    <FileButton onChange={(file) => { void importJson(file); }} accept="application/json,.json" resetRef={resetFile}>
                        {(props) => <Button {...props} variant="default" leftSection={<ArrowUpFromLine aria-hidden="true" size={16} />} disabled={loading}>Import JSON</Button>}
                    </FileButton>
                    <Tooltip label="Download Fourier JSON"><ActionIcon aria-label="Download Fourier JSON" variant="default" size={36} disabled={!font} onClick={downloadJson}><ArrowDownToLine aria-hidden="true" size={17} /></ActionIcon></Tooltip>
                </Group>
            </div>

            <main className="workbench">
                <aside className="controls" aria-label="Text and reconstruction controls">
                    <div className="control-section">
                        <Select label="Font" aria-label="Font" value={selectedFont} onChange={(value) => { if (value && value !== 'imported') void loadBundledFont(value); }}
                            data={[...BUNDLED_FONTS.map((entry) => ({ value: entry.id, label: entry.label })), ...(selectedFont === 'imported' ? [{ value: 'imported', label: `Imported: ${font?.family ?? filename}` }] : [])]}
                            disabled={loading} allowDeselect={false} />
                    </div>
                    <Tabs defaultValue="composition" className="settings-tabs" keepMounted={false}>
                        <Tabs.List className="settings-tabs-list" aria-label="Configuration sections">
                            <Tabs.Tab value="source" aria-label="Source"><Tooltip label="Source"><FileText aria-hidden="true" size={16} /></Tooltip></Tabs.Tab>
                            <Tabs.Tab value="composition" aria-label="Composition"><Tooltip label="Composition"><Type aria-hidden="true" size={16} /></Tooltip></Tabs.Tab>
                            <Tabs.Tab value="reconstruction" aria-label="Reconstruction"><Tooltip label="Reconstruction"><Activity aria-hidden="true" size={16} /></Tooltip></Tabs.Tab>
                            <Tabs.Tab value="breathing" aria-label="Breathing"><Tooltip label="Breathing"><Wind aria-hidden="true" size={16} /></Tooltip></Tabs.Tab>
                            <Tabs.Tab value="wiggly" aria-label="Wiggly"><Tooltip label="Wiggly"><AudioLines aria-hidden="true" size={16} /></Tooltip></Tabs.Tab>
                            <Tabs.Tab value="unwrap" aria-label="Unwrap"><Tooltip label="Unwrap"><Sparkles aria-hidden="true" size={16} /></Tooltip></Tabs.Tab>
                            <Tabs.Tab value="sound" aria-label="Sound"><Tooltip label="Sound"><Volume2 aria-hidden="true" size={16} /></Tooltip></Tabs.Tab>
                        </Tabs.List>
                        <Tabs.Panel value="sound" className="settings-tabs-panel" keepMounted>
                            <SoundControls font={loading ? null : font} text={text} frequency={frequency} wiggleAmplitude={wigglyAmplitude / 100} wiggleRate={wigglyRate} />
                        </Tabs.Panel>
                        <Tabs.Panel value="source" className="settings-tabs-panel">
                            <section className="control-section source-section">
                                <div className="section-heading"><span className="section-index">01</span><h2>Source</h2><FileText aria-hidden="true" size={17} /></div>
                                <div className="font-name">{font?.family ?? 'Loading font'}</div>
                                <div className="font-style">{font?.style ?? 'Loading font data'}</div>
                                {font?.license && <div className="font-style">OFL-1.1 · Attribution and license included in JSON</div>}
                                <div className="source-file" title={filename}><span className="file-dot" />{filename}</div>
                                <div className="font-stats"><div><strong>{font ? Object.keys(font.glyphs).length : '--'}</strong><span>glyphs</span></div><div><strong>{font ? contourCount : '--'}</strong><span>contours</span></div><div><strong>{font?.maxFrequency ?? '--'}</strong><span>max K</span></div></div>
                            </section>
                        </Tabs.Panel>
                        <Tabs.Panel value="composition" className="settings-tabs-panel">
                            <section className="control-section text-section">
                                <div className="section-heading"><span className="section-index">02</span><h2>Composition</h2><Tooltip label="Reset text"><ActionIcon variant="subtle" color="gray" aria-label="Reset text" size={26} onClick={() => setText(INITIAL_TEXT)}><RotateCcw aria-hidden="true" size={15} /></ActionIcon></Tooltip></div>
                                <Textarea label="Text" aria-label="Text to render" value={text} onChange={(event) => setText([...event.currentTarget.value].slice(0, MAX_TEXT_LENGTH).join(''))} minRows={4} maxRows={8} autosize spellCheck={false} placeholder="Your words" classNames={{ input: 'composition-input', label: 'input-label' }} />
                                <div className="input-meta"><span>A-Z &nbsp; a-z &nbsp; 0-9 &nbsp; . ? !</span><span aria-live="polite">{[...text].length} / {MAX_TEXT_LENGTH}</span></div>
                            </section>
                        </Tabs.Panel>
                        <Tabs.Panel value="reconstruction" className="settings-tabs-panel">
                            <section className="control-section frequency-section">
                                <div className="section-heading"><span className="section-index">03</span><h2>Reconstruction</h2><Activity aria-hidden="true" size={17} /></div>
                                <div className="frequency-heading"><label htmlFor="frequency-value">Harmonic limit</label><NumberInput id="frequency-value" aria-label="Harmonic limit" value={frequency} onChange={(value) => setFrequency(Math.min(font?.maxFrequency ?? 20, Math.max(0, Math.round(Number(value) || 0))))} min={0} max={font?.maxFrequency ?? 20} allowDecimal={false} disabled={!font || font.maxFrequency === 0} w={76} size="sm" /></div>
                                <Slider thumbLabel="Frequency" value={frequency} onChange={setFrequency} min={0} max={font?.maxFrequency || 1} step={1} marks={marks} disabled={!font || font.maxFrequency === 0} size="sm" label={(value) => `K = ${value}`} className="frequency-slider" />
                                <Switch label="Auto-fit text" checked={autoFit} onChange={(event) => setAutoFit(event.currentTarget.checked)} disabled={!font} size="sm" mb="md" />
                                <div className="frequency-heading"><label htmlFor="font-size">Font size</label><NumberInput id="font-size" aria-label="Font size" value={fontSize} onChange={(value) => setFontSize(Math.min(240, Math.max(40, Math.round(Number(value) || 40))))} min={40} max={240} step={1} suffix=" px" disabled={!font || autoFit} w={85} size="sm" /></div>
                                <Slider thumbLabel="Font size" value={fontSize} onChange={setFontSize} min={40} max={240} step={1} disabled={!font || autoFit} label={(value) => `${value} px`} size="sm" className="frequency-slider" />
                                <div className="coefficient-stat"><span>Coefficients per contour</span><strong>{2 * frequency + 1}</strong></div>
                                <div className="frequency-equation">−{frequency} <span>≤ k ≤</span> +{frequency}</div>
                            </section>
                        </Tabs.Panel>
                        <Tabs.Panel value="breathing" className="settings-tabs-panel">
                            <section className="control-section breathing-section" aria-label="Breathing controls">
                                <div className="section-heading"><span className="section-index">04</span><h2><label htmlFor="breathing-mode">Breathing</label></h2><Switch id="breathing-mode" aria-label="Breathing mode" checked={breathing} onChange={(event) => setBreathing(event.currentTarget.checked)} disabled={!font} size="sm" /></div>
                                <div className="frequency-heading"><label htmlFor="breathing-amplitude">Amplitude</label><NumberInput id="breathing-amplitude" aria-label="Breathing amplitude" value={breathingAmplitude} onChange={(value) => setBreathingAmplitude(Math.min(50, Math.max(0, Number(value) || 0)))} min={0} max={50} suffix="%" allowDecimal={false} disabled={!font || !breathing} w={85} size="sm" /></div>
                                <Slider thumbLabel="Breathing amplitude" value={breathingAmplitude} onChange={setBreathingAmplitude} min={0} max={50} step={1} disabled={!font || !breathing} label={(value) => `${value}%`} size="sm" className="breathing-slider" />
                                <div className="frequency-heading"><label htmlFor="breathing-rate">Frequency</label><NumberInput id="breathing-rate" aria-label="Breathing frequency" value={breathingRate} onChange={(value) => setBreathingRate(Math.min(2, Math.max(0.05, Number(value) || 0.05)))} min={0.05} max={2} step={0.05} decimalScale={2} suffix=" Hz" disabled={!font || !breathing} w={105} size="sm" /></div>
                                <Slider thumbLabel="Breathing frequency" value={breathingRate} onChange={setBreathingRate} min={0.05} max={2} step={0.05} disabled={!font || !breathing} label={(value) => `${value.toFixed(2)} Hz`} size="sm" className="breathing-slider" />
                            </section>
                        </Tabs.Panel>
                        <Tabs.Panel value="wiggly" className="settings-tabs-panel">
                            <section className="control-section wiggly-section" aria-label="Wiggly controls">
                                <div className="section-heading"><span className="section-index">05</span><h2><label htmlFor="wiggly-mode">Wiggly</label></h2><Switch id="wiggly-mode" aria-label="Wiggly mode" checked={wiggly} onChange={(event) => setWiggly(event.currentTarget.checked)} disabled={!font} size="sm" /></div>
                                <div className="frequency-heading"><label htmlFor="wiggly-amplitude">Amplitude</label><NumberInput id="wiggly-amplitude" aria-label="Wiggly amplitude" value={wigglyAmplitude} onChange={(value) => setWigglyAmplitude(Math.min(50, Math.max(0, Number(value) || 0)))} min={0} max={50} suffix="%" allowDecimal={false} disabled={!font || !wiggly} w={85} size="sm" /></div>
                                <Slider thumbLabel="Wiggly amplitude" value={wigglyAmplitude} onChange={setWigglyAmplitude} min={0} max={50} step={1} disabled={!font || !wiggly} label={(value) => `${value}%`} size="sm" className="breathing-slider" />
                                <div className="frequency-heading"><label htmlFor="wiggly-rate">Frequency</label><NumberInput id="wiggly-rate" aria-label="Wiggly frequency" value={wigglyRate} onChange={(value) => setWigglyRate(Math.min(2, Math.max(0.05, Number(value) || 0.05)))} min={0.05} max={2} step={0.05} decimalScale={2} suffix=" Hz" disabled={!font || !wiggly} w={105} size="sm" /></div>
                                <Slider thumbLabel="Wiggly frequency" value={wigglyRate} onChange={setWigglyRate} min={0.05} max={2} step={0.05} disabled={!font || !wiggly} label={(value) => `${value.toFixed(2)} Hz`} size="sm" className="breathing-slider" />
                            </section>
                        </Tabs.Panel>
                        <Tabs.Panel value="unwrap" className="settings-tabs-panel">
                            <section className="control-section unwrap-section" aria-label="Unwrap controls">
                                <div className="section-heading"><span className="section-index">06</span><h2><label htmlFor="unwrapping-mode">Unwrap</label></h2><Switch id="unwrapping-mode" aria-label="Unwrap mode" checked={unwrapping} onChange={(event) => setUnwrapping(event.currentTarget.checked)} disabled={!font} size="sm" /></div>
                                <div className="frequency-heading"><label htmlFor="unwrap-speed">Speed</label><NumberInput id="unwrap-speed" aria-label="Unwrap speed" value={unwrapSpeed} onChange={(value) => setUnwrapSpeed(Math.min(3, Math.max(0.25, Number(value) || 0.25)))} min={0.25} max={3} step={0.05} decimalScale={2} suffix="×" disabled={!font || !unwrapping} w={85} size="sm" /></div>
                                <Slider thumbLabel="Unwrap speed" value={unwrapSpeed} onChange={setUnwrapSpeed} min={0.25} max={3} step={0.05} disabled={!font || !unwrapping} label={(value) => `${value.toFixed(2)}×`} size="sm" className="breathing-slider" />
                                <div className="frequency-heading"><label htmlFor="unwrap-start-size">Start size</label><NumberInput id="unwrap-start-size" aria-label="Unwrap start size" value={unwrapStartSize} onChange={(value) => setUnwrapStartSize(Math.min(100, Math.max(0, Number(value) || 0)))} min={0} max={100} suffix="%" allowDecimal={false} disabled={!font || !unwrapping} w={85} size="sm" /></div>
                                <Slider thumbLabel="Unwrap start size" value={unwrapStartSize} onChange={setUnwrapStartSize} min={0} max={100} step={1} disabled={!font || !unwrapping} label={(value) => `${value}%`} size="sm" className="breathing-slider" />
                                <Select label="Easing" aria-label="Unwrap easing" value={unwrapEasing} onChange={(value) => { if (value === 'linear' || value === 'ease-in' || value === 'ease-out' || value === 'smooth') setUnwrapEasing(value); }} data={[{ value: 'linear', label: 'Linear' }, { value: 'ease-in', label: 'Ease in' }, { value: 'ease-out', label: 'Ease out' }, { value: 'smooth', label: 'Smooth' }]} allowDeselect={false} disabled={!font || !unwrapping} size="sm" />
                            </section>
                        </Tabs.Panel>
                    </Tabs>
                    <div className="sidebar-foot"><span className="status-dot ready" />JSON geometry only</div>
                </aside>

                <section className="preview-panel" aria-label="Rendered text preview">
                    <div className="preview-toolbar"><div className="preview-title"><span className="live-dot" /><h2>Live specimen</h2></div><div className="preview-meta"><span>Filled outline</span><span className="meta-divider" /><span>K {String(frequency).padStart(2, '0')}</span></div></div>
                    {error && <Alert className="error-alert" color="red" title="Font could not be loaded" icon={<CircleAlert size={18} />} withCloseButton={Boolean(font)} onClose={() => setError(null)}>{error}{!font && <Button variant="subtle" color="red" size="xs" onClick={() => { void loadBundledFont(selectedFont); }}>Retry</Button>}</Alert>}
                    {layout && layout.unsupported.length > 0 && <Alert className="error-alert" color="yellow" title="Unsupported characters" icon={<CircleAlert size={18} />}>Blank spaces substituted for: {layout.unsupported.join(' ')}</Alert>}
                    <div className="specimen-stage">
                        <div className="stage-corner">{font?.family ?? BUNDLED_FONTS[0].family} <span>/</span> {font?.style ?? 'REGULAR'}</div>
                        <div className="specimen-scroll" tabIndex={0} aria-label="Scrollable specimen">
                            {loading ? <div className="stage-message" role="status"><Loader color="green" size="sm" /><span>Loading font data</span></div> : font && layout ? (
                                text.trim() ? <FourierPreview font={font} layout={layout} text={text} frequency={frequency} fontSize={fontSize} autoFit={autoFit} breathing={{ enabled: breathing, amplitude: breathingAmplitude / 100, rate: breathingRate }} wiggly={{ enabled: wiggly, amplitude: wigglyAmplitude / 100, rate: wigglyRate }} unwrapping={unwrapping} unwrapSpeed={unwrapSpeed} unwrapEasing={unwrapEasing} unwrapStartSize={unwrapStartSize} /> : <div className="stage-message">No text</div>
                            ) : <div className="stage-message">No font loaded</div>}
                        </div>
                        <div className="stage-footer"><span>{layout ? `${layout.lineCount} ${layout.lineCount === 1 ? 'line' : 'lines'}` : '--'}</span><span>SVG / NONZERO</span></div>
                    </div>
                    <div className="preview-footer"><span><Check aria-hidden="true" size={14} />{font ? 'Reconstructed from coefficients' : 'Awaiting font data'}</span><span>{font ? `${font.unitsPerEm} units / em` : '--'}</span></div>
                </section>
            </main>
            <footer className="page-footer"><span>FOURIER TYPE</span><span>Finite frequencies. Infinite character.</span><span>PROTOTYPE 01</span></footer>
        </div>
    );
}