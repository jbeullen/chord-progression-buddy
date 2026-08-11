/*
 * End-to-end smoke test. Drives the real page in a real browser with the
 * Strava API mocked at the network layer, so the request wrapper, cache,
 * rendering and sort/filter code all run for real.
 *
 * Playwright is not a dependency of this project — install it where you need
 * it and run:  node tests/e2e.js
 */
const path = require('path');
const { chromium } = require('playwright');

const ATHLETE = { id: 8688258, firstname: 'Jeroen', lastname: 'Beullens', weight: 74, city: 'Mechelen' };

const ACTIVITIES = [
  { id: 101, name: 'Club ride', type: 'Ride', sport_type: 'Ride', device_watts: true },
  { id: 102, name: 'Gravel', type: 'GravelRide', sport_type: 'GravelRide', device_watts: true },
  { id: 103, name: 'No meter', type: 'Ride', sport_type: 'Ride', device_watts: false }
];

/* A stream with a big sprint and a long steady block, so the curve has shape. */
function stream(peak, base) {
  const s = new Array(1800).fill(base);
  for (let i = 300; i < 315; i++) s[i] = peak;
  for (let i = 600; i < 900; i++) s[i] = base * 1.6;
  return s;
}

const SEGMENTS = {
  // A short sprint the rider should be able to take.
  1: {
    id: 1, name: 'Stationsberg sprint', distance: 200, total_elevation_gain: 3,
    average_grade: 1.5, effort_count: 40,
    xoms: { kom: '18s' }, athlete_segment_stats: { pr_elapsed_time: 22 }
  },
  // A steep climb well out of reach.
  2: {
    id: 2, name: 'Roeselberg', distance: 665, total_elevation_gain: 38,
    average_grade: 5.7, effort_count: 900,
    xoms: { kom: '1:32' }, athlete_segment_stats: { pr_elapsed_time: 114 }
  },
  // A long drag whose KOM outlasts the 30-minute streams the curve is built
  // from, so the comparison has to be extrapolated.
  3: {
    id: 3, name: 'Long drag', distance: 20000, total_elevation_gain: 20,
    average_grade: 0.1, effort_count: 120,
    xoms: { kom: '35:00' }, athlete_segment_stats: { pr_elapsed_time: 2400 }
  },
  // No KOM recorded at all.
  4: {
    id: 4, name: 'Unranked lane', distance: 500, total_elevation_gain: 2,
    average_grade: 0.4, effort_count: 1,
    xoms: null, athlete_segment_stats: {}
  }
};

