/*
 * model.js — the physics and power maths. No DOM, no network, no globals
 * beyond the single Model object, so tests can load it straight into node.
 *
 * Two ideas carry the whole app:
 *
 *   1. A power-duration curve: the best average power you have held for each
 *      duration. Built from watts streams, which is the only place the Strava
 *      REST API exposes cycling power at sub-activity resolution.
 *   2. A steady-state power equation. Given a segment's length and climb, it
 *      converts a time into the watts that time costs, and back again.
 *
 * Put them together and a KOM time becomes a watts number you either have or
 * do not have.
 */
const Model = (() => {
  const G = 9.81;
  const RHO = 1.225; // sea-level air density, kg/m³

  /* Durations the curve is sampled at. Short end is dense because that is
   * where segment efforts actually live. */
  const DURATIONS = [5, 10, 15, 30, 60, 120, 180, 300, 420, 600, 900, 1200, 1800, 2700, 3600];

  /* Defaults fitted against real climb efforts (see README). elevK corrects
   * Strava's barometric elevation gain, which reads low on short climbs. */
  const DEFAULTS = {
    riderKg: 74,
    bikeKg: 9,
    cda: 0.33, // solo on the hoods
    cdaDraft: 0.25, // sitting in a wheel
    crr: 0.005,
    elevK: 1.0,
    drivetrain: 0.976
  };

  // ------------------------------------------------------- power curve ---

  /* Max mean power for each duration, from a watts stream sampled at 1 Hz.
   * Prefix sums keep this O(n) per duration rather than O(n·d).
   *
   * Strava streams can carry nulls where the meter dropped out; they are read
   * as zero, which is what the recording actually means for average power. */
  function mmpFromStream(watts, durations = DURATIONS) {
    if (!Array.isArray(watts) || watts.length === 0) return {};
    const n = watts.length;
    const sum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const w = watts[i];
      sum[i + 1] = sum[i] + (typeof w === 'number' && isFinite(w) ? w : 0);
    }
    const out = {};
    for (const d of durations) {
      if (d > n) continue;
      let best = -Infinity;
      for (let i = 0; i + d <= n; i++) {
        const mean = (sum[i + d] - sum[i]) / d;
        if (mean > best) best = mean;
      }
      if (isFinite(best)) out[d] = best;
    }
    return out;
  }

  /* Element-wise maximum across many rides — the athlete's season best at
   * each duration. */
  function mergeCurves(curves) {
    const out = {};
    for (const c of curves) {
      if (!c) continue;
      for (const k of Object.keys(c)) {
        const d = Number(k);
        const v = c[k];
        if (!isFinite(v)) continue;
        if (out[d] === undefined || v > out[d]) out[d] = v;
      }
    }
    return out;
  }

  /* A power curve is convex in log-time, so interpolate there. Outside the
   * sampled range we clamp rather than extrapolate: pretending to know a
   * 3-second or 3-hour number from this data would be a lie. */
  function curvePoints(curve) {
    return Object.keys(curve)
      .map(Number)
      .filter((d) => isFinite(curve[d]))
      .sort((a, b) => a - b)
      .map((d) => [d, curve[d]]);
  }

  function powerAt(curve, t) {
    const pts = curvePoints(curve);
    if (pts.length === 0) return NaN;
    if (pts.length === 1) return pts[0][1];
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [t0, p0] = pts[i];
      const [t1, p1] = pts[i + 1];
      if (t >= t0 && t <= t1) {
        const f = (Math.log(t) - Math.log(t0)) / (Math.log(t1) - Math.log(t0));
        return p0 + f * (p1 - p0);
      }
    }
    return pts[pts.length - 1][1];
  }

  /* True when the curve actually samples this duration rather than clamping to
   * an endpoint — a 40-minute KOM judged against a 20-minute curve is a guess,
   * and the UI says so. */
  function curveCovers(curve, t) {
    const pts = curvePoints(curve);
    if (pts.length < 2) return false;
    return t >= pts[0][0] && t <= pts[pts.length - 1][0];
  }

  // ------------------------------------------------------------ physics ---

  function opts(o = {}) {
    return { ...DEFAULTS, ...o };
  }

  const totalMass = (o) => o.riderKg + o.bikeKg;

  /* Watts needed to cover `dist` metres climbing `gain` metres in `time`
   * seconds. Gravity + rolling + aero, divided by drivetrain efficiency.
   *
   * Grade is taken as the average over the segment. On a segment that rolls,
   * the real cost is higher than this — you lose more into the headwind of the
   * fast parts than you gain back on the slow ones. */
  function powerFor(dist, gain, time, o = {}) {
    const c = opts(o);
    if (!(dist > 0) || !(time > 0)) return NaN;
    const v = dist / time;
    const slope = Math.atan((c.elevK * gain) / dist);
    const rolling = totalMass(c) * G * c.crr * Math.cos(slope) * v;
    const gravity = totalMass(c) * G * Math.sin(slope) * v;
    const aero = 0.5 * RHO * c.cda * v ** 3;
    return (rolling + gravity + aero) / c.drivetrain;
  }

  /* Inverse of powerFor. Monotonic in time, so bisection is safe and exact
   * enough at 60 iterations. */
  function timeFor(dist, gain, watts, o = {}) {
    if (!(dist > 0) || !(watts > 0)) return NaN;
    let lo = 1;
    let hi = 36000;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (powerFor(dist, gain, mid, o) > watts) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* The fastest time the athlete could ride the segment: the point where the
   * power the segment demands equals the power they can hold for that long.
   * Both sides move with time, so solve for the crossing. */
  function bestTime(curve, dist, gain, o = {}) {
    if (curvePoints(curve).length === 0) return NaN;
    const excess = (t) => powerFor(dist, gain, t, o) - powerAt(curve, t);
    let lo = 1;
    let hi = 36000;
    if (excess(hi) > 0) return NaN; // cannot complete it at any sustainable power
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (excess(mid) > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------------------------------------------------------- calibration ---

  /* Fit crr and elevK to the athlete's own segment efforts, so the model
   * answers in their units: their power meter's bias, their tyres, the way
   * Strava reads elevation on their local climbs.
   *
   * cda is deliberately not fitted. Efforts recorded in a group carry an
   * unknowable amount of draft, and a free cda would absorb all of it and then
   * quietly under-predict a solo attempt.
   *
   * Steep efforts only: on the flat, aero dominates and the fit would be
   * chasing draft rather than rolling resistance.
   */
  function calibrate(efforts, o = {}) {
    const usable = (efforts || []).filter(
      (e) =>
        e &&
        e.distance > 150 &&
        e.elapsed_time > 20 &&
        e.average_watts > 50 &&
        e.total_elevation_gain / e.distance > 0.03
    );
    if (usable.length < 4) return { fitted: false, n: usable.length, crr: opts(o).crr, elevK: opts(o).elevK };

    let best = null;
    for (let crr = 0.002; crr <= 0.0121; crr += 0.0005) {
      for (let k = 0.9; k <= 1.401; k += 0.02) {
        let err = 0;
        for (const e of usable) {
          const modelled = powerFor(e.distance, e.total_elevation_gain, e.elapsed_time, {
            ...o,
            crr,
            elevK: k,
            cda: opts(o).cdaDraft
          });
          err += (modelled / e.average_watts - 1) ** 2;
        }
        if (!best || err < best.err) best = { err, crr, elevK: k };
      }
    }
    return {
      fitted: true,
      n: usable.length,
      crr: best.crr,
      elevK: best.elevK,
      rms: Math.sqrt(best.err / usable.length)
    };
  }

  // ------------------------------------------------------------- verdict ---

  /* Bands are in percent of the power the KOM demands, not raw watts: 40 W
   * short of a 600 W sprint is a different proposition from 40 W short of a
   * 250 W drag. */
  function verdict(required, available) {
    if (!isFinite(required) || !isFinite(available)) return { key: 'unknown', label: 'No data' };
    const gap = required - available;
    const pct = gap / required;
    if (gap <= 0) return { key: 'live', label: 'Live', gap, pct };
    if (pct <= 0.08) return { key: 'close', label: 'In reach', gap, pct };
    if (pct <= 0.2) return { key: 'stretch', label: 'A stretch', gap, pct };
    return { key: 'out', label: 'Out of range', gap, pct };
  }

  /* Everything the UI needs about one starred segment. */
  function assess(segment, curve, o = {}) {
    const { distance, total_elevation_gain: gain, komTime, prTime } = segment;
    const c = opts(o);
    const required = powerFor(distance, gain, komTime, c);
    const available = powerAt(curve, komTime);
    const v = verdict(required, available);
    const ceiling = bestTime(curve, distance, gain, c);
    return {
      ...segment,
      requiredWatts: required,
      requiredWkg: required / c.riderKg,
      availableWatts: available,
      verdict: v,
      ceilingTime: ceiling,
      /* Time you would need to find against your own best, not against the
       * KOM — the honest measure of how far off you personally are. */
      prDelta: isFinite(prTime) && isFinite(komTime) ? prTime - komTime : NaN,
      extrapolated: !curveCovers(curve, komTime)
    };
  }

  // -------------------------------------------------------------- format ---

  function formatTime(t) {
    if (!isFinite(t)) return '—';
    const s = Math.round(t);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return `${m}:${String(rem).padStart(2, '0')}`;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  /* Accepts what a human types and what Strava's `xoms.kom` field returns,
   * which is a display string rather than a number: "1:23", "23s", "1m 23s",
   * "1:02:05". */
  function parseTime(str) {
    if (typeof str === 'number') return isFinite(str) ? str : NaN;
    const s = String(str).trim().toLowerCase();
    if (!s) return NaN;

    if (s.includes(':')) {
      const parts = s.split(':').map((p) => Number(p.trim()));
      if (parts.some((p) => !isFinite(p))) return NaN;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return NaN;
    }

    // "1h 2m 5s" / "1m 23s" / "23s", in any subset.
    const unit = /(\d+(?:\.\d+)?)\s*([hms])/g;
    let total = 0;
    let matched = false;
    let m;
    while ((m = unit.exec(s)) !== null) {
      matched = true;
      const n = Number(m[1]);
      total += m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : n;
    }
    if (matched) return total;

    const bare = Number(s);
    return isFinite(bare) ? bare : NaN;
  }

  return {
    DURATIONS,
    DEFAULTS,
    mmpFromStream,
    mergeCurves,
    powerAt,
    curvePoints,
    curveCovers,
    powerFor,
    timeFor,
    bestTime,
    calibrate,
    verdict,
    assess,
    formatTime,
    parseTime
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Model;
