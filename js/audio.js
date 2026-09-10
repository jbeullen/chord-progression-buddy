/*
 * audio.js — a small Web Audio synth, so every chord on the page is audible.
 * No samples, no libraries: two detuned oscillators per note through a shared
 * compressor, which is enough to hear voice leading.
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

    const endsAt = sustained
      ? shapeSustained(g.gain, t0, dur, gain)
      : shapeStruck(g.gain, t0, dur, gain);

    osc.connect(lp);
    shimmer.connect(lp);
    lp.connect(g);
    g.connect(master);

    osc.start(t0);
    shimmer.start(t0);
    osc.stop(endsAt + 0.06);
    shimmer.stop(endsAt + 0.06);
    register([osc, shimmer], g);
  }

  /* ------------------------------------------------------------- piano ---
   *
   * The same chords, struck rather than held. There are no samples here and
   * there is no room for any — the whole app is meant to run from a file on
   * disk — so this is a piano argued from what a piano does rather than
   * recorded from one. Three things carry most of it:
   *
   *   the strike, a filtered noise burst lasting a few hundredths of a second;
   *   the collapse of brightness immediately after it, which is what makes a
   *     string sound struck rather than blown;
   *   and the unison, since a note is two or three strings tuned a hair apart,
   *     and the slow beating between them is the shimmer one oscillator can
   *     never fake.
   *
   * It will not be mistaken for a Steinway. It is unmistakably not the synth,
   * which is the point of offering the choice.
   */
  const PIANO_PARTIALS = [0, 1, 0.55, 0.33, 0.19, 0.11, 0.065, 0.04, 0.024, 0.015, 0.009];
  let pianoWave = null;
  let hammerNoise = null;

  function wave() {
    if (!pianoWave) {
      const imag = Float32Array.from(PIANO_PARTIALS);
      pianoWave = ctx.createPeriodicWave(new Float32Array(imag.length), imag);
    }
    return pianoWave;
  }

  function noise() {
    if (!hammerNoise) {
      const n = Math.floor(ctx.sampleRate * 0.12);
      hammerNoise = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = hammerNoise.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    return hammerNoise;
  }

  /* No plateau to hold: a string starts dying the moment the hammer leaves it.
   * Low strings are longer and heavier and ring on well after the top of the
   * keyboard has gone, so the tail is scaled by pitch — and capped by the time
   * available, which is how the tempo keeps one chord out of the next. */
  function shapePiano(param, t0, dur, gain, freq) {
    const natural = 5.4 - Math.log2(Math.max(freq, 27.5) / 55) * 0.6;
    const tail = Math.max(0.25, Math.min(dur, natural));
    const knee = Math.min(0.3, tail * 0.24);

    /* Three stages rather than two. A single exponential from the strike to
     * silence is mathematically a decay and musically a disappearance — by a
     * third of the way through the bar there is nothing left to hear the next
     * chord against. The middle stage is the part you actually listen to. */
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(gain, t0 + 0.004);
    param.exponentialRampToValueAtTime(gain * 0.45, t0 + knee);
    param.exponentialRampToValueAtTime(gain * 0.06, t0 + tail * 0.8);
    param.exponentialRampToValueAtTime(0.0001, t0 + tail);
    return t0 + tail;
  }

  function tonePiano(freq, t0, dur, gain) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(11000, freq * 13), t0);
    lp.frequency.exponentialRampToValueAtTime(
      Math.max(700, freq * 3.2), t0 + Math.min(0.7, dur)
    );

    const sources = [];
    [-2.5, 2.5].forEach((cents) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave());
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(lp);
      sources.push(o);
    });

    const hit = ctx.createBufferSource();
    hit.buffer = noise();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = Math.min(5200, freq * 6);
    band.Q.value = 0.7;
    const hitGain = ctx.createGain();
    hitGain.gain.setValueAtTime(gain * 0.45, t0);
    hitGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    hit.connect(band);
    band.connect(hitGain);
    hitGain.connect(master);
    sources.push(hit);

    // Two oscillators sum into one gain, and a struck note spends far less
    // time at its peak than a held one. Both are accounted for here so the
    // toggle changes the instrument and not the volume.
    const endsAt = shapePiano(g.gain, t0, dur, gain * 0.8, freq);
    lp.connect(g);
    g.connect(master);

    sources.forEach((s) => { s.start(t0); s.stop(endsAt + 0.06); });
    register(sources, g);
  }

  let instrument = 'synth';

  function tone(freq, t0, dur, gain, sustained) {
    if (instrument === 'piano') tonePiano(freq, t0, dur, gain);
    else toneSynth(freq, t0, dur, gain, sustained);
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
    setInstrument: (v) => { instrument = v === 'piano' ? 'piano' : 'synth'; },
    /* Called once if the browser refuses to start audio, so the UI can say so
     * instead of just staying silent. */
    onBlocked: (fn) => { blockedHandler = fn; },
    state: () => (ctx ? ctx.state : 'uninitialised'),
    sampleRate: () => (ctx ? ctx.sampleRate : null),
    route: () => route,
    unlock: ensure
  };
})();
