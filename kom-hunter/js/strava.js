/*
 * strava.js — everything that talks to Strava, and nothing that does maths.
 *
 * The API allows 100 requests per 15 minutes and 1000 per day, which a naive
 * "fetch every starred segment and every activity stream" would burn through
 * on the first run. Two things keep it inside the budget:
 *
 *   - a persistent cache, because a past activity's power stream and a
 *     segment's KOM change rarely or never, and
 *   - a serial request queue that reads the rate-limit headers Strava returns
 *     and stops before the API starts refusing.
 *
 * The token is whatever the user pasted in. It is held in localStorage and
 * sent as a bearer token; it is never sent anywhere except api.strava.com.
 */
const Strava = (() => {
  const BASE = 'https://www.strava.com/api/v3';
  const TOKEN_KEY = 'kom.token';
  const CACHE_PREFIX = 'kom.cache.';
  const CACHE_VERSION = 'v1';

  let fetchImpl = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null;
  let store = typeof localStorage !== 'undefined' ? localStorage : null;

  /* Seam for tests: swap in a fake fetch and an in-memory store, and start the
   * request tally from clean. */
  function configure(o = {}) {
    if (o.fetch) fetchImpl = o.fetch;
    if (o.store) store = o.store;
    stamps = [];
    rate.updated = null;
    rate.shortUsed = 0;
    rate.dayUsed = 0;
  }

  // -------------------------------------------------------------- token ---

  const getToken = () => (store ? store.getItem(TOKEN_KEY) || '' : '');
  const setToken = (t) => store && store.setItem(TOKEN_KEY, String(t || '').trim());
  const clearToken = () => store && store.removeItem(TOKEN_KEY);
  const hasToken = () => getToken().length > 0;

  // -------------------------------------------------------------- cache ---

  const cacheKey = (k) => `${CACHE_PREFIX}${CACHE_VERSION}.${k}`;

  function cacheGet(k) {
    if (!store) return null;
    try {
      const raw = store.getItem(cacheKey(k));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /* A full quota's worth of streams can outgrow the 5 MB localStorage budget.
   * When it does, drop the cache rather than letting the write throw and take
   * the run down with it. */
  function cacheSet(k, value) {
    if (!store) return;
    try {
      store.setItem(cacheKey(k), JSON.stringify(value));
    } catch {
      clearCache();
      try {
        store.setItem(cacheKey(k), JSON.stringify(value));
      } catch {
        /* still too big — proceed uncached */
      }
    }
  }

  function clearCache() {
    if (!store) return 0;
    const doomed = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
    return doomed.length;
  }

  function cacheSize() {
    if (!store) return 0;
    let n = 0;
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) n++;
    }
    return n;
  }

  // --------------------------------------------------------- rate limit ---

  /* Strava reports usage as "short,long" against limits "short,long", where
   * short is the 15-minute window.
   *
   * Those are custom headers, so a browser only lets us read them when the
   * response carries Access-Control-Expose-Headers. When it does not, the
   * counters below stand in: every request is timestamped locally and the
   * 15-minute window is counted from that. The estimate is conservative — it
   * cannot see requests this app did not make — but it keeps the budget meter
   * honest instead of silently reading zero forever. */
  const rate = { shortUsed: 0, shortLimit: 100, dayUsed: 0, dayLimit: 1000, updated: null };
  const WINDOW_MS = 15 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  let stamps = [];

  const noteRequest = () => {
    const now = Date.now();
    stamps.push(now);
    stamps = stamps.filter((t) => now - t < DAY_MS);
  };
  const countedIn = (ms) => {
    const now = Date.now();
    return stamps.filter((t) => now - t < ms).length;
  };

  function readRateHeaders(headers) {
    if (!headers || !headers.get) return;
    const limit = headers.get('x-ratelimit-limit');
    const usage = headers.get('x-ratelimit-usage');
    if (limit) {
      const [s, d] = limit.split(',').map((n) => parseInt(n, 10));
      if (isFinite(s)) rate.shortLimit = s;
      if (isFinite(d)) rate.dayLimit = d;
    }
    if (usage) {
      const [s, d] = usage.split(',').map((n) => parseInt(n, 10));
      if (isFinite(s)) rate.shortUsed = s;
      if (isFinite(d)) rate.dayUsed = d;
      rate.updated = Date.now();
    }
  }

  /* Prefer Strava's own numbers; fall back to the local tally when the headers
   * were not readable. */
  function rateStatus() {
    const measured = rate.updated !== null;
    const shortUsed = measured ? rate.shortUsed : countedIn(WINDOW_MS);
    const dayUsed = measured ? rate.dayUsed : countedIn(DAY_MS);
    return {
      ...rate,
      measured,
      shortUsed,
      dayUsed,
      shortLeft: Math.max(0, rate.shortLimit - shortUsed),
      dayLeft: Math.max(0, rate.dayLimit - dayUsed)
    };
  }

  /* Keep a few requests in hand so an interactive action after a big sync does
   * not hit a wall. */
  const RESERVE = 5;
  function budgetExhausted() {
    const r = rateStatus();
    return r.shortUsed >= r.shortLimit - RESERVE || r.dayUsed >= r.dayLimit - RESERVE;
  }

  class StravaError extends Error {
    constructor(message, status, kind) {
      super(message);
      this.name = 'StravaError';
      this.status = status;
      this.kind = kind;
    }
  }

  function describe(status, body) {
    const msg = body && body.message ? body.message : '';
    switch (status) {
      case 401:
        return new StravaError(
          'Strava rejected the token. It has expired or was mistyped — paste a fresh one.',
          401,
          'auth'
        );
      case 403:
        return new StravaError(
          `Strava refused this request${msg ? ` (${msg})` : ''}. The token is missing a scope this needs.`,
          403,
          'scope'
        );
      case 404:
        return new StravaError('Strava has no such record.', 404, 'missing');
      case 429:
        return new StravaError('Rate limit reached. Strava allows 100 requests every 15 minutes — wait and continue.', 429, 'rate');
      default:
        return new StravaError(`Strava returned ${status}${msg ? `: ${msg}` : ''}.`, status, 'http');
    }
  }

  // ------------------------------------------------------------ request ---

  let chain = Promise.resolve();

  /* Serialised so the rate-limit headers from one response inform the next
   * request rather than a burst all reading stale numbers. */
  function request(path, params = {}) {
    const run = async () => {
      if (!hasToken()) throw new StravaError('No access token set.', 0, 'auth');
      if (budgetExhausted()) throw new StravaError('Rate limit nearly reached — stopping before Strava refuses.', 429, 'rate');

      const url = new URL(BASE + path);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }

      let res;
      noteRequest();
      try {
        res = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${getToken()}` } });
      } catch (e) {
        throw new StravaError(`Could not reach Strava (${e.message}).`, 0, 'network');
      }
      readRateHeaders(res.headers);

      if (!res.ok) {
        let body = null;
        try {
          body = await res.json();
        } catch {
          /* error bodies are not always JSON */
        }
        throw describe(res.status, body);
      }
      return res.json();
    };
    chain = chain.then(run, run);
    return chain;
  }

  /* Cached GET: the cache is checked first and only a miss costs a request. */
  async function cached(key, path, params) {
    const hit = cacheGet(key);
    if (hit !== null) return hit;
    const data = await request(path, params);
    cacheSet(key, data);
    return data;
  }

  // ---------------------------------------------------------- endpoints ---

  const getAthlete = () => request('/athlete');

  /* Zones need profile:read_all, which a read-only token will not have. The
   * caller treats null as "ask the user for their FTP instead". */
  async function getZones() {
    try {
      return await request('/athlete/zones');
    } catch (e) {
      if (e.kind === 'scope' || e.kind === 'auth') return null;
      throw e;
    }
  }

  async function getStarredSegments(onProgress) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await request('/segments/starred', { page, per_page: 200 });
      out.push(...batch);
      if (onProgress) onProgress(out.length);
      if (batch.length < 200) break;
    }
    return out;
  }

  const getSegment = (id) => cached(`segment.${id}`, `/segments/${id}`);

  const getActivities = ({ page = 1, perPage = 30, after, before } = {}) =>
    request('/athlete/activities', { page, per_page: perPage, after, before });

  const getActivity = (id) => cached(`activity.${id}`, `/activities/${id}`, { include_all_efforts: true });

  /* Only the watts stream is requested. Strava will not return one for a ride
   * recorded without a power meter, which surfaces as a 404. */
  async function getWattsStream(id) {
    try {
      const data = await request(`/activities/${id}/streams`, { keys: 'watts', key_by_type: true });
      return data && data.watts ? data.watts.data : null;
    } catch (e) {
      if (e.kind === 'missing') return null;
      throw e;
    }
  }

  return {
    configure,
    StravaError,
    getToken,
    setToken,
    clearToken,
    hasToken,
    cacheGet,
    cacheSet,
    clearCache,
    cacheSize,
    readRateHeaders,
    rateStatus,
    budgetExhausted,
    request,
    getAthlete,
    getZones,
    getStarredSegments,
    getSegment,
    getActivities,
    getActivity,
    getWattsStream
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Strava;
