/*
 * Tests for the model. No framework — run with `npm test`.
 *
 * The physics cases are anchored to real recorded efforts (Strava activity
 * 19457748748 and friends), so a regression here means the model has drifted
 * away from what a power meter actually measured.
 */
const path = require('path');
const M = require(path.join(__dirname, '..', 'js', 'model.js'));

let passed = 0;
const failures = [];

function is(actual, expected, label) {
  if (actual === expected) passed++;
  else failures.push(`${label}\n    expected: ${expected}\n    actual:   ${actual}`);
}

function near(actual, expected, tol, label) {
  if (isFinite(actual) && Math.abs(actual - expected) <= tol) passed++;
  else failures.push(`${label}\n    expected: ${expected} ±${tol}\n    actual:   ${actual}`);
}

function ok(cond, label) {
  if (cond) passed++;
  else failures.push(label);
}

// ------------------------------------------------------- power curve ---

// A stream with a clear 5-second spike inside an otherwise flat 100 W ride.
const stream = new Array(600).fill(100);
for (let i = 200; i < 205; i++) stream[i] = 600;

const mmp = M.mmpFromStream(stream, [5, 10, 60, 300]);
near(mmp[5], 600, 0.001, '5s max mean finds the spike');
near(mmp[10], 350, 0.001, '10s max mean averages spike with neighbours');
near(mmp[60], (55 * 100 + 5 * 600) / 60, 0.001, '60s window dilutes the spike');
is(M.mmpFromStream([], [5])[5], undefined, 'empty stream yields no curve');
is(M.mmpFromStream([1, 2, 3], [60])[60], undefined, 'duration longer than stream is skipped');

// Nulls are dropouts, and count as zero watts for the average.
near(M.mmpFromStream([100, null, 100, 100], [4])[4], 75, 0.001, 'null samples read as zero');

const merged = M.mergeCurves([{ 5: 500, 60: 300 }, { 5: 700, 60: 250 }, null]);
is(merged[5], 700, 'mergeCurves keeps the better 5s');
is(merged[60], 300, 'mergeCurves keeps the better 60s');

const curve = { 5: 800, 60: 450, 300: 275, 1200: 224, 3600: 199 };
near(M.powerAt(curve, 60), 450, 0.001, 'powerAt hits a sampled point exactly');
ok(M.powerAt(curve, 120) < 450 && M.powerAt(curve, 120) > 275, 'powerAt interpolates between samples');
is(M.powerAt(curve, 1), 800, 'powerAt clamps below the sampled range');
is(M.powerAt(curve, 7200), 199, 'powerAt clamps above the sampled range');
ok(Number.isNaN(M.powerAt({}, 60)), 'powerAt on an empty curve is NaN');

ok(M.curveCovers(curve, 300), 'curveCovers true inside the range');
ok(!M.curveCovers(curve, 4000), 'curveCovers false past the longest sample');
ok(!M.curveCovers({ 60: 400 }, 60), 'a one-point curve covers nothing');

// ----------------------------------------------------------- physics ---

/* Recorded efforts: distance, gain, elapsed, average watts. Ridden in a bunch,
 * so they are checked against the draft cda with the fitted constants. */
const FIT = { riderKg: 74, bikeKg: 9, crr: 0.003, elevK: 1.16, cda: 0.25 };
const efforts = [
  ['Roeselberg (Cotacol 390)', 665.7, 37.8, 114, 377.6],
  ['Roeselberg 1', 850.3, 42.5, 140, 340.6],
  ['Holstheide1', 442.6, 34.5, 107, 329.8],
  ['Huldenberg - the steep bit', 522.7, 38.2, 121, 321.9],
  ['Veeweidestraat (steilste stuk)', 331.3, 20.8, 74, 289.7],
  ['De Grubbe', 778.9, 36.3, 139, 285.4]
];
for (const [name, d, gain, t, watts] of efforts) {
  const modelled = M.powerFor(d, gain, t, FIT);
  const err = Math.abs(modelled / watts - 1);
  ok(err <= 0.1, `${name}: modelled ${modelled.toFixed(0)} W within 10% of recorded ${watts} W`);
}

// powerFor and timeFor must be exact inverses.
const rt = M.timeFor(1000, 50, M.powerFor(1000, 50, 180, FIT), FIT);
near(rt, 180, 0.01, 'timeFor inverts powerFor');

// Monotonicity: a faster time always costs more, a steeper climb always costs more.
ok(M.powerFor(1000, 50, 150, FIT) > M.powerFor(1000, 50, 200, FIT), 'faster costs more watts');
ok(M.powerFor(1000, 80, 180, FIT) > M.powerFor(1000, 50, 180, FIT), 'steeper costs more watts');
ok(M.powerFor(1000, 0, 120, { ...FIT, cda: 0.4 }) > M.powerFor(1000, 0, 120, { ...FIT, cda: 0.25 }),
  'more frontal area costs more watts on the flat');
ok(Number.isNaN(M.powerFor(0, 10, 60, FIT)), 'zero distance is NaN, not Infinity');
ok(Number.isNaN(M.powerFor(500, 10, 0, FIT)), 'zero time is NaN, not Infinity');

// bestTime lands where demand equals supply.
const bt = M.bestTime(curve, 665.7, 37.8, FIT);
ok(isFinite(bt) && bt > 60 && bt < 300, `bestTime for a 666 m climb is plausible (${bt.toFixed(0)}s)`);
near(M.powerFor(665.7, 37.8, bt, FIT), M.powerAt(curve, bt), 1,
  'at bestTime, required power equals available power');
