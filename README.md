# Fourier Type

A browser-based Fourier handwriting and sound experiment built with Vite, React, Mantine and strict TypeScript. Reshape letterforms with a harmonic slider, animate them with Breathing/Wiggly/Unwrap, and play glyph-derived tones or chords in Speech and Sing modes.

A separate TypeScript command converts font outlines into sampled line segments and complex Fourier coefficients. The browser renders filled SVG letters from JSON alone; it does not load or parse the original font. Sound is synthetic sonification, **not intelligible text-to-speech or a linguistic singing synthesizer**.

Includes three redistributable OFL-licensed comparison fonts: Dancing Script (default), Sacramento and Roboto Mono. See [font rights](#font-rights) for attribution and the renamed Fourier datasets.

## Inspiration

This project was heavily inspired by [How I released a game that has no assets](https://www.youtube.com/watch?v=Qr3VsZYQy4s).

## Run

Requires Node **22.12 or newer**. With nvm:

```sh
nvm use
npm ci
npm run dev
```

Vite prints the local URL, normally http://localhost:5173. All three generated datasets are included, so regeneration is not required to open the application. The **Font** selector above the tabs switches between Dancing Script, Sacramento and the equal-width Roboto Mono for comparison. Only the selected JSON is fetched. Switching preserves text, harmonic limit (clamped to the new ceiling), size, Auto-fit and motion/sound settings, and stops playback. A failed load keeps the previous font. Imported JSON appears as a custom selection; choose a bundled font to return. The download button exports the active dataset, including its embedded license.

For a quick demo: edit text in Composition, change K in Reconstruction, enable a motion mode, then open Sound and press Play. Nothing plays automatically. Settings and imported fonts are held in memory and reset on reload. Text and imported font contents are processed locally; the app has no upload endpoint, analytics or remote speech service. The browser still requests the page, bundled UI fonts and default JSON from its host.

```sh
npm run generate:font
npm run generate:font -- --input ./fonts/dancing-script/DancingScript.ttf --output ./public/fonts/dancing-script.fourier.json --family "Fourier Dance" --license ./fonts/dancing-script/OFL.txt --source-url https://github.com/google/fonts/tree/main/ofl/dancingscript --max-frequency 100
npm run typecheck
npm test
npm run build
npm run preview
```

Without arguments, generation rebuilds all three bundled fonts from the original TTFs in `fonts/`, using pinned upstream attribution, renamed families and complete licenses. Variable source fonts use their default outlines (Regular weight); variable axes are not animated. For another font, supply both `--input` and `--output`; `--family` sets the derived family name, and `--license` (an OFL 1.1 notice file) and `--source-url` together embed redistribution information. Observe that font's own licensing and naming requirements.

Generation supports integer limits from 0 through 500. The default is 100; the interface initially selects 20, or the imported ceiling if lower. Changing the generation ceiling requires rerunning the command. Importing JSON changes the slider range automatically. Missing required alphanumerics or `.?!` fail conversion instead of silently using a missing-glyph box.

## Representation

The Reconstruction tab includes **Auto-fit text** (off by default). It scales the complete multiline specimen proportionally to fit both dimensions of the preview area, updating automatically as text, harmonics, animation bounds or available space change. Animation uses its fixed conservative viewport so fitting does not pulse each frame. Manual font-size controls are disabled while fitting; turning it off restores the previous manual size. Auto-fit is preview-only and does not change font data or sound.

The initial repertoire is `A-Z`, `a-z`, `0-9`, `.`, `?`, `!`, and space. Newlines preserve separate baselines; tabs become four spaces. Text is limited to 500 Unicode code points. Unsupported characters become blank spaces and are reported. Font advances and pair kerning are retained, but ligatures, contextual shaping, other punctuation and non-Latin scripts are outside this prototype's scope.

Each independent closed glyph contour is sampled uniformly by arc length with `svg-path-properties`. Connecting successive samples, including the last back to the first, forms its line-segment approximation. The repeated closing endpoint is excluded from the transform. Sampling uses the next power of two at or above `max(2048, 8 * (2K + 1))`.

For a sampled point `z[n] = x[n] + i*y[n]`, `fft.js` computes a complex forward FFT. Coefficients are divided by the sample count. Reconstruction is:

```text
c[k] = (1/N) sum_n z[n] exp(-i 2*pi*k*n/N)
z(t) = sum_{k=-K}^{K} c[k] exp(i 2*pi*k*t)
```

**K=20 means 41 complex coefficients per contour**, including the constant/DC term. Positive and negative frequencies are independent; this is not a real-signal FFT. Reconstruction uses a zero-padded inverse FFT at a fixed sample count per dataset. Units, contour locations, winding, holes and disconnected marks are retained. One Y-axis inversion converts font coordinates into SVG coordinates. Each glyph has its own compound nonzero-fill path so overlapping letters do not cancel each other.

Low limits smooth and distort outlines; holes may close and curves may overshoot. K=0 collapses each contour to its center and filled letters disappear. These are contour Fourier approximations, **not extracted handwriting centerlines**. Source sampling and harmonic truncation both introduce error; 100 harmonics is not a claim of exact recovery.

## Breathing

The Breathing switch enables a smooth repeating change to the retained nonzero harmonics. Amplitude ranges from 0 to 50% (default 15%); frequency is measured in cycles per second, from 0.05 to 2 Hz (default 0.25 Hz, a four-second cycle). It is off by default and starts only after explicit opt-in. Zero amplitude, K=0, or disabling the switch produces static geometry.

For a cycle strength `s` between minus and plus the chosen amplitude, each coefficient is modulated as follows:

```text
c'[k] = c[k] * (1 + s * abs(k) / (abs(k) + 1))
```

DC (`k=0`) is unchanged, so contour centers stay fixed. Higher harmonics change more strongly, altering shape rather than simply scaling the entire text. Advances, kerning and line baselines do not move. The renderer reconstructs coefficient-derived extremes and uses native SVG path interpolation with a sine-like easing curve, avoiding per-frame React renders. Its viewport covers both extremes and remains fixed throughout the cycle. Imported coefficients are never mutated; downloading JSON still exports the original dataset. High amplitude can visibly distort or intersect contours.

## Wiggly and Combined Motion

Wiggly has its own switch, amplitude (0 to 50%, default 10%) and frequency (0.05 to 2 Hz, default 1 Hz). Its frequency means **new random harmonic targets per second**, not a repeating breathing cycle. It starts off, just like Breathing. Both can be enabled together with independent amplitudes and rates.

Wiggly adds independent, bounded offsets to the real and imaginary parts of each retained nonzero coefficient, proportional to that coefficient's magnitude, the selected amplitude and `abs(k)/(abs(k)+1)`. Each glyph/contour/harmonic uses a seeded random sequence; smoothstep interpolation between successive targets avoids abrupt jumps. Different glyphs and contours have different random streams; repeated copies of the same glyph share the same motion. The preview chooses a fresh seed when mounted. Zero-magnitude coefficients remain zero; DC, spacing and baselines are never changed.

When both modes are active, random offsets are added to Breathing's coefficient modulation before reconstruction, so neither mode overrides the other. Wiggly uses `requestAnimationFrame`, throttled to at most 30 updates per second, to update SVG paths directly without per-frame React renders. Hidden tabs pause the loop. A conservative bound derived from the retained coefficients fixes the viewport for the entire motion range. Changing settings restarts motion from the base shape. Breathing alone still uses native SVG animation. Turning one mode off leaves the other active; turning both off restores the original geometry. Zero Wiggly amplitude disables only Wiggly, and K=0 disables all motion.

Animation settings and transient coefficient offsets are preview-only and are not included in JSON downloads. Large combined amplitudes can strongly distort or intersect letter contours.

## Unwrap

Unwrap repeatedly reveals letters in text order, blending seeded random harmonics into each glyph's original coefficients while scaling from **Start size** (default 10%, adjustable from 0 to 100%). **Speed** ranges from 0.25x to 3x, default 1x. **Easing** can be Linear, Ease in, Ease out or Smooth (default).

At 1x, each character's reveal takes 0.7 seconds, starts 0.12 seconds after the preceding character, and the complete sequence pauses 0.5 seconds before looping. Spaces and unsupported characters still consume a reveal slot. Breathing and Wiggly can run alongside Unwrap. A conservative fixed motion bound includes all enabled effects and scaling centers, preventing clipping as random glyph shapes develop. Like Wiggly, the reveal loop pauses in hidden tabs and does not modify exported JSON.

## Sound

The Sound tab plays the current text locally through Web Audio after pressing **Play sound**. This is glyph sonification, not intelligible text-to-speech. The **Tone / Chords** switch defaults to Tone, the original single sine tone per letter. Its pitch comes from the magnitude-weighted average harmonic number across all its contours, including both signed frequencies up to the selected harmonic limit, excluding DC. This spectral centroid is compressed into one octave (`min(1, log2(centroid) / 3)`). Low-volume tones have short attack/release envelopes; start with a comfortable device volume.

**Chords** plays one simultaneous major triad per letter (root, major third, perfect fifth), not an arpeggio. Harmonics 1/4/7/... contribute to the root, 2/5/8/... to the third, and 3/6/9/... to the fifth. Magnitudes from all contours and both signed frequencies set the normalized voice weights, with half the total weight reserved for the root. This is a musical mapping of the font spectrum, not direct playback of every partial. Both Speech and Sing support either voicing. Sing's Wiggly modulation changes both pitch and chord blend; smooth easing preserves every voice's phase and interpolates its weight between letters. Switching voicing stops the current playback.

- **Speech** plays one tone per glyph (default 140 ms), with a glyph-derived pitch between the selected base and twice that frequency. Word boundaries receive randomized pauses between one and two times **Minimum word pause** (25 to 500% of Letter duration, default 143%). Consecutive whitespace forms one boundary; newlines, tabs, unsupported characters and blank glyphs also separate words.
- **Sing** plays one longer tone per glyph along a repeating melody, based on a glyph-derived pitch between the selected base and twice that frequency. The same seeded, smooth Wiggly coefficient offsets as the preview gently change that tone's pitch, with added vibrato; they never add extra voices or note attacks. It uses Wiggly's amplitude and frequency settings even if the visual switch is off. Zero amplitude removes wiggle and vibrato but retains the melody.

**Base pitch** ranges from 80 to 400 Hz, defaulting to 140 Hz in Speech and 196 Hz in Sing. Each mode remembers its own value. Glyph-derived offsets, melody and chord intervals are applied above this base, so it is not a ceiling on the final frequency. Speech-only **Question rise**, **Exclamation lift**, and **Exclamation fall** range from 0 to 12 semitones in half-semitone steps, defaulting to 4, 4 and 2. Fall is the ending distance below the glyph's base pitch, not the drop from the lift's peak. Zero removes the corresponding excursion. Pitch setting changes stop playback.

**Letter duration** ranges from 40 to 1000 ms in 10 ms steps. Speech defaults to 140 ms and Sing to 210 ms; each mode remembers its own value. Pauses and glides are percentages of this duration, so lowering it speeds up the whole performance without changing pitch or timing proportions. Each percentage slider also displays its effective milliseconds. This applies to both Tone and Chords, and changing it stops playback.

Letters within a word are connected without silent gaps or repeated volume attacks. Oscillator phase and volume remain continuous across letter boundaries, while pitch glides into the new letter using smoothstep easing in logarithmic pitch space. Each letter contributes one tone or simultaneous chord, without overlapping letter events. Chord voice weights sum to one to preserve the same peak-volume bound as Tone. Word starts and ends use eased attack/release envelopes; whitespace and unsupported characters break the connection and retain the randomized word pause.

Both modes generate buffers at the audio device's native sample rate, with sample-aligned letter boundaries to avoid per-letter resampling artifacts. A continuous 60 Hz high-pass filter removes DC and low-frequency rumble without resetting at letter joins. High-pass filtering does not remove high-frequency scratching.

**Glide duration** ranges from 0 to 100% of Letter duration, defaulting to 29% (about 41 ms at the default Speech speed). The percentage is shared by Speech and Sing. Zero changes pitch and chord weights instantly without resetting oscillator phase. Changing the slider stops playback, like other sound settings.

**Space glide** adds an audible, sustained bridge between words (0 to 500% of Letter duration, default 0% in Speech and 29% in Sing, about 61 ms at its default speed). Each mode remembers its own slider value when switching modes. It replaces the internal silent word pause with one eased pitch/chord-blend transition into the next word, preserving oscillator phase and volume with no new attack. Consecutive spaces, tabs, newlines and unsupported characters form one boundary. No bridge is added before the first or after the last letter. Set it to 0% to restore randomized silent word pauses; the Minimum word pause slider is disabled while bridging is enabled. Both performance modes and voicings support it, independently of the shorter letter glide.

**Dot pause** sets a silent sentence pause for each `.` (25 to 1000% of Letter duration, default 214%, about 300 ms at the default Speech speed). Dots render normally but do not play tones; they break legato and override Space glide. Whitespace immediately after a dot adds no extra pause, and repeated dots each add their configured duration. These rules also apply to imported fonts; dots remain pause controls even if the imported dataset has no dot outline.

In **Speech only**, `?` smoothly raises the preceding word by the Question rise amount. `!` lifts it by the Exclamation lift amount, then falls below its base pitch by the Exclamation fall amount. These are simple punctuation cues, not linguistic question-type analysis. Both marks use the Dot pause duration, break Space glide and do not play separate tones. Repeated sentence marks each add a pause but do not stack pitch effects. Tone and Chords share the same pitch contour; all three chord voices move together. In **Sing**, `?` and `!` remain ordinary glyph tones, without speech intonation or extra sentence pauses.

Play performs the text once; Stop silences it immediately. Changing the text, font, harmonic limit or sound/Wiggly settings stops the current performance. Font size and visual-only modes do not affect audio. K=0 disables playback; a text with no supported outlines reports an error. Audio buffers are generated just ahead of playback, and resources are released on completion, Stop or unmount. No microphone, network audio service, audio export or font-data changes are involved.

If browser suspension or a busy main thread makes playback miss its scheduling window, it stops with an explicit restart message rather than playing overdue letters simultaneously. Long text with complex animation or unusually large imported glyphs can be expensive, especially on phones. Start with a short phrase; animation and audio are not frame-synchronized.

## Deploying a demo

Build with Node 22.12+ using `npm ci` then `npm run build`. Publish the contents of `dist/` to a static host over HTTPS. No backend, environment secrets or original TTFs are needed by the deployed app. `npm run preview` is a local build check, not a production server.

The default build assumes hosting at `/`. For a subpath such as GitHub Pages:

```sh
npm run build -- --base=/funky-font/
npm run preview -- --base=/funky-font/
```

Set the base to the actual hosted path so bundled assets and font JSON resolve correctly. The host should serve `.json` and font files normally and enable gzip/Brotli if available. Each included JSON is about 1.2-1.5 MiB before compression and loads on selection, not all at startup; the JavaScript build currently emits a non-fatal chunk-size warning.

Before sharing on LinkedIn:

- Keep the bundled font attribution and OFL notices with any redistributed original fonts or derived JSON.
- Preserve the source-code copyright and ISC permission notice when redistributing the code.
- Run the unit/build checks and Chromium desktop/mobile tests below. Also test audio on a real phone and Safari/Firefox; the mobile suite is Chromium viewport emulation, not an iOS browser test.
- Check the deployed URL, JSON loading, playback after a click, Stop, Auto-fit, and all seven tabs. Audio can continue while switching tabs; return to Sound to stop it.
- Add the final canonical URL and a public preview image to social metadata if desired. The page currently provides an Open Graph title and description, but no image or deployment URL.
- Create an initial commit and configure the intended GitHub remote before publishing; do not assume local staged files are already backed up or deployed.

## JSON Version 1

The runtime validator and inferred TypeScript types are in `src/lib/font-data.ts`. The generator validates its own output using the same contract.

```text
version: 1
family, style: strings
coordinates: "x-right-y-up"
unitsPerEm, ascender, descender, lineGap: font metrics
maxFrequency: K
sampling: "uniform-arc-length"
license?: { name: "OFL-1.1", text: complete copyright/license notice, source: upstream URL }
glyphs[character]:
  advanceWidth
  bounds: { xMin, yMin, xMax, yMax }
  contours[]:
    sampleCount
    coefficients[]: { frequency, re, im }  // ordered -K through +K
kerning[leftCharacter + rightCharacter]: adjustment in font units
```

Space must have positive advance and no contours; the generator uses one-third em if no usable space width exists. Absent line gap defaults to zero. Coefficients and metrics must be finite. Imports are limited to 10 MiB, 128 glyphs, 128 contours per glyph, 500 harmonics and 32,768 source samples per contour. Sample counts must be powers of two above Nyquist. The validator checks coefficient order/count, glyph bounds and kerning references. Failed imports preserve the previous valid dataset.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

Vitest covers signed frequency/normalization conventions, independent contours, sampled reconstruction error, source-font conversion and license preservation for all three fonts, monospaced advances, validation, spacing, line breaks, geometry/motion bounds, audio synthesis, pitch controls, punctuation, timing and scheduling. Playwright covers Chromium desktop/mobile rendering, font switching and failed loads, licensed downloads, nonblank raster output, Auto-fit, animation, audio buffers and controls, text/slider interactions, JSON errors and replacement ceilings, plus a pixel intersection comparison between the original Dancing Script outlines and the 100-harmonic reconstruction. It starts Vite if needed. Screenshots and failure traces are written under `test-results/`.

The source parser and original comparison font files are used only by the generator and tests. The production build contains their JSON datasets and separately licensed UI typefaces, not the original comparison TTFs.

Minimal Linux environments may also need Chromium system libraries. Playwright lists the missing dependencies; `npx playwright install-deps chromium` installs them and may require administrator access. These libraries are needed for browser testing, not to run the application in your own browser.

## Code License and Credit

The project's own source code is licensed under the [ISC License](./LICENSE.txt), copyright 2026 Oto Ciulis. It permits use, modification and redistribution, including commercial use, provided the copyright and permission notices remain in all copies.

If you use this project in an app, website or other work, a visible credit such as **"Includes Fourier Type by Oto Ciulis"** in your About/Credits page would be appreciated. This is an optional request, not an additional license condition.

Third-party dependencies, font files and derived Fourier font datasets retain their separate licenses; the ISC license does not replace them.

## Font Rights

All three comparison fonts are distributed under SIL Open Font License 1.1, allowing redistribution, modification and commercial bundling subject to its conditions. Original unmodified TTFs and their full notices are in [fonts/](./fonts/), sourced from Google Fonts revision `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`:

| UI source label | Derived dataset family | Attribution / original license |
|---|---|---|
| Dancing Script | Fourier Dance | Copyright 2016 The Dancing Script Project Authors; [OFL](./fonts/dancing-script/OFL.txt) |
| Sacramento | Fourier Flow | Copyright 2012 Brian J. Bonislawsky DBA Astigmatic (AOETI); [OFL](./fonts/sacramento/OFL.txt) |
| Roboto Mono | Fourier Mono | Copyright 2015 The Roboto Mono Project Authors; [OFL](./fonts/roboto-mono/OFL.txt) |

Dancing Script and Sacramento declare Reserved Font Names. Their modified Fourier representations use new family names; the selector labels identify the original sources, not names of modified font families. All derived datasets remain OFL-1.1 and embed their complete original copyright/license notice and pinned source URL. Import/export preserves this optional metadata; older version-1 JSON without it still works. Do not remove these notices or relicense the datasets under the application's code license. Font software cannot be sold by itself under OFL.

The UI typefaces DM Sans and Space Grotesk use the SIL Open Font License 1.1. Their copyright notices and license are distributed in [public/licenses/OFL.txt](./public/licenses/OFL.txt), which is copied into the deployed build. Dependency licenses remain separate from the ISC license for this project's own source code.