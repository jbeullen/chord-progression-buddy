/*
 * Tests for the theory engine. No framework — run with `npm test`.
 * theory.js is a browser file, so it is loaded and evaluated by hand.
 */
const fs = require('fs');
const path = require('path');

const T = eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'theory.js'), 'utf8') + ';Theory;');

let passed = 0;
const failures = [];

function is(actual, expected, label) {
  if (actual === expected) passed++;
  else failures.push(`${label}\n    expected: ${expected}\n    actual:   ${actual}`);
}

const symbols = (chords) => chords.map((c) => c.symbol).join(' ');
const romans = (chords) => chords.map((c) => c.roman).join(' ');
const spell = (k, mode) => T.scale(T.parseNote(k), mode).map(T.noteName).join(' ');

// ------------------------------------------------------- scale spelling ---
is(spell('C', 'major'), 'C D E F G A B', 'C major scale');
is(spell('F#', 'major'), 'F♯ G♯ A♯ B C♯ D♯ E♯', 'F♯ major keeps E♯, not F');
is(spell('Cb', 'major'), 'C♭ D♭ E♭ F♭ G♭ A♭ B♭', 'C♭ major keeps F♭');
is(spell('Db', 'major'), 'D♭ E♭ F G♭ A♭ B♭ C', 'D♭ major');
is(spell('A', 'minor'), 'A B C D E F G', 'A natural minor');
is(spell('G#', 'minor'), 'G♯ A♯ B C♯ D♯ E F♯', 'G♯ minor');
is(spell('Eb', 'minor'), 'E♭ F G♭ A♭ B♭ C♭ D♭', 'E♭ minor keeps C♭');

// ------------------------------------------------------- key signatures ---
is(T.keySignature(T.parseNote('C'), 'major'), 0, 'C major has no accidentals');
is(T.keySignature(T.parseNote('F#'), 'major'), 6, 'F♯ major has 6 sharps');
is(T.keySignature(T.parseNote('Cb'), 'major'), -7, 'C♭ major has 7 flats');
is(T.keySignature(T.parseNote('G#'), 'minor'), 5, 'G♯ minor has 5 sharps');

// ------------------------------------------------------ diatonic chords ---
const C = T.buildKey(T.parseNote('C'), 'major');
is(symbols(C.diatonic), 'C Dm Em F G Am Bdim', 'C major triads');
is(C.diatonic.map((c) => c.symbol7).join(' '), 'Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7♭5', 'C major sevenths');
is(romans(C.diatonic), 'I ii iii IV V vi vii°', 'C major numerals');
is(C.diatonic.map((c) => c.roman7).join(' '), 'Imaj7 ii7 iii7 IVmaj7 V7 vi7 viiø7', 'C major seventh numerals');
is(C.diatonic.map((c) => c.nashville).join(' '), '1 2m 3m 4 5 6m 7dim', 'C major Nashville numbers');
is(C.diatonic.map((c) => c.nashville7).join(' '), '1△ 2m⁷ 3m⁷ 4△ 5⁷ 6m⁷ 7ø⁷', 'Nashville sevenths stay unambiguous');
is(C.diatonic.map((c) => c.fn).join(' '), 'tonic predominant tonic predominant dominant tonic dominant', 'C major functions');
is(C.diatonic[6].degreeName, 'Leading tone', 'degree 7 of a major key leads');
is(C.relative.name, 'A minor', 'relative of C major');

is(symbols(T.buildKey(T.parseNote('Eb'), 'major').diatonic), 'E♭ Fm Gm A♭ B♭ Cm Ddim', 'E♭ major triads');

const Am = T.buildKey(T.parseNote('A'), 'minor');
is(symbols(Am.diatonic), 'Am Bdim C Dm Em F G', 'A minor triads');
is(romans(Am.diatonic), 'i ii° III iv v VI VII', 'A minor numerals');
is(Am.diatonic[6].degreeName, 'Subtonic', 'degree 7 of a natural minor key does not lead');
is(Am.relative.name, 'C major', 'relative of A minor');
is(symbols(T.buildKey(T.parseNote('F#'), 'minor').diatonic), 'F♯m G♯dim A Bm C♯m D E', 'F♯ minor triads');

// --------------------------------------------------- secondary dominants ---
const sd = T.secondaryDominants(C);
is(sd.map((s) => s.dominant.symbol7).join(' '), 'A7 B7 C7 D7 E7', 'secondary dominants in C');
is(sd.map((s) => s.dominant.roman).join(' '), 'V7/ii V7/iii V7/IV V7/V V7/vi', 'secondary dominant numerals');
is(sd.map((s) => s.two.symbol7).join(' '), 'Em7♭5 F♯m7♭5 Gm7 Am7 Bm7♭5', 'minor targets take a half-diminished ii');
is(sd.map((s) => s.sub.symbol7).join(' '), 'E♭7 F7 G♭7 A♭7 B♭7', 'tritone substitutes in C');
is(sd.map((s) => s.leadingTone.symbol7).join(' '), 'C♯dim7 D♯dim7 Edim7 F♯dim7 G♯dim7', 'leading-tone sevenths in C');
is(sd.length, 5, 'the tonic and the diminished chord get no secondary dominant');

