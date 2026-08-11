/*
 * Inlines the stylesheet and scripts into one self-contained HTML file, so the
 * app can be emailed, dropped on any host, or opened straight from disk.
 *
 *   node tools/build-single-file.js                 -> dist/kom-hunter.html
 *   node tools/build-single-file.js --demo          -> dist/kom-hunter-demo.html
 *   node tools/build-single-file.js --demo --fragment
 *                                                  -> body content only, for a
 *                                                     host that supplies <head>
 *
 * The demo build swaps the network transport for a fixture server. Nothing
 * else changes: the real client, the real cache, the real rendering. It is the
 * app, running against a stub instead of Strava.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const demo = process.argv.includes('--demo');
const fragment = process.argv.includes('--fragment');

const css = read('css/styles.css');
const scripts = ['js/model.js', 'js/strava.js'].map(read).join('\n\n');
const app = read('js/app.js');

/* Replacement *functions*, never replacement strings: `$$`, `$&` and friends
 * are substitution escapes in a replacement string, and app.js is full of
 * `$$(...)` selectors that would silently collapse to `$(...)`. */
const sub = (s, pattern, text) => s.replace(pattern, () => text);

const mock = demo ? `<script>\n${read('tools/demo-fixtures.js')}\n</script>\n` : '';

let html = read('index.html');
html = sub(html, /^[ \t]*<link rel="stylesheet"[^>]*>\n/m, `<style>\n${css}\n</style>\n`);
html = sub(
  html,
  /^[ \t]*<script src="js\/model\.js"><\/script>\n[ \t]*<script src="js\/strava\.js"><\/script>\n[ \t]*<script src="js\/app\.js"><\/script>\n/m,
  `<script>\n${scripts}\n</script>\n${mock}<script>\n${app}\n</script>\n`
);

if (/<link rel="stylesheet"|<script src=/.test(html)) {
  console.error('Something is still linked externally — the markup must have changed.');
  process.exit(1);
}

/* Guard the exact bug that replacement strings caused: the inlined app must
 * still contain both selector helpers. */
if (!html.includes('const $$ =')) {
  console.error('Inlining mangled the source — $$ did not survive.');
  process.exit(1);
}

/* --fragment drops the document shell, for hosts that supply their own <head>
 * and wrap the content themselves. */
if (fragment) {
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const body = html.match(/<body>\n?([\s\S]*)<\/body>/)[1];
  html = `${title}\n${style}\n${body}`;
  // The trailing [\s>/] matters: without it this also matches <header>.
  if (/<!doctype|<\/?(html|head|body)[\s>/]/i.test(html)) {
    console.error('Fragment still carries document-shell tags.');
    process.exit(1);
  }
}

const name = `kom-hunter${demo ? '-demo' : ''}${fragment ? '-fragment' : ''}.html`;
const out = path.join(root, 'dist', name);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${path.relative(root, out)} — ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
