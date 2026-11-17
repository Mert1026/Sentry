import { describe, expect, it, vi } from 'vitest';
import type { FindingExportResultDto } from '@qa/schemas';
import {
  findingsExportBytes,
  saveFindingsExport,
  saveOptionsForFindingsExport,
} from '../../src/main/services/findings-export-save.js';
import { isSavedExport } from '../../src/main/services/export-save.js';

const markdown: FindingExportResultDto = {
  format: 'markdown',
  files: [{ path: 'sentry-findings.md', content: '# Report\n' }],
  findingCount: 2,
  suggestedName: 'sentry-findings.md',
  mimeType: 'text/markdown',
};
const json: FindingExportResultDto = {
  format: 'json',
  files: [{ path: 'sentry-findings.json', content: '{"findings":[]}\n' }],
  findingCount: 2,
  suggestedName: 'sentry-findings.json',
  mimeType: 'application/json',
};
const text: FindingExportResultDto = {
  format: 'text',
  files: [{ path: 'sentry-findings.txt', content: 'Ünïcode report ✓\n' }],
  findingCount: 2,
  suggestedName: 'sentry-findings.txt',
  mimeType: 'text/plain',
};

describe('saving a findings export', () => {
  it('saves a Markdown report as the file itself, with a Markdown save dialog', async () => {
    const requestSavePath = vi.fn().mockResolvedValue('C:\\Users\\me\\report.md');
    const writes: Array<{ destination: string; bytes: Buffer }> = [];
    const result = await saveFindingsExport({
      requestSavePath,
      fetchExport: async () => markdown,
      writeDestination: async (destination, bytes) => void writes.push({ destination, bytes }),
    });
    expect(result).toEqual({
      status: 'saved',
      path: 'C:\\Users\\me\\report.md',
      files: 1,
      findingCount: 2,
    });
    expect(requestSavePath).toHaveBeenCalledWith({
      suggestedFilename: 'sentry-findings.md',
      filters: [
        { name: 'Markdown files', extensions: ['md'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.bytes.toString('utf8')).toBe('# Report\n');
    // The shell may reveal only files this session saved.
    expect(isSavedExport('C:\\Users\\me\\report.md')).toBe(true);
  });

  it('saves a JSON export as the file itself, with a JSON save dialog', async () => {
    const writes: Buffer[] = [];
    const result = await saveFindingsExport({
      requestSavePath: async (options) => {
        expect(options.suggestedFilename).toBe('sentry-findings.json');
        expect(options.filters[0]).toEqual({ name: 'JSON files', extensions: ['json'] });
        return 'C:\\Users\\me\\findings.json';
      },
      fetchExport: async () => json,
      writeDestination: async (_destination, bytes) => void writes.push(bytes),
    });
    expect(result).toMatchObject({ status: 'saved', files: 1, findingCount: 2 });
    expect(writes[0]!.toString('utf8')).toBe('{"findings":[]}\n');
  });

  it('saves a plain text export as UTF-8 text, with a text save dialog', async () => {
    const writes: Buffer[] = [];
    const result = await saveFindingsExport({
      requestSavePath: async (options) => {
        expect(options.suggestedFilename).toBe('sentry-findings.txt');
        expect(options.filters[0]).toEqual({ name: 'Text files', extensions: ['txt'] });
        return 'C:\\Users\\me\\findings.txt';
      },
      fetchExport: async () => text,
      writeDestination: async (_destination, bytes) => void writes.push(bytes),
    });
    expect(result).toMatchObject({ status: 'saved', files: 1 });
    expect(writes[0]!.toString('utf8')).toBe('Ünïcode report ✓\n');
  });

  it('refuses an export that is not exactly one file', () => {
    const none: FindingExportResultDto = { ...markdown, files: [] };
    const two: FindingExportResultDto = {
      ...markdown,
      files: [...markdown.files, { path: 'extra.md', content: 'x' }],
    };
    expect(() => findingsExportBytes(none)).toThrow(/exactly one file/);
    expect(() => findingsExportBytes(two)).toThrow(/exactly one file/);
    expect(saveOptionsForFindingsExport(markdown).filters[0]).toEqual({
      name: 'Markdown files',
      extensions: ['md'],
    });
  });

  it('writes nothing and reports cancelled when the dialog is cancelled', async () => {
    const write = vi.fn();
    for (const cancelled of [null, '']) {
      const result = await saveFindingsExport({
        requestSavePath: async () => cancelled,
        fetchExport: async () => markdown,
        writeDestination: write,
      });
      expect(result).toEqual({ status: 'cancelled' });
    }
    expect(write).not.toHaveBeenCalled();
  });

  it('fails before any dialog opens when the selection cannot be exported', async () => {
    const requestSavePath = vi.fn();
    await expect(
      saveFindingsExport({
        requestSavePath,
        fetchExport: async () => {
          throw new Error('Select at least one finding to export.');
        },
      }),
    ).rejects.toThrow(/at least one finding/);
    expect(requestSavePath).not.toHaveBeenCalled();
  });

  it('does not report success, or allow Show in folder, when the write fails', async () => {
    await expect(
      saveFindingsExport({
        requestSavePath: async () => 'C:\\Users\\me\\failed.md',
        fetchExport: async () => markdown,
        writeDestination: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
    expect(isSavedExport('C:\\Users\\me\\failed.md')).toBe(false);
  });
});
