# Chord Progression Buddy

A web version of the cardboard chord wheel: pick a key, and the whole harmonic
neighbourhood is laid out in front of you — in the number system and in real
chord names at the same time.

Everything on the page is **computed from the key you picked**. There are no
lookup tables of chords per key, so the spellings stay correct all the way out
to D♯ minor (D♯ E♯ F♯ G♯ A♯ B C♯ — not E♭ F G♭…).

## Two languages

A toggle in the top bar switches the whole interface between English and Dutch —
headings, prose, chord functions, scale degrees and the explanations, not just
the buttons. Chord names and numerals are notation and stay as they are.

Without an explicit choice the page follows the browser, so a Dutch browser
opens in Dutch; the toggle overrides that and the choice rides in the URL
(`#lang=nl`).

`js/i18n.js` holds every word the page can show. Nothing else contains
user-facing prose: `theory.js` emits keys and values, `app.js` renders them.
`npm test` fails if either language is missing a key the theory layer emits.

One translation worth knowing about: Dutch has more than one convention for
naming the two pairs of related keys, and this app follows the English sense —
*parallelle mineur* is C majeur / c mineur (same tonic, other mode) and
*relatieve toonaard* is C majeur / a mineur (same notes, other centre). Older
Dutch schoolbooks swap the first word onto the second pair and call the first
*gelijknamig*. Whichever way round it goes, both words have to move together:
one word meaning both pairs is worse than either convention.

## Two modes

**Theory** lays the key out to be read and understood. **Song** lays it out to be
played from.

## Song mode

Three rows in vertical register, seven columns:

|            | | | | | | | |
|------------|---|---|---|---|---|---|---|
| Secondary dominants | G7 | E7 | C7 | A7 | D7 | B7 | F♯7 |
| **Main chords** | **C** | **Am** | **F** | **Dm** | **G** | **Em** | **Bdim** |
| Modal interchange | E♭maj7 | | A♭maj7 | Fm7 | B♭7 | | Ddim |

The main row is the key in reach-order — `I vi IV ii V iii vii` — rather than
scale order. Above each chord is the dominant seventh that pulls into it, with
an arrow pointing at its target. Below are the borrowed chords: ♭III under I,
♭VI under IV, iv under ii, ♭VII under V and ii° under vii.

Song mode is major-only while it is being finished, so the Major/Minor switch
is hidden there and a minor key entering song mode moves to its parallel major.

Click any chord to append it to the progression underneath, then play, loop,
or clear it.

A progression is stored as grid positions rather than as chords, so **changing
key transposes it** — build `I vi IV V` in C, switch to G, and it follows you.
The progression rides in the URL too, so a worked-out sequence is a link you
can send someone.

### Typing a chord

The grid holds the chords a key offers, not every chord a song can use, so
there is an input box under the progression for the rest: slash chords,
tensions, sus and add — `C/G`, `E♭maj7♯11`, `Am9`, `D7sus4`, `B♭13`, `F♯m7♭5`.
Sharps and flats can be typed as `#` and `b`, `-` works for minor, and what you
typed is echoed back as the app reads it before you commit to it. Anything it
cannot read it says so about, rather than adding an approximation.

Typed chords are parsed into spelled notes like everything else, so the ♯11 of
`E♭maj7♯11` comes out as an A and not a B♭♭. They are stored as a distance from
the tonic rather than as a chord, which means **they transpose too**: a `C/G`
typed in C major becomes `G/D` in G major, and travels in the URL alongside the
rest of the progression.

## Tempo

The control in the key bar governs every sound the page makes, in both modes:
the progression, the worked examples in theory mode, and how long a chord rings
when you click one. It reads in beats per minute counted one chord to the bar
of 4/4, so the default of 120 BPM holds a chord for two seconds. It can be
dragged during playback and takes effect from the next chord.

## Synth or piano

A switch in the top bar picks which one plays, everywhere on the page. There
are no samples — the whole thing has to run from a file on disk — so the piano
is argued from what a piano does rather than recorded from one, and it is built
one partial at a time, because the things that separate a struck string from a
synthesiser are things no single waveform can express:

- **A piano string is stiff, so it is not harmonic.** Its partials sit
  progressively sharp of the whole-number multiples, by `f·n·√(1 + Bn²)`. The
  measured stretch here runs from 0.02% at the fundamental to about 3.5% by the
  thirteenth partial in the middle of the keyboard, and further in the bass
  where the strings are short for their pitch. Every periodic waveform is by
  definition exactly harmonic, so this is the part that cannot be faked with a
  wavetable — and it is a good share of why a piano sounds like a piano.
- **Each partial decays at its own rate**, the high ones fastest, which is why
  a note is bright for a moment and mellow for a long time after.
- **The hammer strikes about an eighth of the way along the string**, and
  cannot excite a partial with a node at that point. The eighth is missing.
- The felt is soft and a soundboard is not a tweeter, so the top of the
  spectrum is rolled off steeply rather than merely thinned.
