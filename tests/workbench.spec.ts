import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseSourceFont } from '../scripts/generate-font';
import { parseFontJson } from '../src/lib/font-data';

const fixture = parseFontJson(await readFile(new URL('../public/fonts/dancing-script.fourier.json', import.meta.url), 'utf8'));

test('switches bundled fonts while preserving text and reconstruction settings and exports the license', async ({ page }) => {
    await page.goto('/');
    const specimen = page.getByRole('img', { name: /reconstruction/ });
    await expect(specimen).toBeVisible();
    await page.getByRole('textbox', { name: 'Text to render' }).fill('Hello Mono?!');
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    await page.getByRole('textbox', { name: 'Harmonic limit' }).fill('37');
    await page.getByRole('switch', { name: 'Auto-fit text' }).check();
    const shapes = new Set<string>();
    for (const [label, family, id] of [
        ['Dancing Script', 'Fourier Dance', 'dancing-script'],
        ['Sacramento', 'Fourier Flow', 'sacramento'],
        ['Roboto Mono', 'Fourier Mono', 'roboto-mono'],
        ['Dancing Script', 'Fourier Dance', 'dancing-script'],
    ]) {
        await page.getByRole('textbox', { name: 'Font', exact: true }).click();
        await page.getByRole('option', { name: label, exact: true }).click();
        await expect(specimen).toHaveAccessibleName(`${family} reconstruction at 37 harmonics: Hello Mono?!`);
        await expect(specimen).toHaveAttribute('width', '100%');
        await expect(page.getByRole('switch', { name: 'Auto-fit text' })).toBeChecked();
        shapes.add((await specimen.locator('path').first().getAttribute('d'))!);
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download Fourier JSON' }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe(`${id}.fourier.json`);
        const data = parseFontJson(await readFile((await download.path())!, 'utf8'));
        expect(data.family).toBe(family);
        expect(data.license?.name).toBe('OFL-1.1');
        expect(data.license?.text).toContain('SIL OPEN FONT LICENSE');
        expect(data.license?.text).toContain('Copyright');
    }
    expect(shapes.size).toBe(3);
    await page.getByRole('tab', { name: 'Composition' }).click();
    await expect(page.getByRole('textbox', { name: 'Text to render' })).toHaveValue('Hello Mono?!');
});

