/*
 * audio.js — the sound, so every chord on the page is audible. No libraries.
 *
 * Two instruments, and the piano comes in two kinds. The synth is two detuned
 * oscillators per note through a shared filter, which holds a chord flat and
 * makes voice leading easy to follow. The piano is recordings of a real one,
 * fetched only when somebody asks for it — and where they cannot be fetched,
 * a piano built here one partial at a time, which is what keeps the app whole
 * when it is opened straight off a disk.
 */
const Sound = (() => {
  let ctx = null;
  let master = null;
  let analyser = null;
  let muted = false;
  let blockedHandler = null;
  let reportedBlocked = false;

  /* iOS puts bare Web Audio in the "ambient" audio session, which the ring/
   * silent switch mutes — but only through the built-in speaker, so it keeps
   * working on headphones and looks like a broken app. Audio coming out of an
   * <audio> element counts as media playback instead, and ignores the switch.
   * So on iOS the graph ends in a MediaStream played by an element rather than
   * in ctx.destination. */
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && 'ontouchend' in document);

  let sinkEl = null;
  let streamDest = null;
  let route = 'none';

  function connectDirect() {
    if (route === 'direct' || !analyser) return;
    if (streamDest) {
      try { analyser.disconnect(streamDest); } catch (e) { /* never connected */ }
    }
    analyser.connect(ctx.destination);
    route = 'direct';
  }

  /* Send the output through a hidden <audio> element. Anything that goes wrong
   * falls back to the ordinary destination, so the worst case is the behaviour
   * we had before. */
  function connectViaMediaElement() {
    try {
      streamDest = ctx.createMediaStreamDestination();
      analyser.connect(streamDest);

      sinkEl = document.createElement('audio');
      sinkEl.setAttribute('playsinline', '');
      sinkEl.playsInline = true;
      sinkEl.autoplay = true;
      sinkEl.hidden = true;
      sinkEl.srcObject = streamDest.stream;
      document.body.appendChild(sinkEl);
      route = 'media-element';

      const played = sinkEl.play();
      if (played && typeof played.catch === 'function') played.catch(connectDirect);
      // If it never actually starts, take the ordinary route instead.
      setTimeout(() => { if (sinkEl && sinkEl.paused) connectDirect(); }, 500);
    } catch (e) {
      connectDirect();
    }
  }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.16;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      // The analyser sits in the chain so the page can measure whether sound is
      // actually being produced, rather than failing silently.
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      master.connect(comp);
      comp.connect(analyser);

      if (IS_IOS) connectViaMediaElement();
      else connectDirect();
    }
    return ctx;
  }

  /* Watch the output for a moment and report the loudest sample seen. */
  function probe(duration = 700) {
    return new Promise((resolve) => {
      const c = ensure();
      if (!c || !analyser) return resolve({ producing: false, peak: 0, state: 'unsupported' });
      const buf = new Float32Array(analyser.fftSize);
      let peak = 0;
      const started = Date.now();
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) {
          const a = Math.abs(buf[i]);
          if (a > peak) peak = a;
        }
        if (Date.now() - started >= duration) {
          clearInterval(timer);
          resolve({ producing: peak > 0.0005, peak, state: c.state });
        }
      }, 30);
    });
  }

  /* Play an unmistakable arpeggio and measure what came out of it. */
  function test() {
    const c = ensure();
    if (!c) return Promise.resolve({ producing: false, peak: 0, state: 'unsupported' });
    whenRunning((run) => {
      const t0 = run.currentTime + 0.02;
      [60, 64, 67, 72].forEach((m, i) => tone(midiToFreq(m), t0 + i * 0.12, 0.9, 0.22));
    });
    return probe(900);
  }

  function blocked(reason) {
    if (reportedBlocked) return;
    reportedBlocked = true;
    if (blockedHandler) blockedHandler(reason);
  }

  /* Browsers hand back a suspended context until a user gesture, and resuming
   * is asynchronous. Scheduling against `currentTime` before the context is
   * actually running drops the notes into the past, so everything waits for
   * the resume to land. */
  function whenRunning(fn) {
    const c = ensure();
    if (!c) { blocked('unsupported'); return; }
    if (c.state === 'running') { fn(c); return; }

    let settled = false;
    const go = () => {
      if (settled) return;
      settled = true;
      if (c.state === 'running') { reportedBlocked = false; fn(c); }
      else blocked('suspended');
    };

    const p = c.resume();
    if (p && typeof p.then === 'function') p.then(go, () => blocked('refused'));
    // Older Safari's resume() returns nothing, so poll briefly as well.
    setTimeout(go, 250);
  }

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* Voices currently scheduled or sounding, so playback can be cut short. */
  let live = [];

  /* Two envelopes. A struck chord decays away like a plucked instrument, which
   * suits a one-off click. A chord in a progression has to hold until the next
   * one is due, or the sequence reads as a string of separate hits rather than
   * as harmony moving — so it sustains and releases only at the end, leaving a
   * short silence so the two chords never overlap and blur. */
  function shapeStruck(param, t0, dur, gain) {
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(gain, t0 + 0.014);
    param.exponentialRampToValueAtTime(gain * 0.4, t0 + dur * 0.45);
    param.exponentialRampToValueAtTime(0.0001, t0 + dur);
    return t0 + dur;
  }

  function shapeSustained(param, t0, dur, gain) {
    const attack = Math.min(0.012, dur * 0.1);
    const decay = Math.min(0.16, dur * 0.25);
    const release = Math.min(0.14, dur * 0.25);
    const sustain = gain * 0.72;
    const releaseAt = Math.max(t0 + attack + decay, t0 + dur - release);

    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(gain, t0 + attack);
    param.exponentialRampToValueAtTime(sustain, t0 + attack + decay);
    param.setValueAtTime(sustain, releaseAt); // hold the level until the release
    param.exponentialRampToValueAtTime(0.0001, releaseAt + release);
    return releaseAt + release;
  }

  /* Keep every sound source of one note together, so stopping early can cut
   * all of them and the bookkeeping does not care what made the sound. */
  function register(sources, g) {
    const voice = { sources, g };
    live.push(voice);
    sources[0].onended = () => {
      const i = live.indexOf(voice);
      if (i > -1) live.splice(i, 1);
    };
  }

  function toneSynth(freq, t0, dur, gain, sustained) {
    const osc = ctx.createOscillator();
    const shimmer = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();

    osc.type = 'triangle';
    shimmer.type = 'sine';
    osc.frequency.value = freq;
    shimmer.frequency.value = freq;
    shimmer.detune.value = 7;

    // A held chord keeps some brightness; a struck one darkens as it decays.
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t0);
    lp.frequency.exponentialRampToValueAtTime(
      sustained ? 2200 : 1400,
      t0 + (sustained ? Math.min(0.9, dur) : dur)
    );

    /* Down where a slash bass lives, a triangle wave is very nearly a sine:
     * measured at G1, all of its energy sits in the 49 Hz fundamental and the
     * second harmonic is 43 dB down. No laptop or phone reproduces 49 Hz at
     * all, so the note is inaudible on most of the machines this runs on —
     * which is exactly the complaint, and why the piano does not have it. The
     * recorded low G puts almost nothing in its fundamental and its loudest
     * partial is the octave above; the ear reads the pitch off the harmonics
     * and supplies the rest, whether or not the speaker can.
     *
     * So the bass register gets harmonics of its own to be heard by, in
     * roughly the proportions the recording has. This fades in below 120 Hz,
     * which no chord tone ever reaches — only the bass of a slash chord goes
     * down there. */
    const boost = Math.min(1, Math.max(0, (120 - freq) / 50));
    const HARMONICS = [[2, 1.6], [3, 1.0], [4, 0.5]];
    /* Four oscillators where there were two, so the note is turned down by
     * as much as they add. Adding a bass should make a chord deeper, not
     * louder — measured, it was coming out 47% louder than the same chord
     * without one. */
    const level = gain / (1 + boost * 0.47);

    const endsAt = sustained
      ? shapeSustained(g.gain, t0, dur, level)
      : shapeStruck(g.gain, t0, dur, level);

    osc.connect(lp);
    shimmer.connect(lp);
    lp.connect(g);
    g.connect(master);

    const sources = [osc, shimmer];
    if (boost > 0) {
      HARMONICS.forEach(([mult, amount]) => {
        const h = ctx.createOscillator();
        const hg = ctx.createGain();
        h.type = 'sine';
        h.frequency.value = freq * mult;
        hg.gain.value = amount * boost;
        h.connect(hg);
        hg.connect(lp);
        h.start(t0);
        h.stop(endsAt + 0.06);
        sources.push(h);
      });
    }

    osc.start(t0);
    shimmer.start(t0);
    osc.stop(endsAt + 0.06);
    shimmer.stop(endsAt + 0.06);
    register(sources, g);
  }

  /* ------------------------------------------------------------- piano ---
   *
   * The same chords, struck rather than held. There are no samples here and
   * there is no room for any — the whole app is meant to run from a file on
   * disk — so this is a piano argued from what a piano does rather than
   * recorded from one. It is built one partial at a time, because the three
   * things that separate a struck string from a synthesiser are all things a
   * single oscillator cannot express:
   *
   * A piano string is stiff, so it is *not* harmonic. Its partials sit
   * progressively sharp of the whole-number multiples, by f·n·√(1 + Bn²).
   * B is small — a few ten-thousandths — but it is the reason a piano sounds
   * like a piano and an organ does not, and no single waveform can carry it,
   * since every periodic wave is by definition exactly harmonic.
   *
   * Each partial decays at its own rate, the high ones fastest. That is why a
   * piano note is bright for a moment and mellow for a long time afterwards.
   *
   * The hammer strikes about an eighth of the way along the string, which
   * cannot excite a partial with a node at that point — so the eighth is
   * missing, and its neighbours are weakened. That notch is audible.
   *
   * On top of that: a broadband thump for the hammer itself, and a second
   * detuned copy of the lowest partials, since a note is two or three strings
   * tuned a hair apart and the slow beating between them is a sound no single
   * string makes.
   *
   * And then the part that has nothing to do with the string. Strings on their
   * own are nearly inaudible — a piano is a soundboard, and a soundboard is a
   * large wooden box in a room. Perfectly accurate partials with no body around
   * them still sound like an oscillator bank, because in life nobody has ever
   * heard a note that arrived without a room attached. So the strings are sent
   * through a small synthesised impulse response as well as straight out.
   */
  const MAX_PARTIALS = 14;
  const STRIKE_POINT = 1 / 8; // where the hammer meets the string
  /* A dozen partials starting together add up to far more than one oscillator
   * did, so the per-note level is scaled to land beside the synth. Tuned by
   * measuring the output, not by ear. */
  const PIANO_LEVEL = 1.62;
  const BODY_WET = 0.5;
  let hammerNoise = null;
  let bodyIn = null;
  let bodyWet = null;

  function noise() {
    if (!hammerNoise) {
      const n = Math.floor(ctx.sampleRate * 0.2);
      hammerNoise = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = hammerNoise.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    return hammerNoise;
  }

  /* The soundboard and the room it stands in: a short, dense decay with a few
   * discrete early reflections, which is what gives a box a size. Built once,
   * shared by every note. */
  function body() {
    if (!bodyIn) {
      const len = Math.floor(ctx.sampleRate * 0.6);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
        }
        // Slightly different reflection times per channel, so it has width.
        [0.0061, 0.0119, 0.0203, 0.0314].forEach((sec, k) => {
          const i = Math.floor((sec + ch * 0.0013) * ctx.sampleRate);
          if (i < len) d[i] += (k % 2 ? -0.6 : 0.7) / (k + 1);
        });
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      bodyWet = ctx.createGain();
      bodyWet.gain.value = BODY_WET;
      conv.connect(bodyWet);
      bodyWet.connect(master);
      bodyIn = conv;
    }
    return bodyIn;
  }

  /* Stiffness rises steeply towards the bass, where the strings are short for
   * their pitch and wound with copper to make up the difference. */
  const inharmonicity = (freq) => 0.00007 + 0.0022 / (1 + Math.pow(freq / 100, 1.7));

  function tonePiano(freq, t0, dur, gain) {
    const sources = [];
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(master);
    out.connect(body());

    const B = inharmonicity(freq);
    const ceiling = Math.min(ctx.sampleRate * 0.45, 15000);
    /* Low strings are long and heavy and ring on for half a minute; a note at
     * the top of the keyboard is gone in under a second. That spread is one of
     * the plainest things about a piano, and the first version of this had it
     * far too flat — barely two to one across the whole range. */
    const natural = Math.max(0.6, 8.5 - Math.log2(Math.max(freq, 27.5) / 55) * 1.35);

    const partial = (n, cents, level) => {
      const f = n * freq * Math.sqrt(1 + B * n * n);
      if (f > ceiling) return false;

      // The strike point cannot excite a partial that has a node there.
      const comb = Math.abs(Math.sin(Math.PI * n * STRIKE_POINT));
      /* A felt hammer is soft and a soundboard is not a tweeter, so the top of
       * the spectrum is rolled off rather than merely thinned. This has to be
       * steep: the strike comb repeats every eighth partial, and a gentle
       * rolloff hands the ninth to the thirteenth their energy back as a
       * cluster around 3 kHz, which is both where the ear is most sensitive and
       * why the first attempt sounded glassy rather than bright. */
      const roll = 1 / (1 + Math.pow(f / 1600, 2.6));
      const amp = gain * PIANO_LEVEL * level * comb * roll / Math.pow(n, 1.15);
      if (amp < gain * 0.002) return true; // too quiet to be worth a node

      /* Upper partials shed their energy fastest, into the soundboard and the
       * air. This ratio is most of the piano's changing colour. t60 is the time
       * this partial would take to fall 60 dB if left alone. */
      const t60 = Math.max(0.12, natural / (1 + (n - 1) * 0.55));
      const attack = 0.0015 + 0.0035 / n;

      /* Decay at the string's own rate for as long as there is room, then damp
       * what is left. Capping the rate instead — forcing the partial to reach
       * silence exactly when the bar ends — is what made the first attempt
       * vanish: a fundamental that has to lose 60 dB inside two seconds is
       * inaudible long before the next chord arrives, where a real one has
       * lost about 20 and is still singing. This is also just what happens on
       * the instrument, where the note rings on until the key is released and
       * the damper drops. */
      const ring = Math.min(t60, Math.max(0.1, dur));
      const left = Math.max(0.00012, amp * Math.pow(0.001, ring / t60));
      const damped = left > 0.0002;
      const ends = t0 + ring + (damped ? 0.09 : 0);

      /* A struck note does not decay at one rate. The strings of a unison are
       * coupled through the bridge, and while they are still in phase they
       * feed the soundboard hard and lose energy fast; once they drift apart
       * they hold on to it and ring on much longer. Hence the piano's "prompt
       * sound" and its "aftersound" — an audible knee a fraction of a second
       * in, and the reason a single clean exponential never sounds struck. */
      const prompt = Math.min(ring * 0.5, t60 * 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + attack);
      if (prompt > attack) g.gain.exponentialRampToValueAtTime(amp * 0.62, t0 + prompt);
      g.gain.exponentialRampToValueAtTime(left, t0 + ring);
      if (damped) g.gain.exponentialRampToValueAtTime(0.0001, ends);

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      if (cents) o.detune.value = cents;
      o.connect(g);
      g.connect(out);
      o.start(t0);
      o.stop(ends + 0.03);
      sources.push(o);
      return true;
    };

    for (let n = 1; n <= MAX_PARTIALS; n++) {
      if (!partial(n, 0, 1)) break;
    }
    /* The unison, on the partials that carry the weight of the note. The
     * amount of detuning wanders a little from note to note, because a piano
     * is never twice in exactly the same tune and two identical strikes are a
     * sound only a machine makes. */
    const wander = () => 1 + (Math.random() - 0.5) * 0.5;
    partial(1, -1.7 * wander(), 0.7);
    partial(2, 2.2 * wander(), 0.7);

    /* The hammer, in two parts. The click is what you hear on a bright note;
     * the knock underneath it is the weight of the action and the case, and
     * without it the attack is a tick rather than a blow. */
    const strike = (filter, freqHz, q, level, decay) => {
      const src = ctx.createBufferSource();
      src.buffer = noise();
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freqHz;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain * level, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      src.connect(f);
      f.connect(g);
      g.connect(out);
      // A different slice of noise each time, so no two strikes are identical.
      src.start(t0, Math.random() * 0.08);
      src.stop(t0 + decay + 0.05);
      sources.push(src);
    };
    strike('bandpass', Math.min(6000, Math.max(900, freq * 7)), 0.6, 0.5, 0.035);
    strike('lowpass', Math.max(160, Math.min(700, freq * 2.2)), 0.8, 0.42, 0.075);

    register(sources, out);
  }

  /* ----------------------------------------------------- the sampled piano ---
   *
   * Everything above is a piano reasoned from first principles, and there is a
   * ceiling to that: a real instrument is hundreds of coupled resonances in a
   * wooden box, and past a point the only way to sound like one is to have
   * recorded one. These are recordings of a real Yamaha C5 — the Salamander
   * Grand Piano, by Alexander Holm, under CC BY 3.0.
   *
   * They are a few megabytes, which is more than the rest of the app put
   * together, so nothing is fetched until somebody actually asks for the piano.
   * Until the files land — and permanently, if they cannot land at all, which
   * is what happens when the page is opened straight off a disk or inlined into
   * a single file — the synthesised piano above carries the sound. Nobody hears
   * silence and nobody waits.
   */
  const SAMPLE_PATH = 'audio/piano/';
  const SAMPLE_MIDI = {
    /* Down to D♯1 because a slash bass drops well below the chord — the
     * lowest note this app can ask for is a D♯1, and that is exactly where
     * this stops. */
    Ds1: 27, Fs1: 30, A1: 33,
    C2: 36, Ds2: 39, Fs2: 42, A2: 45,
    C3: 48, Ds3: 51, Fs3: 54, A3: 57,
    C4: 60, Ds4: 63, Fs4: 66, A4: 69,
    C5: 72, Ds5: 75, Fs5: 78, A5: 81,
    C6: 84
  };
  /* The recordings are already as loud as they are; this only lines them up
   * with the synth so the switch is not also a volume control. */
  const SAMPLE_LEVEL = 9.5;

  let samples = null;
  let sampleState = 'off'; // off | loading | ready | unavailable
  let sampleHandler = null;

  const setSampleState = (s) => {
    sampleState = s;
    if (sampleHandler) sampleHandler(s);
  };

  /* Opened straight off a disk, fetch cannot read a neighbouring file at all —
   * every browser refuses it as cross-origin. Asking anyway works, in the sense
   * that the fallback catches it, but it fills the console with a screen of red
   * that says the page is broken when it is doing exactly what it should. */
  const canFetchSamples = () => /^https?:$/.test(location.protocol);

  function loadSample(c, name) {
    return fetch(SAMPLE_PATH + name + '.mp3')
      .then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.arrayBuffer();
      })
      // Safari's decodeAudioData wants the callback form, so wrap it either way.
      .then((buf) => new Promise((res, rej) => {
        const p = c.decodeAudioData(buf, res, rej);
        if (p && typeof p.then === 'function') p.then(res, rej);
      }))
      .then((audio) => [SAMPLE_MIDI[name], audio]);
  }

  function loadSamples() {
    if (sampleState === 'loading' || sampleState === 'ready') return;
    const c = ensure();
    if (!c || !canFetchSamples()) { setSampleState('unavailable'); return; }
    setSampleState('loading');

    const names = Object.keys(SAMPLE_MIDI);
    /* One file first. Where the recordings were never deployed — the single
     * file build, or the page inlined somewhere else — this asks once and gives
     * up, rather than asking seventeen times to learn the same thing. */
    loadSample(c, names[0])
      .then((first) => Promise.all([first].concat(
        names.slice(1).map((name) => loadSample(c, name)))))
      .then((pairs) => {
        samples = new Map(pairs);
        setSampleState('ready');
      })
      /* One failure is enough to know: no retry loop, no repeated wait, and the
       * synthesised piano keeps playing as though nothing happened. */
      .catch(() => { samples = null; setSampleState('unavailable'); });
  }

  const SAMPLE_KEYS = Object.values(SAMPLE_MIDI).sort((a, b) => a - b);

  function nearestSample(midi) {
    let best = SAMPLE_KEYS[0];
    SAMPLE_KEYS.forEach((m) => {
      if (Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    });
    return best;
  }

  function toneSampled(freq, t0, dur, gain) {
    const midi = 69 + 12 * Math.log2(freq / 440);
    const from = nearestSample(midi);

    const src = ctx.createBufferSource();
    src.buffer = samples.get(from);
    // Never more than a tone and a half of shifting: the samples sit a minor
    // third apart, which is what the set was recorded for.
    src.playbackRate.value = Math.pow(2, (midi - from) / 12);

    /* The recording already is the attack, the decay and the room. The only
     * thing left to add is the damper: the note rings as it was played until
     * the bar runs out, and is then let go the way a key is. */
    const g = ctx.createGain();
    const hold = Math.max(0.12, dur);
    const release = 0.16;
    g.gain.setValueAtTime(gain * SAMPLE_LEVEL, t0);
    g.gain.setValueAtTime(gain * SAMPLE_LEVEL, t0 + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + hold + release);

    src.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + hold + release + 0.02);
    register([src], g);
  }

  let instrument = 'synth';

  function tone(freq, t0, dur, gain, sustained) {
    if (instrument !== 'piano') return toneSynth(freq, t0, dur, gain, sustained);
    if (sampleState === 'ready' && samples) return toneSampled(freq, t0, dur, gain);
    return tonePiano(freq, t0, dur, gain);
  }

  /* Cut every sounding and scheduled note, with a short fade so stopping does
   * not click. */
  function silence() {
    if (!ctx) return;
    const t = ctx.currentTime;
    live.forEach(({ sources, g }) => {
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0.0001, t + 0.04);
        sources.forEach((s) => s.stop(t + 0.05));
      } catch (e) {
        // Already stopped — nothing to cut.
      }
    });
    /* The soundboard is shared and outlives any one note, so stopping has to
     * duck it too — otherwise Stop leaves half a second of room ringing after
     * everything that fed it has gone. It comes back a moment later, ready for
     * the next note. */
    if (bodyWet) {
      bodyWet.gain.cancelScheduledValues(t);
      bodyWet.gain.setValueAtTime(bodyWet.gain.value, t);
      bodyWet.gain.linearRampToValueAtTime(0.0001, t + 0.05);
      bodyWet.gain.setValueAtTime(BODY_WET, t + 0.45);
    }
    live = [];
  }

  /* Schedule a chord at an absolute context time. The sequencer works this way
   * so its timing comes from the audio clock rather than from setTimeout.
   * Sequenced chords hold rather than decay. */
  function chordAt(midis, when, dur = 1.1) {
    if (muted) return;
    const c = ensure();
    if (!c || c.state !== 'running') return;
    midis.forEach((m, i) => tone(midiToFreq(m), when + i * 0.01, dur, 0.15 - i * 0.009, true));
  }

  const now = () => {
    const c = ensure();
    return c ? c.currentTime : 0;
  };

  /* Play one chord (array of MIDI numbers), lightly strummed. */
  function chord(midis, delay = 0, dur = 1.1) {
    if (muted) return;
    whenRunning((c) => {
      const t0 = c.currentTime + delay + 0.02;
      midis.forEach((m, i) => tone(midiToFreq(m), t0 + i * 0.014, dur, 0.19 - i * 0.012));
    });
  }

  /* Play a series of chords. Returns the per-chord delays so the UI can
   * highlight along with the sound. */
  function sequence(chordList, opts = {}) {
    const gap = opts.gap || 0.72;
    // Default to holding the chord until just before the next one.
    const dur = opts.dur || Math.max(0.25, gap - 0.09);
    const delays = chordList.map((_, i) => i * gap);
    if (!muted) {
      whenRunning((c) => {
        const base = c.currentTime + 0.02;
        chordList.forEach((midis, i) => {
          const t0 = base + delays[i];
          const d = i === chordList.length - 1 ? dur * 1.6 : dur;
          midis.forEach((m, j) => tone(midiToFreq(m), t0 + j * 0.01, d, 0.15 - j * 0.009, true));
        });
      });
    }
    return { delays, gap };
  }

  return {
    chord,
    chordAt,
    sequence,
    silence,
    now,
    test,
    probe,
    isMuted: () => muted,
    setMuted: (v) => { muted = v; },
    instrument: () => instrument,
    setInstrument: (v) => {
      instrument = v === 'piano' ? 'piano' : 'synth';
      if (instrument === 'piano') loadSamples();
    },
    /* 'loading' while the recordings are on their way, 'unavailable' when they
     * cannot be had at all. Either way the piano still plays. */
    samples: () => sampleState,
    onSamples: (fn) => { sampleHandler = fn; },
    /* Called once if the browser refuses to start audio, so the UI can say so
     * instead of just staying silent. */
    onBlocked: (fn) => { blockedHandler = fn; },
    state: () => (ctx ? ctx.state : 'uninitialised'),
    sampleRate: () => (ctx ? ctx.sampleRate : null),
    route: () => route,
    unlock: ensure
  };
})();
