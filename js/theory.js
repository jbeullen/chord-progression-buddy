/*
 * theory.js — the music theory engine.
 *
 * Notes are spelled, not just pitch classes: a note is { letter, acc } where
 * letter is 0..6 (C..B) and acc is the accidental offset in semitones.
 * That is what lets F# major come out as E#, and not F, for its seventh degree.
 */
const Theory = (() => {
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_SEMI = [0, 2, 4, 5, 7, 9, 11];
  const SHARP = '♯';
  const FLAT = '♭';

  const SCALE_STEPS = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10] // natural minor
  };

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  // ---------------------------------------------------------------- notes ---

  const nt = (letter, acc) => ({ letter, acc });
  const absv = (n) => LETTER_SEMI[n.letter] + n.acc;
  const pc = (n) => (((absv(n) % 12) + 12) % 12);
  const mod12 = (x) => (((x % 12) + 12) % 12);

  function accStr(acc) {
    if (acc === 0) return '';
    return acc > 0 ? SHARP.repeat(acc) : FLAT.repeat(-acc);
  }

  const noteName = (n) => LETTERS[n.letter] + accStr(n.acc);

  /* Move by a diatonic letter distance and a semitone distance at once, which
   * keeps the spelling honest (letterSteps 2 + 3 semitones is always a minor
   * third, never an augmented second). */
  function step(n, letterSteps, semis) {
    const li = n.letter + letterSteps;
    const letter = ((li % 7) + 7) % 7;
    const base = LETTER_SEMI[letter] + 12 * Math.floor(li / 7);
    return nt(letter, absv(n) + semis - base);
  }

  const fifthAbove = (n) => step(n, 4, 7);
  const fourthAbove = (n) => step(n, 3, 5);
  const semitoneBelow = (n) => step(n, -1, -1);
  const majorSecondAbove = (n) => step(n, 1, 2);
  const minorSecondAbove = (n) => step(n, 1, 1);
  const dimFifthAbove = (n) => step(n, 4, 6);

  /* MIDI number for playback. C4 = 60. */
  const midiOf = (n, octave) => absv(n) + 12 * (octave + 1);

  function parseNote(str) {
    const letter = LETTERS.indexOf(str[0].toUpperCase());
    if (letter < 0) return null;
    let acc = 0;
    for (const ch of str.slice(1)) {
      if (ch === '#' || ch === SHARP) acc += 1;
      else if (ch === 'b' || ch === FLAT) acc -= 1;
    }
    return nt(letter, acc);
  }

  // --------------------------------------------------------------- scales ---

  function scale(tonic, mode) {
    const steps = SCALE_STEPS[mode];
    return steps.map((semis, i) => step(tonic, i, semis));
  }

  /* How many sharps (+) or flats (-) the key signature carries. */
  function keySignature(tonic, mode) {
    const notes = scale(tonic, mode);
    let sharps = 0;
    let flats = 0;
    notes.forEach((n) => {
      if (n.acc > 0) sharps += n.acc;
      if (n.acc < 0) flats -= n.acc;
    });
    return sharps > 0 ? sharps : -flats;
  }

  // --------------------------------------------------------------- chords ---

  const TRIADS = {
    maj: { intervals: [0, 4, 7], suffix: '', roman: (r) => r.toUpperCase() },
    min: { intervals: [0, 3, 7], suffix: 'm', roman: (r) => r.toLowerCase() },
    dim: { intervals: [0, 3, 6], suffix: 'dim', roman: (r) => r.toLowerCase() + '°' },
    aug: { intervals: [0, 4, 8], suffix: 'aug', roman: (r) => r.toUpperCase() + '+' }
  };

  const SEVENTHS = {
    maj7: { intervals: [0, 4, 7, 11], suffix: 'maj7', romanSuffix: 'maj7' },
    dom7: { intervals: [0, 4, 7, 10], suffix: '7', romanSuffix: '7' },
    min7: { intervals: [0, 3, 7, 10], suffix: 'm7', romanSuffix: '7' },
    minMaj7: { intervals: [0, 3, 7, 11], suffix: 'mMaj7', romanSuffix: 'maj7' },
    halfDim7: { intervals: [0, 3, 6, 10], suffix: 'm7' + FLAT + '5', romanSuffix: 'ø7' },
    dim7: { intervals: [0, 3, 6, 9], suffix: 'dim7', romanSuffix: '°7' },
    augMaj7: { intervals: [0, 4, 8, 11], suffix: 'maj7' + SHARP + '5', romanSuffix: 'maj7' },
    aug7: { intervals: [0, 4, 8, 10], suffix: '7' + SHARP + '5', romanSuffix: '7' }
  };

  function triadQuality(i3, i5) {
    if (i3 === 4 && i5 === 7) return 'maj';
    if (i3 === 3 && i5 === 7) return 'min';
    if (i3 === 3 && i5 === 6) return 'dim';
    if (i3 === 4 && i5 === 8) return 'aug';
    return 'maj';
  }

  function seventhQuality(triad, i7) {
    if (triad === 'maj') return i7 === 11 ? 'maj7' : 'dom7';
    if (triad === 'min') return i7 === 11 ? 'minMaj7' : 'min7';
    if (triad === 'dim') return i7 === 9 ? 'dim7' : 'halfDim7';
    return i7 === 11 ? 'augMaj7' : 'aug7';
  }

  /* Build a chord object from four spelled notes (the 7th is optional). */
  function makeChord(notes, opts = {}) {
    const [root, third, fifth, seventh] = notes;
    const i3 = mod12(absv(third) - absv(root));
    const i5 = mod12(absv(fifth) - absv(root));
    const triad = triadQuality(i3, i5);
    const sev = seventh ? seventhQuality(triad, mod12(absv(seventh) - absv(root))) : null;

    const chord = {
      root,
      triadNotes: [root, third, fifth],
      seventhNote: seventh || null,
      quality: triad,
      seventhQuality: sev,
      symbol: noteName(root) + TRIADS[triad].suffix,
      symbol7: seventh ? noteName(root) + SEVENTHS[sev].suffix : null,
      isMajorish: triad === 'maj' || triad === 'aug'
    };

    chord.notes = seventh ? [root, third, fifth, seventh] : chord.triadNotes;
    Object.assign(chord, opts);
    return chord;
  }

  /* Stack thirds out of a scale, starting at degree `deg` (0-indexed). */
  function chordFromScale(scaleNotes, deg, withSeventh = true) {
    const pick = (i) => scaleNotes[(deg + i) % 7];
    const notes = [pick(0), pick(2), pick(4)];
    if (withSeventh) notes.push(pick(6));
    return makeChord(notes);
  }

  /* Build a chord of an arbitrary quality on an arbitrary root. */
  function chordOn(root, quality, seventhType) {
    const spec = TRIADS[quality];
    const third = step(root, 2, spec.intervals[1]);
    const fifth = step(root, 4, spec.intervals[2]);
    const notes = [root, third, fifth];
    if (seventhType) notes.push(step(root, 6, SEVENTHS[seventhType].intervals[3]));
    return makeChord(notes);
  }

  // --------------------------------------------------------- typed chords ---

  /*
   * Chords a player types rather than picks off the grid: C/G, E♭maj7♯11, Am9,
   * F♯m7♭5, Dsus4. The point of parsing them into spelled notes rather than
   * pitch classes is the same as everywhere else in this file — the ♯11 of
   * E♭maj7 is an A, and calling it a B♭♭ would be a different note on paper
   * even though it sounds identical.
   *
   * Each chord tone is a letter distance plus a semitone distance, so a ♭9 is
   * always a ninth and never an augmented octave.
   */
  const CHORD_TONES = {
    root: [0, 0],
    maj3: [2, 4], min3: [2, 3], sus2: [1, 2], sus4: [3, 5],
    dim5: [4, 6], per5: [4, 7], aug5: [4, 8],
    six: [5, 9],
    dim7: [6, 9], min7: [6, 10], maj7: [6, 11],
    nine: [8, 14], eleven: [10, 17], thirteen: [12, 21]
  };

  /* One pass over the part of the symbol after the root. Returns null the
   * moment it meets something it cannot account for: a chord box that silently
   * ignores half of what you typed is worse than one that says it cannot read
   * it. */
  function scanChordBody(ascii) {
    let s = ascii;
    const spec = {
      third: 'maj3', fifth: 'per5', seventh: null,
      six: false, tensions: [], drop: {}
    };
    let ext = 0;
    let sawDim = false;

    const eat = (re) => {
      const m = re.exec(s);
      if (m) s = s.slice(m[0].length);
      return m;
    };
    const alter = (degree, offset) => {
      spec.tensions = spec.tensions.filter((tn) => tn.degree !== degree);
      spec.tensions.push({ degree, offset });
    };

    // The quality sits first, if it is spelled out at all. "m" is minor and
    // "M" is a major seventh, so this stretch is deliberately case-sensitive.
    if (eat(/^(maj|Maj|MAJ)(?![a-z])/) || eat(/^M(?=\d)/)) spec.seventh = 'maj7';
    else if (eat(/^(min|Min|m|-)(?!aj)/)) spec.third = 'min3';
    else if (eat(/^(dim|Dim|o(?=7|$))/)) { spec.third = 'min3'; spec.fifth = 'dim5'; sawDim = true; }
    else if (eat(/^(aug|Aug|\+)/)) spec.fifth = 'aug5';

    while (s) {
      let m;
      if (eat(/^(maj|Maj|MAJ)(?![a-z])/) || eat(/^M(?=\d)/)) { spec.seventh = 'maj7'; continue; }
      if ((m = eat(/^sus([24]?)/))) { spec.third = m[1] === '2' ? 'sus2' : 'sus4'; continue; }
      if ((m = eat(/^add(2|4|6|9|11|13)/))) {
        const d = parseInt(m[1], 10);
        if (d === 6) spec.six = true;
        else alter(d === 2 ? 9 : d === 4 ? 11 : d, 0);
        continue;
      }
      if (eat(/^(6\/9|69)/)) { spec.six = true; alter(9, 0); continue; }
      if ((m = eat(/^(13|11|9|7|6)/))) {
        const n = parseInt(m[1], 10);
        if (n === 6) spec.six = true;
        else ext = Math.max(ext, n);
        continue;
      }
      if ((m = eat(/^([b#])(5|6|9|11|13)/))) {
        const off = m[1] === '#' ? 1 : -1;
        const d = parseInt(m[2], 10);
        if (d === 5) spec.fifth = off > 0 ? 'aug5' : 'dim5';
        else if (d === 6) spec.six = true;
        /* An altered tension asks for itself and for the seventh underneath
         * it, but not for the tensions in between: ♭III maj7♯11 is a lydian
         * colour, and throwing in a ninth nobody asked for changes it. */
        else { alter(d, off); ext = Math.max(ext, 7); }
        continue;
      }
      if ((m = eat(/^(?:no|omit)([35])/))) { spec.drop[m[1]] = true; continue; }
      return null; // something we do not understand — say so rather than guess
    }

    /* A numbered extension implies the seventh and the tensions below it —
     * with one exception every player knows: a 13th chord leaves out the 11th,
     * because a natural 11 sits a semitone above a major third. */
    if (ext >= 7) {
      if (!spec.seventh) spec.seventh = sawDim ? 'dim7' : 'min7';
      if (ext >= 9) alterIfAbsent(spec, 9);
      if (ext === 11) alterIfAbsent(spec, 11);
      if (ext >= 13) alterIfAbsent(spec, 13);
    } else if (spec.seventh && ext === 0 && !spec.six) {
      // "Cmaj" on its own is a plain triad; "Cmaj7" reaches here with ext 7.
      spec.seventh = null;
    }
    if (sawDim && spec.seventh === 'min7' && ext === 7) spec.seventh = 'dim7';
    return spec;
  }

  function alterIfAbsent(spec, degree) {
    if (!spec.tensions.some((tn) => tn.degree === degree)) spec.tensions.push({ degree, offset: 0 });
  }

  const TENSION_TONE = { 9: 'nine', 11: 'eleven', 13: 'thirteen' };

  /* Build a chord from a root, the text after it, and an optional slash bass.
   * Returns null when the body is not readable as a chord. */
  function typedChord(root, body, bass) {
    const ascii = String(body || '').replace(/♯/g, '#').replace(/♭/g, 'b');
    const spec = scanChordBody(ascii);
    if (!spec) return null;

    const at = (tone, extra = 0) => step(root, CHORD_TONES[tone][0], CHORD_TONES[tone][1] + extra);
    const notes = [root];
    const third = spec.drop['3'] && spec.third !== 'sus2' && spec.third !== 'sus4' ? null : at(spec.third);
    const fifth = spec.drop['5'] ? null : at(spec.fifth);
    if (third) notes.push(third);
    if (fifth) notes.push(fifth);
    if (spec.six) notes.push(at('six'));
    if (spec.seventh) notes.push(at(spec.seventh));
    spec.tensions
      .slice()
      .sort((a, b) => a.degree - b.degree)
      .forEach((tn) => notes.push(at(TENSION_TONE[tn.degree], tn.offset)));

    // The triad quality still drives the numeral and the number suffix, so a
    // sus chord borrows the major casing it is usually written with.
    const i3 = third ? mod12(absv(third) - absv(root)) : 4;
    const i5 = fifth ? mod12(absv(fifth) - absv(root)) : 7;
    const quality = triadQuality(i3, i5);
    const sev = spec.seventh
      ? seventhQuality(quality, mod12(absv(at(spec.seventh)) - absv(root)))
      : null;

    /* The root is respelled for display, so the rest of the symbol is tidied to
     * match. Case is left alone on a bare m or M, where it is the whole
     * difference between a minor chord and a major seventh. */
    const pretty = String(body || '')
      .replace(/#/g, SHARP)
      .replace(/b(?=\d)/g, FLAT)
      .replace(/(MAJ|Maj)(?![a-z])/g, 'maj')
      .replace(/(MIN|Min)(?![a-z])/g, 'min')
      .replace(/DIM|Dim/g, 'dim')
      .replace(/AUG|Aug/g, 'aug')
      .replace(/SUS|Sus/g, 'sus')
      .replace(/ADD|Add/g, 'add');
    const name = noteName(root) + pretty + (bass ? '/' + noteName(bass) : '');

    return {
      root,
      bass: bass || null,
      notes,
      triadNotes: [root, third || at('maj3'), fifth || at('per5')],
      seventhNote: spec.seventh ? at(spec.seventh) : null,
      quality,
      seventhQuality: sev,
      isMajorish: quality === 'maj' || quality === 'aug',
      typedBody: pretty,
      symbol: name,
      symbol7: name,
      display: name
    };
  }

  /* Read a whole chord symbol, root and all. */
  function parseChordSymbol(text) {
    if (typeof text !== 'string') return null;
    let s = text.trim()
      .replace(/\s+/g, '')
      .replace(/[Δ∆]/g, 'maj')
      .replace(/[°º]/g, 'dim')
      .replace(/ø/g, 'm7b5')
      .replace(/[–—]/g, '-');
    if (!s) return null;

    let bass = null;
    const slash = s.indexOf('/');
    // "6/9" is a chord quality, not a slash bass.
    if (slash >= 0 && !/^6\/9/.test(s.slice(slash - 1))) {
      const tail = s.slice(slash + 1);
      if (!/^[A-Ga-g][#b♯♭]*$/.test(tail)) return null;
      bass = parseNote(tail);
      s = s.slice(0, slash);
    }

    const rootText = /^[A-Ga-g][#b♯♭]*/.exec(s);
    if (!rootText) return null;
    const root = parseNote(rootText[0]);
    return typedChord(root, s.slice(rootText[0].length), bass);
  }

  // ------------------------------------------------------- roman numerals ---

  /* Where a note sits in a reference scale: its degree, and the accidental
   * prefix that says how far it is from the scale's own version of it. */
  function degreeOf(note, refScale) {
    const deg = (((note.letter - refScale[0].letter) % 7) + 7) % 7;
    let diff = mod12(pc(note) - pc(refScale[deg]));
    if (diff > 6) diff -= 12;
    return { deg, prefix: diff < 0 ? FLAT.repeat(-diff) : diff > 0 ? SHARP.repeat(diff) : '' };
  }

  /* Roman numeral for a chord, measured against a reference scale. Chords that
   * sit outside the scale pick up a flat/sharp prefix (bVI, #iv...). */
  function romanFor(chord, refScale, opts = {}) {
    const { deg, prefix } = degreeOf(chord.root, refScale);
    let numeral = TRIADS[chord.quality].roman(ROMAN[deg]);
    if (opts.seventh && chord.seventhQuality) {
      const suffix = SEVENTHS[chord.seventhQuality].romanSuffix;
      // Half-diminished and diminished sevenths carry their own symbol.
      if (suffix === 'ø7') numeral = numeral.replace('°', '') + 'ø7';
      else if (suffix === '°7') numeral = numeral + '7';
      else numeral = numeral + suffix;
    }
    // A slash chord names both ends in the same system: I/V, not I/G.
    if (chord.bass && pc(chord.bass) !== pc(chord.root)) {
      const b = degreeOf(chord.bass, refScale);
      numeral += '/' + b.prefix + ROMAN[b.deg];
    }
    return prefix + numeral;
  }

  /* The number system: the degree number carries a suffix naming the chord
   * family — 1 major, 2- minor, 5D dominant, 7-♭5 half-diminished.
   *
   * The family is a property of the seventh, not the triad: a major triad and
   * a dominant are the same three notes, and only the seventh tells them
   * apart. So the suffix is chosen from the seventh quality wherever the chord
   * has one, and falls back to the triad when it does not. */
  const NUMBER_SUFFIX = {
    maj7: '',
    dom7: 'D',
    min7: '-',
    halfDim7: '-' + FLAT + '5',
    dim7: '°',
    minMaj7: '-maj7',
    augMaj7: '+',
    aug7: '+D'
  };

  /* Without a seventh a major triad is just major — nothing marks it as a
   * dominant, so it is not labelled as one. */
  const NUMBER_SUFFIX_TRIAD = { maj: '', min: '-', dim: '-' + FLAT + '5', aug: '+' };

  function numberFor(chord, refScale) {
    const { deg, prefix } = degreeOf(chord.root, refScale);
    const suffix = chord.seventhQuality
      ? NUMBER_SUFFIX[chord.seventhQuality]
      : NUMBER_SUFFIX_TRIAD[chord.quality];
    let out = prefix + (deg + 1) + suffix;
    if (chord.bass && pc(chord.bass) !== pc(chord.root)) {
      const b = degreeOf(chord.bass, refScale);
      out += '/' + b.prefix + (b.deg + 1);
    }
    return out;
  }

  // ------------------------------------------------------------ functions ---

  /* Names are the presentation layer's business: this layer emits keys and
   * lets the translation table turn them into words. */
  const DEGREE_KEYS = ['tonic', 'supertonic', 'mediant', 'subdominant', 'dominant', 'submediant', 'leading'];

  const FUNCTION_BY_DEGREE = {
    major: ['tonic', 'predominant', 'tonic', 'predominant', 'dominant', 'tonic', 'dominant'],
    minor: ['tonic', 'predominant', 'tonic', 'predominant', 'dominant', 'predominant', 'dominant']
  };

  function degreeKey(scaleNotes, deg) {
    if (deg === 6) {
      const gap = mod12(pc(scaleNotes[0]) - pc(scaleNotes[6]));
      return gap === 1 ? 'leading' : 'subtonic';
    }
    return DEGREE_KEYS[deg];
  }

  // ------------------------------------------------------------- the key ---

  /* Everything the UI needs about one key, computed once per selection. */
  function buildKey(tonic, mode) {
    const scaleNotes = scale(tonic, mode);
    const parallelMode = mode === 'major' ? 'minor' : 'major';
    const parallelScale = scale(tonic, parallelMode);

    const diatonic = scaleNotes.map((_, deg) => {
      const chord = chordFromScale(scaleNotes, deg);
      chord.degree = deg;
      chord.roman = romanFor(chord, scaleNotes);
      chord.roman7 = romanFor(chord, scaleNotes, { seventh: true });
      chord.number = numberFor(chord, scaleNotes);
      chord.degreeKey = degreeKey(scaleNotes, deg);
      chord.fn = FUNCTION_BY_DEGREE[mode][deg];
      chord.id = 'deg' + deg;
      return chord;
    });

    // The relative key: vi of a major key, III of a minor key.
    const relativeDeg = mode === 'major' ? 5 : 2;
    const relativeMode = parallelMode;
    const relativeTonic = scaleNotes[relativeDeg];
    const relativeScale = scale(relativeTonic, relativeMode);
    const relativeDiatonic = relativeScale.map((_, deg) => {
      const chord = chordFromScale(relativeScale, deg);
      chord.degree = deg;
      chord.roman = romanFor(chord, relativeScale);
      chord.roman7 = romanFor(chord, relativeScale, { seventh: true });
      chord.number = numberFor(chord, relativeScale);
      chord.degreeKey = degreeKey(relativeScale, deg);
      chord.fn = FUNCTION_BY_DEGREE[relativeMode][deg];
      return chord;
    });

    return {
      tonic,
      mode,
      tonicName: noteName(tonic),
      shortName: noteName(tonic) + (mode === 'major' ? '' : 'm'),
      scaleNotes,
      signature: keySignature(tonic, mode),
      diatonic,
      parallel: { tonic, mode: parallelMode, scaleNotes: parallelScale },
      relative: {
        tonic: relativeTonic,
        mode: relativeMode,
        tonicName: noteName(relativeTonic),
        shortName: noteName(relativeTonic) + (relativeMode === 'major' ? '' : 'm'),
        scaleNotes: relativeScale,
        diatonic: relativeDiatonic,
        degreeInHome: relativeDeg
      }
    };
  }

  // --------------------------------------------------- secondary dominants ---

  /* A secondary dominant and its whole approach kit for one target chord. */
  function secondaryFor(key, target) {
    const domRoot = fifthAbove(target.root);
    const dominant = chordOn(domRoot, 'maj', 'dom7');
    dominant.roman = 'V7/' + stripSeventh(target.roman);

    // The ii that sets it up: minor if the target is major, half-diminished if
    // the target is minor or diminished.
    const twoRoot = majorSecondAbove(target.root);
    const targetIsMinorish = !target.isMajorish;
    const two = targetIsMinorish
      ? chordOn(twoRoot, 'dim', 'halfDim7')
      : chordOn(twoRoot, 'min', 'min7');
    two.roman = (targetIsMinorish ? 'iiø7/' : 'ii7/') + stripSeventh(target.roman);

    // Tritone substitute: same tritone, root a diminished fifth away.
    const subRoot = dimFifthAbove(domRoot);
    const sub = chordOn(subRoot, 'maj', 'dom7');
    sub.roman = FLAT + 'II7/' + stripSeventh(target.roman);

    // Secondary leading-tone diminished seventh.
    const ltRoot = semitoneBelow(target.root);
    const leadingTone = chordOn(ltRoot, 'dim', 'dim7');
    leadingTone.roman = 'vii°7/' + stripSeventh(target.roman);

    // The two voices that do the actual work: the dominant's 3rd rises to the
    // target root, its 7th falls to the target third.
    const resolution = {
      third: { from: dominant.notes[1], to: target.root },
      seventh: { from: dominant.notes[3], to: target.notes[1] }
    };

    // These four are defined by their sevenths, so always show them that way.
    [dominant, two, sub, leadingTone].forEach((c) => { c.display = c.symbol7; });

    return { target, dominant, two, sub, leadingTone, resolution };
  }

  function stripSeventh(roman) {
    return roman.replace(/(maj7|ø7|7)$/, '');
  }

  /* Every target worth having a secondary dominant: skip the tonic (that is
   * just V) and skip the diminished chord (its "dominant" resolves nowhere). */
  function secondaryDominants(key) {
    return key.diatonic
      .filter((c) => c.degree !== 0 && c.quality !== 'dim')
      .map((c) => secondaryFor(key, c));
  }

  // ------------------------------------------------------ modal interchange ---

  function borrowedChords(key) {
    const parallelScale = key.parallel.scaleNotes;
    const out = [];

    parallelScale.forEach((_, deg) => {
      const chord = chordFromScale(parallelScale, deg);
      // Skip anything the home key already has (same root, same quality).
      const home = key.diatonic[deg];
      if (pc(chord.root) === pc(home.root) && chord.quality === home.quality) return;
      chord.roman = romanFor(chord, key.scaleNotes);
      chord.roman7 = romanFor(chord, key.scaleNotes, { seventh: true });
      chord.number = numberFor(chord, key.scaleNotes);
      chord.noteKey = 'borrow.' + key.mode + '.' + deg;
      chord.sourceKey = 'source.parallel.' + key.parallel.mode;
      chord.replaces = home;
      out.push(chord);
    });

    // The Neapolitan is not diatonic to either parallel scale, but it belongs
    // in any list of borrowed colour.
    const neapolitan = chordOn(minorSecondAbove(key.tonic), 'maj', 'maj7');
    neapolitan.roman = FLAT + 'II';
    neapolitan.number = FLAT + '2';
    neapolitan.noteKey = 'borrow.neapolitan';
    neapolitan.sourceKey = 'source.chromatic';
    out.push(neapolitan);

    return out;
  }

  // ------------------------------------------------------------ pivoting ---

  /* Relative-key pivots: the two keys share all seven chords, so every chord
   * is a pivot. What changes is the function it carries on each side. */
  function relativePivots(key) {
    return key.diatonic.map((chord) => {
      const match = key.relative.diatonic.find((c) => pc(c.root) === pc(chord.root));
      return {
        chord,
        homeRoman: chord.roman,
        relativeRoman: match ? match.roman : '—',
        homeFn: chord.fn,
        relativeFn: match ? match.fn : null
      };
    });
  }

  /* Concrete routes into and out of the relative key, phrased as chord chains. */
  function relativeRoutes(key) {
    const rel = key.relative;
    const relTonic = rel.diatonic[0];
    const homeTonic = key.diatonic[0];

    // Dominant of the relative tonic (harmonic-minor V7 when going to a minor key).
    const relDom = chordOn(fifthAbove(rel.tonic), 'maj', 'dom7');
    const relTwo = rel.mode === 'minor'
      ? chordOn(majorSecondAbove(rel.tonic), 'dim', 'halfDim7')
      : chordOn(majorSecondAbove(rel.tonic), 'min', 'min7');

    const homeDom = key.diatonic[4].isMajorish
      ? chordFromScale(key.scaleNotes, 4)
      : chordOn(fifthAbove(key.tonic), 'maj', 'dom7');
    const homeTwo = Object.assign({}, key.diatonic[1]);
    [relDom, relTwo, homeDom, homeTwo].forEach((c) => { c.display = c.symbol7; });

    // A pivot chord that is pre-dominant on both sides reads most smoothly.
    const pivot = key.diatonic[3];
    const pivotRel = rel.diatonic.find((c) => pc(c.root) === pc(pivot.root));

    return {
      into: [
        {
          key: 'route.into.dominant',
          chords: [homeTonic, relDom, relTonic],
          params: {
            dom: relDom.symbol7,
            roman: 'V7/' + stripSeventh(key.diatonic[rel.degreeInHome].roman),
            target: relTonic.symbol
          }
        },
        {
          key: 'route.into.twoFive',
          chords: [homeTonic, relTwo, relDom, relTonic],
          params: { two: relTwo.symbol7, dom: relDom.symbol7, target: relTonic.symbol }
        },
        {
          key: 'route.into.pivot',
          chords: [homeTonic, pivot, relDom, relTonic],
          params: {
            pivot: pivot.symbol,
            homeRoman: pivot.roman,
            relRoman: pivotRel ? pivotRel.roman : '—',
            dom: relDom.symbol7
          }
        }
      ],
      out: [
        {
          key: 'route.out.dominant',
          chords: [relTonic, homeDom, homeTonic],
          params: { dom: homeDom.symbol7 || homeDom.symbol, target: homeTonic.symbol }
        },
        {
          key: 'route.out.twoFive',
          chords: [relTonic, homeTwo, homeDom, homeTonic],
          params: { two: homeTwo.symbol7, dom: homeDom.symbol7 || homeDom.symbol, target: homeTonic.symbol }
        },
        {
          key: 'route.out.step',
          chords: [relTonic, key.diatonic[6], homeTonic],
          params: { from: rel.shortName, via: key.diatonic[6].symbol, target: homeTonic.symbol }
        }
      ],
      relDom,
      relTwo,
      homeDom
    };
  }

  // ------------------------------------------------- per-chord relationships ---

  /* Everything about how to arrive at, and leave from, one selected chord. */
  function chordContext(key, chord) {
    const sec = secondaryFor(key, chord);
    const deg = chord.degree;
    const isTonic = deg === 0;

    // Approaches
    const approaches = [];
    if (!isTonic && chord.quality !== 'dim') {
      approaches.push({
        key: 'approach.secondary',
        chord: sec.dominant,
        label: sec.dominant.roman,
        params: {
          chord: chord.symbol,
          thirdFrom: noteName(sec.resolution.third.from),
          thirdTo: noteName(sec.resolution.third.to),
          seventhFrom: noteName(sec.resolution.seventh.from),
          seventhTo: noteName(sec.resolution.seventh.to)
        }
      });
      approaches.push({
        key: 'approach.twoFive',
        chord: sec.two,
        label: sec.two.roman,
        params: { two: sec.two.symbol7, dom: sec.dominant.symbol7, chord: chord.symbol },
        chain: [sec.two, sec.dominant, chord]
      });
      approaches.push({
        key: 'approach.tritone',
        chord: sec.sub,
        label: sec.sub.roman,
        params: { dom: sec.dominant.symbol7, root: noteName(chord.root) }
      });
      approaches.push({
        key: 'approach.leadingTone',
        chord: sec.leadingTone,
        label: sec.leadingTone.roman,
        params: {}
      });
    } else if (isTonic) {
      const five = Object.assign({}, key.diatonic[4], { display: key.diatonic[4].symbol7 });
      const four = key.diatonic[3];
      approaches.push({
        key: 'approach.authentic',
        chord: five,
        label: five.roman7,
        params: { dom: five.symbol7 || five.symbol, chord: chord.symbol }
      });
      approaches.push({
        key: 'approach.plagal',
        chord: four,
        label: four.roman,
        params: { four: four.symbol, chord: chord.symbol }
      });
      const backdoor = chordOn(step(key.tonic, 6, 10), 'maj', 'dom7');
      backdoor.display = backdoor.symbol7;
      backdoor.roman = FLAT + 'VII7';
      approaches.push({
        key: 'approach.backdoor',
        chord: backdoor,
        label: FLAT + 'VII7',
        params: { backdoor: backdoor.symbol7, chord: chord.symbol }
      });
    }

    // Departures — where this chord naturally wants to go inside the key.
    const departures = [];
    const push = (targetDeg, k, params, chain) => {
      const t = key.diatonic[targetDeg];
      departures.push({ chord: t, label: t.roman, key: k, params: params || {}, chain: chain || null });
    };
    if (chord.fn === 'tonic') {
      push(3, 'depart.tonic.predominant');
      push(4, 'depart.tonic.dominant');
      /* Spelled out from the actual chords rather than a fixed "ii – V – I",
       * because in a minor key the route reads i – iiø – v – i. */
      const jazz = [chord, key.diatonic[1], key.diatonic[4], key.diatonic[0]];
      push(1, 'depart.tonic.jazz', { route: jazz.map((c) => c.roman).join(' – ') }, jazz);
    } else if (chord.fn === 'predominant') {
      push(4, 'depart.predominant.dominant');
      push(0, 'depart.predominant.tonic');
      push(6, 'depart.predominant.leadingTone');
    } else {
      push(0, 'depart.dominant.resolve');
      push(5, 'depart.dominant.deceptive');
      push(3, 'depart.dominant.again');
    }

    // This chord acting as a dominant of something else.
    const asDominantTargetRoot = fourthAbove(chord.root);
    const asDominantTarget = key.diatonic.find((c) => pc(c.root) === pc(asDominantTargetRoot));
    const asDominant = chordOn(chord.root, 'maj', 'dom7');
    asDominant.display = asDominant.symbol7;
    asDominant.roman = asDominantTarget ? 'V7/' + stripSeventh(asDominantTarget.roman) : 'V7';

    // Modal interchange substitute for this exact chord.
    const parallelChord = chordFromScale(key.parallel.scaleNotes, deg);
    let interchange = null;
    if (pc(parallelChord.root) !== pc(chord.root) || parallelChord.quality !== chord.quality) {
      parallelChord.roman = romanFor(parallelChord, key.scaleNotes);
      parallelChord.roman7 = romanFor(parallelChord, key.scaleNotes, { seventh: true });
      interchange = {
        chord: parallelChord,
        key: 'detail.interchange.text',
        params: {
          chord: chord.symbol,
          swap: parallelChord.symbol,
          roman: parallelChord.roman,
          parallelMode: key.parallel.mode,
          tonic: noteName(key.tonic)
        }
      };
    }

    // Role in the relative key.
    const relMatch = key.relative.diatonic.find((c) => pc(c.root) === pc(chord.root));

    /* A minor relative key borrows a leading tone for its dominant; a major one
     * already has it. Either way the sentence names a three-chord route, so it
     * hands over all three to be played. */
    const relDom = key.relative.mode === 'minor'
      ? chordOn(fifthAbove(key.relative.tonic), 'maj', 'dom7')
      : Object.assign({}, key.relative.diatonic[4]);
    relDom.display = relDom.symbol7;

    return {
      approaches,
      departures,
      secondary: sec,
      asDominant: asDominantTarget ? { chord: asDominant, target: asDominantTarget } : null,
      interchange,
      relative: relMatch
        ? {
            roman: relMatch.roman,
            fn: relMatch.fn,
            key: 'detail.relative.text',
            chain: [chord, relDom, key.relative.diatonic[0]],
            params: {
              chord: chord.symbol,
              homeRoman: chord.roman,
              relRoman: relMatch.roman,
              dom: relDom.symbol7,
              target: key.relative.diatonic[0].symbol
            }
          }
        : null
    };
  }

  // ---------------------------------------------------------- progressions ---

  /* Progression templates. Tokens: {d} diatonic degree, {sec} secondary
   * dominant of a degree, {bor} borrowed from the parallel mode, {nea}. */
  const PROGRESSIONS = {
    major: [
      { id: 'axis', tokens: [{ d: 0 }, { d: 4 }, { d: 5 }, { d: 3 }] },
      { id: 'doowop', tokens: [{ d: 0 }, { d: 5 }, { d: 3 }, { d: 4 }] },
      { id: 'twoFiveOne', tokens: [{ d: 1, s: true }, { d: 4, s: true }, { d: 0, s: true }] },
      { id: 'secondaryLift', tokens: [{ d: 0 }, { sec: 1 }, { d: 1, s: true }, { d: 4, s: true }] },
      { id: 'toRelative', tokens: [{ d: 0 }, { d: 3 }, { sec: 5 }, { d: 5 }] },
      { id: 'borrowedFour', tokens: [{ d: 0 }, { d: 3 }, { bor: 3 }, { d: 0 }] },
      { id: 'backdoor', tokens: [{ bor: 3 }, { bor: 6, s: true }, { d: 0, s: true }] },
      { id: 'descending', tokens: [{ d: 0 }, { d: 4 }, { d: 5 }, { d: 2 }, { d: 3 }] }
    ],
    minor: [
      { id: 'naturalLoop', tokens: [{ d: 0 }, { d: 5 }, { d: 2 }, { d: 6 }] },
      { id: 'harmonicCadence', tokens: [{ d: 0 }, { d: 3 }, { bor: 4 }, { d: 0 }] },
      { id: 'twoFiveOne', tokens: [{ d: 1, s: true }, { bor: 4, s: true }, { d: 0, s: true }] },
      { id: 'andalusian', tokens: [{ d: 0 }, { d: 6 }, { d: 5 }, { bor: 4 }] },
      { id: 'toRelative', tokens: [{ d: 0 }, { d: 5 }, { sec: 2 }, { d: 2 }] },
      { id: 'dorian', tokens: [{ d: 0 }, { bor: 3 }, { d: 0 }, { d: 6 }] },
      { id: 'picardy', tokens: [{ d: 0 }, { d: 3 }, { bor: 4, s: true }, { bor: 0 }] },
      { id: 'neapolitan', tokens: [{ d: 0 }, { nea: true }, { bor: 4, s: true }, { d: 0 }] }
    ]
  };

  function resolveToken(key, token) {
    if (token.nea) {
      const c = chordOn(minorSecondAbove(key.tonic), 'maj', 'maj7');
      c.roman = FLAT + 'II';
      c.display = c.symbol;
      return c;
    }
    if (token.sec !== undefined) {
      const target = key.diatonic[token.sec];
      const c = chordOn(fifthAbove(target.root), 'maj', 'dom7');
      c.roman = 'V7/' + stripSeventh(target.roman);
      c.display = c.symbol7;
      return c;
    }
    if (token.bor !== undefined) {
      const c = chordFromScale(key.parallel.scaleNotes, token.bor);
      c.roman = romanFor(c, key.scaleNotes, { seventh: !!token.s });
      c.display = token.s ? c.symbol7 : c.symbol;
      return c;
    }
    const c = key.diatonic[token.d];
    const copy = Object.assign({}, c);
    copy.roman = token.s ? c.roman7 : c.roman;
    copy.display = token.s ? c.symbol7 : c.symbol;
    copy.notes = token.s ? c.notes : c.triadNotes;
    return copy;
  }

  function progressions(key) {
    return PROGRESSIONS[key.mode].map((p) => ({
      nameKey: 'prog.' + key.mode + '.' + p.id + '.name',
      noteKey: 'prog.' + key.mode + '.' + p.id + '.note',
      chords: p.tokens.map((t) => resolveToken(key, t))
    }));
  }

  // ----------------------------------------------------------- song mode ---

  /* The songwriting grid puts the diatonic chords in reach-order rather than
   * scale-order: tonic first, then the chords you actually reach for next. */
  const SONG_ORDER = [0, 5, 3, 1, 4, 2, 6]; // I vi IV ii V iii vii

  /* Which chord from the parallel mode sits under each column of the grid,
   * keyed by position in SONG_ORDER rather than by scale degree. In a major
   * key that reads ♭III under I, ♭VI under IV, iv under ii, ♭VII under V and
   * ii° under vii, with nothing under vi or iii. */
  const SONG_INTERCHANGE = {
    0: 2, // ♭III under I
    2: 5, // ♭VI  under IV
    3: 3, // iv   under ii
    4: 6, // ♭VII under V
    6: 1  // ii°  under vii
  };

  function songLayout(key) {
    return SONG_ORDER.map((degree, pos) => {
      const main = key.diatonic[degree];

      // Each column gets the dominant seventh a fifth above it — over the tonic
      // that is simply V7 rather than a secondary dominant. The diminished
      // chord gets none: it is not a key you can tonicize, so its column stays
      // empty rather than offering a dominant that resolves nowhere.
      let secondary = null;
      if (main.quality !== 'dim') {
        secondary = chordOn(fifthAbove(main.root), 'maj', 'dom7');
        // The chord is named as the seventh it is, but the numeral stays plain:
        // V/ii says what the chord is for without restating its quality.
        secondary.display = secondary.symbol7;
        secondary.roman = degree === 0 ? 'V' : 'V/' + stripSeventh(main.roman);
        secondary.number = numberFor(secondary, key.scaleNotes);
      }

      let interchange = null;
      const borrowedDegree = SONG_INTERCHANGE[pos];
      if (borrowedDegree !== undefined) {
        interchange = chordFromScale(key.parallel.scaleNotes, borrowedDegree);
        // Numeral without the seventh, and no display override, so the name
        // follows the sevenths toggle exactly as the main row does.
        interchange.roman = romanFor(interchange, key.scaleNotes);
        interchange.number = numberFor(interchange, key.scaleNotes);
      }

      return { pos, degree, main, secondary, interchange };
    });
  }

  /* The distance from one note to another as a letter step plus a semitone
   * step — the exact pair step() needs to walk back, so the spelling survives
   * the round trip. */
  function intervalBetween(from, to) {
    const deg = (((to.letter - from.letter) % 7) + 7) % 7;
    const li = from.letter + deg;
    const base = LETTER_SEMI[((li % 7) + 7) % 7] + 12 * Math.floor(li / 7);
    return { deg, semis: to.acc + base - absv(from) };
  }

  /* A typed chord is stored as its distance from the tonic rather than as a
   * chord, for the same reason a grid chord is stored as a grid position: the
   * progression then transposes with the key instead of being stranded in
   * whichever key it was typed in. */
  function typedSlot(key, chord) {
    const root = intervalBetween(key.tonic, chord.root);
    const slot = { row: 'typed', deg: root.deg, semis: root.semis, body: chord.typedBody };
    if (chord.bass) {
      const b = intervalBetween(key.tonic, chord.bass);
      slot.bassDeg = b.deg;
      slot.bassSemis = b.semis;
    }
    return slot;
  }

  function typedChordAt(key, slot) {
    const root = step(key.tonic, slot.deg, slot.semis);
    const bass = slot.bassDeg === undefined ? null : step(key.tonic, slot.bassDeg, slot.bassSemis);
    const chord = typedChord(root, slot.body, bass);
    if (!chord) return null;
    chord.roman = romanFor(chord, key.scaleNotes);
    chord.roman7 = chord.roman;
    chord.number = numberFor(chord, key.scaleNotes);
    return chord;
  }

  /* Resolve a saved progression slot back to a chord in the current key, which
   * is what lets a progression transpose when the key changes. */
  function songChordAt(key, slot) {
    if (slot.row === 'typed') return typedChordAt(key, slot);
    const col = songLayout(key)[slot.pos];
    if (!col) return null;
    return col[slot.row] || null;
  }

  // ------------------------------------------------------------- voicing ---

  /* Turn a chord into MIDI notes in a comfortable register for playback. */
  function voice(chord, baseOctave = 3) {
    const rootPc = pc(chord.root);
    const rootMidi = 12 * (baseOctave + 1) + rootPc;
    const out = [rootMidi];
    chord.notes.slice(1).forEach((n) => {
      let m = 12 * (baseOctave + 1) + pc(n);
      while (m <= out[out.length - 1]) m += 12;
      out.push(m);
    });
    out.push(rootMidi + 12);
    /* A slash chord is the same chord with someone else underneath — and
     * underneath has to mean properly underneath. Dropped in just below the
     * stack, a C/G puts its G a fourth under the C and the ear hears a C chord
     * with a low note added rather than a C over G, especially since the root
     * is doubled an octave up as well. So the bass falls until there is at
     * least a minor seventh of clear air above it. The chord itself does not
     * move, which keeps C and C/G in the same register when a progression goes
     * between them. */
    if (chord.bass && pc(chord.bass) !== rootPc) {
      let bassMidi = 12 * baseOctave + pc(chord.bass);
      while (rootMidi - bassMidi < 10) bassMidi -= 12;
      out.unshift(bassMidi);
    }
    return out;
  }

  // --------------------------------------------------------------- keys ---

  const MAJOR_KEYS = ['C', 'D' + FLAT, 'D', 'E' + FLAT, 'E', 'F', 'F' + SHARP, 'G', 'A' + FLAT, 'A', 'B' + FLAT, 'B'];
  const MINOR_KEYS = ['A', 'B' + FLAT, 'B', 'C', 'C' + SHARP, 'D', 'E' + FLAT, 'E', 'F', 'F' + SHARP, 'G', 'G' + SHARP];

  /* Alternative spellings that are still writable key signatures (<= 7 accidentals). */
  const ENHARMONICS = {
    major: {
      ['D' + FLAT]: 'C' + SHARP, ['C' + SHARP]: 'D' + FLAT,
      ['F' + SHARP]: 'G' + FLAT, ['G' + FLAT]: 'F' + SHARP,
      B: 'C' + FLAT, ['C' + FLAT]: 'B'
    },
    minor: {
      ['B' + FLAT]: 'A' + SHARP, ['A' + SHARP]: 'B' + FLAT,
      ['E' + FLAT]: 'D' + SHARP, ['D' + SHARP]: 'E' + FLAT,
      ['G' + SHARP]: 'A' + FLAT, ['A' + FLAT]: 'G' + SHARP
    }
  };

  return {
    SHARP, FLAT, MAJOR_KEYS, MINOR_KEYS, ENHARMONICS,
    nt, noteName, parseNote, pc, step, scale, buildKey, chordOn, chordFromScale,
    romanFor, numberFor, secondaryDominants, secondaryFor, borrowedChords,
    relativePivots, relativeRoutes, chordContext, progressions, voice, midiOf,
    stripSeventh, keySignature, songLayout, songChordAt, SONG_ORDER,
    parseChordSymbol, typedChord, typedSlot, intervalBetween
  };
})();
