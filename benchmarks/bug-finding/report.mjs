// Per-contender table for one task: every run, the average, then a side-by-side comparison.
//
//   node benchmarks/bug-finding/report.mjs <task-id-substring> [--work <dir>]
//   node benchmarks/bug-finding/report.mjs <task-id-substring> --claims
//        prints the "other claims" BLIND (shuffled, opaque ids, no contender names) and writes
//        <work>/labels/<task>.key.json (opaque id -> run). Label them into <task>.labels.json:
//        { "C01": { "label": "real" | "not_a_bug" | "unclear", "reason": "..." }, ... }
//        Labels are judged against the real source in the workspace, not against the fix.
//        Other claims are labelled this way because a repo can hold real bugs the fix did not touch.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORK } from './work-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const sub = argv.find((a) => !a.startsWith('--')) ?? '';
const wi = argv.indexOf('--work');
const work = resolve(wi >= 0 ? argv[wi + 1] : DEFAULT_WORK);
const labelsDir = join(work, 'labels');

const rows = readdirSync(join(work, 'scores')).filter((f) => f.includes(sub)).map((f) => {
  const s = JSON.parse(readFileSync(join(work, 'scores', f), 'utf8'));
  const r = JSON.parse(readFileSync(join(work, 'results', f), 'utf8'));
  return { ...s, usage: r.usage };
});
if (!rows.length) throw new Error(`no scored runs match "${sub}"`);
const taskId = rows[0].taskId;
const others = (r) => (r.detail ?? []).map((c, i) => ({ c, i })).filter((x) => !x.c.matches_fix);

if (argv.includes('--claims')) {
  // Deterministic shuffle so the blind ids do not follow arm order.
  const all = rows.flatMap((r) => others(r).map((x) => ({ arm: r.arm, rep: r.rep, i: x.i, c: x.c })));
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = all.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [all[k], all[j]] = [all[j], all[k]]; }
  const key = {};
  all.forEach((x, n) => {
    const id = `C${String(n + 1).padStart(2, '0')}`;
    key[id] = { arm: x.arm, rep: x.rep, index: x.i };
    console.log(`\n${id}  file: ${x.c.file ?? '?'}\n  ${x.c.summary}`);
  });
  mkdirSync(labelsDir, { recursive: true });
  writeFileSync(join(labelsDir, `${taskId}.key.json`), JSON.stringify(key, null, 1));
  console.log(`\n${all.length} claims. Key written to labels/${taskId}.key.json (do not read it before labelling).`);
  process.exit(0);
}

const keyFile = join(labelsDir, `${taskId}.key.json`);
const labFile = join(labelsDir, `${taskId}.labels.json`);
const key = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, 'utf8')) : {};
const labels = existsSync(labFile) ? JSON.parse(readFileSync(labFile, 'utf8')) : {};
const tally = (r) => {
  const t = { real: 0, not_a_bug: 0, unclear: 0, unlabelled: 0 };
  for (const x of others(r)) {
    const id = Object.keys(key).find((k) => key[k].arm === r.arm && key[k].rep === r.rep && key[k].index === x.i);
    t[labels[id]?.label ?? 'unlabelled']++;
  }
  return t;
};
const fmt = (t) => `${t.real} real / ${t.not_a_bug} not a bug / ${t.unclear} unclear${t.unlabelled ? ` / ${t.unlabelled} unlabelled` : ''}`;

const order = ['bare', 'crafted', 'bare-gpt', 'crafted-gpt', 'sentry-fast', 'sentry-full', 'bare-muse', 'crafted-muse', 'sentry-fast-muse', 'sentry-full-muse'];
const arms = [...order, ...new Set(rows.map((r) => r.arm))].filter((a, i, all) => all.indexOf(a) === i && rows.some((r) => r.arm === a));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');
const tok = (u) => (u ? `${((u.inputTokens ?? 0) / 1e6).toFixed(2)}M in / ${((u.outputTokens ?? 0) / 1e3).toFixed(0)}k out` : 'n/a');

for (const a of arms) {
  const rs = rows.filter((r) => r.arm === a).sort((x, y) => x.rep - y.rep);
  console.log(`\n### ${a}  (${rs[0]?.model})`);
  console.log('| Run | Found the real bug | Claims | Other claims: real / not a bug / unclear | Time (s) | Cost or tokens |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rs) console.log(`| ${r.rep} | ${r.hit ? 'YES' : 'no'} | ${r.claims} | ${fmt(tally(r))} | ${f(r.durationMs / 1000)} | ${r.costUsd != null ? '$' + f(r.costUsd, 2) : tok(r.usage)} |`);
  const sum = rs.map(tally).reduce((s, t) => ({ real: s.real + t.real, not_a_bug: s.not_a_bug + t.not_a_bug, unclear: s.unclear + t.unclear, unlabelled: s.unlabelled + t.unlabelled }), { real: 0, not_a_bug: 0, unclear: 0, unlabelled: 0 });
  console.log(`| **avg / total** | ${rs.filter((r) => r.hit).length}/${rs.length} | ${f(avg(rs.map((r) => r.claims)), 1)} | ${fmt(sum)} (total) | ${f(avg(rs.map((r) => r.durationMs / 1000)))} | ${rs.every((r) => r.costUsd != null) ? '$' + f(avg(rs.map((r) => r.costUsd)), 2) : 'see tokens'} |`);
}

console.log('\n### Comparison');
console.log('| Contender | Runs | Found the bug | Avg claims | Min-max claims | Other claims that are real | Avg time (s) |');
console.log('|---|---|---|---|---|---|---|');
for (const a of arms) {
  const rs = rows.filter((r) => r.arm === a);
  const c = rs.map((r) => r.claims);
  const t = rs.map(tally).reduce((s, x) => ({ real: s.real + x.real, n: s.n + x.real + x.not_a_bug + x.unclear + x.unlabelled, unl: s.unl + x.unlabelled }), { real: 0, n: 0, unl: 0 });
  console.log(`| ${a} | ${rs.length} | ${rs.filter((r) => r.hit).length}/${rs.length} | ${f(avg(c), 1)} | ${Math.min(...c)}-${Math.max(...c)} | ${t.real}/${t.n}${t.unl ? ` (${t.unl} not yet labelled)` : ''} | ${f(avg(rs.map((r) => r.durationMs / 1000)))} |`);
}
