# Piano recordings

The `.mp3` files in this directory are from the **Salamander Grand Piano V3**,
a set of recordings of a Yamaha C5 grand.

- Author: **Alexander Holm**
- Licence: **[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)**
- Source: <https://archive.org/details/SalamanderGrandPianoV3>

CC BY requires attribution, which the page carries in its footer in both
languages, alongside this file.

## What is here, and what is not

One sample every minor third from D♯1 to C6 — the range this app can actually
play — taken from a single velocity layer. Notes in between are pitch-shifted
by at most a tone and a half, which is what a set spaced this way is for.

It reaches down to D♯1 because of slash chords: the bass of a C/G is dropped
well below the chord so it is heard as a bass rather than fusing with the root,
and D♯1 is the lowest note that can produce. A test asserts that nothing the
voicer can play falls further than a tone and a half from a recording.

The rest of the original set — the other velocity layers, the release samples,
the top and bottom of the keyboard — is not included. It runs to over a hundred
megabytes, and none of it would be heard here.

The files are otherwise unmodified. There is no encoder in the build, so they
are not re-compressed or trimmed; the app simply stops reading each one when
the bar ends.
