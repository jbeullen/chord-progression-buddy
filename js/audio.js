/*
 * audio.js — a small Web Audio synth, so every chord on the page is audible.
 * No samples, no libraries: two detuned oscillators per note through a shared
 * compressor, which is enough to hear voice leading.
 */
const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  let blockedHandler = null;
  let reportedBlocked = false;

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
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    return ctx;
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

  function tone(freq, t0, dur, gain) {
    const osc = ctx.createOscillator();
    const shimmer = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();

    osc.type = 'triangle';
    shimmer.type = 'sine';
    osc.frequency.value = freq;
    shimmer.frequency.value = freq;
    shimmer.detune.value = 7;

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t0);
    lp.frequency.exponentialRampToValueAtTime(1400, t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.014);
    g.gain.exponentialRampToValueAtTime(gain * 0.4, t0 + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(lp);
    shimmer.connect(lp);
    lp.connect(g);
    g.connect(master);

    osc.start(t0);
    shimmer.start(t0);
    osc.stop(t0 + dur + 0.06);
    shimmer.stop(t0 + dur + 0.06);
  }

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
    const dur = opts.dur || gap * 1.35;
    const delays = chordList.map((_, i) => i * gap);
    if (!muted) {
      whenRunning((c) => {
        const base = c.currentTime + 0.02;
        chordList.forEach((midis, i) => {
          const t0 = base + delays[i];
          const d = i === chordList.length - 1 ? dur * 1.6 : dur;
          midis.forEach((m, j) => tone(midiToFreq(m), t0 + j * 0.014, d, 0.19 - j * 0.012));
        });
      });
    }
    return { delays, gap };
  }

  return {
    chord,
    sequence,
    isMuted: () => muted,
    setMuted: (v) => { muted = v; },
    /* Called once if the browser refuses to start audio, so the UI can say so
     * instead of just staying silent. */
    onBlocked: (fn) => { blockedHandler = fn; },
    state: () => (ctx ? ctx.state : 'uninitialised'),
    unlock: ensure
  };
})();
