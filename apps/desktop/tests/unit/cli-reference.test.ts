import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_REFERENCE_MARKDOWN } from '../../src/main/cli-reference.generated.js';
import {
  CLI_REFERENCE_FILE_NAME,
  saveCliReference,
  saveOptionsForCliReference,
} from '../../src/main/services/cli-reference-save.js';
import { isSavedExport } from '../../src/main/services/export-save.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const guide = readFileSync(join(repo, 'docs', 'beta', 'cli.md'), 'utf8').replace(/\r\n/g, '\n');

describe('the compiled CLI reference', () => {
  it('is the CLI guide, so the download is never out of date (run `pnpm --filter @qa/desktop gen:cli-reference`)', () => {
    expect(CLI_REFERENCE_MARKDOWN).toBe(guide);
  });

  it('explains every command the CLI prints in its usage text', () => {
    const production = readFileSync(join(repo, 'apps', 'cli', 'src', 'production.ts'), 'utf8');
    const usage = [...production.matchAll(/^\s+'\s{2}([a-z-]+(?: [a-z-]+)?)[ '[<|(]/gm)].map(
      (match) => match[1] as string,
    );
    expect(usage.length).toBeGreaterThan(20);
    for (const command of usage) {
      const [area, action] = command.split(' ');
      // The guide names the area and the action, in the command reference or in its own section.
      expect(CLI_REFERENCE_MARKDOWN, command).toContain(action ?? area ?? command);
    }
  });

  it('covers the settings and model commands added with the Desktop settings', () => {
    for (const text of [
      'settings run-limit',
      'settings note-limit',
      'models list',
      'models update',
      'settings effort',
    ])
      expect(CLI_REFERENCE_MARKDOWN, text).toContain(text);
  });
});

describe('where the compiled reference lives', () => {
  it('is in the main-process sources only: the preload build recompiles src/shared as CommonJS into the same folder and breaks the main process', () => {
    const preloadConfig = JSON.parse(
      readFileSync(join(repo, 'apps', 'desktop', 'tsconfig.preload.json'), 'utf8'),
    ) as { include: string[] };
    expect(preloadConfig.include).toContain('src/shared');
    expect(
      readdirSync(join(repo, 'apps', 'desktop', 'src', 'shared')).filter((name) =>
        name.includes('cli-reference'),
      ),
    ).toEqual([]);
    expect(
      readdirSync(join(repo, 'apps', 'desktop', 'src', 'main')).includes(
        'cli-reference.generated.ts',
      ),
    ).toBe(true);
  });
});

describe('saving the CLI reference', () => {
  it('offers a Markdown file name and filter in the native dialog', () => {
    expect(saveOptionsForCliReference()).toEqual({
      suggestedFilename: 'sentry-cli-commands.md',
      filters: [
        { name: 'Markdown files', extensions: ['md'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    expect(CLI_REFERENCE_FILE_NAME.endsWith('.md')).toBe(true);
  });

  it('writes the guide exactly to the chosen path and remembers it as saved', async () => {
    const writes: Array<{ destination: string; bytes: Buffer }> = [];
    const result = await saveCliReference({
      requestSavePath: vi.fn().mockResolvedValue('C:\\Users\\me\\cli.md'),
      writeDestination: async (destination, bytes) => void writes.push({ destination, bytes }),
    });
    expect(result).toEqual({ status: 'saved', path: 'C:\\Users\\me\\cli.md' });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.destination).toBe('C:\\Users\\me\\cli.md');
    expect(writes[0]?.bytes.toString('utf8')).toBe(guide);
    expect(isSavedExport('C:\\Users\\me\\cli.md')).toBe(true);
  });

  it('writes nothing and is not an error when the dialog is cancelled', async () => {
    const writeDestination = vi.fn();
    for (const chosen of [null, '']) {
      expect(
        await saveCliReference({
          requestSavePath: async () => chosen,
          writeDestination,
        }),
      ).toEqual({ status: 'cancelled' });
    }
    expect(writeDestination).not.toHaveBeenCalled();
  });

  it('leaves a failed write as an error rather than a half-saved file', async () => {
    await expect(
      saveCliReference({
        requestSavePath: async () => 'C:\\Users\\me\\cli.md',
        writeDestination: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
  });
});