- **A struck note does not decay at one rate.** The strings of a unison are
  coupled through the bridge; while they are in phase they feed the soundboard
  hard and lose energy fast, and once they drift apart they hold on to it. That
  knee a fraction of a second in is the piano's "prompt sound" and
  "aftersound", and a single clean exponential never sounds struck.
- On top of that, a two-part hammer — a click and the knock of the action
  underneath it — and a second detuned copy of the lowest partials, since a
  note is two or three strings tuned a hair apart and the beating between them
  is a sound no single string makes. Both wander slightly from note to note,
  because two identical strikes are a sound only a machine makes.
- **And then the part that is not the string at all.** Strings alone are
  nearly inaudible: a piano is a soundboard, and a soundboard is a wooden box
  in a room. Perfectly accurate partials with nothing around them still sound
  like an oscillator bank, because nobody has ever heard a note that arrived
  without a room attached. So the strings also go through a small synthesised
  impulse response, which Stop ducks along with everything else.

It is a good imitation and not a recording, and there is a ceiling to how close
this can get: a real piano is hundreds of coupled resonances, and matching it
properly means sampling one. That would mean shipping audio files, which is
the one thing the "opens from disk with no dependencies" rule rules out.

The difference is not only timbre. The synth holds a chord flat for as long as
it is given; the piano decays at the string's own rate and is damped when the
bar runs out, which is what releasing a key does. Bass notes ring on where
treble notes have already gone — by the end of a bar at 120 BPM a low note has
lost around 17 dB and a high one around 40.

## What Theory mode shows

**The diatonic chords** — the main event. Seven cards, each with its Roman
numeral, its number, the actual chord, the seventh chord, the scale degree
name, and a colour for its harmonic function (tonic / pre-dominant / dominant).

Numbers use the quality-suffix shorthand: `1` major, `2-` minor, `5D` dominant,
`7-♭5` half-diminished. So a major key reads `1 2- 3- 4 5D 6- 7-♭5` and a minor
key reads `1- 2-♭5 3 4- 5- 6 7D`. The suffix comes from the seventh rather than
the triad, because a dominant and a major chord are the same three notes and
only the seventh separates them — which is why the V of a major key is `5D`
while a `Gmaj7` in the same key would be plain `5`.

**Secondary dominants** — for every chord in the key: its own V7, the ii that
sets that V7 up, the tritone substitute, and the leading-tone diminished
seventh. The "what resolves" column names the two voices that actually do the
work, e.g. for E7 → Am: `G♯ → A` and `D → C`.

**Modal interchange** — every chord borrowed from the parallel mode, plus the
Neapolitan, each with what it replaces and what it is good for.

**The relative key** — its diatonic chords, a pivot table showing what each
chord means on both sides (F is `IV` in C major and `VI` in A minor), and
concrete routes *into* the relative key and *back out* of it.

**Per-chord detail** — click any chord to get how to get *to* it, where it wants
to go, how to recolour it by modal interchange, what happens if you use it as a
dominant, and the job it does in the relative key.

**Progressions** — the usual suspects, already transposed into your key.

Every chord and every progression on the page is clickable and plays through a
small Web Audio synth. Nothing is a static image.

## Running it

It is plain HTML, CSS and JavaScript with no build step and no dependencies —
open `index.html` in a browser and it works, including from `file://`.

To serve it over HTTP instead:

```sh
npm start        # http://localhost:8080
```

## Tests

The theory engine is tested on its own, including a sweep that builds every
chord in all 36 spellable keys and asserts none of them needs more than a
double accidental:

```sh
npm test
```

## Deploying

`.github/workflows/deploy-pages.yml` runs the tests on every push and publishes
the default branch to GitHub Pages. It needs one setting turned on once:
**Settings → Pages → Source → GitHub Actions**. After that every push to the
default branch redeploys, and a failing test blocks the deploy.

Any static host works too — the site is the repo root, with no build step.

There is also a single-file build — the stylesheet and all three scripts
inlined into one HTML file with no dependencies, small enough to email or drop
anywhere:

```sh
npm run build    # → dist/chord-progression-buddy.html
```

## How it works

- `js/i18n.js` — the dictionary, and the only file holding user-facing prose.
- `js/theory.js` — the engine. Notes are `{ letter, acc }` pairs rather than
  pitch classes, and every interval move carries both a letter distance and a
  semitone distance. That is what keeps a minor third spelled as a third and
  never as an augmented second, in any key.
- `js/audio.js` — two detuned oscillators per note through a shared low-pass
  and compressor. Enough to hear voice leading, small enough to inline.
- `js/app.js` — state, rendering, and the URL hash. The hash carries the key,
  the mode, the selected chord and the sevenths toggle, so any view you are
  looking at is a link you can send someone.

## Keyboard and URLs

- `←` / `→` walk through the diatonic chords and play them.
- `#key=F♯&mode=minor&deg=3&7=1` opens straight to the iv chord of F♯ minor
  with sevenths showing.
