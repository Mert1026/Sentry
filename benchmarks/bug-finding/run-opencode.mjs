// Run one plain OpenCode arm (the same OpenCode build and model Sentry's OpenCode agent uses) on one
// prepared task and save the raw result in the format run-plain.mjs writes, so score.mjs and
// report.mjs work unchanged.
//
//   node benchmarks/bug-finding/run-opencode.mjs <task-id> <bare|crafted> <rep> [--work <dir>]
//
// Env: BENCH_OC_MODEL (default opencode-go/muse-spark-1.3-contributor), BENCH_OC_VARIANT (default high,
//      Sentry's OpenCode effort setting).
// Needs the opencode-go key in OpenCode's own store: run `opencode auth login` once inside WSL.
// The arm is saved as "<arm>-muse". Same tool limits as the Claude arms: read, search, node and a few
// read-only shell commands; no edits, no web.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareBugPrompt, craftedBugPrompt } from './prompts.mjs';
import { DEFAULT_WORK } from './work-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [id, base, rep = '1', ...rest] = process.argv.slice(2);
const wi = rest.indexOf('--work');
const work = resolve(wi >= 0 ? rest[wi + 1] : DEFAULT_WORK);
if (!id || !['bare', 'crafted'].includes(base)) throw new Error('usage: run-opencode.mjs <task-id> <bare|crafted> <rep>');
const arm = `${base}-muse`;

const task = JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8')).find((t) => t.id === id);
if (!task) throw new Error(`unknown task ${id}`);
// Outside any repository so no parent CLAUDE.md / AGENTS.md reaches the agent (see run-plain.mjs).
const wsRoot = process.env.BENCH_PLAIN_WS_ROOT ?? 'C:/bench-ws';
const ws = join(wsRoot, id);
if (!existsSync(ws)) throw new Error(`workspace missing, run prepare.mjs ${id}`);
const wslPath = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);

const prompt = base === 'bare' ? bareBugPrompt(task.scope) : craftedBugPrompt(task.scope);
const model = process.env.BENCH_OC_MODEL ?? 'opencode-go/muse-spark-1.3-contributor';
const variant = process.env.BENCH_OC_VARIANT ?? 'high';
mkdirSync(join(work, 'tmp'), { recursive: true });
const promptFile = join(work, 'tmp', `${id}__${arm}__r${rep}.prompt.txt`);
writeFileSync(promptFile, prompt);

const permission = {
  edit: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny',
  bash: { 'node *': 'allow', 'ls *': 'allow', ls: 'allow', 'cat *': 'allow', 'grep *': 'allow', 'find *': 'allow', 'head *': 'allow', 'wc *': 'allow', '*': 'deny' },
};
const config = JSON.stringify({ permission });
const bin = '$HOME/.local/share/sentry/tools/opencode/node_modules/.bin/opencode';
const script = `cd '${wslPath(ws)}' && export OPENCODE_CONFIG_CONTENT='${config}' && ${bin} run --pure --format json -m '${model}' --variant '${variant}' --dir '${wslPath(ws)}' "$(cat '${wslPath(promptFile)}')"`;

const started = Date.now();
const child = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-lc', script], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
const timer = setTimeout(() => child.kill(), 25 * 60 * 1000);
const code = await new Promise((r) => child.on('close', r));
clearTimeout(timer);

// JSON event stream: text parts make up the answer, step_finish carries tokens and cost.
let text = '';
let tokens = null;
let cost = 0;
let steps = 0;
let toolCalls = 0;
let streamError = '';
for (const line of out.split('\n')) {
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  const part = e.part ?? e;
  if (e.type === 'text' && typeof part.text === 'string') text += part.text;
  if (e.type === 'tool_use') toolCalls += 1;
  if (e.type === 'error') streamError = JSON.stringify(e.error ?? e).slice(0, 400);
  if (e.type === 'step_finish') {
    steps += 1;
    if (part.cost) cost += part.cost;
    const t = part.tokens;
    if (t) tokens = { input: (tokens?.input ?? 0) + (t.input ?? 0), output: (tokens?.output ?? 0) + (t.output ?? 0), reasoning: (tokens?.reasoning ?? 0) + (t.reasoning ?? 0) };
  }
}
text = text.trim();
// An agent halted by a rejected permission request ends after one narration line: not a measurement.
const haltedByPermission = /auto-rejecting/.test(err) && text.length < 300;
const failedRun = code !== 0 || !text || streamError !== '' || haltedByPermission;
const outDir = failedRun ? 'failed' : 'results';
mkdirSync(join(work, outDir), { recursive: true });
const file = join(work, outDir, `${id}__${arm}__r${rep}${failedRun ? `__${Date.now()}` : ''}.json`);
writeFileSync(file, JSON.stringify({
  taskId: id, arm, rep: Number(rep), model: `${model} (variant ${variant})`, exitCode: code,
  durationMs: Date.now() - started, prompt, usage: tokens,
  result: { result: text, is_error: failedRun, total_cost_usd: cost > 0 ? cost : null, num_turns: toolCalls || steps },
  streamError: streamError || undefined,
  rawStdoutTail: failedRun ? out.slice(-3000) : undefined, stderr: err.slice(-2000),
}, null, 1));
if (failedRun) { console.log(`${id} ${arm} r${rep} FAILED exit=${code} ${streamError}`); process.exitCode = 1; }
else console.log(`${id} ${arm} r${rep} exit=${code} ${(Date.now() - started) / 1000}s tokens=${JSON.stringify(tokens)} -> ${file}`);
