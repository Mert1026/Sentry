import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OWNER_MARKER = '.sentry-owned';

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

/**
 * Creates the disposable home of one run. A folder that is already there is removed only when Sentry made
 * it (it holds the marker, as a crashed earlier run would leave); anything else is not Sentry's, so the run
 * stops and the folder is left alone.
 */
export async function claimEphemeralHome(dir: string): Promise<void> {
  if (await exists(dir)) {
    if (!(await exists(join(dir, OWNER_MARKER))))
      throw new Error(
        'The disposable home ' +
          dir +
          ' already exists and was not made by Sentry, so it was left alone.',
      );
    await rm(dir, { recursive: true, force: true });
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, OWNER_MARKER), '', 'utf8');
}

/** Removes the disposable home, but only a folder that carries Sentry's marker. */
export async function releaseEphemeralHome(dir: string): Promise<void> {
  if (!(await exists(join(dir, OWNER_MARKER)))) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
