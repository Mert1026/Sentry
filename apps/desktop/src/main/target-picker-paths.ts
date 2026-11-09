import { posix, win32 } from 'node:path';

/** Translate the runtime's source path into a path the desktop file dialog can open. */
export function sourcePathForDialog(
  source: string,
  platform: NodeJS.Platform,
  distro?: string,
): string {
  if (platform !== 'win32') return source;
  if (win32.isAbsolute(source) && !source.startsWith('/')) return source;
  if (!source.startsWith('/')) throw new Error('The project source path is not absolute.');
  const drive = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(source);
  if (drive !== null)
    return `${drive[1]!.toUpperCase()}:\\${(drive[2] ?? '').replaceAll('/', '\\')}`;
  if (distro === undefined || !/^[^\\/.:]+$/.test(distro))
    throw new Error('The connected WSL distribution is unavailable.');
  return `\\\\wsl.localhost\\${distro}\\${source.slice(1).replaceAll('/', '\\')}`;
}

/** Return only paths inside the project; the run engine validates them against its snapshot. */
export function projectRelativeSelections(
  root: string,
  selections: readonly string[],
  platform: NodeJS.Platform,
): string[] {
  const paths = platform === 'win32' ? win32 : posix;
  return selections.map((selection) => {
    const relative = paths.relative(root, selection);
    if (
      !relative ||
      paths.isAbsolute(relative) ||
      relative === '..' ||
      relative.startsWith('..' + paths.sep)
    )
      throw new Error(
        'Choose files or folders inside the project, not the project root or another location.',
      );
    const normalized = relative.split(paths.sep).join('/');
    if (normalized.includes(',') || normalized.split('/').some((part) => part === '..'))
      throw new Error('This path cannot be added to the scope.');
    return normalized;
  });
}
