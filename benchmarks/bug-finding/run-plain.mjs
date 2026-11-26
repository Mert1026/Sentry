// Run one plain-agent arm (bare | crafted) on one prepared task and save the raw result.
//
//   node benchmarks/bug-finding/run-plain.mjs <task-id> <bare|crafted> <rep> [--work <dir>]
//
// Env: BENCH_MODEL (default "sonnet"), BENCH_CLAUDE (path to claude.exe), BENCH_MAX_USD (default 5).
// Results: <work>/results/<task>__<arm>__r<rep>.json  (never inside the workspace the agent sees).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareBugPrompt, craftedBugPrompt } from './prompts.mjs';
import { DEFAULT_WORK } from './work-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [id, arm, rep = '1', ...rest] = process.argv.slice(2);
const workIdx = rest.indexOf('--work');
const work = resolve(workIdx >= 0 ? rest[workIdx + 1] : DEFAULT_WORK);
if (!id || !['bare', 'crafted'].includes(arm))
  throw new Error('usage: run-plain.mjs <task-id> <bare|crafted> <rep>');

function findClaude() {
  if (process.env.BENCH_CLAUDE) return process.env.BENCH_CLAUDE;
  const base = join(homedir(), 'AppData', 'Local', 'Claude-Data');
  const hits = [];
  for (const a of readdirSync(base)) {
    const cc = join(base, a, 'claude-code');
    if (!existsSync(cc)) continue;
    for (const v of readdirSync(cc))
      for (const h of readdirSync(join(cc, v))) {
        const exe = join(cc, v, h, 'claude.exe');
        if (existsSync(exe)) hits.push({ v, exe });
      }
  }
  hits.sort((x, y) => x.v.localeCompare(y.v, undefined, { numeric: true }));
  if (!hits.length) throw new Error('no claude.exe found; set BENCH_CLAUDE');
  return hits.at(-1).exe;
}

const task = JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8')).find((t) => t.id === id);
if (!task) throw new Error(`unknown task ${id}`);
// The plain agents read instruction files (CLAUDE.md, AGENTS.md) from every parent folder, so their
// workspace lives OUTSIDE this repository, whose own CLAUDE.md would otherwise reach them.
const ws = join(
  process.env.BENCH_PLAIN_WS_ROOT ??
    (process.platform === 'win32' ? 'C:/bench-ws' : join(homedir(), 'bench-workspaces')),
  id,
);
if (!existsSync(ws)) throw new Error(`workspace missing, run prepare.mjs ${id}`);

const prompt = arm === 'bare' ? bareBugPrompt(task.scope) : craftedBugPrompt(task.scope);
// Defaults match Sentry's own Claude agent settings (SENTRY_ANTHROPIC_MODEL / _REASONING) so all
// three arms use the same model and effort.
const model = process.env.BENCH_MODEL ?? 'claude-haiku-5-5';
const args = [
  '-p',
  prompt,
  '--output-format',
  'json',
  '--model',
  model,
  '--effort',
  process.env.BENCH_EFFORT ?? 'high',
  // Bash is scoped so the plain arms can run code like Sentry does, without network or installs
  // (Sentry's own runs have no dependency downloads either).
  '--allowedTools',
  'Read',
  'Grep',
  'Glob',
  'Bash(node:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(grep:*)',
  'Bash(find:*)',
  'Bash(head:*)',
  'Bash(wc:*)',
  '--disallowedTools',
  'Bash(npm:*)',
  'Bash(npx:*)',
  'Bash(yarn:*)',
  'Bash(pnpm:*)',
  'Bash(curl:*)',
  'Bash(wget:*)',
  'Bash(git:*)',
  'WebFetch',
  'WebSearch',
  '--permission-mode',
  'dontAsk',
  '--setting-sources',
  'project',
  '--disable-slash-commands',
  '--no-session-persistence',
  '--max-budget-usd',
  process.env.BENCH_MAX_USD ?? '5',
];

const started = Date.now();
const child = spawn(findClaude(), args, { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
const timer = setTimeout(() => child.kill(), 25 * 60 * 1000);
const code = await new Promise((r) => child.on('close', r));
clearTimeout(timer);

let parsed = null;
try {
  parsed = JSON.parse(out);
} catch {
  /* keep raw */
}
const failedRun = code !== 0 || !parsed || parsed.is_error || !parsed.result;
const outDir = failedRun ? 'failed' : 'results'; // failures are infrastructure noise, never scored
mkdirSync(join(work, outDir), { recursive: true });
const file = join(work, outDir, `${id}__${arm}__r${rep}${failedRun ? `__${Date.now()}` : ''}.json`);
writeFileSync(
  file,
  JSON.stringify(
    {
      taskId: id,
      arm,
      rep: Number(rep),
      model,
      exitCode: code,
      durationMs: Date.now() - started,
      prompt,
      result: parsed,
      rawStdout: parsed ? undefined : out,
      stderr: err.slice(-2000),
    },
    null,
    1,
  ),
);
if (failedRun) {
  console.log(`${id} ${arm} r${rep} FAILED exit=${code}`);
  process.exitCode = 1;
} else
  console.log(
    `${id} ${arm} r${rep} exit=${code} ${(Date.now() - started) / 1000}s cost=${parsed?.total_cost_usd ?? '?'} -> ${file}`,
  );
