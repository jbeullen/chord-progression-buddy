/*
 * Tests for the Strava client. No framework, no network — a fake fetch and an
 * in-memory store are injected, so what is under test is the request, cache,
 * rate-limit and error-mapping logic rather than Strava itself.
 */
const path = require('path');
const S = require(path.join(__dirname, '..', 'js', 'strava.js'));

let passed = 0;
const failures = [];

const is = (a, e, label) => {
  if (a === e) passed++;
  else failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`);
};
const ok = (c, label) => {
  if (c) passed++;
  else failures.push(label);
};

// ------------------------------------------------------------ fixtures ---

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => Array.from(map.keys())[i],
    get length() {
      return map.size;
    },
    _map: map
  };
}

function headers(obj) {
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  return { get: (k) => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null) };
}

/* Records every call and replies from a queue of scripted responses. */
function fakeFetch(script) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const next = script.shift();
    if (!next) throw new Error('fake fetch ran out of scripted responses');
    if (next.throw) throw new Error(next.throw);
    return {
      ok: next.status === undefined || (next.status >= 200 && next.status < 300),
      status: next.status || 200,
      headers: headers(next.headers || {}),
      json: async () => next.body
    };
  };
  fn.calls = calls;
  return fn;
}

const setup = (script) => {
  const store = memoryStore();
  const f = fakeFetch(script);
  S.configure({ fetch: f, store });
  S.setToken('test-token');
  return { store, f };
};

// --------------------------------------------------------------- token ---

{
  const store = memoryStore();
  S.configure({ fetch: fakeFetch([]), store });
  ok(!S.hasToken(), 'no token to begin with');
  S.setToken('  abc123  ');
  is(S.getToken(), 'abc123', 'token is trimmed on the way in');
  ok(S.hasToken(), 'hasToken sees a stored token');
  S.clearToken();
  ok(!S.hasToken(), 'clearToken removes it');
}

// ---------------------------------------------------------- rate limit ---

S.readRateHeaders(headers({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '42,300' }));
{
  const r = S.rateStatus();
  is(r.shortUsed, 42, 'reads short-window usage');
  is(r.dayUsed, 300, 'reads daily usage');
  is(r.shortLeft, 58, 'computes short-window headroom');
  is(r.dayLeft, 700, 'computes daily headroom');
  ok(!S.budgetExhausted(), '42 of 100 is not exhausted');
}

S.readRateHeaders(headers({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '96,300' }));
ok(S.budgetExhausted(), 'stops short of the limit, keeping a reserve');
S.readRateHeaders(headers({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '0,0' }));
ok(!S.budgetExhausted(), 'a fresh window is not exhausted');

// A response with no rate headers must not wipe what is known.
S.readRateHeaders(headers({}));
is(S.rateStatus().shortUsed, 0, 'missing headers leave the last reading alone');
ok(S.rateStatus().measured, 'usage read from headers is reported as measured');

// ------------------------------------------------------------ requests ---

(async () => {
  {
    const { f } = setup([{ body: { id: 8688258, weight: 74 } }]);
    const athlete = await S.getAthlete();
    is(athlete.id, 8688258, 'getAthlete returns the parsed body');
    ok(f.calls[0].startsWith('https://www.strava.com/api/v3/athlete'), 'calls the athlete endpoint');
  }

  {
    const { f } = setup([{ body: [] }]);
    await S.getActivities({ page: 2, perPage: 50, after: 1000 });
    const url = new URL(f.calls[0]);
    is(url.searchParams.get('page'), '2', 'passes the page through');
    is(url.searchParams.get('per_page'), '50', 'passes per_page through');
    is(url.searchParams.get('after'), '1000', 'passes the after cursor through');
  }

  {
    // undefined params must not become the string "undefined"
    const { f } = setup([{ body: [] }]);
    await S.getActivities({ page: 1 });
    ok(!f.calls[0].includes('after='), 'omits absent parameters');
  }

  // ------------------------------------------------------------- cache ---

  {
    const { f } = setup([{ body: { id: 670732, name: 'Grasbos' } }]);
    const first = await S.getSegment(670732);
    const second = await S.getSegment(670732);
    is(first.name, 'Grasbos', 'segment fetched');
    is(second.name, 'Grasbos', 'second read served from cache');
    is(f.calls.length, 1, 'a cached segment costs no second request');
  }

  {
    const { store } = setup([{ body: { id: 1 } }]);
    await S.getSegment(1);
    ok(S.cacheSize() === 1, 'cacheSize counts cached entries');
    const removed = S.clearCache();
    is(removed, 1, 'clearCache reports what it removed');
    is(S.cacheSize(), 0, 'cache is empty afterwards');
    ok(store.getItem('kom.token') === 'test-token', 'clearing the cache keeps the token');
  }

  // ---------------------------------------------------------- pagination ---

  {
    const page1 = new Array(200).fill(0).map((_, i) => ({ id: i }));
    const { f } = setup([{ body: page1 }, { body: [{ id: 999 }] }]);
    const all = await S.getStarredSegments();
    is(all.length, 201, 'follows pagination until a short page');
    is(f.calls.length, 2, 'stops after the short page');
  }

  {
    const { f } = setup([{ body: [{ id: 1 }] }]);
    let reported = 0;
    await S.getStarredSegments((n) => {
      reported = n;
    });
    is(reported, 1, 'reports progress to the caller');
    is(f.calls.length, 1, 'a single short page is one request');
  }

  // -------------------------------------------------------------- errors ---

  const expectError = async (script, kind, label) => {
    setup(script);
    try {
      await S.getAthlete();
      failures.push(`${label}\n    expected a ${kind} error, got success`);
    } catch (e) {
      is(e.kind, kind, label);
    }
  };

  await expectError([{ status: 401, body: { message: 'Authorization Error' } }], 'auth', '401 maps to an auth error');
  await expectError([{ status: 403, body: { message: 'Forbidden' } }], 'scope', '403 maps to a scope error');
  await expectError([{ status: 404, body: {} }], 'missing', '404 maps to a missing error');
  await expectError([{ status: 429, body: {} }], 'rate', '429 maps to a rate error');
  await expectError([{ status: 500, body: {} }], 'http', '500 maps to a generic http error');
  await expectError([{ throw: 'offline' }], 'network', 'a thrown fetch maps to a network error');

  {
    // An error body that is not JSON must not mask the status.
    setup([{ status: 502, body: undefined }]);
    try {
      await S.getAthlete();
      failures.push('502 with an unparseable body should throw');
    } catch (e) {
      is(e.status, 502, 'keeps the status when the error body is not JSON');
    }
  }

  {
    const store = memoryStore();
    S.configure({ fetch: fakeFetch([{ body: {} }]), store });
    S.clearToken();
    try {
      await S.getAthlete();
      failures.push('a missing token should throw before fetching');
    } catch (e) {
      is(e.kind, 'auth', 'refuses to fetch without a token');
    }
  }

  // ------------------------------------------------------------- streams ---

  {
    setup([{ body: { watts: { data: [100, 200, 300] } } }]);
    const s = await S.getWattsStream(1);
    is(JSON.stringify(s), '[100,200,300]', 'unwraps the watts stream');
  }

  {
    setup([{ body: { time: { data: [0, 1] } } }]);
    is(await S.getWattsStream(2), null, 'a ride with no power stream yields null');
  }

  {
    setup([{ status: 404, body: {} }]);
    is(await S.getWattsStream(3), null, 'a 404 on streams is treated as no power data');
  }

  {
    // Scope failures on zones are soft: the app asks for FTP by hand instead.
    setup([{ status: 403, body: { message: 'Forbidden' } }]);
    is(await S.getZones(), null, 'a scope failure on zones returns null rather than throwing');
  }

  {
    setup([{ status: 500, body: {} }]);
    try {
      await S.getZones();
      failures.push('a server error on zones should propagate');
    } catch (e) {
      is(e.kind, 'http', 'a server error on zones still throws');
    }
  }

  // ---------------------------------------------------- budget guarding ---

  {
    setup([{ body: {}, headers: { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '99,500' } }]);
    await S.getAthlete();
    try {
      await S.getAthlete();
      failures.push('should refuse once the budget is spent');
    } catch (e) {
      is(e.kind, 'rate', 'refuses further requests once the budget is spent');
    }
  }

  // ------------------------------- budget without readable rate headers ---

  {
    /* Cross-origin responses hide custom headers unless the server exposes
     * them, so the client falls back to counting its own requests. */
    setup([{ body: {} }, { body: {} }, { body: {} }]);
    ok(!S.rateStatus().measured, 'with no headers, usage is an estimate');
    await S.getAthlete();
    await S.getAthlete();
    await S.getAthlete();
    const r = S.rateStatus();
    is(r.shortUsed, 3, 'counts its own requests when headers are unreadable');
    is(r.shortLeft, 97, 'derives headroom from the local tally');
    ok(!r.measured, 'still reported as an estimate');
  }

  {
    // Real headers take over from the estimate as soon as one arrives.
    setup([{ body: {}, headers: { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '70,400' } }]);
    await S.getAthlete();
    const r = S.rateStatus();
    ok(r.measured, "Strava's own counters take precedence once seen");
    is(r.shortUsed, 70, 'uses the reported usage, not the local count of 1');
  }

  // ------------------------------------------------------------- report ---

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n`);
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    console.error(`${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`${passed} passed`);
})();
