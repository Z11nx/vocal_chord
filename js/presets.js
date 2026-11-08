/*
 * presets.js — vowel shapes, consonant gestures, harmony modes, demo songs.
 * `ref` = typical adult formants F1/F2/F3 (Hz) for comparison.
 */
(function (root) {
  'use strict';

  const VOWELS = {
    i: { ipa: 'i', label: 'ee', word: 'see', ref: [270, 2290, 3010], shape: { tongueX: 1, tongueY: 0.9, jaw: 0.1, lipRound: 0, lipOpen: 1, tipUp: 0 } },
    e: { ipa: 'ɛ', label: 'eh', word: 'bed', ref: [530, 1840, 2480], shape: { tongueX: 0.8, tongueY: 0.55, jaw: 0.38, lipRound: 0, lipOpen: 1, tipUp: 0 } },
    ae: { ipa: 'æ', label: 'ae', word: 'cat', ref: [660, 1720, 2410], shape: { tongueX: 0.72, tongueY: 0.25, jaw: 0.75, lipRound: 0, lipOpen: 1, tipUp: 0 } },
    a: { ipa: 'ɑ', label: 'ah', word: 'father', ref: [730, 1090, 2440], shape: { tongueX: 0.1, tongueY: 0.05, jaw: 0.5, lipRound: 0, lipOpen: 1, tipUp: 0 } },
    o: { ipa: 'o', label: 'oh', word: 'go', ref: [500, 900, 2400], shape: { tongueX: 0, tongueY: 0.45, jaw: 0.3, lipRound: 0.65, lipOpen: 1, tipUp: 0 } },
    u: { ipa: 'u', label: 'oo', word: 'boot', ref: [300, 870, 2240], shape: { tongueX: 0.4, tongueY: 0.92, jaw: 0.15, lipRound: 1, lipOpen: 1, tipUp: 0 } },
    schwa: { ipa: 'ə', label: 'uh', word: 'sofa', ref: [500, 1500, 2500], shape: { tongueX: 0.5, tongueY: 0.5, jaw: 0.35, lipRound: 0, lipOpen: 1, tipUp: 0 } },
  };

  // Consonants: `shape` overrides the articulators during the closure /
  // constriction; `hold` is its duration (s); `voice` 0 = voiceless;
  // `post` = aspiration time after release (s).
  const CONSONANTS = {
    p: { label: 'p', kind: 'stop', shape: { lipOpen: 0 }, hold: 0.07, voice: 0, post: 0.04 },
    b: { label: 'b', kind: 'stop', shape: { lipOpen: 0 }, hold: 0.06, voice: 1 },
    m: { label: 'm', kind: 'nasal', shape: { lipOpen: 0, velum: 1 }, hold: 0.11, voice: 1 },
    t: { label: 't', kind: 'stop', shape: { tipUp: 1, jaw: 0.15 }, hold: 0.06, voice: 0, post: 0.04 },
    d: { label: 'd', kind: 'stop', shape: { tipUp: 1, jaw: 0.15 }, hold: 0.05, voice: 1 },
    n: { label: 'n', kind: 'nasal', shape: { tipUp: 1, velum: 1, jaw: 0.15 }, hold: 0.1, voice: 1 },
    k: { label: 'k', kind: 'stop', shape: { tongueX: 0.2, tongueY: 1, jaw: 0.15 }, hold: 0.07, voice: 0, post: 0.05 },
    g: { label: 'g', kind: 'stop', shape: { tongueX: 0.2, tongueY: 1, jaw: 0.15 }, hold: 0.06, voice: 1 },
    ng: { label: 'ng', kind: 'nasal', shape: { tongueX: 0.2, tongueY: 1, velum: 1, jaw: 0.15 }, hold: 0.12, voice: 1 },
    s: { label: 's', kind: 'fricative', shape: { tipUp: 0.77, tongueX: 0.7, tongueY: 0.5, jaw: 0.1 }, hold: 0.13, voice: 0 },
    z: { label: 'z', kind: 'fricative', shape: { tipUp: 0.77, tongueX: 0.7, tongueY: 0.5, jaw: 0.1 }, hold: 0.11, voice: 1 },
    sh: { label: 'sh', kind: 'fricative', shape: { tipUp: 0.73, tongueX: 0.8, tongueY: 0.75, lipRound: 0.5, jaw: 0.12 }, hold: 0.14, voice: 0 },
    zh: { label: 'zh', kind: 'fricative', shape: { tipUp: 0.73, tongueX: 0.8, tongueY: 0.75, lipRound: 0.5, jaw: 0.12 }, hold: 0.1, voice: 1, hidden: true },
    th: { label: 'th', kind: 'fricative', shape: { tipUp: 0.74, tongueX: 0.95, tongueY: 0.5, jaw: 0.12 }, hold: 0.11, voice: 0 },
    dh: { label: 'dh', kind: 'fricative', shape: { tipUp: 0.74, tongueX: 0.95, tongueY: 0.5, jaw: 0.12 }, hold: 0.07, voice: 1, hidden: true },
    f: { label: 'f', kind: 'fricative', shape: { lipOpen: 0.2, jaw: 0.3 }, hold: 0.12, voice: 0 },
    v: { label: 'v', kind: 'fricative', shape: { lipOpen: 0.2, jaw: 0.3 }, hold: 0.09, voice: 1 },
    h: { label: 'h', kind: 'aspirate', shape: {}, hold: 0.08, voice: 0 },
    l: { label: 'l', kind: 'approximant', shape: { tipUp: 0.66, tongueX: 0.6, tongueY: 0.35, jaw: 0.2 }, hold: 0.07, voice: 1 },
    r: { label: 'r', kind: 'approximant', shape: { tipUp: 0.65, tongueX: 0.45, tongueY: 0.6, lipRound: 0.35 }, hold: 0.08, voice: 1 },
    w: { label: 'w', kind: 'approximant', shape: { tongueX: 0.15, tongueY: 0.85, lipRound: 1, lipOpen: 0.35 }, hold: 0.07, voice: 1 },
    y: { label: 'y', kind: 'approximant', shape: { tongueX: 1, tongueY: 0.95, jaw: 0.1 }, hold: 0.06, voice: 1 },
  };

  const HARMONY = {
    solo: { label: 'Solo', voices: [{ semis: 0, pan: 0, gain: 1 }] },
    choir: { label: 'Unison choir', voices: [{ semis: 0, pan: 0, gain: 0.8 }, { semis: 0.12, pan: -0.6, gain: 0.6 }, { semis: -0.1, pan: 0.6, gain: 0.6 }] },
    octave: { label: 'Octaves', voices: [{ semis: 0, pan: 0, gain: 0.9 }, { semis: -12, pan: -0.3, gain: 0.7 }] },
    fifth: { label: 'Power 5th', voices: [{ semis: 0, pan: 0, gain: 0.85 }, { semis: 7, pan: 0.4, gain: 0.55 }, { semis: -12, pan: -0.4, gain: 0.55 }] },
    major: { label: 'Major triad', voices: [{ semis: 0, pan: 0, gain: 0.8 }, { semis: 4, pan: -0.5, gain: 0.55 }, { semis: 7, pan: 0.5, gain: 0.55 }, { semis: -12, pan: 0, gain: 0.45 }] },
    minor: { label: 'Minor triad', voices: [{ semis: 0, pan: 0, gain: 0.8 }, { semis: 3, pan: -0.5, gain: 0.55 }, { semis: 7, pan: 0.5, gain: 0.55 }, { semis: -12, pan: 0, gain: 0.45 }] },
  };

  const SCALES = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
  };

  const VOICE_TYPES = {
    bass: { label: 'Bass', base: 43, tension: 0.55 },
    tenor: { label: 'Tenor', base: 52, tension: 0.62 },
    alto: { label: 'Alto', base: 57, tension: 0.68 },
    soprano: { label: 'Soprano', base: 64, tension: 0.72 },
  };

  // Step-sequencer songs: [midi offset from voice base (null = rest), syllable]
  const SONGS = {
    twinkle: { label: 'Twinkle Twinkle (with words)', bpm: 96, steps: [[0, 'twin'], [0, 'kul'], [7, 'twin'], [7, 'kul'], [9, 'lit'], [9, 'tul'], [7, 'star'], [null, ''], [5, 'how'], [5, 'I'], [4, 'won'], [4, 'der'], [2, 'what'], [2, 'you'], [0, 'are'], [null, '']] },
    scale: { label: 'Do-re-mi scale', bpm: 100, steps: [[0, 'doh'], [2, 'ray'], [4, 'mee'], [5, 'fah'], [7, 'soh'], [9, 'lah'], [11, 'tee'], [12, 'doh'], [12, 'doh'], [11, 'tee'], [9, 'lah'], [7, 'soh'], [5, 'fah'], [4, 'mee'], [2, 'ray'], [0, 'doh']] },
    ode: { label: 'Ode to Joy (Beethoven)', bpm: 120, steps: [[4, 'la'], [4, 'la'], [5, 'la'], [7, 'la'], [7, 'la'], [5, 'la'], [4, 'la'], [2, 'la'], [0, 'la'], [0, 'la'], [2, 'la'], [4, 'la'], [4, 'la'], [2, 'la'], [2, 'aah'], [null, '']] },
    doowop: { label: 'Doo-wop bass line', bpm: 132, steps: [[0, 'doo'], [null, ''], [0, 'doo'], [7, 'wah'], [9, 'doo'], [null, ''], [9, 'doo'], [7, 'wah'], [5, 'doo'], [null, ''], [5, 'doo'], [4, 'wah'], [2, 'bom'], [4, 'bom'], [7, 'bom'], [null, '']] },
    beatbox: { label: 'Mouth percussion', bpm: 96, steps: [[0, 'p'], [null, ''], [0, 'ts'], [null, ''], [0, 'k'], [null, ''], [0, 'ts'], [0, 'p'], [0, 'p'], [null, ''], [0, 'ts'], [null, ''], [0, 'k'], [0, 'ts'], [0, 'ts'], [null, '']] },
    vowels: { label: 'Vowel morph', bpm: 70, steps: [[0, 'ee'], [0, 'eh'], [0, 'ah'], [0, 'oh'], [0, 'oo'], [0, 'oh'], [0, 'ah'], [0, 'eh'], [7, 'ee'], [7, 'eh'], [7, 'ah'], [7, 'oh'], [5, 'oo'], [4, 'mm'], [2, 'nn'], [0, 'ah']] },
  };

  const api = { VOWELS, CONSONANTS, HARMONY, SCALES, VOICE_TYPES, SONGS };
  root.Presets = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
