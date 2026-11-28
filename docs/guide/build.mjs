// Builds the user guide PDFs from their HTML sources with headless Chrome or Edge.
//   node docs/guide/build.mjs          -> both PDFs
//   node docs/guide/build.mjs en       -> docs/guide/Sentry-guide.pdf only
//   node docs/guide/build.mjs bg       -> docs/guide/Sentry-ръководство.pdf only
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const guides = {
  bg: { source: 'guide.bg.html', output: 'Sentry-ръководство.pdf' },
  en: { source: 'guide.en.html', output: 'Sentry-guide.pdf' },
};
const wanted = process.argv.slice(2);
const languages = wanted.length > 0 ? wanted : Object.keys(guides);

const browsers = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((path) => path !== undefined && existsSync(path));
if (browsers.length === 0) {
  console.error('No Chrome or Edge found. Set CHROME to the browser executable.');
  process.exit(1);
}

for (const language of languages) {
  const guide = guides[language];
  if (guide === undefined) {
    console.error(`Unknown guide "${language}". Use: ${Object.keys(guides).join(', ')}`);
    process.exit(1);
  }
  const output = resolve(here, guide.output);
  const result = spawnSync(
    browsers[0],
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=8000',
      '--print-to-pdf=' + output,
      pathToFileURL(join(here, guide.source)).href,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log('Wrote ' + output);
}
