# Chord Progression Buddy

A web version of the cardboard chord wheel: pick a key, and the whole harmonic
neighbourhood is laid out in front of you — in the number system and in real
chord names at the same time.

Everything on the page is **computed from the key you picked**. There are no
lookup tables of chords per key, so the spellings stay correct all the way out
to D♯ minor (D♯ E♯ F♯ G♯ A♯ B C♯ — not E♭ F G♭…).

## What it shows

**The diatonic chords** — the main event. Seven cards, each with its Roman
numeral, its Nashville number, the actual chord, the seventh chord, the scale
degree name, and a colour for its harmonic function (tonic / pre-dominant /
dominant).

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

Any static host will do. For GitHub Pages: **Settings → Pages → Deploy from a
branch**, pick the branch and the `/` root folder.

## How it works

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
