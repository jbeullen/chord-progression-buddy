/*
 * Inlines the stylesheet and scripts into one self-contained HTML file, so the
 * site can be emailed, dropped on any host, or opened from a USB stick.
 *
 *   node tools/build-single-file.js
 *   node tools/build-single-file.js --fragment out.html   (body content only,
 *                                    for hosts that supply their own <head>)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('css/styles.css');
const js = ['js/i18n.js', 'js/theory.js', 'js/audio.js', 'js/app.js'].map(read).join('\n\n');

const standalone = read('index.html')
  .replace(/^[ \t]*<link rel="stylesheet"[^>]*>\n/m, `<style>\n${css}\n</style>\n`)
  .replace(
    /^[ \t]*<script src="js\/i18n\.js"><\/script>[\s\S]*?<script src="js\/app\.js"><\/script>\n/m,
    `<script>\n${js}\n</script>\n`
  );

if (/<link rel="stylesheet"|<script src=/.test(standalone)) {
  console.error('Inlining failed — index.html no longer matches the expected tags.');
  process.exit(1);
}

const fragmentFlag = process.argv.indexOf('--fragment');
if (fragmentFlag > -1) {
  const target = process.argv[fragmentFlag + 1];
  if (!target) {
    console.error('--fragment needs an output path');
    process.exit(1);
  }
  const body = standalone.match(/<body>\n([\s\S]*)<\/body>/)[1];
  fs.writeFileSync(target, `<style>\n${css}\n</style>\n${body}`);
  console.log('fragment → ' + target);
} else {
  const outDir = path.join(root, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'chord-progression-buddy.html');
  fs.writeFileSync(out, standalone);
  console.log(`dist/chord-progression-buddy.html — ${(standalone.length / 1024).toFixed(0)} KB, no dependencies`);
}
