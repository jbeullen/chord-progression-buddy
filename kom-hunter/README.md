# KOM Hunter

Cross-references your starred Strava segments against your own power-duration
curve, and tells you which KOMs are actually in range.

Every KOM is a time. A time on a known length and gradient is a wattage. Your
own rides say what wattage you can hold for that long. Put those together and
"could I take this KOM?" stops being a feeling and becomes a number — one you
either have, or are short by.

No dependencies, no backend, no framework. Three scripts and a stylesheet;
the build step is optional and only bundles them into one file.

```
npm start     # serve at http://localhost:8080
npm test      # unit tests for the model and the API client
npm run build # inline everything into one self-contained dist/kom-hunter.html
```

`npm run build -- --demo` produces a build with the network transport swapped
for fixtures — the whole app, clickable without a token, for showing someone
what it does.

## What it does

1. Reads your starred segments and each one's current KOM time.
2. Builds your power-duration curve from the watts streams of your recent
   rides — the best average power you have actually held at every duration
   from 5 seconds to an hour.
3. Calibrates the physics to *you*, by fitting rolling resistance and an
   elevation correction against your own recorded climbing efforts.
4. Prices every KOM in watts and sorts by how far short you are.

Verdicts are banded by percentage of the required power, not raw watts — being
40 W short of a 600 W sprint is a different proposition from 40 W short of a
250 W drag.

| Verdict | Meaning |
| --- | --- |
| **Live** | You already produce more than the KOM demands. |
| **In reach** | Within 8%. A run-up, fresh legs and the right wind could cover it. |
| **A stretch** | Within 20%. Realistic after a block targeting that duration. |
| **Out of range** | More than 20% short. Not coming back with pacing or equipment. |

## Getting a token

The app asks for a Strava access token and keeps it in your browser's local
storage. It is sent to `api.strava.com` and nowhere else. There is no server
in this project to send it to.

Strava's token exchange requires a client secret, which a static site cannot
hold safely, so the exchange is done once by you on the command line:

1. Create an API application at [strava.com/settings/api](https://www.strava.com/settings/api).
   Note the **Client ID** and **Client Secret**.

2. Authorise your own app by visiting this URL, with your client ID
   substituted in:

   ```
   https://www.strava.com/oauth/authorize?client_id=YOUR_ID&redirect_uri=http://localhost&response_type=code&scope=read,activity:read_all,profile:read_all
   ```

   Approve it. The browser lands on a dead `localhost` page — that is expected.
   Copy the `code` parameter out of the address bar.

3. Exchange the code for a token:

   ```sh
   curl -X POST https://www.strava.com/oauth/token \
     -d client_id=YOUR_ID \
     -d client_secret=YOUR_SECRET \
     -d code=THE_CODE \
     -d grant_type=authorization_code
   ```

   Paste the `access_token` from the response into the app.

Tokens last six hours. When one expires the app says so; repeat step 3 with
`grant_type=refresh_token` and `refresh_token=…` to get another.

### Scopes

| Scope | Needed for |
| --- | --- |
| `read` | Starred segments and their KOM times |
| `activity:read_all` | Watts streams, so the power curve can be built |
| `profile:read_all` | Power zones (optional — the app works without it) |

Without `activity:read_all` you can still use the app: open **No power meter?
Enter your numbers by hand** and type in your best 5-second, 1-minute,
5-minute and 20-minute power.

## The rate limit is the hard part

Strava allows **100 requests per 15 minutes** and 1000 per day, and a first run
costs roughly one request per starred segment plus one per ride scanned. A
hundred starred segments will not fit in one window.

So:

- Every segment detail and every computed ride curve is **cached in local
  storage**. A second run costs almost nothing.
- Long jobs **write down what they have as they go**. If the limit is reached
  halfway, the segments already fetched are kept and the next run resumes from
  the cache rather than starting over.
- The header shows what is left in the current window. When Strava's rate-limit
  headers are readable it shows their numbers; when the browser hides them
  (they are custom headers, exposed only if the server permits it) it falls
  back to counting this tab's own requests and says so.

If you have a large starred list, expect the first run to take two or three
15-minute windows. Just press **Analyse starred segments** again each time.

## The model

Steady-state power against distance, elevation gain and time:

```
P = ( m·g·(Crr·cos θ + sin θ)·v  +  ½·ρ·CdA·v³ ) / drivetrain
```

Defaults: ρ 1.225 kg/m³, drivetrain efficiency 0.976, CdA 0.33 solo or 0.25
following a wheel. Rider and bike mass come from the settings panel.

`Crr` and an elevation-correction factor are **fitted to your own efforts** —
climbs steeper than 3%, longer than 150 m, with recorded power. Strava's
barometric elevation gain tends to read low on short climbs, and that factor
absorbs it. Against one athlete's twelve local climbs the fit lands within
about 4% RMS.

CdA is deliberately *not* fitted. Efforts recorded in a group carry an unknown
amount of draft, and a free CdA would quietly absorb it and then under-predict
a solo attempt.

### What it cannot know

- **Wind.** On an exposed flat segment this dominates everything else.
- **Whether the KOM was set in a bunch.** Many flat sprint KOMs were set with a
  lead-out; matching one solo needs considerably more power than the model says.
- **Rolling terrain.** Average gradient understates a segment that pitches up
  and down, because you lose more into the fast parts than you gain on the slow.
- **Surface and tyres**, beyond what the fitted `Crr` picked up.

Treat a **live** or **in reach** verdict as a reason to go and try, not a
promise. Treat **out of range** as reliable — that gap does not close on a good
day.

## Testing

```sh
npm test              # model + API client, no network, no dependencies
node tests/e2e.js     # drives the real page with a mocked Strava API
```

The end-to-end test needs Playwright available (it is not a dependency of this
project) and mocks Strava at the network layer, so the request wrapper, cache,
rendering, sorting and filtering all execute for real.

**The live Strava API has not been exercised.** Every test here runs against a
mock, because the machine this was written on cannot reach `strava.com`. The
request shapes follow Strava's v3 documentation, but the first real token is
also the first real test — if an endpoint answers differently than expected,
that is where it will show.

## Layout

```
index.html        markup and copy
css/styles.css    tokens, light and dark themes
js/model.js       physics and power maths — pure, no DOM, no network
js/strava.js      API client: token, cache, rate limiting, error mapping
js/app.js         state, sync flow, rendering
tests/            model, client, and browser end-to-end
tools/            optional single-file bundler and its demo fixtures
```

`model.js` is the piece worth trusting: it has no dependencies on the browser
or the network, and its tests are anchored to real recorded power data.

## Running it from a file

The single-file build opens straight from disk, but a page loaded over
`file://` has a `null` origin, and Strava may refuse the cross-origin call.
If the browser blocks it, serve the file over http instead — any static
server will do:

```sh
npx http-server dist -p 8080     # then open http://localhost:8080/kom-hunter.html
```

## Licence

MIT.
