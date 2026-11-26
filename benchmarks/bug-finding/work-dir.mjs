// Where the benchmark keeps its data (clones, workspaces, results, scores, labels).
// It lives OUTSIDE the Sentry repository on purpose: inside it, the files would be copied and hashed
// every time someone adds the repo as a project in Sentry (tens of thousands of files, many minutes).
// Override with BENCH_WORK or --work.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_WORK = process.env.BENCH_WORK ?? (process.platform === 'win32' ? 'C:/bench-work' : join(here, '.work'));
