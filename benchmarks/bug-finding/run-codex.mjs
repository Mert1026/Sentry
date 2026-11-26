// Run one plain OpenAI arm (Codex CLI, ChatGPT login) on one prepared task and save the raw result in
// the same format run-plain.mjs writes, so score.mjs and report.mjs work unchanged.
//
//   node benchmarks/bug-finding/run-codex.mjs <task-id> <bare|crafted> <rep> [--work <dir>]
//
// Env: BENCH_CODEX_MODEL (default gpt-6-astra (Codex on a ChatGPT login rejects gpt-6.1-terra, gpt-6.1-sol and gpt-6.2-*)),
//      BENCH_CODEX_EFFORT (default low, Sentry's ChatGPT effort setting).
// The arm is saved as "<arm>-gpt". Read-only sandbox: no writes, no network (matches the Claude arms).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareBugPrompt, craftedBugPrompt } from './prompts.mjs';
import { DEFAULT_WORK } from './work-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [id, base, rep = '1', ...rest] = process.argv.slice(2);
const wi = rest.indexOf('--work');
const work = resolve(wi >= 0 ? rest[wi + 1] : DEFAULT_WORK);
if (!id || !['bare', 'crafted'].includes(base))
  throw new Error('usage: run-codex.mjs <task-id> <bare|crafted> <rep>');
const arm = `${base}-gpt`;

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

const prompt = base === 'bare' ? bareBugPrompt(task.scope) : craftedBugPrompt(task.scope);
const model = process.env.BENCH_CODEX_MODEL ?? 'gpt-6-astra';
const effort = process.env.BENCH_CODEX_EFFORT ?? 'low';
mkdirSync(join(work, 'tmp'), { recursive: true });
const lastMsg = join(work, 'tmp', `${id}__${arm}__r${rep}.txt`);
const args = [
  'exec',
  '--json',
  '-m',
  model,
  '-c',
  `model_reasoning_effort="${effort}"`,
  '-c',
  'windows.sandbox="elevated"', // the sandbox setting lives in the user config, which is ignored below
  '-s',
  'read-only',
  '--skip-git-repo-check',
  '--ephemeral',
  '--ignore-user-config',
  '--ignore-rules',
  '-C',
  ws,
  '-o',
  lastMsg,
  '-', // the prompt goes in on stdin: through the Windows shell an argument with spaces would be split
];

const started = Date.now();
const child = spawn(process.platform === 'win32' ? 'codex.cmd' : 'codex', args, {
  cwd: ws,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});
child.stdin.end(prompt);
let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
const timer = setTimeout(() => child.kill(), 25 * 60 * 1000);
const code = await new Promise((r) => child.on('close', r));
clearTimeout(timer);

let text = '';
try {
  text = readFileSync(lastMsg, 'utf8').trim();
} catch {
  /* none */
}
// Token usage and tool-call count from the JSONL event stream.
let usage = null;
let turns = 0;
for (const line of out.split('\n')) {
  try {
    const e = JSON.parse(line);
    if (e.type === 'turn.completed' && e.usage) usage = e.usage;
    if (e.type === 'item.completed' && e.item?.type === 'command_execution') turns += 1;
  } catch {
    /* not an event line */
  }
}
const failedRun = code !== 0 || !text;
const outDir = failedRun ? 'failed' : 'results';
mkdirSync(join(work, outDir), { recursive: true });
const file = join(work, outDir, `${id}__${arm}__r${rep}${failedRun ? `__${Date.now()}` : ''}.json`);
writeFileSync(
  file,
  JSON.stringify(
    {
      taskId: id,
      arm,
      rep: Number(rep),
      model: `${model} (effort ${effort})`,
      exitCode: code,
      durationMs: Date.now() - started,
      prompt,
      usage,
      result: { result: text, is_error: failedRun, total_cost_usd: null, num_turns: turns },
      rawStdoutTail: failedRun ? out.slice(-3000) : undefined,
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
    `${id} ${arm} r${rep} exit=${code} ${(Date.now() - started) / 1000}s tokens=${JSON.stringify(usage)} -> ${file}`,
  );
