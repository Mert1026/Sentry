// Sentry arm: import the prepared workspace as a project, run Sentry's Claude agent on the same
// scope, and save the findings in the same result format run-plain.mjs writes.
//
//   node benchmarks/bug-finding/run-sentry.mjs <task-id> <rep> [--depth fast|full] [--work <dir>]
//   node benchmarks/bug-finding/run-sentry.mjs <task-id> <rep> --convert <run-id> [--depth ...]
//        (--convert skips the run and only converts an existing run's findings)
//
// Requires Sentry Desktop running. Uses the Claude agent with whatever model/effort Sentry has
// configured (checked and recorded in the result). Uses provider budget.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORK } from './work-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '..', '..', 'apps', 'cli', 'dist', 'index.js');
const argv = process.argv.slice(2);
const [id, rep = '1'] = argv;
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const work = resolve(opt('--work', DEFAULT_WORK));
const depth = opt('--depth', 'fast');
const agent = opt('--agent', 'claude'); // claude | opencode (opencode = the muse model set up in Sentry)
// BENCH_ARM_SUFFIX (for example "-plan2") keeps a run of a changed Sentry build apart from the earlier results.
const armName = `sentry-${depth}${agent === 'claude' ? '' : '-muse'}${process.env.BENCH_ARM_SUFFIX ?? ''}`;
const convert = opt('--convert', null);

const task = JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8')).find((t) => t.id === id);
if (!task) throw new Error(`unknown task ${id}`);

function qa(args, timeout = 3 * 60 * 60 * 1000) {
  const p = spawnSync('node', [cli, ...args, '--json'], { encoding: 'utf8', maxBuffer: 1 << 28, timeout });
  const lines = p.stdout.trim().split('\n').filter((l) => l.startsWith('{'));
  if (!lines.length) throw new Error(`no JSON from: ${args.join(' ')}\n${p.stdout.slice(-500)}${p.stderr.slice(-500)}`);
  return JSON.parse(lines.at(-1));
}

const started = Date.now();
let runId = convert;
if (!runId) {
  const ws = join(work, 'workspaces', id);
  const added = qa(['project', 'add', ws]);
  if (!added.ok) throw new Error(`project add failed: ${JSON.stringify(added)}`);
  const res = qa(['run', 'start', added.data.projectId, '--mode', 'targeted', '--paths', task.scopePaths ?? task.scope, '--agents', agent, '--depth', depth, '--wait']);
  if (!res.ok) throw new Error(`run start failed: ${JSON.stringify(res)}`);
  runId = res.data.runId;
}
const show = qa(['run', 'show', runId]);
if (!show.ok) throw new Error(`run show failed: ${JSON.stringify(show)}`);
const d = show.data;
const agentRun = d.agentRuns?.[0];
const text = (d.findings ?? []).map((f, i) => [
  `Finding ${i + 1}: ${f.title} [severity ${f.severity}, confidence ${f.confidence}]`,
  f.description,
  `Expected: ${f.expectedBehavior ?? ''}`,
  `Actual: ${f.actualBehavior ?? ''}`,
  `Location: ${(f.locations ?? []).map((l) => `${l.relativePath}:${l.startLine ?? ''}`).join(', ')}`,
].join('\n')).join('\n\n') || 'No findings.';

if (d.run.status !== 'completed') {
  // Infrastructure failure (network, startup timeout): not a measurement. Keep it aside and fail
  // so the driver retries instead of scoring "no findings".
  mkdirSync(join(work, 'failed'), { recursive: true });
  writeFileSync(join(work, 'failed', `${id}__${armName}__r${rep}__${Date.now()}.json`), JSON.stringify(d, null, 1));
  console.log(`${id} ${armName} r${rep} FAILED (${d.run.status}): ${JSON.stringify(agentRun?.failure?.code)}`);
  process.exit(1);
}
const startedAt = Date.parse(d.run.startedAt);
const endedAt = Date.parse(d.run.completedAt ?? d.run.startedAt);
mkdirSync(join(work, 'results'), { recursive: true });
const file = join(work, 'results', `${id}__${armName}__r${rep}.json`);
writeFileSync(file, JSON.stringify({
  taskId: id, arm: armName, rep: Number(rep), model: agentRun?.runtimeIdentity?.modelId, exitCode: 0,
  durationMs: endedAt - startedAt, sentryRunId: runId, runStatus: d.run.status,
  usage: agentRun?.usage,
  result: { result: text, is_error: d.run.status !== 'completed', total_cost_usd: null, num_turns: agentRun?.usage?.turns ?? null },
  findingCount: d.findings?.length ?? 0, wallClockMs: Date.now() - started,
}, null, 1));
console.log(`${id} ${armName} r${rep} ${d.run.status} findings=${d.findings?.length ?? 0} ${(endedAt - startedAt) / 1000}s -> ${file}`);
