# Vocal Chord — the orchestra inside your head

A browser instrument that turns the human voice into a set of playable "instruments".
You see a sliced, side-on (mid-sagittal) view of a human head, from brain to trachea.
Drag the tongue, lips, jaw, soft palate and vocal folds, and a physical model of the voice sings.

## Run it

No build step and no dependencies.

- **Quickest:** open `index.html` in a browser.
  On `file://` the voice runs on the main thread, which is fine on most machines.
- **Best:** serve the folder so the sound engine can run in an AudioWorklet (lower latency):

  ```sh
  python3 -m http.server 8000   # then open http://localhost:8000
  ```

Press **Turn on sound**, then hold a piano key (`A W S E D F T G Y H U J K…`) and drag the glowing handles.

## The instruments

| Anatomy | Instrument | What it does |
|---|---|---|
| Lungs | the bellows | Breath pressure: loudness. Sustain holds a note; Whisper turns the voice off but keeps the air. |
| Vocal folds | the strings | Pitch, tension (slack and airy ↔ pressed and bright), breathiness, vibrato, glide. Drag the folds up or down to bend pitch. |
| Tongue | the slide | Body position chooses the vowel (drag it, or use the IPA vowel chart). The tip makes t / d / n / s / l. |
| Jaw | the bell | Opens the mouth cavity. The tongue rides along with it. |
| Lips | the mute | Close for p / b / m, narrow for f / v, round for oo / oh. |
| Soft palate | the nasal stop | Lower it to send air through the nose: hums, m, n, ng. |

### Say it: words, spoken or sung

Type anything into the **Say it** box.

- **Speak** (Enter) reads it with natural rhythm. Intonation falls at full stops, rises on questions, and pauses at commas.
- **Sing** (Shift+Enter) puts one syllable per beat on a melody in the chosen scale and key.
- Hold a piano key while it talks and you control the pitch yourself, like a talk box.

Each word is shown with its pronunciation, and it lights up as it's spoken. The sequencer steps accept real words too.

`js/speech.js` handles the conversion. It looks words up in a dictionary of common English words, and falls back to spelling rules for everything else (digraphs, silent and "magic" e, r-coloured vowels, suffixes). It then syllabifies the phonemes and plans a timed sequence of articulator targets. That sequence moves the real tongue, lips, jaw and soft palate in the model, so every word you hear is produced by the anatomy on screen.

You can also:

- Use the vowel pads (`1`–`8`) and the consonant pads.
- Choose a harmony mode (choir, octaves, power fifth, major or minor triad).
- Program the 16-step sequencer, where each step is a note plus a sung syllable such as `la`, `doo`, `bom`, `mm` or `ts`.

Other keys:

- `Space`: sustain
- `Z` / `X`: octave down / up
- **Airway x-ray**: shows the cross-sections the sound is computed from

## How the sound works

The picture *is* the instrument.

1. `js/anatomy.js` builds the moving anatomy from a few articulator parameters.
   It then casts 44 lines across the airway, from the vocal folds to the lips, and measures the gap between the moving structures (tongue, lower lip, epiglottis) and the fixed ones (palate, velum, throat wall, upper lip).
2. Each gap becomes a cross-sectional area (A = α·dᵝ).
3. `js/dsp.js` feeds those areas to a Kelly-Lochbaum waveguide model of the vocal tract.
   - It has a nasal branch at the soft palate.
   - It is driven by a Liljencrants-Fant glottal-pulse source plus breath noise.
   - Turbulence noise is injected at the tightest constriction, and a burst is triggered when a closure releases.

With the vowel presets, the model lands close to typical adult formants. Here are the measured F1/F2 values from `node tools/formants.js` against the targets:

| vowel | target F1/F2 | model F1/F2 |
|---|---|---|
| i (see) | 270 / 2290 | 281 / 2186 |
| ɛ (bed) | 530 / 1840 | 510 / 1887 |
| ɑ (father) | 730 / 1090 | 674 / 1131 |
| o (go) | 500 / 900 | 516 / 902 |
| u (boot) | 300 / 870 | 305 / 914 |

## Developer tools

```sh
node tools/formants.js        # formant check for vowels + closure check for consonants
node tools/stability.js       # runs the full processor offline; checks for NaN/blow-ups
node tools/render-wav.js x.wav "hello there" speak   # speak or sing text into a WAV file
```

## Files

- `index.html`, `css/style.css`: layout and UI
- `js/anatomy.js`: head geometry and airway measurement
- `js/dsp.js`: voice synthesis (AudioWorklet processor, with a main-thread fallback)
- `js/render.js`: canvas drawing of the sliced head, airflow and sound waves
- `js/speech.js`: text → phonemes → timed articulator plan (speaking and singing)
- `js/presets.js`: vowels, consonant gestures, harmonies, scales and demo songs
- `js/app.js`: interaction, keyboard, sequencer and audio wiring
