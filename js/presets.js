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
    scale: { label: 'Do-re-mi scale', bpm: 100, steps: [[0, 'do'], [2, 're'], [4, 'mi'], [5, 'fa'], [7, 'so'], [9, 'la'], [11, 'ti'], [12, 'do'], [12, 'do'], [11, 'ti'], [9, 'la'], [7, 'so'], [5, 'fa'], [4, 'mi'], [2, 're'], [0, 'do']] },
    ode: { label: 'Ode to Joy (Beethoven)', bpm: 120, steps: [[4, 'la'], [4, 'la'], [5, 'la'], [7, 'la'], [7, 'la'], [5, 'la'], [4, 'la'], [2, 'la'], [0, 'la'], [0, 'la'], [2, 'la'], [4, 'la'], [4, 'la'], [2, 'la'], [2, 'aah'], [null, '']] },
    doowop: { label: 'Doo-wop bass line', bpm: 132, steps: [[0, 'doo'], [null, ''], [0, 'doo'], [7, 'wah'], [9, 'doo'], [null, ''], [9, 'doo'], [7, 'wah'], [5, 'doo'], [null, ''], [5, 'doo'], [4, 'wah'], [2, 'bom'], [4, 'bom'], [7, 'bom'], [null, '']] },
    beatbox: { label: 'Mouth percussion', bpm: 96, steps: [[0, 'p'], [null, ''], [0, 'ts'], [null, ''], [0, 'k'], [null, ''], [0, 'ts'], [0, 'p'], [0, 'p'], [null, ''], [0, 'ts'], [null, ''], [0, 'k'], [0, 'ts'], [0, 'ts'], [null, '']] },
    vowels: { label: 'Vowel morph', bpm: 70, steps: [[0, 'ee'], [0, 'eh'], [0, 'ah'], [0, 'oh'], [0, 'oo'], [0, 'oh'], [0, 'ah'], [0, 'eh'], [7, 'ee'], [7, 'eh'], [7, 'ah'], [7, 'oh'], [5, 'oo'], [4, 'mm'], [2, 'nn'], [0, 'ah']] },
  };

  // Parse a sung syllable ("la", "doo", "bom", "ts") into onset, vowel, coda.
  const VOWEL_SPELL = [
    ['aah', 'a'], ['ah', 'a'], ['aa', 'ae'], ['ae', 'ae'], ['ee', 'i'], ['eh', 'e'], ['oo', 'u'], ['oh', 'o'],
    ['uh', 'schwa'], ['ay', 'e'], ['ai', 'e'], ['ow', 'a'], ['a', 'a'], ['e', 'e'], ['i', 'i'], ['o', 'o'], ['u', 'u'],
  ];
  const ONSETS = ['sh', 'ng', 'p', 'b', 'm', 't', 'd', 'n', 'k', 'g', 's', 'z', 'f', 'v', 'h', 'l', 'r', 'w', 'y', 'c', 'j'];
  function parseSyllable(text) {
    let s = (text || '').toLowerCase().replace(/[^a-z]/g, '');
    const res = { onset: [], vowel: null, coda: null };
    if (!s) return res;
    // onset consonants
    let guard = 0;
    while (s && guard++ < 4) {
      const c = ONSETS.find((o) => s.startsWith(o) && !VOWEL_SPELL.some(([sp]) => s.startsWith(sp)));
      if (!c) break;
      res.onset.push(c === 'c' ? 'k' : c === 'j' ? 'd' : c);
      s = s.slice(c.length);
    }
    const v = VOWEL_SPELL.find(([sp]) => s.startsWith(sp));
    if (v) { res.vowel = v[1]; s = s.slice(v[0].length); }
    if (s) {
      const coda = ['ng', 'm', 'n', 's', 'z', 't', 'k', 'p', 'sh'].find((c) => s.startsWith(c));
      if (coda) res.coda = coda;
    }
    // "mm", "nn", "ng" with no vowel = hum
    if (!res.vowel && res.onset.length) {
      const last = res.onset[res.onset.length - 1];
      if (last === 'm' || last === 'n' || last === 'ng') { res.hum = last; }
    }
    return res;
  }

  const api = { VOWELS, CONSONANTS, HARMONY, SCALES, VOICE_TYPES, SONGS, parseSyllable };
  root.Presets = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
