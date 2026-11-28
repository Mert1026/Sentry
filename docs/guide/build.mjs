// Builds the user guide PDF from its HTML source with headless Chrome or Edge.
//   node docs/guide/build.mjs            -> docs/guide/Sentry-ръководство.pdf
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'guide.bg.html');
const output = resolve(here, 'Sentry-ръководство.pdf');

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

const result = spawnSync(
  browsers[0],
  [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=8000',
    '--print-to-pdf=' + output,
    pathToFileURL(source).href,
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Wrote ' + output);