test('retains the active font on a failed switch and can switch back from imported JSON', async ({ page }) => {
    await page.goto('/');
    const specimen = page.getByRole('img', { name: /reconstruction/ });
    await expect(specimen).toBeVisible();
    await page.route('**/sacramento.fourier.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.getByRole('textbox', { name: 'Font', exact: true }).click();
    await page.getByRole('option', { name: 'Sacramento', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Font request failed (503)');
    await expect(specimen).toHaveAccessibleName(/Fourier Dance reconstruction/);
    await expect(page.getByRole('textbox', { name: 'Font', exact: true })).toHaveValue('Dancing Script');
    await page.locator('input[type=file]').setInputFiles({
        name: 'custom.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ ...fixture, family: 'Custom font' })),
    });
    await expect(specimen).toHaveAccessibleName(/Custom font reconstruction/);
    await expect(page.getByRole('textbox', { name: 'Font', exact: true })).toHaveValue('Imported: Custom font');
    await page.getByRole('textbox', { name: 'Font', exact: true }).click();
    await page.getByRole('option', { name: 'Roboto Mono', exact: true }).click();
    await expect(specimen).toHaveAccessibleName(/Fourier Mono reconstruction/);
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('retries a failed initial bundled font request', async ({ page }) => {
    let available = false;
    await page.route('**/dancing-script.fourier.json', (route) => {
        return available ? route.continue() : route.fulfill({ status: 503, body: 'Unavailable' });
    });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('Font request failed (503)');
    await expect(page.locator('.stage-corner')).toContainText('Fourier Dance');
    available = true;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('img', { name: /Fourier Dance reconstruction/ })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Font', exact: true })).toBeEnabled();
});

test('loads JSON-only geometry, renders ink, and fits the viewport', async ({ page }, info) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    await page.goto('/');
    const specimen = page.getByRole('img', { name: /Fourier Dance reconstruction/ });
    await expect(specimen).toBeVisible();
    const sourceTab = page.getByRole('tab', { name: 'Source' });
    await expect(sourceTab).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(7);
    await sourceTab.click();
    await expect(page.getByText('66', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    await expect(page.getByRole('slider', { name: 'Frequency' })).toHaveAttribute('aria-valuenow', '20');
    const originalWidth = await specimen.getAttribute('width');
    const fontSize = page.getByRole('textbox', { name: 'Font size' });
    await expect(fontSize).toHaveValue('125 px');
    await fontSize.fill('160');
    await expect(page.getByRole('slider', { name: 'Font size' })).toHaveAttribute('aria-valuenow', '160');
    await expect.poll(() => specimen.getAttribute('width')).not.toBe(originalWidth);
    expect(requests.some((request) => /\.(?:otf|ttf)(?:\?|$)/.test(request))).toBe(false);
    expect(requests.some((request) => request.includes('dancing-script.fourier.json'))).toBe(true);
    const ink = await specimen.evaluate(async (svg) => {
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('width', '1000');
        clone.setAttribute('height', '500');
        clone.setAttribute('color', '#000');
        const image = new Image();
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
        try {
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = 1000;
            canvas.height = 500;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, 1000, 500).data;
            let count = 0;
            for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 128) count++;
            return count;
        } finally { URL.revokeObjectURL(url); }
    });
    expect(ink).toBeGreaterThan(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (info.project.name === 'desktop') {
        const slider = await page.getByRole('slider', { name: 'Frequency' }).boundingBox();
        expect(slider!.y + slider!.height).toBeLessThan(900);
    }
    await page.screenshot({ path: `test-results/${info.project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
});

test('auto-fits long and multiline text on resize and restores manual size', async ({ page }) => {
    await page.goto('/');
    const specimen = page.getByRole('img', { name: /reconstruction/ });
    await expect(specimen).toBeVisible();
    const initialText = await page.getByRole('textbox', { name: 'Text to render' }).inputValue();
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    const manualWidth = await specimen.getAttribute('width');
    const fit = page.getByRole('switch', { name: 'Auto-fit text' });
    await fit.check();
    await expect(page.getByRole('textbox', { name: 'Font size', exact: true })).toBeDisabled();
    await expect(specimen).toHaveAttribute('width', '100%');
    const assertFits = async () => {
        await expect.poll(() => specimen.evaluate((svg) => {
            const area = svg.closest('.specimen-scroll')!;
            const rect = svg.getBoundingClientRect();
            const bounds = area.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 &&
                rect.left >= bounds.left && rect.right <= bounds.right + 1 &&
                rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1 &&
                area.scrollWidth <= area.clientWidth + 1 && area.scrollHeight <= area.clientHeight + 1;
        })).toBe(true);
    };
    await assertFits();
    await page.getByRole('tab', { name: 'Composition' }).click();
    const text = page.getByRole('textbox', { name: 'Text to render' });
    for (const value of ['Hello World '.repeat(30), 'Hello\n'.repeat(30)]) {
        await text.fill(value);
        await assertFits();
    }
    await page.setViewportSize({ width: 720, height: 800 });
    await assertFits();
    await text.fill(initialText);
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    await fit.uncheck();
    await expect(specimen).toHaveAttribute('width', manualWidth!);
    await expect(page.getByRole('textbox', { name: 'Font size', exact: true })).toBeEnabled();
});

test('renders punctuation glyphs without unsupported warnings', async ({ page }) => {
    await page.goto('/');
    const specimen = page.getByRole('img', { name: /reconstruction/ });
    await expect(specimen).toBeVisible();
    await page.getByRole('textbox', { name: 'Text to render' }).fill('.?!');
    await expect(specimen.locator('path')).toHaveCount(3);
    await expect(page.getByText('Unsupported characters', { exact: true })).toHaveCount(0);
    for (const path of await specimen.locator('path').all()) {
        await expect(path).toHaveAttribute('d', /^M/);
    }
});

test('edits text, handles unsupported and empty input, and keyboard-controls harmonics', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('img', { name: /reconstruction/ })).toBeVisible();
    const text = page.getByRole('textbox', { name: 'Text to render' });
    await text.fill('B8ijg\nAZaz09@');
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    const slider = page.getByRole('slider', { name: 'Frequency' });
    await expect(page.getByText('Unsupported characters', { exact: true })).toBeVisible();
    await expect(page.getByText('2 lines', { exact: true })).toBeVisible();
    for (const frequency of [0, 1, 5, 20, 100]) {
        await page.getByRole('textbox', { name: 'Harmonic limit' }).fill(String(frequency));
        await expect(slider).toHaveAttribute('aria-valuenow', String(frequency));
        await expect(page.getByRole('img', { name: /reconstruction/ })).toHaveAccessibleName(new RegExp(`at ${frequency} harmonics`));
    }
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', '100');
    await page.getByRole('tab', { name: 'Composition' }).click();
    await text.fill('');
    await expect(page.getByText('No text', { exact: true })).toBeVisible();
    await expect(page.getByText('Unsupported characters', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reset text' }).click();
    await expect(text).toHaveValue('Hello World\nHow are you doing today?');
});

test('imports different frequency ceilings and retains the last valid font after errors', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('img', { name: /reconstruction/ })).toBeVisible();
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    const input = page.locator('input[type=file]');
    await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('img', { name: /reconstruction/ })).toHaveAccessibleName(/Fourier Dance reconstruction at 20/);
    for (const ceiling of [5, 0]) {
        const data = structuredClone(fixture);
        data.family = `Test ${ceiling}`;
        data.maxFrequency = ceiling;
        Object.values(data.glyphs).forEach((glyph) => glyph.contours.forEach((contour) => {
            contour.coefficients = contour.coefficients.filter((coefficient) => Math.abs(coefficient.frequency) <= ceiling);
        }));
        const file = { name: 'small.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) };
        await input.setInputFiles(file);
        await expect(page.getByRole('img', { name: /reconstruction/ })).toHaveAccessibleName(new RegExp(`Test ${ceiling} reconstruction at ${ceiling}`));
        await expect(page.getByRole('alert')).toHaveCount(0);
        if (ceiling === 0) await expect(page.getByRole('textbox', { name: 'Harmonic limit' })).toBeDisabled();
    }
});

test('high-frequency raster matches source contours, including holes and dots', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('img', { name: /reconstruction/ })).toBeVisible();
    await page.getByRole('textbox', { name: 'Text to render' }).fill('B8ijg');
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    await page.getByRole('textbox', { name: 'Harmonic limit' }).fill('100');
    const source = parseSourceFont(await readFile(new URL('../fonts/dancing-script/DancingScript.ttf', import.meta.url)));
    const path = source.getPath('B8ijg', 0, 0, source.unitsPerEm, { kerning: true, features: { liga: false, rlig: false } }).toPathData(6);
    const overlap = await page.getByRole('img', { name: /reconstruction/ }).evaluate(async (svg, pathData) => {
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('width', '1200');
        clone.setAttribute('height', '600');
        clone.setAttribute('color', '#000');
        const reference = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="${clone.getAttribute('viewBox')}"><path d="${pathData}" fill="black" fill-rule="nonzero"/></svg>`;
        async function raster(markup: string): Promise<Uint8ClampedArray> {
            const image = new Image();
            const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
            try {
                image.src = url;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = 1200;
                canvas.height = 600;
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                return context.getImageData(0, 0, 1200, 600).data;
            } finally { URL.revokeObjectURL(url); }
        }
        const actual = await raster(new XMLSerializer().serializeToString(clone));
        const expected = await raster(reference);
        let intersection = 0;
        let union = 0;
        for (let index = 3; index < actual.length; index += 4) {
            const actualInk = actual[index] > 128;
            const expectedInk = expected[index] > 128;
            if (actualInk && expectedInk) intersection++;
            if (actualInk || expectedInk) union++;
        }
        return intersection / union;
    }, path);
    expect(overlap).toBeGreaterThan(0.95);
    console.log(`Source/Fourier raster intersection-over-union: ${(overlap * 100).toFixed(2)}%`);
});

test('breathes coefficient-derived paths with adjustable amplitude and rate, then restores static geometry', async ({ page }, info) => {
    await page.goto('/');
    const specimen = page.getByRole('img', { name: /reconstruction/ });
    await expect(specimen).toBeVisible();
    await page.getByRole('textbox', { name: 'Text to render' }).fill('B8ijg');
    await page.getByRole('tab', { name: 'Breathing' }).click();
    const path = specimen.locator('path').first();
    const original = await path.getAttribute('d');
    const toggle = page.getByRole('switch', { name: 'Breathing mode' });
    const amplitude = page.getByRole('textbox', { name: 'Breathing amplitude', exact: true });
    const rate = page.getByRole('textbox', { name: 'Breathing frequency', exact: true });
    await expect(toggle).not.toBeChecked();
    await expect(amplitude).toBeDisabled();
    await expect(specimen.locator('animate')).toHaveCount(0);
    await page.locator('h2 label[for="breathing-mode"]').click();
    await expect(toggle).toBeChecked();
    await amplitude.fill('30');
    await rate.fill('0.5');
    await expect(specimen).toHaveAttribute('data-breathing', 'true');
    await expect(path.locator('animate')).toHaveAttribute('dur', '2s');
    const cycle = await specimen.evaluate(async (element) => {
        const svg = element as SVGSVGElement;
        const contour = svg.querySelector('path')!;
        svg.pauseAnimations();
        const animation = contour.querySelector('animate')!;
        const start = animation.getStartTime();
        const samples = [];
        for (const time of [0, 0.5, 1.5, 2]) {
            svg.setCurrentTime(start + time);
            await new Promise(requestAnimationFrame);
            samples.push({ length: contour.getTotalLength(), viewBox: svg.getAttribute('viewBox'), width: svg.getAttribute('width'), height: svg.getAttribute('height') });
        }
        return samples;
    });
    expect(cycle[1].length).toBeGreaterThan(cycle[0].length);
    expect(cycle[2].length).toBeLessThan(cycle[0].length);
    expect(cycle[3].length).toBeCloseTo(cycle[0].length, 0);
    expect(new Set(cycle.map((sample) => `${sample.viewBox}/${sample.width}/${sample.height}`)).size).toBe(1);
    await specimen.evaluate((element) => (element as SVGSVGElement).unpauseAnimations());
    await page.screenshot({ path: `test-results/breathing-${info.project.name}.png`, fullPage: true });
    await amplitude.fill('0');
    await expect(specimen.locator('animate')).toHaveCount(0);
    await expect(path).toHaveAttribute('d', original!);
    await amplitude.fill('50');
    await rate.fill('2');
    await expect(path.locator('animate')).toHaveAttribute('dur', '0.5s');
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    await page.getByRole('textbox', { name: 'Harmonic limit', exact: true }).fill('0');
    await expect(specimen.locator('animate')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Harmonic limit', exact: true }).fill('20');
    await page.getByRole('tab', { name: 'Breathing' }).click();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    await expect(specimen.locator('animate')).toHaveCount(0);
    await expect(path).toHaveAttribute('d', original!);
    await expect(rate).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Wiggly animates random harmonics independently and combines with Breathing', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const specimen = page.getByRole('img', { name: /reconstruction/ });
    await expect(specimen).toBeVisible();
    await page.getByRole('textbox', { name: 'Text to render' }).fill('B8ijg');
    await page.getByRole('tab', { name: 'Wiggly' }).click();
    const path = specimen.locator('path').first();
    const original = await path.getAttribute('d');
    const wiggly = page.getByRole('switch', { name: 'Wiggly mode' });
    const breathing = page.getByRole('switch', { name: 'Breathing mode' });
    const amplitude = page.getByRole('textbox', { name: 'Wiggly amplitude', exact: true });
    const rate = page.getByRole('textbox', { name: 'Wiggly frequency', exact: true });
    await expect(wiggly).not.toBeChecked();
    await expect(amplitude).toBeDisabled();
    await expect(rate).toBeDisabled();
    await page.locator('h2 label[for="wiggly-mode"]').click();
    await expect(wiggly).toBeChecked();
    await amplitude.fill('30');
    await rate.fill('2');
    await expect(page.getByRole('slider', { name: 'Wiggly amplitude', exact: true })).toHaveAttribute('aria-valuenow', '30');
    await expect(page.getByRole('slider', { name: 'Wiggly frequency', exact: true })).toHaveAttribute('aria-valuenow', '2');
    await expect(specimen).toHaveAttribute('data-wiggly', 'true');
    await expect(specimen).toHaveAttribute('data-breathing', 'false');
    await expect.poll(() => path.getAttribute('d')).not.toBe(original);
    const first = await path.getAttribute('d');
    const viewBox = await specimen.getAttribute('viewBox');
    await expect.poll(() => path.getAttribute('d')).not.toBe(first);
    await expect(specimen).toHaveAttribute('viewBox', viewBox!);
    await amplitude.fill('0');
    await expect(specimen).toHaveAttribute('data-wiggly', 'false');
    await expect(path).toHaveAttribute('d', original!);
    await amplitude.fill('50');
    await page.getByRole('tab', { name: 'Breathing' }).click();
    await page.locator('h2 label[for="breathing-mode"]').click();
    await page.getByRole('textbox', { name: 'Breathing amplitude', exact: true }).fill('50');
    await expect(specimen).toHaveAttribute('data-wiggly', 'true');
    await expect(specimen).toHaveAttribute('data-breathing', 'true');
    await expect(specimen.locator('animate')).toHaveCount(0);
    await expect.poll(() => path.getAttribute('d')).not.toBe(original);
    const combined = await path.getAttribute('d');
    await expect.poll(() => path.getAttribute('d')).not.toBe(combined);
    expect(await specimen.evaluate((element) => {
        const svg = element as SVGSVGElement;
        const bounds = svg.getBBox();
        const viewport = svg.viewBox.baseVal;
        return bounds.x >= viewport.x && bounds.y >= viewport.y &&
            bounds.x + bounds.width <= viewport.x + viewport.width && bounds.y + bounds.height <= viewport.y + viewport.height;
    })).toBe(true);
    await page.screenshot({ path: `test-results/wiggly-combined-${info.project.name}.png`, fullPage: true });
    await breathing.focus();
    await page.keyboard.press('Space');
    await expect(breathing).not.toBeChecked();
    await page.getByRole('tab', { name: 'Wiggly' }).click();
    await expect(wiggly).toBeChecked();
    const withoutBreathing = await path.getAttribute('d');
    await expect.poll(() => path.getAttribute('d')).not.toBe(withoutBreathing);
    await page.getByRole('tab', { name: 'Breathing' }).click();
    await page.locator('h2 label[for="breathing-mode"]').click();
    await page.getByRole('tab', { name: 'Wiggly' }).click();
    await wiggly.focus();
    await page.keyboard.press('Space');
    await expect(wiggly).not.toBeChecked();
    await page.getByRole('tab', { name: 'Breathing' }).click();
    await expect(breathing).toBeChecked();
    await expect(path.locator('animate')).toHaveAttribute('dur', '4s');
    await breathing.focus();
    await page.keyboard.press('Space');
    await expect(path).toHaveAttribute('d', original!);
    await expect(specimen.locator('animate')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Wiggly' }).click();
    await page.locator('h2 label[for="wiggly-mode"]').click();
    await page.getByRole('tab', { name: 'Reconstruction' }).click();
    await page.getByRole('textbox', { name: 'Harmonic limit', exact: true }).fill('0');
    await expect(specimen).toHaveAttribute('data-wiggly', 'false');
    const zero = await path.getAttribute('d');
    await page.getByRole('tab', { name: 'Composition' }).click();
    await page.getByRole('textbox', { name: 'Text to render' }).fill('');
    await expect(page.getByText('No text', { exact: true })).toBeVisible();
    expect(zero).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});

test('loops the unwrap reveal and keeps Breathing active', async ({ page }) => {
    await page.goto('/');
    const specimen = page.getByRole('img', { name: /reconstruction/ });
    await expect(specimen).toBeVisible();
    await page.getByRole('textbox', { name: 'Text to render' }).fill('AA');
    await page.getByRole('tab', { name: 'Unwrap' }).click();
    const path = specimen.locator('path').first();
    const original = await path.getAttribute('d');
    const originalTransform = await path.getAttribute('transform');
    const unwrap = page.getByRole('switch', { name: 'Unwrap mode' });
    const speed = page.getByRole('textbox', { name: 'Unwrap speed' });
    await expect(speed).toBeDisabled();
    await page.locator('h2 label[for="unwrapping-mode"]').click();
    await expect(unwrap).toBeChecked();
    await expect(speed).toBeEnabled();
    const startSize = page.getByRole('textbox', { name: 'Unwrap start size' });
    await expect(startSize).toHaveValue('10%');
    await startSize.fill('35');
    await expect(page.getByRole('slider', { name: 'Unwrap start size' })).toHaveAttribute('aria-valuenow', '35');
    const easing = page.getByRole('textbox', { name: 'Unwrap easing' });
    await expect(easing).toHaveValue('Smooth');
    await easing.click();
    await page.getByRole('option', { name: 'Ease out' }).click();
    await expect(easing).toHaveValue('Ease out');
    await speed.fill('3');
    await expect(page.getByRole('slider', { name: 'Unwrap speed' })).toHaveAttribute('aria-valuenow', '3');
    await expect(specimen).toHaveAttribute('data-unwrapping', 'true');
    await expect.poll(() => path.getAttribute('d')).not.toBe(original);
    await expect.poll(() => path.getAttribute('transform')).not.toBe(originalTransform);
    await expect.poll(() => path.getAttribute('d'), { timeout: 2000, intervals: [20, 30, 50] }).toBe(original);
    await expect(path).toHaveAttribute('transform', originalTransform!);
    await expect.poll(() => path.getAttribute('transform'), { timeout: 2000, intervals: [20, 30, 50] }).not.toBe(originalTransform);

    await page.getByRole('tab', { name: 'Breathing' }).click();
    await page.locator('h2 label[for="breathing-mode"]').click();
    await expect(specimen.locator('animate')).toHaveCount(0);
    const breathingPath = await path.getAttribute('d');
    await expect.poll(() => path.getAttribute('d')).not.toBe(breathingPath);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});