const json = (body) => ({
  status: 200,
  contentType: 'application/json',
  headers: { 'x-ratelimit-limit': '100,1000', 'x-ratelimit-usage': '10,50' },
  body: JSON.stringify(body)
});

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`);
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Failed HTTP responses are logged by the browser itself; the 401 case is
    // deliberately provoked below, so only script errors count here.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  const calls = [];
  await page.route('**/api.strava.com/**', () => {});
  await page.route('https://www.strava.com/api/v3/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace('/api/v3', '');
    calls.push(p);

    if (p === '/athlete') return route.fulfill(json(ATHLETE));
    if (p === '/athlete/zones') return route.fulfill(json({ power: { zones: [{ min: 0, max: 138 }] } }));
    if (p === '/athlete/activities') {
      return route.fulfill(json(url.searchParams.get('page') === '1' ? ACTIVITIES : []));
    }
    let m = p.match(/^\/activities\/(\d+)\/streams$/);
    if (m) {
      const peak = m[1] === '101' ? 900 : 700;
      return route.fulfill(json({ watts: { data: stream(peak, 180) } }));
    }
    m = p.match(/^\/activities\/(\d+)$/);
    if (m) {
      return route.fulfill(json({
        id: Number(m[1]),
        segment_efforts: [
          { distance: 400, elapsed_time: 90, average_watts: 330, segment: { total_elevation_gain: 30 } },
          { distance: 600, elapsed_time: 130, average_watts: 320, segment: { total_elevation_gain: 45 } },
          { distance: 800, elapsed_time: 170, average_watts: 300, segment: { total_elevation_gain: 50 } },
          { distance: 500, elapsed_time: 110, average_watts: 315, segment: { total_elevation_gain: 40 } },
          { distance: 700, elapsed_time: 150, average_watts: 305, segment: { total_elevation_gain: 55 } }
        ]
      }));
    }
    if (p === '/segments/starred') {
      return route.fulfill(json(url.searchParams.get('page') === '1' ? Object.values(SEGMENTS).map((s) => ({ id: s.id, name: s.name })) : []));
    }
    m = p.match(/^\/segments\/(\d+)$/);
    if (m) return route.fulfill(json(SEGMENTS[m[1]]));

    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));

  console.log('\ninitial state');
  // `.card` sets display:flex, which beats the UA rule for [hidden] unless the
  // stylesheet says otherwise — so assert the collapsed sections really are.
  for (const sel of ['#setup-card', '#progress-card', '#power-card', '#results-card', '#error-card']) {
    check(!(await page.isVisible(sel)), `${sel} is hidden before connecting`);
  }

  console.log('\nconnect');
  await page.fill('#token', 'fake-token');
  await page.click('#connect');
  await page.waitForSelector('#connected:not([hidden])');
  check((await page.textContent('#who-name')).includes('Jeroen'), 'athlete name shown after connecting');
  check(await page.isVisible('#setup-card'), 'settings appear once connected');
  check((await page.inputValue('#rider-kg')) === '74', 'rider weight seeded from the Strava profile');
  check(await page.isVisible('#rate'), 'rate-limit meter appears');

  console.log('\nanalyse');
  await page.click('#analyse');
  await page.waitForSelector('#results-card:not([hidden])', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#results tbody tr').length >= 4, null, { timeout: 20000 });

  const rows = await page.$$eval('#results tbody tr', (trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()))
  );
  check(rows.length === 4, `all four starred segments assessed (got ${rows.length})`);

  const byName = Object.fromEntries(rows.map((r) => [r[0].replace('est', '').trim(), r]));
  check(!!byName['Stationsberg sprint'], 'sprint segment present');
  check(byName['Roeselberg'][3] === '1:32', 'KOM time parsed from Strava display string');
  check(byName['Roeselberg'][4] === '1:54', "athlete's PB shown");
  check(byName['Unranked lane'][8] === 'No KOM', 'a segment with no KOM is marked, not crashed on');
  check(/^\d+$/.test(byName['Roeselberg'][5]), 'required watts computed for the climb');

  const powerVisible = await page.isVisible('#power-card');
  check(powerVisible, 'power curve card rendered');
  const curvePts = await page.$$eval('#curve circle', (c) => c.length);
  check(curvePts > 5, `power curve drawn with ${curvePts} points`);
  check((await page.textContent('#power-chip')).includes('2 rides'), 'only the two rides with power were used');

  const calLogged = await page.$$eval('#log li', (ls) => ls.some((l) => /Calibrated on \d+/.test(l.textContent)));
  check(calLogged, 'calibration ran against the athlete’s own climbs');

  console.log('\nfilter and sort');
  await page.click('#verdict-filter button[data-v="out"]');
  const outRows = await page.$$eval('#results tbody tr', (t) => t.length);
  check(outRows > 0 && outRows < 4, `verdict filter narrows the table (${outRows} of 4)`);
  await page.click('#verdict-filter button[data-v="all"]');

  await page.fill('#search', 'roesel');
  check((await page.$$eval('#results tbody tr', (t) => t.length)) === 1, 'search filters by name');
  await page.fill('#search', '');

  await page.click('#results th[data-sort="distance"]');
  const firstAsc = await page.textContent('#results tbody tr:first-child td:first-child');
  await page.click('#results th[data-sort="distance"]');
  const firstDesc = await page.textContent('#results tbody tr:first-child td:first-child');
  check(firstAsc !== firstDesc, 'clicking a header twice reverses the sort');

  console.log('\nextrapolation flag');
  check(rows.some((r) => r[0].includes('est')), 'a KOM longer than the curve is flagged as estimated');

  await page.screenshot({ path: path.join(__dirname, 'e2e-screenshot.png'), fullPage: true });

  console.log('\nsettings re-run the model without new requests');
  const before = calls.length;
  await page.selectOption('#style', 'draft');
  await page.waitForTimeout(200);
  const draftWatts = await page.textContent('#results tbody tr:first-child td:nth-child(6)');
  await page.selectOption('#style', 'solo');
  await page.waitForTimeout(200);
  const soloWatts = await page.textContent('#results tbody tr:first-child td:nth-child(6)');
  check(calls.length === before, 'changing attack style costs no API requests');
  check(Number(soloWatts) > Number(draftWatts), 'attacking solo requires more watts than following a wheel');

  console.log('\ncaching');
  const beforeReload = calls.length;
  await page.reload();
  await page.waitForSelector('#results-card:not([hidden])');
  check((await page.$$eval('#results tbody tr', (t) => t.length)) === 4, 'results survive a reload');
  await page.click('#analyse');
  await page.waitForFunction(() => document.querySelectorAll('#results tbody tr').length >= 4);
  const segmentRefetches = calls.slice(beforeReload).filter((p) => /^\/segments\/\d+$/.test(p)).length;
  check(segmentRefetches === 0, 'a second run serves every segment from cache');

  console.log('\nerror handling');
  await page.evaluate(() => localStorage.clear());
  await page.route('https://www.strava.com/api/v3/athlete', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Authorization Error' }) })
  );
  await page.reload();
  await page.fill('#token', 'bad-token');
  await page.click('#connect');
  await page.waitForSelector('#error-card:not([hidden])');
  check((await page.textContent('#error-text')).includes('expired'), 'a 401 explains the token has expired');

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);

  await browser.close();

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
