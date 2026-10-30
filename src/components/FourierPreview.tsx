import { useEffect, useRef, useState } from 'react';
import type { FourierFont } from '../lib/font-data';
import { motionPadding, renderText, type TextLayout, type UnwrapEasing } from '../lib/render-text';

interface Props {
    font: FourierFont;
    layout: TextLayout;
    text: string;
    frequency: number;
    fontSize: number;
    autoFit: boolean;
    breathing: { enabled: boolean; amplitude: number; rate: number };
    wiggly: { enabled: boolean; amplitude: number; rate: number };
    unwrapping: boolean;
    unwrapSpeed: number;
    unwrapEasing: UnwrapEasing;
    unwrapStartSize: number;
}

const UNWRAP_DURATION = 0.7;
const UNWRAP_DELAY = 0.12;
const UNWRAP_PAUSE = 0.5;

export default function FourierPreview({ font, layout, text, frequency, fontSize, autoFit, breathing, wiggly, unwrapping, unwrapSpeed, unwrapEasing, unwrapStartSize }: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [wiggleSeed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
    const active = breathing.enabled && breathing.amplitude > 0 && frequency > 0;
    const wigglyActive = wiggly.enabled && wiggly.amplitude > 0 && frequency > 0;
    const unwrappingActive = unwrapping && frequency > 0;
    const animated = wigglyActive || unwrappingActive;
    const expanded = active && !wigglyActive ? renderText(font, text, frequency, breathing.amplitude) : layout;
    const contracted = active && !wigglyActive ? renderText(font, text, frequency, -breathing.amplitude) : layout;
    const frames = [layout, expanded, contracted];
    const padding = animated ? motionPadding(font, frequency, active ? breathing.amplitude : 0, wigglyActive ? wiggly.amplitude : 0, text, unwrappingActive) : 0;
    const x = Math.min(...frames.map((frame) => frame.viewBox.x)) - padding;
    const y = Math.min(...frames.map((frame) => frame.viewBox.y)) - padding;
    const width = Math.max(...frames.map((frame) => frame.viewBox.x + frame.viewBox.width)) + padding - x;
    const height = Math.max(...frames.map((frame) => frame.viewBox.y + frame.viewBox.height)) + padding - y;

    useEffect(() => {
        const paths = svgRef.current?.querySelectorAll<SVGPathElement>('path');
        if (!paths) return;
        const restore = () => paths.forEach((path, index) => {
            const glyph = layout.glyphs[index];
            path.setAttribute('d', glyph.path);
            path.setAttribute('transform', `translate(${glyph.x} ${glyph.y})`);
            path.setAttribute('opacity', unwrappingActive ? '0' : '1');
        });
        restore();
        if (!animated) {
            svgRef.current?.querySelectorAll<SVGAnimateElement>('animate').forEach((animation) => animation.beginElement());
            return;
        }
        let request = 0;
        let elapsed = 0;
        let previous: number | null = null;
        let lastDraw = -Infinity;
        const characterCount = [...text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')].length;
        const unwrapCycle = Math.max(0, characterCount - 1) * UNWRAP_DELAY + UNWRAP_DURATION + UNWRAP_PAUSE;
        const draw = (timestamp: number) => {
            if (document.hidden) { previous = null; return; }
            if (previous !== null) elapsed += (timestamp - previous) / 1000;
            previous = timestamp;
            if (timestamp - lastDraw >= 1000 / 30) {
                const strength = active ? breathing.amplitude * Math.sin(2 * Math.PI * breathing.rate * elapsed) : 0;
                const wiggle = wigglyActive ? { amplitude: wiggly.amplitude, rate: wiggly.rate, time: elapsed, seed: wiggleSeed } : undefined;
                const frame = renderText(font, text, frequency, strength, wiggle, unwrappingActive ? { time: (elapsed * unwrapSpeed) % unwrapCycle, duration: UNWRAP_DURATION, delay: UNWRAP_DELAY, seed: wiggleSeed, easing: unwrapEasing, startSize: unwrapStartSize / 100 } : undefined);
                paths.forEach((path, index) => {
                    const glyph = frame.glyphs[index];
                    path.setAttribute('d', glyph.path);
                    path.setAttribute('opacity', String(glyph.opacity));
                    const bounds = font.glyphs[glyph.character].bounds;
                    const centerX = (bounds.xMin + bounds.xMax) / 2;
                    const centerY = -(bounds.yMin + bounds.yMax) / 2;
                    path.setAttribute('transform', glyph.scale === 1
                        ? `translate(${glyph.x} ${glyph.y})`
                        : `translate(${glyph.x} ${glyph.y}) translate(${centerX} ${centerY}) scale(${glyph.scale}) translate(${-centerX} ${-centerY})`);
                });
                lastDraw = timestamp;
            }
            request = requestAnimationFrame(draw);
        };
        const visibilityChanged = () => {
            cancelAnimationFrame(request);
            previous = null;
            if (!document.hidden) request = requestAnimationFrame(draw);
        };
        request = requestAnimationFrame(draw);
        document.addEventListener('visibilitychange', visibilityChanged);
        return () => {
            cancelAnimationFrame(request);
            document.removeEventListener('visibilitychange', visibilityChanged);
            restore();
        };
    }, [active, animated, wigglyActive, unwrappingActive, unwrapSpeed, unwrapEasing, unwrapStartSize, breathing.amplitude, breathing.rate, wiggly.amplitude, wiggly.rate, wiggleSeed, font, text, frequency, layout]);

    return (
        <div className={autoFit ? 'specimen-fit-frame' : 'specimen-natural-frame'}>
        <svg
            ref={svgRef}
            className="specimen-svg"
            data-breathing={active}
            data-wiggly={wigglyActive}
            data-unwrapping={unwrappingActive}
            role="img"
            aria-label={`${font.family} reconstruction at ${frequency} harmonics: ${text || 'empty text'}`}
            viewBox={`${x} ${y} ${width} ${height}`}
            width={autoFit ? '100%' : width / font.unitsPerEm * fontSize}
            height={autoFit ? '100%' : height / font.unitsPerEm * fontSize}
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
        >
            <title>{text}</title>
            {layout.glyphs.map((glyph, index) => (
                <path key={index} d={glyph.path} transform={`translate(${glyph.x} ${glyph.y})`} opacity={unwrappingActive ? 0 : 1} fill="currentColor" fillRule="nonzero">
                    {active && !animated && <animate
                        attributeName="d"
                        values={`${glyph.path};${expanded.glyphs[index].path};${glyph.path};${contracted.glyphs[index].path};${glyph.path}`}
                        keyTimes="0;0.25;0.5;0.75;1"
                        keySplines="0.33 0.52 0.67 1;0.33 0 0.67 0.48;0.33 0.52 0.67 1;0.33 0 0.67 0.48"
                        calcMode="spline"
                        dur={`${1 / breathing.rate}s`}
                        repeatCount="indefinite"
                        begin="indefinite"
                    />}
                </path>
            ))}
        </svg>
        </div>
    );
}