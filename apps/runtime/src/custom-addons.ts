import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  CUSTOM_ADDON_COMMAND_MAX,
  checkCustomAddonName,
  checkCustomAddonPathEntries,
  customAddonDir,
  customAddonsRoot,
} from '@qa/shared';
import type { ScriptRunner } from './toolchains.js';

const MARKER = '.installed.json';
const LOG_TAIL_CHARS = 2000;
const DEFAULT_PATH_ENTRIES = ['bin'];

export interface CustomAddonStatus {
  readonly name: string;
  readonly command: string;
  readonly pathEntries: readonly string[];
  readonly installed: boolean;
  readonly installing: boolean;
  readonly installedAt?: string;
  readonly sizeMb?: number;
  readonly error?: string;
}

interface Marker {
  readonly name: string;
  readonly command: string;
  readonly pathEntries: string[];
  readonly installedAt: string;
}

function duMegabytes(dir: string): Promise<number | undefined> {
  return new Promise((done) => {
    execFile('du', ['-sk', dir], (error, stdout) => {
      const kilobytes = Number.parseInt(stdout.split('\t')[0] ?? '', 10);
      done(error !== null || Number.isNaN(kilobytes) ? undefined : Math.round(kilobytes / 1024));
    });
  });
}

/**
 * Add-ons the person installs with their own shell command. Each lives in its own folder under
 * `toolchains/custom/`, apart from the listed packs, and its program folders go on PATH after all
 * of them. The command runs on the host (like a listed install), never inside an agent sandbox.
 */
export class CustomAddons {
  private readonly installing = new Map<string, Promise<void>>();
  /** The last attempt per name: kept so a failed install can be read and tried again. */
  private readonly attempts = new Map<
    string,
    { command: string; pathEntries: string[]; error?: string }
  >();

  constructor(
    private readonly dataRoot: string,
    private readonly runner: ScriptRunner,
  ) {}

  private async readMarker(name: string): Promise<Marker | undefined> {
    try {
      return JSON.parse(
        await readFile(join(customAddonDir(this.dataRoot, name), MARKER), 'utf8'),
      ) as Marker;
    } catch {
      return undefined;
    }
  }

  private async installedNames(): Promise<string[]> {
    try {
      const entries = await readdir(customAddonsRoot(this.dataRoot), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && checkCustomAddonName(entry.name) === undefined)
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  async list(): Promise<CustomAddonStatus[]> {
    const out = new Map<string, CustomAddonStatus>();
    for (const name of await this.installedNames()) {
      const marker = await this.readMarker(name);
      if (marker === undefined) continue;
      const sizeMb = await duMegabytes(customAddonDir(this.dataRoot, name));
      out.set(name, {
        name,
        command: marker.command,
        pathEntries: marker.pathEntries,
        installed: true,
        installing: this.installing.has(name),
        installedAt: marker.installedAt,
        ...(sizeMb === undefined ? {} : { sizeMb }),
      });
    }
    for (const [name, attempt] of this.attempts) {
      if (out.has(name)) continue;
      out.set(name, {
        name,
        command: attempt.command,
        pathEntries: attempt.pathEntries,
        installed: false,
        installing: this.installing.has(name),
        ...(attempt.error === undefined ? {} : { error: attempt.error }),
      });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Starts an install and returns at once; poll list() for the outcome. Throws on invalid input. */
  install(input: { name: string; command: string; pathEntries?: readonly string[] }): {
    started: boolean;
  } {
    const reason = checkCustomAddonName(input.name);
    if (reason !== undefined) throw new Error(reason);
    const command = input.command.replace(/\r\n/g, '\n').trim();
    if (command.length === 0) throw new Error('Enter the command that installs the add-on.');
    if (command.length > CUSTOM_ADDON_COMMAND_MAX || command.includes('\0'))
      throw new Error(
        'The command is too long (at most ' + CUSTOM_ADDON_COMMAND_MAX + ' characters).',
      );
    const pathEntries = [
      ...new Set(
        (input.pathEntries ?? []).map((entry) => entry.trim().replace(/\/+$/, '')).filter(Boolean),
      ),
    ];
    const effective = pathEntries.length === 0 ? DEFAULT_PATH_ENTRIES : pathEntries;
    const bad = checkCustomAddonPathEntries(effective);
    if (bad !== undefined) throw new Error(bad);
    if (this.installing.has(input.name)) return { started: false };
    const work = this.runInstall(input.name, command, effective)
      .catch((error: unknown) => {
        this.attempts.set(input.name, {
          command,
          pathEntries: effective,
          error: (error instanceof Error ? error.message : String(error)).slice(-LOG_TAIL_CHARS),
        });
      })
      .finally(() => this.installing.delete(input.name));
    this.installing.set(input.name, work);
    this.attempts.set(input.name, { command, pathEntries: effective });
    return { started: true };
  }

  /** Resolves when every running install has finished (used by tests and shutdown). */
  async settled(): Promise<void> {
    await Promise.all([...this.installing.values()]);
  }

  private async runInstall(name: string, command: string, pathEntries: string[]): Promise<void> {
    // An installed add-on is never replaced behind its back: remove it first.
    if ((await this.readMarker(name)) !== undefined)
      throw new Error('"' + name + '" is already installed. Remove it first to install it again.');
    const dir = customAddonDir(this.dataRoot, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const result = await this.runner(command, {
      cwd: dir,
      env: { SENTRY_ADDON_DIR: dir, SENTRY_ADDON_NAME: name },
    });
    const fail = async (message: string): Promise<never> => {
      await rm(dir, { recursive: true, force: true });
      throw new Error(message);
    };
    if (result.code !== 0)
      await fail('Install failed (exit ' + result.code + '): ' + result.output.trim());
    for (const entry of pathEntries) {
      const folder = resolve(dir, entry);
      const inside = folder === resolve(dir) || folder.startsWith(resolve(dir) + sep);
      const isFolder =
        inside &&
        (await stat(folder).then(
          (s) => s.isDirectory(),
          () => false,
        ));
      if (!isFolder)
        await fail(
          'The command finished, but the program folder "' +
            entry +
            '" does not exist inside the add-on. Create it in the command, or name the folder that holds the programs.',
        );
    }
    const marker: Marker = { name, command, pathEntries, installedAt: new Date().toISOString() };
    await writeFile(join(dir, MARKER), JSON.stringify(marker), 'utf8');
    this.attempts.delete(name);
  }

  async remove(name: string): Promise<void> {
    const reason = checkCustomAddonName(name);
    if (reason !== undefined) throw new Error(reason);
    if (this.installing.has(name)) throw new Error('That install is still running.');
    await rm(customAddonDir(this.dataRoot, name), { recursive: true, force: true });
    this.attempts.delete(name);
  }

  /** Absolute program folders of the installed add-ons, in name order. */
  async pathEntries(): Promise<string[]> {
    const out: string[] = [];
    for (const name of await this.installedNames()) {
      const marker = await this.readMarker(name);
      if (marker === undefined) continue;
      const dir = customAddonDir(this.dataRoot, name);
      for (const entry of marker.pathEntries) {
        // The marker is ours, but a hand-edited one must still not point outside the add-on.
        const folder = resolve(dir, entry);
        if (folder === resolve(dir) || folder.startsWith(resolve(dir) + sep)) out.push(folder);
      }
    }
    return out;
  }
}