ok(Number.isNaN(M.bestTime({}, 1000, 50, FIT)), 'bestTime without a curve is NaN');

// ------------------------------------------------------- calibration ---

/* Generate efforts from known constants and check the fit recovers them. */
const TRUE = { riderKg: 74, bikeKg: 9, crr: 0.0055, elevK: 1.2, cda: 0.25, cdaDraft: 0.25 };
const synthetic = [
  [400, 30, 90], [600, 45, 130], [800, 50, 170], [500, 40, 110], [700, 55, 150], [900, 60, 200]
].map(([distance, gain, t]) => ({
  distance,
  total_elevation_gain: gain,
  elapsed_time: t,
  average_watts: M.powerFor(distance, gain, t, TRUE)
}));

const fit = M.calibrate(synthetic, { riderKg: 74, bikeKg: 9, cdaDraft: 0.25 });
ok(fit.fitted, 'calibrate reports a fit when given enough efforts');
is(fit.n, 6, 'calibrate counts the usable efforts');
near(fit.crr, TRUE.crr, 0.0011, 'calibrate recovers crr');
near(fit.elevK, TRUE.elevK, 0.05, 'calibrate recovers the elevation correction');
ok(fit.rms < 0.02, `calibrate fits the synthetic set tightly (rms ${fit.rms.toFixed(4)})`);

const thin = M.calibrate(synthetic.slice(0, 2), {});
ok(!thin.fitted, 'calibrate declines to fit on too few efforts');
is(thin.crr, M.DEFAULTS.crr, 'declining to fit falls back to the default crr');

// Flat and low-power efforts are rejected as calibration input.
const junk = M.calibrate([
  { distance: 2000, total_elevation_gain: 5, elapsed_time: 200, average_watts: 250 },
  { distance: 3000, total_elevation_gain: 2, elapsed_time: 300, average_watts: 240 },
  { distance: 500, total_elevation_gain: 40, elapsed_time: 120, average_watts: 10 },
  { distance: 100, total_elevation_gain: 9, elapsed_time: 25, average_watts: 300 }
], {});
ok(!junk.fitted, 'calibrate rejects flat, weak and too-short efforts');

// ----------------------------------------------------------- verdict ---

is(M.verdict(400, 450).key, 'live', 'surplus power is a live target');
is(M.verdict(400, 400).key, 'live', 'exactly enough power is live');
is(M.verdict(400, 380).key, 'close', '5% short is in reach');
is(M.verdict(400, 340).key, 'stretch', '15% short is a stretch');
is(M.verdict(400, 200).key, 'out', '50% short is out of range');
is(M.verdict(NaN, 400).key, 'unknown', 'missing data gives no verdict');
near(M.verdict(400, 340).pct, 0.15, 1e-9, 'verdict reports the fractional gap');

const assessed = M.assess(
  { distance: 665.7, total_elevation_gain: 37.8, komTime: 92, prTime: 114 },
  curve,
  FIT
);
is(assessed.verdict.key, 'stretch', 'a 92s KOM on the Roeselberg is a stretch');
near(assessed.requiredWatts, 474.3, 1, 'assess prices the 92s Roeselberg at ~474 W');
is(
  M.assess({ distance: 665.7, total_elevation_gain: 37.8, komTime: 78, prTime: 114 }, curve, FIT).verdict.key,
  'out',
  'a 78s KOM on the same climb is out of range'
);
near(assessed.prDelta, 22, 0.001, 'assess reports the gap to your own PB');
ok(assessed.requiredWkg > 6, 'assess converts required watts to W/kg');
ok(!assessed.extrapolated, 'a 92s KOM is inside the sampled curve');
ok(M.assess({ distance: 20000, total_elevation_gain: 100, komTime: 4200, prTime: NaN }, curve, FIT).extrapolated,
  'a 70-minute KOM is flagged as extrapolated');

// ------------------------------------------------------------ format ---

is(M.formatTime(45), '45s', 'formats seconds');
is(M.formatTime(92), '1:32', 'formats minutes and seconds');
is(M.formatTime(600), '10:00', 'pads seconds');
is(M.formatTime(3725), '1:02:05', 'formats hours');
is(M.formatTime(NaN), '—', 'formats missing time as a dash');
is(M.parseTime('1:32'), 92, 'parses m:ss');
is(M.parseTime('1:02:05'), 3725, 'parses h:mm:ss');
is(M.parseTime('45'), 45, 'parses bare seconds');
is(M.parseTime(92), 92, 'passes numbers through');
ok(Number.isNaN(M.parseTime('abc')), 'rejects nonsense');
// Strava's xoms.kom is a display string, not a number.
is(M.parseTime('23s'), 23, "parses Strava's bare-seconds form");
is(M.parseTime('1m 23s'), 83, "parses Strava's minutes-and-seconds form");
is(M.parseTime('1h 2m 5s'), 3725, "parses Strava's hours form");
is(M.parseTime('2m'), 120, 'parses whole minutes');
is(M.parseTime('  1:32  '), 92, 'tolerates surrounding whitespace');
ok(Number.isNaN(M.parseTime('')), 'rejects an empty string');
ok(Number.isNaN(M.parseTime(NaN)), 'rejects NaN');
ok(Number.isNaN(M.parseTime('1:aa')), 'rejects a malformed clock time');

// -------------------------------------------------------------- report ---

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  console.error(`${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed`);
