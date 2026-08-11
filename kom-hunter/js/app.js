/*
 * app.js — state, rendering and the sync flow.
 *
 * The expensive part of this app is Strava's rate limit, not the maths. A
 * first run on a big starred list costs one request per segment, so every
 * result is cached and every long job is written down as it goes: if the
 * limit is hit halfway, what was fetched survives and the next run resumes
 * from the cache rather than starting again.
 */
(() => {
  const M = Model;
  const S = Strava;

  const SETTINGS_KEY = 'kom.settings';
  const CURVE_KEY = 'kom.curve';
  const RESULTS_KEY = 'kom.results';
  const CAL_KEY = 'kom.calibration';

  const state = {
    athlete: null,
    settings: { riderKg: 74, bikeKg: 9, style: 'solo', rideCount: 15 },
    curve: {},
    curveSource: null,
    calibration: null,
    rows: [],
    filter: 'all',
    search: '',
    sort: { key: 'gap', dir: 'asc' },
    busy: false
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const load = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full — the app still works, it just will not remember */
    }
  };

  // ------------------------------------------------------------- chrome ---

  const show = (sel, on = true) => {
    const el = $(sel);
    if (el) el.hidden = !on;
  };

  function logLine(text, cls) {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    $('#log').appendChild(li);
    $('#log').scrollTop = $('#log').scrollHeight;
  }

  function progress(done, total, label) {
    show('#progress-card', true);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    $('#progress-fill').style.width = `${pct}%`;
    $('#progress-chip').textContent = label || `${done} / ${total}`;
  }

  function showError(e) {
    show('#error-card', true);
    $('#error-text').textContent = e && e.message ? e.message : String(e);
  }
  const clearError = () => show('#error-card', false);

  function paintRate() {
    const r = S.rateStatus();
    if (!r.measured && r.shortUsed === 0) return;
    show('#rate', true);
    const pct = Math.min(100, Math.round((r.shortUsed / r.shortLimit) * 100));
    const fill = $('#rate-fill');
    fill.style.width = `${pct}%`;
    fill.className = pct > 85 ? 'hot' : pct > 60 ? 'warn' : '';
    /* Strava's own counters include requests made from anywhere; the local
     * tally only sees this tab, so say which one is on screen. */
    $('#rate-text').textContent = `${r.shortLeft} left of ${r.shortLimit}${r.measured ? '' : ' (this tab)'}`;
  }

  function setBusy(on) {
    state.busy = on;
    $$('button').forEach((b) => {
      if (b.dataset.always !== 'on') b.disabled = on;
    });
  }

  // ----------------------------------------------------------- settings ---

  function readSettings() {
    state.settings = {
      riderKg: Number($('#rider-kg').value) || 74,
      bikeKg: Number($('#bike-kg').value) || 9,
      style: $('#style').value,
      rideCount: Math.max(3, Math.min(60, Number($('#ride-count').value) || 15))
    };
    save(SETTINGS_KEY, state.settings);
  }

  function writeSettings() {
    $('#rider-kg').value = state.settings.riderKg;
    $('#bike-kg').value = state.settings.bikeKg;
    $('#style').value = state.settings.style;
    $('#ride-count').value = state.settings.rideCount;
  }

  /* The options object handed to the model: settings plus whatever the
   * calibration learned from this athlete's own efforts. */
  function modelOpts() {
    const s = state.settings;
    const cal = state.calibration;
    return {
      riderKg: s.riderKg,
      bikeKg: s.bikeKg,
      cda: s.style === 'draft' ? M.DEFAULTS.cdaDraft : M.DEFAULTS.cda,
      crr: cal && cal.fitted ? cal.crr : M.DEFAULTS.crr,
      elevK: cal && cal.fitted ? cal.elevK : M.DEFAULTS.elevK
    };
  }

  // ------------------------------------------------------------ connect ---

  async function connect(token) {
    clearError();
    if (token !== undefined) S.setToken(token);
    if (!S.hasToken()) return;
    setBusy(true);
    try {
      const athlete = await S.getAthlete();
      state.athlete = athlete;
      paintRate();
      $('#conn-chip').textContent = 'Connected';
      $('#conn-chip').className = 'chip good';
      $('#who-name').textContent = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || 'Athlete';
      const bits = [`id ${athlete.id}`];
      if (athlete.weight) bits.push(`${athlete.weight} kg`);
      if (athlete.city) bits.push(athlete.city);
      $('#who-meta').textContent = bits.join(' · ');
      show('#connect-form', false);
      show('#connected', true);
      show('#setup-card', true);

      if (athlete.weight && !load(SETTINGS_KEY, null)) {
        state.settings.riderKg = athlete.weight;
        writeSettings();
      }

      // FTP is not needed for the model, but a missing zones scope is worth
      // knowing about before a long sync starts.
      const zones = await S.getZones();
      if (zones && zones.power && zones.power.zones) {
        logLine('Power zones read from your profile.');
      }
    } catch (e) {
      $('#conn-chip').textContent = 'Not connected';
      $('#conn-chip').className = 'chip bad';
      showError(e);
    } finally {
      setBusy(false);
      paintRate();
    }
  }

  // -------------------------------------------------------- power curve ---

  /* One cached max-mean-power curve per activity. Streams are large and
   * immutable, so the derived curve is cached and the stream is thrown away. */
  async function curveForActivity(act) {
    const key = `mmp.${act.id}`;
    const hit = S.cacheGet(key);
    if (hit) return hit;
    const watts = await S.getWattsStream(act.id);
    if (!watts || watts.length === 0) {
      S.cacheSet(key, {});
      return {};
    }
    const curve = M.mmpFromStream(watts);
    S.cacheSet(key, curve);
    return curve;
  }

  async function buildPowerCurve() {
    readSettings();
    clearError();
    setBusy(true);
    $('#log').innerHTML = '';
    show('#progress-card', true);
    try {
      const wanted = state.settings.rideCount;
      logLine(`Listing your last ${wanted} rides…`);
      const acts = [];
      for (let page = 1; acts.length < wanted && page <= 5; page++) {
        const batch = await S.getActivities({ page, perPage: Math.min(100, wanted) });
        if (batch.length === 0) break;
        acts.push(...batch);
        if (batch.length < Math.min(100, wanted)) break;
      }

      const rides = acts
        .filter((a) => a.device_watts && (a.type === 'Ride' || a.type === 'VirtualRide' || a.type === 'GravelRide' ||
          a.sport_type === 'Ride' || a.sport_type === 'GravelRide' || a.sport_type === 'MountainBikeRide'))
        .slice(0, wanted);

      if (rides.length === 0) {
        logLine('No rides with recorded power found. Enter your numbers by hand below.', 'err');
        show('#power-card', true);
        return;
      }
      logLine(`${rides.length} rides with power. Reading streams…`);

      const curves = [];
      for (let i = 0; i < rides.length; i++) {
        progress(i, rides.length, `Ride ${i + 1} of ${rides.length}`);
        try {
          curves.push(await curveForActivity(rides[i]));
        } catch (e) {
          if (e.kind === 'rate') {
            logLine('Rate limit reached — keeping what was read so far.', 'err');
            break;
          }
          logLine(`Skipped ${rides[i].name}: ${e.message}`, 'err');
        }
        paintRate();
      }
      progress(rides.length, rides.length, 'Streams read');

      state.curve = M.mergeCurves(curves);
      state.curveSource = { rides: curves.filter((c) => Object.keys(c).length).length, at: Date.now() };
      save(CURVE_KEY, { curve: state.curve, source: state.curveSource });

      await calibrate(rides.slice(0, 5));

      logLine('Power curve built.', 'done');
      renderCurve();
      if (state.rows.length) reassess();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
      paintRate();
    }
  }

  /* Fit the rolling and elevation constants to this athlete's own climbing
   * efforts, using activity details that are cheap because they are cached. */
  async function calibrate(rides) {
    const efforts = [];
    for (const r of rides) {
      try {
        const detail = await S.getActivity(r.id);
        for (const e of detail.segment_efforts || []) {
          efforts.push({
            distance: e.distance,
            total_elevation_gain:
              e.segment && e.segment.total_elevation_gain !== undefined
                ? e.segment.total_elevation_gain
                : (e.segment && e.segment.elevation_high - e.segment.elevation_low) || 0,
            elapsed_time: e.elapsed_time,
            average_watts: e.average_watts
          });
        }
      } catch (e) {
        if (e.kind === 'rate') break;
      }
      paintRate();
    }

    const cal = M.calibrate(efforts, { riderKg: state.settings.riderKg, bikeKg: state.settings.bikeKg });
    state.calibration = cal;
    save(CAL_KEY, cal);
    if (cal.fitted) {
      logLine(`Calibrated on ${cal.n} of your climbs (${(cal.rms * 100).toFixed(1)}% error).`, 'done');
    } else {
      logLine('Not enough steep efforts to calibrate — using default constants.');
    }
  }

  function applyManualCurve() {
    const entries = [
      [5, Number($('#m5').value)],
      [60, Number($('#m60').value)],
      [300, Number($('#m300').value)],
      [1200, Number($('#m1200').value)]
    ].filter(([, w]) => w > 0);
    if (entries.length < 2) {
      showError(new Error('Enter at least two of the four power numbers.'));
      return;
    }
    clearError();
    state.curve = Object.fromEntries(entries);
    state.curveSource = { manual: true, at: Date.now() };
    save(CURVE_KEY, { curve: state.curve, source: state.curveSource });
    renderCurve();
    if (state.rows.length) reassess();
  }

  // ------------------------------------------------------------ segments ---

  /* Pull the numbers the model needs out of a detailed segment. Strava gives
   * the KOM as a display string, and not every segment has one. */
  function segmentFacts(seg) {
    const gain =
      seg.total_elevation_gain !== undefined && seg.total_elevation_gain !== null
        ? seg.total_elevation_gain
        : ((seg.elevation_high || 0) - (seg.elevation_low || 0));
    const komRaw = seg.xoms ? seg.xoms.kom || seg.xoms.overall : null;
    const stats = seg.athlete_segment_stats || {};
    return {
      id: seg.id,
      name: seg.name,
      distance: seg.distance,
      total_elevation_gain: Math.max(0, gain),
      grade: seg.average_grade,
      komTime: M.parseTime(komRaw),
      komRaw: komRaw || null,
      prTime: isFinite(stats.pr_elapsed_time) ? stats.pr_elapsed_time : NaN,
      effortCount: seg.effort_count
    };
  }

  async function analyse() {
    readSettings();
    clearError();
    setBusy(true);
    $('#log').innerHTML = '';
    show('#progress-card', true);

    try {
      if (Object.keys(state.curve).length === 0) {
        logLine('No power curve yet — building one first.');
        await buildPowerCurveInline();
        // buildPowerCurve releases the busy flag on its way out; this job is
        // still running, so take it back.
        setBusy(true);
        if (Object.keys(state.curve).length === 0) {
          logLine('Without a power curve the segments can be listed but not judged.', 'err');
        }
      }

      logLine('Fetching starred segments…');
      const starred = await S.getStarredSegments((n) => progress(0, 1, `${n} starred`));
      logLine(`${starred.length} starred segments.`);

      const uncached = starred.filter((s) => !S.cacheGet(`segment.${s.id}`)).length;
      const budget = S.rateStatus().shortLeft;
      if (uncached > budget) {
        logLine(
          `${uncached} segments still need fetching but only ${budget} requests are left in this 15-minute window. ` +
            'Fetching what fits — run it again after the window resets to finish the rest.',
          'err'
        );
      }

      const facts = [];
      for (let i = 0; i < starred.length; i++) {
        progress(i, starred.length, `Segment ${i + 1} of ${starred.length}`);
        try {
          const detail = await S.getSegment(starred[i].id);
          facts.push(segmentFacts(detail));
        } catch (e) {
          if (e.kind === 'rate') {
            logLine(`Rate limit reached at ${i} of ${starred.length}. Keeping these; re-run later to finish.`, 'err');
            break;
          }
          logLine(`Skipped ${starred[i].name}: ${e.message}`, 'err');
        }
        paintRate();
      }
      progress(starred.length, starred.length, 'Segments read');

      save(RESULTS_KEY, facts);
      state.rows = facts;
      reassess();
      logLine(`Assessed ${facts.length} segments.`, 'done');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
      paintRate();
    }
  }

  /* buildPowerCurve owns the busy flag and the log; when analyse() calls it as
   * a first step, run the body without letting it clear the log underneath. */
  async function buildPowerCurveInline() {
    const log = $('#log').innerHTML;
    await buildPowerCurve();
    $('#log').innerHTML = log + $('#log').innerHTML;
  }

  /* Re-run the model over already-fetched segments. Free — no requests. */
  function reassess() {
    const o = modelOpts();
    const assessed = state.rows.map((f) => {
      if (!isFinite(f.komTime) || !(f.distance > 0)) {
        return { ...f, verdict: { key: 'unknown', label: 'No KOM' }, requiredWatts: NaN, requiredWkg: NaN, gap: NaN };
      }
      const a = M.assess(f, state.curve, o);
      return { ...a, gap: a.verdict.gap };
    });
    state.assessed = assessed;
    renderResults();
  }

  // ----------------------------------------------------------- rendering ---

  function renderCurve() {
    const pts = M.curvePoints(state.curve);
    show('#power-card', true);
    const chip = $('#power-chip');
    if (!pts.length) {
      chip.textContent = 'No data';
      return;
    }
    const src = state.curveSource || {};
    chip.textContent = src.manual ? 'Entered by hand' : `${src.rides || 0} rides`;

    const tbody = $('#power-table tbody');
    tbody.innerHTML = pts
      .map(
        ([d, w]) =>
          `<tr><td>${M.formatTime(d)}</td><td class="mono">${Math.round(w)}</td>` +
          `<td class="mono">${(w / state.settings.riderKg).toFixed(2)}</td></tr>`
      )
      .join('');

    drawCurve(pts);
  }

  function drawCurve(pts) {
    const svg = $('#curve');
    const NS = 'http://www.w3.org/2000/svg';
    while (svg.childNodes.length > 1) svg.removeChild(svg.lastChild);

    const L = 46;
    const R = 14;
    const T = 12;
    const B = 30;
    const w = 720;
    const h = 300;
    const pw = w - L - R;
    const ph = h - T - B;

    const tMin = pts[0][0];
    const tMax = pts[pts.length - 1][0];
    const pMax = Math.max(...pts.map((p) => p[1])) * 1.08;
    const x = (t) => L + ((Math.log(t) - Math.log(tMin)) / (Math.log(tMax) - Math.log(tMin) || 1)) * pw;
    const y = (p) => T + ph - (p / pMax) * ph;

    const el = (n, a) => {
      const e = document.createElementNS(NS, n);
      for (const k in a) e.setAttribute(k, a[k]);
      return e;
    };
    const text = (s, a) => {
      const e = el('text', { fill: 'var(--ink-3)', 'font-size': 11, 'font-family': 'ui-monospace, monospace', ...a });
      e.textContent = s;
      return e;
    };

    const step = pMax > 800 ? 200 : pMax > 400 ? 100 : 50;
    for (let p = step; p < pMax; p += step) {
      svg.appendChild(el('line', { x1: L, x2: L + pw, y1: y(p), y2: y(p), stroke: 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(text(p, { x: L - 7, y: y(p) + 4, 'text-anchor': 'end' }));
    }
    for (const [t] of pts) {
      if (![5, 30, 60, 300, 1200, 3600].includes(t)) continue;
      svg.appendChild(el('line', { x1: x(t), x2: x(t), y1: T, y2: T + ph, stroke: 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(text(M.formatTime(t), { x: x(t), y: T + ph + 18, 'text-anchor': 'middle' }));
    }

    const d = pts.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(p).toFixed(1)}`).join('');
    svg.appendChild(el('path', { d, fill: 'none', stroke: 'var(--brick)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    for (const [t, p] of pts) {
      const c = el('circle', { cx: x(t), cy: y(p), r: 3.2, fill: 'var(--brick)', stroke: 'var(--ground)', 'stroke-width': 2 });
      c.appendChild(el('title', {})).textContent = `${M.formatTime(t)} — ${Math.round(p)} W`;
      svg.appendChild(c);
    }
  }

  const SORTERS = {
    name: (r) => r.name.toLowerCase(),
    distance: (r) => r.distance,
    grade: (r) => r.grade,
    komTime: (r) => (isFinite(r.komTime) ? r.komTime : Infinity),
    prTime: (r) => (isFinite(r.prTime) ? r.prTime : Infinity),
    requiredWatts: (r) => (isFinite(r.requiredWatts) ? r.requiredWatts : Infinity),
    requiredWkg: (r) => (isFinite(r.requiredWkg) ? r.requiredWkg : Infinity),
    gap: (r) => (isFinite(r.gap) ? r.gap : Infinity),
    verdict: (r) => ['live', 'close', 'stretch', 'out', 'unknown'].indexOf(r.verdict.key)
  };

  function renderResults() {
    const rows = state.assessed || [];
    show('#results-card', rows.length > 0);
    if (!rows.length) return;

    const q = state.search.trim().toLowerCase();
    let view = rows.filter((r) => {
      if (state.filter !== 'all' && r.verdict.key !== state.filter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });

    const get = SORTERS[state.sort.key] || SORTERS.gap;
    view = view.slice().sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return state.sort.dir === 'asc' ? cmp : -cmp;
    });

    const counts = rows.reduce((acc, r) => {
      acc[r.verdict.key] = (acc[r.verdict.key] || 0) + 1;
      return acc;
    }, {});
    $('#results-chip').textContent =
      `${counts.live || 0} live · ${counts.close || 0} in reach · ${counts.stretch || 0} stretch · ${counts.out || 0} out`;

    $('#results tbody').innerHTML = view
      .map((r) => {
        const gap = isFinite(r.gap)
          ? r.gap <= 0
            ? `+${Math.round(-r.gap)} W`
            : `−${Math.round(r.gap)} W`
          : '—';
        const flag = r.extrapolated
          ? '<span class="flag" title="This KOM is longer than any effort in your power curve, so the comparison is extrapolated.">est</span>'
          : '';
        return (
          `<tr class="r-${r.verdict.key}">` +
          `<td><a href="https://www.strava.com/segments/${r.id}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a>${flag}</td>` +
          `<td class="mono">${(r.distance / 1000).toFixed(2)} km</td>` +
          `<td class="mono">${isFinite(r.grade) ? r.grade.toFixed(1) : '—'}%</td>` +
          `<td class="mono">${M.formatTime(r.komTime)}</td>` +
          `<td class="mono">${M.formatTime(r.prTime)}</td>` +
          `<td class="mono">${isFinite(r.requiredWatts) ? Math.round(r.requiredWatts) : '—'}</td>` +
          `<td class="mono">${isFinite(r.requiredWkg) ? r.requiredWkg.toFixed(1) : '—'}</td>` +
          `<td class="mono">${gap}</td>` +
          `<td><span class="pill v-${r.verdict.key}">${r.verdict.label}</span></td>` +
          '</tr>'
        );
      })
      .join('');

    $('#results-note').textContent =
      `Showing ${view.length} of ${rows.length}. "Needs" is the power the KOM time demands ` +
      `${state.settings.style === 'draft' ? 'with a wheel to follow' : 'riding solo'}; shortfall compares it to your best ` +
      'power for that duration.';

    $$('#results th[data-sort]').forEach((th) => {
      if (th.dataset.sort === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // -------------------------------------------------------------- wiring ---

  function wire() {
    $('#connect').addEventListener('click', () => connect($('#token').value));
    $('#token').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') connect($('#token').value);
    });

    $('#forget').addEventListener('click', () => {
      S.clearToken();
      state.athlete = null;
      show('#connected', false);
      show('#connect-form', true);
      show('#setup-card', false);
      $('#conn-chip').textContent = 'Not connected';
      $('#conn-chip').className = 'chip';
      $('#token').value = '';
    });

    $('#clear-cache').addEventListener('click', () => {
      const n = S.clearCache();
      localStorage.removeItem(RESULTS_KEY);
      localStorage.removeItem(CURVE_KEY);
      localStorage.removeItem(CAL_KEY);
      state.curve = {};
      state.rows = [];
      state.assessed = [];
      show('#results-card', false);
      show('#power-card', false);
      logLine(`Cleared ${n} cached records.`);
      show('#progress-card', true);
    });

    $('#analyse').addEventListener('click', analyse);
    $('#refresh-power').addEventListener('click', buildPowerCurve);
    $('#manual-apply').addEventListener('click', applyManualCurve);

    ['#rider-kg', '#bike-kg', '#style'].forEach((sel) =>
      $(sel).addEventListener('change', () => {
        readSettings();
        if (state.rows.length) reassess();
        if (Object.keys(state.curve).length) renderCurve();
      })
    );
    $('#ride-count').addEventListener('change', readSettings);

    $('#verdict-filter').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      state.filter = btn.dataset.v;
      $$('#verdict-filter button').forEach((b) => b.classList.toggle('on', b === btn));
      renderResults();
    });

    $('#search').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderResults();
    });

    $$('#results th[data-sort]').forEach((th) =>
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        else state.sort = { key, dir: key === 'name' ? 'asc' : 'asc' };
        renderResults();
      })
    );
  }

  // ---------------------------------------------------------------- boot ---

  function boot() {
    state.settings = load(SETTINGS_KEY, state.settings);
    writeSettings();
    wire();

    const cached = load(CURVE_KEY, null);
    if (cached && cached.curve) {
      state.curve = cached.curve;
      state.curveSource = cached.source;
      renderCurve();
    }
    state.calibration = load(CAL_KEY, null);

    const rows = load(RESULTS_KEY, null);
    if (rows && rows.length) {
      state.rows = rows;
      reassess();
    }

    if (S.hasToken()) {
      $('#token').value = '';
      connect();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