const toVi = sd[4].resolution; // E7 -> Am
is(T.noteName(toVi.third.from) + '→' + T.noteName(toVi.third.to), 'G♯→A', 'the V7 third rises to the target root');
is(T.noteName(toVi.seventh.from) + '→' + T.noteName(toVi.seventh.to), 'D→C', 'the V7 seventh falls to the target third');

is(T.secondaryDominants(Am).map((s) => s.dominant.symbol7).join(' '), 'G7 A7 B7 C7 D7', 'secondary dominants in A minor');

// ------------------------------------------------------ modal interchange ---
is(symbols(T.borrowedChords(C)), 'Cm Ddim E♭ Fm Gm A♭ B♭ D♭', 'chords borrowed into C major');
is(romans(T.borrowedChords(C)), 'i ii° ♭III iv v ♭VI ♭VII ♭II', 'borrowed numerals carry their accidental');
is(symbols(T.borrowedChords(Am)), 'A Bm C♯m D E F♯m G♯dim B♭', 'chords borrowed into A minor');
is(romans(T.borrowedChords(Am)), 'I ii ♯iii IV V ♯vi ♯vii° ♭II', 'borrowed numerals in a minor key');

// -------------------------------------------------------------- pivoting ---
is(T.relativePivots(C).map((p) => p.homeRoman + '=' + p.relativeRoman).join(' '),
  'I=III ii=iv iii=v IV=VI V=VII vi=i vii°=ii°', 'C major / A minor pivot functions');
is(T.relativeRoutes(C).relDom.symbol7, 'E7', 'the way into A minor is E7');
is(T.relativeRoutes(C).relTwo.symbol7, 'Bm7♭5', 'the ii before it is half-diminished');
is(T.relativeRoutes(Am).relDom.symbol7, 'G7', 'the way into C major is G7');

// -------------------------------------------------------- chord contexts ---
const ctxTwo = T.chordContext(C, C.diatonic[1]);
is(ctxTwo.approaches[0].chord.symbol7, 'A7', 'Dm is reached by A7');
is(ctxTwo.interchange.chord.symbol, 'Ddim', 'Dm recolours to Ddim');
is(ctxTwo.relative.roman, 'iv', 'Dm is iv in A minor');
is(ctxTwo.asDominant.target.symbol, 'G', 'D7 would pull to G');

const ctxOne = T.chordContext(C, C.diatonic[0]);
is(ctxOne.approaches.map((a) => a.title).join(', '), 'Authentic cadence, Plagal cadence, Backdoor', 'ways home to the tonic');
is(ctxOne.approaches[2].chord.symbol7, 'B♭7', 'the backdoor into C is B♭7');

// --------------------------------------------------------- progressions ---
const displays = (p) => p.chords.map((c) => c.display).join(' ');
const pr = T.progressions(C);
is(displays(pr[0]), 'C G Am F', 'axis progression in C');
is(displays(pr[2]), 'Dm7 G7 Cmaj7', 'ii–V–I in C');
is(displays(pr[4]), 'C F E7 Am', 'route into the relative minor');
is(displays(pr[5]), 'C F Fm C', 'borrowed iv');
is(displays(pr[6]), 'Fm B♭7 Cmaj7', 'backdoor cadence');

const prm = T.progressions(Am);
is(displays(prm[0]), 'Am F C G', 'natural minor loop');
is(displays(prm[2]), 'Bm7♭5 E7 Am7', 'minor ii–V–i');
is(displays(prm[3]), 'Am G F E', 'Andalusian cadence');
is(displays(prm[6]), 'Am Dm E7 A', 'Picardy third ending');
is(displays(prm[7]), 'Am B♭ E7 Am', 'Neapolitan cadence');

// -------------------------------------------------------------- voicings ---
is(T.voice(C.diatonic[0]).join(' '), '48 52 55 59 60', 'Cmaj7 voices upwards from the root');
is(T.voice(C.diatonic[6]).join(' '), '59 62 65 69 71', 'Bm7♭5 voices upwards from the root');

// ------------------------------------- every key stays inside two accidentals ---
let spellingProblems = 0;
let emptySymbols = 0;
['major', 'minor'].forEach((mode) => {
  const keys = mode === 'major' ? T.MAJOR_KEYS : T.MINOR_KEYS;
  [...keys, ...Object.keys(T.ENHARMONICS[mode])].forEach((k) => {
    const key = T.buildKey(T.parseNote(k), mode);
    const everyChord = [
      ...key.diatonic,
      ...key.relative.diatonic,
      ...T.borrowedChords(key),
      ...T.secondaryDominants(key).flatMap((s) => [s.dominant, s.two, s.sub, s.leadingTone]),
      ...T.progressions(key).flatMap((p) => p.chords),
      ...key.diatonic.flatMap((c) => T.chordContext(key, c).approaches.map((a) => a.chord))
    ];
    everyChord.forEach((c) => {
      if (c.notes.some((n) => Math.abs(n.acc) > 2)) spellingProblems++;
      if (!c.symbol || /undefined|NaN/.test(String(c.symbol) + String(c.roman))) emptySymbols++;
    });
  });
});
is(spellingProblems, 0, 'no chord anywhere needs more than a double accidental');
is(emptySymbols, 0, 'every chord in every key has a symbol and a numeral');

// ------------------------------------------------------------------ done ---
if (failures.length) {
  console.error(`\n${failures.length} failing:\n\n  ${failures.join('\n\n  ')}\n`);
  process.exit(1);
}
console.log(`${passed} theory checks passed`);
