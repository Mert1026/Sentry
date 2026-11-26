// Run the whole matrix, repeat by repeat (all bugs at rep 1, then rep 2, ...), skipping results that
// already exist so it can be stopped and resumed (for example when a usage limit is hit).
//
//   node benchmarks/bug-finding/run-all.mjs [--reps 3] [--depth fast|full] [--only <task-id-substring>]
//
// Plain arms run two at a time; Sentry runs one at a time (one Desktop, one agent).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORK } from './work-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const reps = Number(opt('--reps', '3'));
const depth = opt('--depth', 'fast');
const only = opt('--only', '');
const tasks = JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8')).filter((t) => t.id.includes(only));

const run = async (script, args) => {
  const code = await runOnce(script, args);
  if (code === 0) return code;
  console.log(`retrying once: ${script} ${args.join(' ')}`);
  return runOnce(script, args);
};
const runOnce = (script, args) => new Promise((resolve) => {
  const c = spawn('node', [join(here, script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (out += d));
  c.on('close', (code) => { console.log(out.trim().split('\n').slice(-1)[0] || `(no output, exit ${code})`); resolve(code); });
});
const done = (id, arm, rep) => existsSync(join(DEFAULT_WORK, 'results', `${id}__${arm}__r${rep}.json`));

for (let rep = 1; rep <= reps; rep++) {
  for (const t of tasks) {
    if (!existsSync(join(DEFAULT_WORK, 'workspaces', t.id))) await run('prepare.mjs', [t.id]);
    const jobs = [];
    for (const arm of ['bare', 'crafted']) if (!done(t.id, arm, rep)) jobs.push(run('run-plain.mjs', [t.id, arm, String(rep)]));
    if (!done(t.id, `sentry-${depth}`, rep)) jobs.push(run('run-sentry.mjs', [t.id, String(rep), '--depth', depth]));
    await Promise.all(jobs); // the two plain arms overlap with the Sentry run for this bug
  }
}
console.log('matrix complete');
