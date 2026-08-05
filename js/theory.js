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

  // ------------------------------------------------------- roman numerals ---

  /* Roman numeral for a chord, measured against a reference scale. Chords that
   * sit outside the scale pick up a flat/sharp prefix (bVI, #iv...). */
  function romanFor(chord, refScale, opts = {}) {
    const tonicLetter = refScale[0].letter;
    const deg = (((chord.root.letter - tonicLetter) % 7) + 7) % 7;
    let diff = mod12(pc(chord.root) - pc(refScale[deg]));
    if (diff > 6) diff -= 12;
    const prefix = diff < 0 ? FLAT.repeat(-diff) : diff > 0 ? SHARP.repeat(diff) : '';
    let numeral = TRIADS[chord.quality].roman(ROMAN[deg]);
    if (opts.seventh && chord.seventhQuality) {
      const suffix = SEVENTHS[chord.seventhQuality].romanSuffix;
      // Half-diminished and diminished sevenths carry their own symbol.
      if (suffix === 'ø7') numeral = numeral.replace('°', '') + 'ø7';
      else if (suffix === '°7') numeral = numeral + '7';
      else numeral = numeral + suffix;
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
    const tonicLetter = refScale[0].letter;
    const deg = (((chord.root.letter - tonicLetter) % 7) + 7) % 7;
    let diff = mod12(pc(chord.root) - pc(refScale[deg]));
    if (diff > 6) diff -= 12;
    const prefix = diff < 0 ? FLAT.repeat(-diff) : diff > 0 ? SHARP.repeat(diff) : '';
    const suffix = chord.seventhQuality
      ? NUMBER_SUFFIX[chord.seventhQuality]
      : NUMBER_SUFFIX_TRIAD[chord.quality];
    return prefix + (deg + 1) + suffix;
  }

  // ------------------------------------------------------------ functions ---

  const DEGREE_NAMES = ['Tonic', 'Supertonic', 'Mediant', 'Subdominant', 'Dominant', 'Submediant', 'Leading tone'];

  const FUNCTION_BY_DEGREE = {
    major: ['tonic', 'predominant', 'tonic', 'predominant', 'dominant', 'tonic', 'dominant'],
    minor: ['tonic', 'predominant', 'tonic', 'predominant', 'dominant', 'predominant', 'dominant']
  };

  const FUNCTION_LABEL = { tonic: 'Tonic', predominant: 'Pre-dominant', dominant: 'Dominant' };

  function degreeName(scaleNotes, deg) {
    if (deg === 6) {
      const gap = mod12(pc(scaleNotes[0]) - pc(scaleNotes[6]));
      return gap === 1 ? 'Leading tone' : 'Subtonic';
    }
    return DEGREE_NAMES[deg];
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
      chord.degreeName = degreeName(scaleNotes, deg);
      chord.fn = FUNCTION_BY_DEGREE[mode][deg];
      chord.fnLabel = FUNCTION_LABEL[chord.fn];
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
      chord.degreeName = degreeName(relativeScale, deg);
      chord.fn = FUNCTION_BY_DEGREE[relativeMode][deg];
      chord.fnLabel = FUNCTION_LABEL[chord.fn];
      return chord;
    });

    return {
      tonic,
      mode,
      name: noteName(tonic) + ' ' + (mode === 'major' ? 'major' : 'minor'),
      shortName: noteName(tonic) + (mode === 'major' ? '' : 'm'),
      scaleNotes,
      signature: keySignature(tonic, mode),
      diatonic,
      parallel: { tonic, mode: parallelMode, scaleNotes: parallelScale },
      relative: {
        tonic: relativeTonic,
        mode: relativeMode,
        name: noteName(relativeTonic) + ' ' + relativeMode,
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

  const BORROW_NOTES = {
    major: {
      0: 'The parallel minor tonic. Dark, and a strong way to pivot into the minor key.',
      1: 'Half-diminished pre-dominant. Push it straight into V for an instant minor-key colour.',
      2: 'Flat mediant. Lifts a major progression sideways: I – ' + FLAT + 'III – IV.',
      3: 'The famous one. IV → iv → I is the single most-used borrowed move in pop.',
      4: 'Minor v. Softens the cadence — no leading tone, so it drifts instead of resolving.',
      5: 'Flat submediant. Big cinematic drop, classic in ' + FLAT + 'VI – ' + FLAT + 'VII – I.',
      6: 'Flat seventh. The "backdoor" chord — ' + FLAT + 'VII7 → I sounds like a plagal dominant.'
    },
    minor: {
      0: 'Picardy third. End a minor piece on the major tonic and it feels resolved, not sad.',
      1: 'Minor-key ii from Dorian. Brighter pre-dominant than ii°.',
      2: 'Raised mediant. Rare, mostly a passing chord towards IV.',
      3: 'The Dorian IV. Raises the 6th and makes a minor groove sound modal, not tragic.',
      4: 'Major V from harmonic minor. This is how a minor key gets a real leading tone.',
      5: 'Raised submediant. Dorian brightness, works between iv and V.',
      6: 'Raised subtonic diminished — the leading-tone chord, an alternative to V7.'
    }
  };

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
      chord.note = BORROW_NOTES[key.mode][deg];
      chord.source = 'Parallel ' + key.parallel.mode;
      chord.replaces = home;
      out.push(chord);
    });

    // The Neapolitan is not diatonic to either parallel scale, but it belongs
    // in any list of borrowed colour.
    const neapolitan = chordOn(minorSecondAbove(key.tonic), 'maj', 'maj7');
    neapolitan.roman = FLAT + 'II';
    neapolitan.number = FLAT + '2';
    neapolitan.note = 'Neapolitan. A major chord on the flat 2nd — dramatic pre-dominant, goes to V.';
    neapolitan.source = 'Chromatic';
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
        homeFn: chord.fnLabel,
        relativeFn: match ? match.fnLabel : '—'
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
          label: 'The direct way — borrow its dominant',
          chords: [homeTonic, relDom, relTonic],
          text: 'Play ' + relDom.symbol7 + ' (that is V7/' + stripSeventh(key.diatonic[rel.degreeInHome].roman) +
            ' in ' + key.name + ') and the ear lands on ' + relTonic.symbol + ' as the new home.'
        },
        {
          label: 'The smooth way — ii–V into the new key',
          chords: [homeTonic, relTwo, relDom, relTonic],
          text: 'Set the dominant up first: ' + relTwo.symbol7 + ' – ' + relDom.symbol7 + ' – ' +
            relTonic.symbol + '. Two bars and you are fully in ' + rel.name + '.'
        },
        {
          label: 'The invisible way — pivot chord',
          chords: [homeTonic, pivot, relDom, relTonic],
          text: pivot.symbol + ' is ' + pivot.roman + ' in ' + key.name + ' and ' +
            (pivotRel ? pivotRel.roman : '—') + ' in ' + rel.name +
            '. Enter on it, then cadence with ' + relDom.symbol7 + ' and nobody hears the seam.'
        }
      ],
      out: [
        {
          label: 'Straight back home',
          chords: [relTonic, homeDom, homeTonic],
          text: 'One chord does it: ' + (homeDom.symbol7 || homeDom.symbol) + ' is the dominant of ' +
            key.name + ' and of nothing in ' + rel.name + ', so it drags the ear straight back to ' +
            homeTonic.symbol + '.'
        },
        {
          label: 'ii–V back home',
          chords: [relTonic, homeTwo, homeDom, homeTonic],
          text: homeTwo.symbol7 + ' – ' + (homeDom.symbol7 || homeDom.symbol) + ' – ' + homeTonic.symbol +
            ' re-establishes ' + key.name + ' in one phrase.'
        },
        {
          label: 'Slide back by step',
          chords: [relTonic, key.diatonic[6], homeTonic],
          text: rel.shortName + ' → ' + key.diatonic[6].symbol + ' → ' + homeTonic.symbol +
            ': the leading-tone chord drags you home without a full cadence.'
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
        title: 'Secondary dominant',
        chord: sec.dominant,
        label: sec.dominant.roman,
        text: 'Borrow ' + chord.symbol + '’s own V7. ' +
          noteName(sec.resolution.third.from) + ' → ' + noteName(sec.resolution.third.to) +
          ' and ' + noteName(sec.resolution.seventh.from) + ' → ' + noteName(sec.resolution.seventh.to) +
          ' — the tritone closes in and hands you the chord.'
      });
      approaches.push({
        title: 'Its own ii–V',
        chord: sec.two,
        label: sec.two.roman,
        text: 'Two bars of set-up: ' + sec.two.symbol7 + ' – ' + sec.dominant.symbol7 + ' – ' + chord.symbol + '.'
      });
      approaches.push({
        title: 'Tritone substitute',
        chord: sec.sub,
        label: sec.sub.roman,
        text: 'Same tritone as ' + sec.dominant.symbol7 + ', but the bass slides down a semitone into ' +
          noteName(chord.root) + '.'
      });
      approaches.push({
        title: 'Leading-tone diminished',
        chord: sec.leadingTone,
        label: sec.leadingTone.roman,
        text: 'A softer approach than the V7 — same pull, no root movement underneath.'
      });
    } else if (isTonic) {
      const five = Object.assign({}, key.diatonic[4], { display: key.diatonic[4].symbol7 });
      const four = key.diatonic[3];
      approaches.push({
        title: 'Authentic cadence',
        chord: five,
        label: five.roman7,
        text: (five.symbol7 || five.symbol) + ' → ' + chord.symbol + '. The strongest arrival there is.'
      });
      approaches.push({
        title: 'Plagal cadence',
        chord: four,
        label: four.roman,
        text: four.symbol + ' → ' + chord.symbol + '. The "amen" — restful rather than conclusive.'
      });
      const backdoor = chordOn(step(key.tonic, 6, 10), 'maj', 'dom7');
      backdoor.display = backdoor.symbol7;
      backdoor.roman = FLAT + 'VII7';
      approaches.push({
        title: 'Backdoor',
        chord: backdoor,
        label: FLAT + 'VII7',
        text: backdoor.symbol7 + ' → ' + chord.symbol + '. Borrowed from the parallel minor, and it lands sideways.'
      });
    }

    // Departures — where this chord naturally wants to go inside the key.
    const departures = [];
    const push = (targetDeg, text) => {
      const t = key.diatonic[targetDeg];
      departures.push({ chord: t, label: t.roman, text });
    };
    if (chord.fn === 'tonic') {
      push(3, 'Move out to the pre-dominant side and start a phrase.');
      push(4, 'Straight to the dominant for a short, punchy turnaround.');
      push(1, 'The jazz route: ' + chord.roman + ' – ii – V – I.');
    } else if (chord.fn === 'predominant') {
      push(4, 'Pre-dominant → dominant. This is the move the whole system is built around.');
      push(0, 'Fall back to the tonic for a plagal, unresolved feel.');
      push(6, 'Up to the leading-tone chord for a tighter, more chromatic push.');
    } else {
      push(0, 'Resolve. The leading tone rises, the seventh falls.');
      push(5, 'Deceptive cadence — the ear expects the tonic and gets its relative instead.');
      push(3, 'Step back to the pre-dominant and go around again.');
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
        text: 'Swap ' + chord.symbol + ' for ' + parallelChord.symbol + ' (' + parallelChord.roman +
          ', borrowed from ' + noteName(key.tonic) + ' ' + key.parallel.mode +
          ') to recolour the same slot without changing the melody note underneath it.'
      };
    }

    // Role in the relative key.
    const relMatch = key.relative.diatonic.find((c) => pc(c.root) === pc(chord.root));

    return {
      approaches,
      departures,
      secondary: sec,
      asDominant: asDominantTarget ? { chord: asDominant, target: asDominantTarget } : null,
      interchange,
      relative: relMatch
        ? {
            roman: relMatch.roman,
            fn: relMatch.fnLabel,
            text: chord.symbol + ' is ' + chord.roman + ' here and ' + relMatch.roman + ' in ' +
              key.relative.name + '. Land on it, follow with ' +
              (key.relative.mode === 'minor'
                ? chordOn(fifthAbove(key.relative.tonic), 'maj', 'dom7').symbol7
                : key.relative.diatonic[4].symbol7) +
              ' → ' + key.relative.diatonic[0].symbol + ', and the key has changed underneath you.'
          }
        : null
    };
  }

  // ---------------------------------------------------------- progressions ---

  /* Progression templates. Tokens: {d} diatonic degree, {sec} secondary
   * dominant of a degree, {bor} borrowed from the parallel mode, {nea}. */
  const PROGRESSIONS = {
    major: [
      { name: 'Axis / pop', tokens: [{ d: 0 }, { d: 4 }, { d: 5 }, { d: 3 }], note: 'Four chords, half the charts.' },
      { name: 'Doo-wop', tokens: [{ d: 0 }, { d: 5 }, { d: 3 }, { d: 4 }], note: 'The 50s turnaround.' },
      { name: 'ii–V–I', tokens: [{ d: 1, s: true }, { d: 4, s: true }, { d: 0, s: true }], note: 'The jazz cadence, with sevenths.' },
      { name: 'Secondary lift', tokens: [{ d: 0 }, { sec: 1 }, { d: 1, s: true }, { d: 4, s: true }], note: 'V7/ii pulls the ii in hard.' },
      { name: 'Into the relative minor', tokens: [{ d: 0 }, { d: 3 }, { sec: 5 }, { d: 5 }], note: 'V7/vi is the door to the relative key.' },
      { name: 'Borrowed iv', tokens: [{ d: 0 }, { d: 3 }, { bor: 3 }, { d: 0 }], note: 'The classic modal interchange move.' },
      { name: 'Backdoor', tokens: [{ bor: 3 }, { bor: 6, s: true }, { d: 0, s: true }], note: 'iv – ' + FLAT + 'VII7 – Imaj7.' },
      { name: 'Descending bass', tokens: [{ d: 0 }, { d: 4 }, { d: 5 }, { d: 2 }, { d: 3 }], note: 'Pachelbel’s escalator.' }
    ],
    minor: [
      { name: 'Natural minor loop', tokens: [{ d: 0 }, { d: 5 }, { d: 2 }, { d: 6 }], note: 'i – VI – III – VII, endlessly.' },
      { name: 'Harmonic cadence', tokens: [{ d: 0 }, { d: 3 }, { bor: 4 }, { d: 0 }], note: 'The major V gives minor its leading tone.' },
      { name: 'iiø–V–i', tokens: [{ d: 1, s: true }, { bor: 4, s: true }, { d: 0, s: true }], note: 'The minor jazz cadence.' },
      { name: 'Andalusian', tokens: [{ d: 0 }, { d: 6 }, { d: 5 }, { bor: 4 }], note: 'i – VII – VI – V, flamenco staple.' },
      { name: 'To the relative major', tokens: [{ d: 0 }, { d: 5 }, { sec: 2 }, { d: 2 }], note: 'V7/III opens the relative major.' },
      { name: 'Dorian groove', tokens: [{ d: 0 }, { bor: 3 }, { d: 0 }, { d: 6 }], note: 'The raised 6th keeps it from going tragic.' },
      { name: 'Picardy ending', tokens: [{ d: 0 }, { d: 3 }, { bor: 4, s: true }, { bor: 0 }], note: 'Finish on the major tonic.' },
      { name: 'Neapolitan cadence', tokens: [{ d: 0 }, { nea: true }, { bor: 4, s: true }, { d: 0 }], note: 'Drama in three chords.' }
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
      name: p.name,
      note: p.note,
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
    0: { deg: 2, seventh: true },  // ♭III under I
    2: { deg: 5, seventh: true },  // ♭VI  under IV
    3: { deg: 3, seventh: true },  // iv   under ii
    4: { deg: 6, seventh: true },  // ♭VII under V
    6: { deg: 1, seventh: false }  // ii°  under vii
  };

  function songLayout(key) {
    return SONG_ORDER.map((degree, pos) => {
      const main = key.diatonic[degree];

      // Every column gets the dominant seventh a fifth above it. Over the
      // tonic that is simply V7 rather than a secondary dominant.
      const secondary = chordOn(fifthAbove(main.root), 'maj', 'dom7');
      secondary.display = secondary.symbol7;
      secondary.roman = degree === 0 ? 'V7' : 'V7/' + stripSeventh(main.roman);
      secondary.number = numberFor(secondary, key.scaleNotes);

      let interchange = null;
      const spec = SONG_INTERCHANGE[pos];
      if (spec) {
        interchange = chordFromScale(key.parallel.scaleNotes, spec.deg);
        interchange.roman = romanFor(interchange, key.scaleNotes, { seventh: spec.seventh });
        interchange.number = numberFor(interchange, key.scaleNotes);
        interchange.display = spec.seventh ? interchange.symbol7 : interchange.symbol;
        // A slot shown as a triad should sound like one too.
        if (!spec.seventh) interchange.notes = interchange.triadNotes;
      }

      return { pos, degree, main, secondary, interchange };
    });
  }

  /* Resolve a saved progression slot back to a chord in the current key, which
   * is what lets a progression transpose when the key changes. */
  function songChordAt(key, slot) {
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
    stripSeventh, keySignature, songLayout, songChordAt, SONG_ORDER
  };
})();
