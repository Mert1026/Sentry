// Blind scorer. For each saved run result a judge model sees ONLY the real fix and the run's final
// text (no arm name, no prompt), splits the text into distinct bug claims, and says which claim (if
// any) identifies the same defect that the fix repairs.
//
//   node benchmarks/bug-finding/score.mjs [--work <dir>]     scores every result without a score yet
//   node benchmarks/bug-finding/score.mjs --table            prints the per-arm table
//
// A "hit" needs the claim to name the fixed file AND describe the same defect the patch fixes.
// Claims that merely sit in the same file, or are unrelated to the fix, are "other claims": they are
// NOT counted as false positives automatically (a repo can contain unfixed bugs); they are reported
// as "other claims per run" and kept for manual review.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORK } from './work-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const workIdx = argv.indexOf('--work');
const work = resolve(workIdx >= 0 ? argv[workIdx + 1] : DEFAULT_WORK);
const tasks = JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8'));
const resultsDir = join(work, 'results');
const scoresDir = join(work, 'scores');

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
  return hits.at(-1).exe;
}

function judgePrompt(task, text) {
  return `You are grading a bug-finding report. Use only what is below.

<real_bug_fix repo="${task.repo}">
Files changed by the real fix: ${task.fixFiles.join(', ')}
${task.fixPatch}
</real_bug_fix>

<report>
${text}
</report>

Task:
1. List every distinct bug claim in the report (a claim = one specific defect the report says exists). Ignore claims the report itself says are fine or not bugs.
2. For each claim, decide "matches_fix": true only if the claim identifies the same defect the fix repairs: same file or function AND the same wrong behavior. Being in the same file, or being a vaguely related area, is not a match.

Reply with JSON only:
{"claims":[{"summary":"...","file":"...","matches_fix":true|false,"reason":"one short sentence"}]}`;
}

function scoreOne(file) {
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const task = tasks.find((t) => t.id === run.taskId);
  const text = run.result?.result ?? run.rawStdout ?? '';
  const empty = { claims: [] };
  let judged = empty;
  let judgeError = null;
  if (run.result?.is_error || !text) {
    judgeError = 'run produced no report';
  } else {
    const p = spawnSync(
      findClaude(),
      [
        '-p',
        judgePrompt(task, text),
        '--output-format',
        'json',
        '--model',
        process.env.BENCH_JUDGE_MODEL ?? 'sonnet',
        '--tools',
        '',
        '--setting-sources',
        'project',
        '--disable-slash-commands',
        '--no-session-persistence',
      ],
      { encoding: 'utf8', cwd: work, maxBuffer: 1 << 26 },
    );
    try {
      const out = JSON.parse(p.stdout).result;
      judged = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    } catch (e) {
      judgeError = `judge output unreadable: ${e.message}`;
    }
  }
  const claims = judged.claims ?? [];
  return {
    taskId: run.taskId,
    arm: run.arm,
    rep: run.rep,
    model: run.model,
    hit: claims.some((c) => c.matches_fix === true),
    claims: claims.length,
    otherClaims: claims.filter((c) => !c.matches_fix).length,
    durationMs: run.durationMs,
    costUsd: run.result?.total_cost_usd ?? null,
    turns: run.result?.num_turns ?? null,
    judgeError,
    detail: claims,
  };
}

if (argv.includes('--table')) {
  const rows = readdirSync(scoresDir).map((f) =>
    JSON.parse(readFileSync(join(scoresDir, f), 'utf8')),
  );
  const arms = [...new Set(rows.map((r) => r.arm))];
  console.log('arm | runs | hits | recall | other claims/run | avg s | avg $');
  for (const a of arms) {
    const r = rows.filter((x) => x.arm === a && !x.judgeError);
    const n = r.length || 1;
    const hits = r.filter((x) => x.hit).length;
    console.log(
      `${a} | ${r.length} | ${hits} | ${((hits / n) * 100).toFixed(0)}% | ${(r.reduce((s, x) => s + x.otherClaims, 0) / n).toFixed(1)} | ${(r.reduce((s, x) => s + x.durationMs, 0) / n / 1000).toFixed(0)} | ${(r.reduce((s, x) => s + (x.costUsd ?? 0), 0) / n).toFixed(2)}`,
    );
  }
  const bad = rows.filter((x) => x.judgeError);
  if (bad.length)
    console.log(
      `unscored: ${bad.length} (${bad.map((b) => `${b.taskId}/${b.arm}/r${b.rep}`).join(', ')})`,
    );
} else {
  mkdirSync(scoresDir, { recursive: true });
  for (const f of readdirSync(resultsDir)) {
    const out = join(scoresDir, f);
    if (existsSync(out)) continue;
    const s = scoreOne(join(resultsDir, f));
    writeFileSync(out, JSON.stringify(s, null, 1));
    console.log(
      `${f}: hit=${s.hit} claims=${s.claims}${s.judgeError ? ' ERROR ' + s.judgeError : ''}`,
    );
  }
}
