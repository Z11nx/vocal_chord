/*
 * speech.js — turns typed text into timed articulator movements.
 *
 *   "hello there"  →  words  →  phonemes (HH AX L OW1 …)  →  syllables
 *                  →  timed segments: { shape, voicing, pitch, start, dur }
 *
 * The app plays the segments by driving the tongue, lips, jaw and soft
 * palate of the head model — so the voice really is "spoken" by the
 * anatomy you see. English spelling is irregular, so common words come
 * from a small dictionary and everything else from letter-to-sound rules.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------- vowel targets
  // Articulator shapes for each vowel phoneme (ARPAbet names).
  const VOWEL_SHAPES = {
    IY: { tongueX: 1, tongueY: 0.9, jaw: 0.1, lipRound: 0 },
    IH: { tongueX: 0.85, tongueY: 0.7, jaw: 0.2, lipRound: 0 },
    EE: { tongueX: 0.88, tongueY: 0.68, jaw: 0.22, lipRound: 0 }, // start of "ay"
    EH: { tongueX: 0.8, tongueY: 0.55, jaw: 0.38, lipRound: 0 },
    AE: { tongueX: 0.72, tongueY: 0.25, jaw: 0.65, lipRound: 0 },
    AA: { tongueX: 0.1, tongueY: 0.05, jaw: 0.5, lipRound: 0 },
    AO: { tongueX: 0.05, tongueY: 0.3, jaw: 0.5, lipRound: 0.45 },
    OH: { tongueX: 0, tongueY: 0.45, jaw: 0.3, lipRound: 0.65 },
    UH: { tongueX: 0.3, tongueY: 0.7, jaw: 0.2, lipRound: 0.6 },
    UW: { tongueX: 0.4, tongueY: 0.92, jaw: 0.15, lipRound: 1 },
    AH: { tongueX: 0.35, tongueY: 0.35, jaw: 0.42, lipRound: 0 },
    AX: { tongueX: 0.5, tongueY: 0.5, jaw: 0.28, lipRound: 0 },
    ER: { tongueX: 0.45, tongueY: 0.6, jaw: 0.25, lipRound: 0.3, tipUp: 0.65 },
  };
  const DIPHTHONGS = { EY: ['EE', 'IY'], AY: ['AA', 'IH'], AW: ['AA', 'UH'], OY: ['AO', 'IH'], OW: ['OH', 'UH'] };
  const VOWELS = new Set([...Object.keys(VOWEL_SHAPES), ...Object.keys(DIPHTHONGS)]);

  // consonant phoneme → key in Presets.CONSONANTS (CH/JH are two-part)
  const CONS = {
    P: 'p', B: 'b', M: 'm', T: 't', D: 'd', N: 'n', K: 'k', G: 'g', NG: 'ng', S: 's', Z: 'z',
    SH: 'sh', ZH: 'zh', F: 'f', V: 'v', TH: 'th', DH: 'dh', HH: 'h', L: 'l', R: 'r', W: 'w', Y: 'y',
    CH: ['t', 'sh'], JH: ['d', 'zh'],
  };
  const VOICED = new Set(['B', 'D', 'G', 'V', 'DH', 'Z', 'ZH', 'JH', 'M', 'N', 'NG', 'L', 'R', 'W', 'Y']);

  const IPA = {
    IY: 'i', IH: 'ɪ', EY: 'eɪ', EH: 'ɛ', AE: 'æ', AA: 'ɑ', AO: 'ɔ', OW: 'oʊ', UH: 'ʊ', UW: 'u', AH: 'ʌ', AX: 'ə', ER: 'ɝ',
    AY: 'aɪ', AW: 'aʊ', OY: 'ɔɪ', P: 'p', B: 'b', M: 'm', T: 't', D: 'd', N: 'n', K: 'k', G: 'ɡ', NG: 'ŋ', S: 's', Z: 'z',
    SH: 'ʃ', ZH: 'ʒ', F: 'f', V: 'v', TH: 'θ', DH: 'ð', HH: 'h', L: 'l', R: 'ɹ', W: 'w', Y: 'j', CH: 'tʃ', JH: 'dʒ',
  };

  // ---------------------------------------------------------- dictionary
  // Common irregular words (ARPAbet; 1 = stressed vowel, 0 = unstressed).
  const DICT_SRC = `
a:AX0|the:DH AX0|an:AE1 N|and:AE1 N D|of:AH1 V|to:T UW1|too:T UW1|two:T UW1|you:Y UW1|your:Y AO1 R|you're:Y AO1 R
i:AY1|i'm:AY1 M|me:M IY1|my:M AY1|we:W IY1|he:HH IY1|she:SH IY1|be:B IY1|is:IH1 Z|it's:IH1 T S|are:AA1 R|was:W AA1 Z
were:W ER1|have:HH AE1 V|has:HH AE1 Z|do:D UW1|does:D AH1 Z|done:D AH1 N|one:W AH1 N|three:TH R IY1|four:F AO1 R
five:F AY1 V|six:S IH1 K S|seven:S EH1 V AX0 N|eight:EY1 T|nine:N AY1 N|ten:T EH1 N|zero:Z IH1 R OW0|what:W AH1 T
who:HH UW1|where:W EH1 R|there:DH EH1 R|their:DH EH1 R|they:DH EY1|them:DH EH1 M|this:DH IH1 S|that:DH AE1 T
these:DH IY1 Z|those:DH OW1 Z|then:DH EH1 N|than:DH AE1 N|with:W IH1 DH|from:F R AH1 M|said:S EH1 D|says:S EH1 Z
come:K AH1 M|some:S AH1 M|love:L AH1 V|give:G IH1 V|live:L IH1 V|gone:G AO1 N|know:N OW1|hello:HH AX0 L OW1
hi:HH AY1|hey:HH EY1|world:W ER1 L D|good:G UH1 D|great:G R EY1 T|how:HH AW1|now:N AW1|today:T AX0 D EY1
okay:OW1 K EY1|ok:OW1 K EY1|yes:Y EH1 S|no:N OW1|not:N AA1 T|again:AX0 G EH1 N|about:AX0 B AW1 T|away:AX0 W EY1
above:AX0 B AH1 V|voice:V OY1 S|sing:S IH1 NG|song:S AO1 NG|music:M Y UW1 Z IH0 K|tongue:T AH1 NG|mouth:M AW1 TH
throat:TH R OW1 T|heart:HH AA1 R T|very:V EH1 R IY0|many:M EH1 N IY0|any:EH1 N IY0|people:P IY1 P AX0 L
please:P L IY1 Z|welcome:W EH1 L K AX0 M|twinkle:T W IH1 NG K AX0 L|little:L IH1 T AX0 L|wonder:W AH1 N D ER0
happy:HH AE1 P IY0|birthday:B ER1 TH D EY0|friend:F R EH1 N D|friends:F R EH1 N D Z|beautiful:B Y UW1 T AX0 F AX0 L
water:W AO1 T ER0|robot:R OW1 B AA0 T|human:HH Y UW1 M AX0 N|computer:K AX0 M P Y UW1 T ER0|door:D AO1 R
more:M AO1 R|for:F AO1 R|or:AO1 R|our:AW1 ER0|out:AW1 T|so:S OW1|go:G OW1|into:IH1 N T UW0|all:AO1 L|call:K AO1 L
small:S M AO1 L|ball:B AO1 L|walk:W AO1 K|talk:T AO1 K|could:K UH1 D|would:W UH1 D|should:SH UH1 D|put:P UH1 T
pull:P UH1 L|push:P UH1 SH|full:F UH1 L|girl:G ER1 L|get:G EH1 T|eye:AY1|eyes:AY1 Z|buy:B AY1|by:B AY1|laugh:L AE1 F
enough:IH0 N AH1 F|through:TH R UW1|though:DH OW1|thought:TH AO1 T|brother:B R AH1 DH ER0|mother:M AH1 DH ER0
father:F AA1 DH ER0|other:AH1 DH ER0|over:OW1 V ER0|never:N EH1 V ER0|ever:EH1 V ER0|every:EH1 V R IY0
open:OW1 P AX0 N|only:OW1 N L IY0|also:AO1 L S OW0|because:B IH0 K AH1 Z|before:B IH0 F AO1 R|maybe:M EY1 B IY0
baby:B EY1 B IY0|lady:L EY1 D IY0|head:HH EH1 D|dead:D EH1 D|bread:B R EH1 D|ready:R EH1 D IY0|said:S EH1 D
want:W AA1 N T|was:W AA1 Z|watch:W AA1 CH|word:W ER1 D|words:W ER1 D Z|work:W ER1 K|learn:L ER1 N|earth:ER1 TH
here:HH IH1 R|hear:HH IH1 R|year:Y IH1 R|ear:IH1 R|bear:B EH1 R|wear:W EH1 R|pear:P EH1 R|great:G R EY1 T
light:L AY1 T|night:N AY1 T|right:R AY1 T|kind:K AY1 N D|mind:M AY1 N D|find:F AY1 N D|child:CH AY1 L D
old:OW1 L D|cold:K OW1 L D|gold:G OW1 L D|both:B OW1 TH|most:M OW1 S T|post:P OW1 S T|ghost:G OW1 S T
oh:OW1|ooh:UW1|ah:AA1|aah:AA1|uh:AH1|eh:EH1|ee:IY1|oo:UW1|la:L AA1|da:D AA1|na:N AA1|doo:D UW1|wah:W AA1
bom:B AA1 M|doh:D OW1|ray:R EY1|mee:M IY1|fah:F AA1|soh:S OW1|lah:L AA1|tee:T IY1|ti:T IY1|re:R EY1|mi:M IY1
fa:F AA1|sol:S OW1 L|so:S OW1|vocal:V OW1 K AX0 L|chord:K AO1 R D|instrument:IH1 N S T R AX0 M AX0 N T
sing:S IH1 NG|singing:S IH1 NG IH0 NG|talking:T AO1 K IH0 NG|speak:S P IY1 K|alive:AX0 L AY1 V|am:AE1 M
can:K AE1 N|can't:K AE1 N T|don't:D OW1 N T|won't:W OW1 N T|i'll:AY1 L|i've:AY1 V|let's:L EH1 T S|what's:W AH1 T S
`;
  const DICT = {};
  for (const entry of DICT_SRC.trim().split(/[|\n]/)) {
    const [w, p] = entry.split(':');
    if (w && p) DICT[w.trim()] = p.trim().split(/\s+/);
  }

  // ------------------------------------------------- letter-to-sound rules
  // Tried in order at each position; sticky regexes may look behind/ahead.
  const C = '[bcdfghjklmnpqrstvwxz]';
  const RULES = [
    [/tion/y, 'SH AX0 N'], [/sion/y, 'ZH AX0 N'], [/ture/y, 'CH ER0'], [/ous$/y, 'AX0 S'],
    [/eigh/y, 'EY1'], [/igh/y, 'AY1'], [/ough(?=t)/y, 'AO1'], [/augh/y, 'AO1'],
    [new RegExp(`(?<=${C})le$`, 'y'), 'AX0 L'],
    [/ing(?=s?$)/y, 'IH0 NG'],
    [/(?<=[td])ed$/y, 'IH0 D'], [/(?<=(?:[pkfx]|ch|sh|ss))ed$/y, 'T'], [/(?<=..)ed$/y, 'D'],
    [/(?<=(?:s|x|z|ch|sh))es$/y, 'IH0 Z'], [new RegExp(`(?<=[aeiou]${C})es$`, 'y'), 'S'],
    [/aah?$/y, 'AA1'], [/ah(?=$|[^aeiou])/y, 'AA1'], [/eh$/y, 'EH1'], [/uh$/y, 'AH1'], [/oh$/y, 'OW1'],
    [/air/y, 'EH1 R'], [/are$/y, 'EH1 R'], [/ear/y, 'IH1 R'], [/our/y, 'AW1 ER0'],
    [/ar/y, 'AA1 R'], [/or/y, 'AO1 R'], [/(?:er|ir|ur|yr)/y, 'ER1'],
    [/ee/y, 'IY1'], [/ea/y, 'IY1'], [/(?:ai|ay)/y, 'EY1'], [/oa/y, 'OW1'], [/oo(?=k)/y, 'UH1'], [/oo/y, 'UW1'],
    [/ou/y, 'AW1'], [/ow$/y, 'OW1'], [/ow/y, 'AW1'], [/(?:oi|oy)/y, 'OY1'], [/(?:au|aw)/y, 'AO1'], [/ew/y, 'UW1'],
    [/ue$/y, 'UW1'], [/ie$/y, 'AY1'], [/ie/y, 'IY1'], [/ei/y, 'EY1'], [/ey$/y, 'IY0'],
    // "magic e": vowel + consonant + silent e makes the vowel long
    [new RegExp(`a(?=${C}e(?:s|d|ly)?$)`, 'y'), 'EY1'], [new RegExp(`e(?=${C}e(?:s|d|ly)?$)`, 'y'), 'IY1'],
    [new RegExp(`i(?=${C}e(?:s|d|ly)?$)`, 'y'), 'AY1'], [new RegExp(`o(?=${C}e(?:s|d|ly)?$)`, 'y'), 'OW1'],
    [new RegExp(`u(?=${C}e(?:s|d|ly)?$)`, 'y'), 'UW1'],
    [/ch/y, 'CH'], [/sh/y, 'SH'], [/th/y, 'TH'], [/ph/y, 'F'], [/wh/y, 'W'], [/ck/y, 'K'], [/ng/y, 'NG'],
    [/n(?=k)/y, 'NG'], [/qu/y, 'K W'], [/x/y, 'K S'], [/^kn/y, 'N'], [/^wr/y, 'R'], [/(?<=m)b$/y, ''], [/gh/y, ''],
    [/c(?=[eiy])/y, 'S'], [/c/y, 'K'], [/g(?=[eiy])/y, 'JH'], [/g/y, 'G'], [/j/y, 'JH'],
    [/(?<=[aeiou])s(?=[aeiouy])/y, 'Z'],
  ];
  const LETTER = { b: 'B', d: 'D', f: 'F', h: 'HH', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P', r: 'R', s: 'S', t: 'T', v: 'V', w: 'W', z: 'Z', q: 'K' };

  function lts(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    const out = [];
    let i = 0;
    const hasVowelBefore = (k) => /[aeiouy]/.test(w.slice(0, k));
    while (i < w.length) {
      const ch = w[i];
      // a repeated consonant sounds once ("little", "happy")
      if (i > 0 && ch === w[i - 1] && !'aeiou'.includes(ch)) { i++; continue; }
      let matched = false;
      for (const [re, ph] of RULES) {
        re.lastIndex = i;
        if (re.source.startsWith('^') && i !== 0) continue;
        const m = re.exec(w);
        if (m && m.index === i) {
          if (ph) out.push(...ph.split(' '));
          i += m[0].length || 1;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      if (ch === 'e' && i === w.length - 1 && hasVowelBefore(i)) { i++; continue; } // silent final e
      if (ch === 'y') {
        if (i === 0) out.push('Y');
        else if (i === w.length - 1) out.push(hasVowelBefore(i) ? 'IY0' : 'AY1');
        else out.push(/[aeiou]/.test(w[i + 1] || '') ? 'Y' : 'IH1');
      } else if (ch === 'o' && i === w.length - 1) out.push('OW1');
      else if (ch === 'e' && i === w.length - 1) out.push('IY1');
      else if ('aeiou'.includes(ch)) out.push({ a: 'AE1', e: 'EH1', i: 'IH1', o: 'AA1', u: 'AH1' }[ch]);
      else if (LETTER[ch]) out.push(LETTER[ch]);
      i++;
    }
    // stress: first vowel strong, later short vowels reduce toward schwa
    let first = true;
    const res = out.map((p) => {
      const base = p.replace(/\d/, '');
      if (!VOWELS.has(base)) return p;
      const stress = first ? 1 : 0;
      first = false;
      if (!stress && ['AE', 'AA', 'AH', 'EH'].includes(base)) return 'AX0';
      return base + stress;
    });
    // final s sounds like z after voiced sounds ("dogs", "sings")
    const n = res.length;
    if (n > 1 && res[n - 1] === 'S') {
      const prev = res[n - 2].replace(/\d/, '');
      if (VOICED.has(prev) || VOWELS.has(prev)) res[n - 1] = 'Z';
    }
    return res;
  }

  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function numberWords(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
    if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
    return String(n).split('').map((d) => ONES[+d]).join(' ');
  }

  /** text → [{ word, phones: ['HH','AX0',…] } | { pause: seconds, mark }] */
  function toPhonemes(text) {
    const tokens = [];
    const re = /(\d+)|([a-zA-Z']+)|([.!?]+)|([,;:—–-]+)/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) for (const w of numberWords(+m[1]).split(' ')) tokens.push({ word: w });
      else if (m[2]) tokens.push({ word: m[2] });
      else if (m[3]) tokens.push({ pause: 0.38, mark: m[3][0] });
      else if (m[4]) tokens.push({ pause: 0.2, mark: ',' });
    }
    for (const t of tokens) {
      if (!t.word) continue;
      const key = t.word.toLowerCase();
      if (/^(h?m+|n+|hmm+)$/.test(key)) { t.phones = [key.includes('n') ? 'N' : 'M']; t.hum = true; continue; }
      t.phones = DICT[key] ? DICT[key].slice() : lts(key);
      if (!t.phones.length) t.phones = ['AX0'];
    }
    return tokens;
  }

  /** split a word's phonemes into syllables (one vowel each, maximal onset) */
  function syllabify(phones) {
    const vIdx = phones.map((p, i) => (VOWELS.has(p.replace(/\d/, '')) ? i : -1)).filter((i) => i >= 0);
    if (!vIdx.length) return [{ phones, vowel: -1, stress: 0 }];
    const syl = [];
    let start = 0;
    for (let k = 0; k < vIdx.length; k++) {
      const v = vIdx[k];
      let end;
      if (k === vIdx.length - 1) end = phones.length;
      else {
        const gap = vIdx[k + 1] - v - 1; // consonants between this vowel and the next
        end = v + 1 + (gap <= 1 ? 0 : 1);
      }
      const ph = phones.slice(start, end);
      syl.push({ phones: ph, vowel: v - start, stress: +(phones[v].match(/\d/) || [0])[0] });
      start = end;
    }
    return syl;
  }

  // ------------------------------------------------------------- planner
  const DUR = { stop: 0.065, nasal: 0.075, fricative: 0.1, vfricative: 0.075, approximant: 0.06, aspirate: 0.06 };
  function consDur(c, cons) {
    if (!cons) return 0.06;
    if (cons.kind === 'fricative') return c.voice ? DUR.vfricative : DUR.fricative;
    return DUR[cons.kind] || 0.06;
  }

  /**
   * Plan an utterance.
   * opts.mode: 'speak' | 'sing' | 'step'
   *   speak — natural rhythm and falling/rising intonation around opts.midi
   *   sing  — one beat per syllable on a melody in the given scale
   *   step  — fit the text into opts.stepDur at a fixed pitch (sequencer)
   */
  function plan(text, opts) {
    const P = root.Presets;
    const o = Object.assign({ mode: 'speak', midi: 50, rate: 1, bpm: 100, scale: [0, 2, 4, 5, 7, 9, 11], key: 0, stepDur: 0.3 }, opts);
    const tokens = toPhonemes(text);
    const words = [];
    // flatten into syllables with word info
    const sylls = [];
    tokens.forEach((t) => {
      if (t.pause) { sylls.push({ pause: t.pause, mark: t.mark }); return; }
      const wi = words.length;
      words.push({ word: t.word, ipa: t.phones.map((p) => IPA[p.replace(/\d/, '')] || '').join('') });
      if (t.hum) { sylls.push({ hum: t.phones[0], word: wi, phones: [], vowel: -1, stress: 1 }); return; }
      const ss = syllabify(t.phones);
      ss.forEach((s, k) => sylls.push(Object.assign(s, { word: wi, last: k === ss.length - 1 })));
    });
    // phrase boundaries (for lengthening / intonation)
    let phraseStart = 0;
    sylls.forEach((s, i) => {
      if (s.pause || i === sylls.length - 1) {
        const end = s.pause ? i - 1 : i;
        for (let k = phraseStart; k <= end; k++) {
          sylls[k].phrasePos = (k - phraseStart) / Math.max(1, end - phraseStart);
          sylls[k].phraseFinal = k === end;
          sylls[k].mark = s.pause ? s.mark : '.';
        }
        phraseStart = i + 1;
      }
    });

    // melody for sung text: a gentle walk through the scale, resolving home
    let seed = 0;
    for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const scaleNote = (deg) => {
      const n = o.scale.length;
      const oct = Math.floor(deg / n);
      return o.scale[((deg % n) + n) % n] + 12 * oct;
    };
    let degree = 2;

    const segs = [];
    let t = 0;
    const vowelSegsOf = (shapeKey) => Object.assign({ lipOpen: 1, tipUp: 0, velum: 0 }, VOWEL_SHAPES[shapeKey]);
    const push = (s) => { s.start = t; segs.push(s); t += s.dur; return s; };
    const rate = o.rate;

    sylls.forEach((s, si) => {
      if (s.pause) {
        if (o.mode !== 'step') push({ kind: 'pause', dur: (o.mode === 'sing' ? s.pause * 1.5 : s.pause) / rate, shape: null, voice: 0 });
        return;
      }
      // pitch for this syllable
      let midi, midi2;
      if (o.mode === 'speak') {
        const decl = -3 * (s.phrasePos || 0);
        midi = o.midi + 2 + decl + (s.stress ? 2 : 0);
        midi2 = midi - 0.6;
        if (s.phraseFinal) {
          if (s.mark === '?') { midi2 = midi + 5; }
          else if (s.mark === '!') { midi += 2; midi2 = midi - 5; }
          else if (s.mark === ',') { midi2 = midi + 1; }
          else midi2 = midi - 4;
        }
      } else if (o.mode === 'sing') {
        if (s.phraseFinal) degree = rnd() < 0.5 ? 0 : 4;
        else {
          const r = rnd();
          degree += r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : -2;
          degree = Math.max(-1, Math.min(8, degree));
        }
        midi = o.midi + o.key + scaleNote(degree);
        midi2 = midi;
      } else { midi = o.midi; midi2 = o.midi; }

      // syllable duration budget
      let budget;
      if (o.mode === 'sing') budget = (60 / o.bpm) * (s.phraseFinal ? 2 : 1);
      else if (o.mode === 'step') {
        const inStep = sylls.filter((x) => !x.pause).length;
        budget = o.stepDur / inStep;
      }

      const vowelPhone = s.vowel >= 0 ? s.phones[s.vowel].replace(/\d/, '') : null;
      const vShape = vowelPhone ? vowelSegsOf(DIPHTHONGS[vowelPhone] ? DIPHTHONGS[vowelPhone][0] : vowelPhone) : null;
      // neighbour vowel shape for consonants without a vowel in this syllable
      const nextV = () => {
        for (let k = si + 1; k < sylls.length; k++) {
          const x = sylls[k];
          if (x.vowel >= 0 && x.phones) { const vp = x.phones[x.vowel].replace(/\d/, ''); return vowelSegsOf(DIPHTHONGS[vp] ? DIPHTHONGS[vp][0] : vp); }
        }
        return vowelSegsOf('AX');
      };

      if (s.hum) {
        const hum = s.hum === 'M' ? { lipOpen: 0, velum: 1, jaw: 0.12 } : { tipUp: 1, velum: 1, jaw: 0.15 };
        const dur = budget || 0.45 / rate;
        push({ kind: 'hum', ph: s.hum, dur, shape: Object.assign(vowelSegsOf('AX'), hum), voice: 1, midi, midi2, word: s.word });
        return;
      }

      // build consonant + vowel segments
      const onset = s.vowel >= 0 ? s.phones.slice(0, s.vowel) : s.phones;
      const coda = s.vowel >= 0 ? s.phones.slice(s.vowel + 1) : [];
      const consSegs = (list, ctxShape) => {
        const out = [];
        for (const ph of list) {
          const parts = Array.isArray(CONS[ph]) ? CONS[ph] : [CONS[ph]];
          parts.forEach((key, pi) => {
            const c = P.CONSONANTS[key];
            if (!c) return;
            let dur = consDur(c, c) / rate;
            if (parts.length > 1) dur *= pi === 0 ? 0.7 : 0.8;
            const shape = Object.assign({}, ctxShape || nextV(), { velum: 0 }, c.shape);
            if (ph === 'CH' || ph === 'JH') Object.assign(shape, { tongueX: 0.8, tongueY: 0.75 });
            out.push({ kind: c.kind, ph, dur, shape, voice: c.voice, post: c.post || 0, boost: c.kind === 'aspirate', midi, midi2: midi, word: s.word });
          });
        }
        return out;
      };
      const on = consSegs(onset, vShape);
      const co = consSegs(coda, vShape);
      let vDur = 0;
      if (vowelPhone) {
        const diph = !!DIPHTHONGS[vowelPhone];
        if (budget) vDur = Math.max(0.07, budget - [...on, ...co].reduce((a, x) => a + x.dur, 0));
        else {
          vDur = (s.stress ? 0.15 : 0.08) * (diph ? 1.35 : 1) * (s.last ? 1.15 : 1) * (s.phraseFinal ? 1.45 : 1) / rate;
        }
      }
      on.forEach(push);
      if (vowelPhone) {
        const prev = segs[segs.length - 1];
        const seg = push({ kind: 'vowel', ph: vowelPhone, dur: vDur, shape: vShape, voice: 1, midi, midi2, word: s.word });
        if (DIPHTHONGS[vowelPhone]) seg.shape2 = vowelSegsOf(DIPHTHONGS[vowelPhone][1]);
        // voiceless stops leave a puff of breath before the voice starts
        if (prev && prev.post && prev.voice === 0) seg.voiceDelay = prev.post / rate;
        if (prev && prev.kind === 'aspirate') seg.voiceDelay = 0.015;
      }
      co.forEach(push);
      if (budget && !vowelPhone) {
        // consonant-only "syllable" (e.g. "ts", "k"): leave silence for the rest of the step
        const used = [...on].reduce((a, x) => a + x.dur, 0);
        if (budget - used > 0.01) push({ kind: 'pause', dur: budget - used, shape: null, voice: 0 });
      }
    });
    // a small release at the end so the last sound decays naturally
    if (o.mode !== 'step') push({ kind: 'pause', dur: 0.12, shape: null, voice: 0 });
    return { segments: segs, duration: t, words, mode: o.mode };
  }

  const api = { plan, toPhonemes, lts, syllabify, VOWEL_SHAPES, DIPHTHONGS, IPA, DICT };
  root.Speech = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
