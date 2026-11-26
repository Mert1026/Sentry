// Materialize one benchmark task as a clean workspace: the repository at its pre-fix commit with
// no .git directory (so no agent can read history or the fix) and no ground truth.
//
//   node benchmarks/bug-finding/prepare.mjs <task-id> [--work <dir>]
//
// Repos are cloned blobless once into <work>/repos/<owner>__<name> and reused.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORK } from './work-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const id = args[0];
const workIdx = args.indexOf('--work');
const work = resolve(workIdx >= 0 ? args[workIdx + 1] : DEFAULT_WORK);
if (!id) throw new Error('usage: prepare.mjs <task-id> [--work <dir>]');

const tasks = JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8'));
const task = tasks.find((t) => t.id === id);
if (!task) throw new Error(`unknown task ${id}`);

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
const repoDir = join(work, 'repos', task.repo.replace('/', '__'));
mkdirSync(join(work, 'repos'), { recursive: true });
if (!existsSync(repoDir)) {
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', `https://github.com/${task.repo}.git`, repoDir], { stdio: 'inherit' });
}
git(repoDir, 'fetch', '--filter=blob:none', 'origin', task.baseCommit);

const ws = join(work, 'workspaces', task.id);
rmSync(ws, { recursive: true, force: true });
mkdirSync(ws, { recursive: true });
// git archive exports the tree without .git; it streams into tar.
execFileSync('git', ['archive', '--format=tar', '-o', join(work, `${task.id}.tar`), task.baseCommit], { cwd: repoDir, stdio: 'inherit' });
// Relative paths from the work dir: GNU tar reads "C:" as a remote host.
execFileSync('tar', ['-xf', `${task.id}.tar`, '-C', `workspaces/${task.id}`], { cwd: work, stdio: 'inherit' });
rmSync(join(work, `${task.id}.tar`), { force: true });
// Second copy for the plain agents, outside this repository (see run-plain.mjs).
const plainWs = join(process.env.BENCH_PLAIN_WS_ROOT ?? (process.platform === 'win32' ? 'C:/bench-ws' : join(homedir(), 'bench-workspaces')), task.id);
rmSync(plainWs, { recursive: true, force: true });
mkdirSync(dirname(plainWs), { recursive: true });
cpSync(ws, plainWs, { recursive: true });
console.log(ws);
