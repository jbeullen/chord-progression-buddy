# Chord Progression Buddy

A web version of the cardboard chord wheel: pick a key, and the whole harmonic
neighbourhood is laid out in front of you — in the number system and in real
chord names at the same time.

Everything on the page is **computed from the key you picked**. There are no
lookup tables of chords per key, so the spellings stay correct all the way out
to D♯ minor (D♯ E♯ F♯ G♯ A♯ B C♯ — not E♭ F G♭…).

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
or clear it. A progression is stored as grid positions rather than as chords,
so **changing key transposes it** — build `I vi IV V` in C, switch to G, and it
follows you. The progression rides in the URL too, so a worked-out sequence is
a link you can send someone.

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
