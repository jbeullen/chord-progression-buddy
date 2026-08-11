/*
 * demo-fixtures.js — swaps the network transport for a stub, so the app can be
 * driven without a Strava token. Included only in the --demo build.
 *
 * Nothing in the app changes: the real client, cache, model and rendering all
 * run. Only the bytes coming back from fetch are fabricated.
 *
 * The power data is not fabricated. The watts streams below are generated to
 * reproduce a real measured power-duration curve exactly (see makeStream), and
 * the calibration efforts are real recorded climbs. The KOM times are the one
 * invented ingredient, which the banner says out loud.
 */
(() => {
  const ATHLETE = {
    id: 8688258,
    firstname: 'Jeroen',
    lastname: 'Beullens',
    weight: 74,
    city: 'Mechelen'
  };

  /* Measured: best power at each duration across seven rides, 7 Jul–10 Aug. */
  const CURVE = [
    [5, 797], [10, 760], [15, 724], [30, 614], [60, 456], [120, 368], [180, 317],
    [300, 275], [420, 250], [600, 226], [900, 225], [1200, 224], [1800, 219],
    [2700, 204], [3600, 199]
  ];

  const powerAt = (t) => {
    if (t <= CURVE[0][0]) return CURVE[0][1];
    if (t >= CURVE[CURVE.length - 1][0]) return CURVE[CURVE.length - 1][1];
    for (let i = 0; i < CURVE.length - 1; i++) {
      const [t0, p0] = CURVE[i];
      const [t1, p1] = CURVE[i + 1];
      if (t >= t0 && t <= t1) {
        const f = (Math.log(t) - Math.log(t0)) / (Math.log(t1) - Math.log(t0));
        return p0 + f * (p1 - p0);
      }
    }
    return CURVE[CURVE.length - 1][1];
  };

  /* A monotonically descending stream has its best window for every duration
   * starting at sample zero, so the running mean *is* the power curve. Solving
   * that backwards gives the sample values:
   *
   *     Σ(i<d) w[i] = d · P(d)   ⇒   w[d] = d·P(d) − (d−1)·P(d−1)
   *
   * which reproduces the target curve exactly at every duration rather than
   * approximately. Scale trims the whole curve for the supporting rides.
   */
  function makeStream(scale) {
    const n = 3600;
    const out = new Array(n);
    for (let d = 1; d <= n; d++) {
      out[d - 1] = Math.max(0, Math.round(d * powerAt(d) - (d - 1) * powerAt(d - 1)) * scale);
    }
    return out;
  }

  const ACTIVITIES = [
    { id: 19457748748, name: 'WTC Tilt: Poggio Diest', type: 'Ride', sport_type: 'Ride', device_watts: true },
    { id: 19666611094, name: 'WTC Tilt: Vlooiberg', type: 'Ride', sport_type: 'Ride', device_watts: true },
    { id: 19616981290, name: 'Peloton des Plaisances', type: 'Ride', sport_type: 'Ride', device_watts: true }
  ];
  const SCALE = { 19457748748: 1, 19666611094: 0.94, 19616981290: 0.9 };

  /* Real recorded climbing efforts — what the calibration fits against. */
  const EFFORTS = [
    { distance: 665.7, elapsed_time: 114, average_watts: 377.6, segment: { total_elevation_gain: 37.8 } },
    { distance: 632, elapsed_time: 114, average_watts: 377.5, segment: { total_elevation_gain: 40.8 } },
    { distance: 850.3, elapsed_time: 140, average_watts: 340.6, segment: { total_elevation_gain: 42.5 } },
    { distance: 442.6, elapsed_time: 107, average_watts: 329.8, segment: { total_elevation_gain: 34.5 } },
    { distance: 522.7, elapsed_time: 121, average_watts: 321.9, segment: { total_elevation_gain: 38.2 } },
    { distance: 955.4, elapsed_time: 192, average_watts: 289.0, segment: { total_elevation_gain: 47.6 } },
    { distance: 331.3, elapsed_time: 74, average_watts: 289.7, segment: { total_elevation_gain: 20.8 } },
    { distance: 778.9, elapsed_time: 139, average_watts: 285.4, segment: { total_elevation_gain: 36.3 } },
    { distance: 858.3, elapsed_time: 173, average_watts: 294.6, segment: { total_elevation_gain: 45.2 } },
    { distance: 541.9, elapsed_time: 93, average_watts: 280.5, segment: { total_elevation_gain: 18.0 } }
  ];

  /* Real segments, real lengths, real personal bests. The `kom` values are
   * invented — this build cannot reach Strava to read the real ones. */
  const SEG = (id, name, distance, gain, grade, pr, kom, efforts) => ({
    id, name, distance, total_elevation_gain: gain, average_grade: grade,
    effort_count: efforts, xoms: { kom }, athlete_segment_stats: { pr_elapsed_time: pr }
  });

  const SEGMENTS = {};
  [
    SEG(9697816, 'Klimmetje naar Temsebrug', 112.7, 0, 0.2, 12, '11s', 3400),
    SEG(3578700, 'staionsberg muizen', 185.1, 3.2, 1.7, 17, '15s', 1200),
    SEG(5131992, 'Brug AZ Sint Maarten', 218.2, 5.8, 2.7, 18, '16s', 2100),
    SEG(3578413, 'stationberg', 242.7, 6, 2.5, 22, '20s', 900),
    SEG(2279065, 'Spurtje Reetsestraat (langs E19)', 409.7, 0, 0.1, 31, '27s', 5200),
    SEG(1281476, 'Roeselberg Steil', 270.3, 16.2, 6.0, 51, '38s', 4100),
    SEG(26556447, 'Bosstraat steile stuk', 533.7, 18.6, 3.5, 60, '48s', 6800),
    SEG(13306013, 'Oude Waarloossteenweg', 1144.8, 0, 0.1, 81, '1:14', 3900),
    SEG(19301511, 'Roeselberg (Cotacol n°390)', 665.7, 37.8, 5.7, 114, '1:32', 9100),
    SEG(24852700, 'Huldenberg - the steep bit', 522.7, 38.2, 7.3, 121, '1:35', 5600),
    SEG(1184208, 'De Grubbe', 778.9, 36.3, 4.7, 139, '1:45', 12400),
    SEG(23942106, 'De Poggio van Ottenburg', 774.4, 35.6, 4.6, 149, '1:52', 2700),
    SEG(4280753, 'Holstheide (exact)', 955.4, 47.6, 5.0, 192, '2:28', 7300),
    SEG(873041, 'Neerijsesteenweg', 1399.7, 39.2, 2.8, 230, '2:45', 8800),
    SEG(36739639, 'Schunnebroek', 2235.4, 30, 1.3, 239, '3:25', 1500)
  ].forEach((s) => {
    SEGMENTS[s.id] = s;
  });

  // ------------------------------------------------------------- transport ---

  const reply = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body
  });

  /* A little latency, so progress and the rate meter behave as they would
   * against the real API rather than finishing before they are painted. */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function demoFetch(rawUrl) {
    const url = new URL(rawUrl);
    const p = url.pathname.replace('/api/v3', '');
    await wait(60);

    if (p === '/athlete') return reply(ATHLETE);
    if (p === '/athlete/zones') return reply({ power: { zones: [{ min: 0, max: 138 }] }, ftp: 250 });
    if (p === '/athlete/activities') {
      return reply(url.searchParams.get('page') === '1' ? ACTIVITIES : []);
    }

    let m = p.match(/^\/activities\/(\d+)\/streams$/);
    if (m) return reply({ watts: { data: makeStream(SCALE[m[1]] || 0.9) } });

    m = p.match(/^\/activities\/(\d+)$/);
    if (m) return reply({ id: Number(m[1]), segment_efforts: EFFORTS });

    if (p === '/segments/starred') {
      return reply(
        url.searchParams.get('page') === '1'
          ? Object.values(SEGMENTS).map((s) => ({ id: s.id, name: s.name }))
          : []
      );
    }

    m = p.match(/^\/segments\/(\d+)$/);
    if (m && SEGMENTS[m[1]]) return reply(SEGMENTS[m[1]]);

    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  }

  // ------------------------------------------------------------------ boot ---

  // Start every visit from clean, so the demo is the same for everyone.
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('kom.')) localStorage.removeItem(k);
  }

  Strava.configure({ fetch: demoFetch });
  Strava.setToken('demo-token');

  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML =
      '<strong>Demo build.</strong> No Strava connection — the API is stubbed out, so you can click ' +
      'through without a token. The athlete, segments, lengths, gradients and personal bests are real, ' +
      'and the power curve is generated to reproduce a real measured one exactly. ' +
      '<strong>The KOM times are invented</strong>, because this build cannot reach Strava to read them. ' +
      'Press <em>Analyse starred segments</em> to run it.';
    document.querySelector('main').prepend(banner);

    const token = document.getElementById('token');
    if (token) token.value = 'demo-token';
  });
})();
