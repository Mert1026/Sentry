import { inflateRawSync } from 'node:zlib';
import { crc32 } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { FindingExportResultDto } from '@qa/schemas';
import { buildZip, assertSafeZipName } from '../../src/main/services/zip.js';
import {
  findingsExportBytes,
  saveFindingsExport,
  saveOptionsForFindingsExport,
} from '../../src/main/services/findings-export-save.js';
import { isSavedExport } from '../../src/main/services/export-save.js';

/** A tiny ZIP reader, so the tests check the real byte layout rather than our own writer. */
function readZip(buffer: Buffer): Array<{ name: string; text: string; crcOk: boolean }> {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(endAt).toBeGreaterThanOrEqual(0);
  const count = buffer.readUInt16LE(endAt + 10);
  let pointer = buffer.readUInt32LE(endAt + 16);
  const out: Array<{ name: string; text: string; crcOk: boolean }> = [];
  for (let index = 0; index < count; index += 1) {
    expect(buffer.readUInt32LE(pointer)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(pointer + 10);
    const crc = buffer.readUInt32LE(pointer + 16);
    const size = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const offset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');
    expect(buffer.readUInt32LE(offset)).toBe(0x04034b50);
    const localNameLength = buffer.readUInt16LE(offset + 26);
    const start = offset + 30 + localNameLength;
    const raw = buffer.subarray(start, start + size);
    const data = method === 0 ? raw : inflateRawSync(raw);
    out.push({ name, text: data.toString('utf8'), crcOk: crc32(data) === crc });
    pointer += 46 + nameLength;
  }
  return out;
}

const markdown: FindingExportResultDto = {
  format: 'markdown',
  files: [{ path: 'sentry-findings.md', content: '# Report\n' }],
  findingCount: 2,
  suggestedName: 'sentry-findings.md',
  mimeType: 'text/markdown',
};
const issues: FindingExportResultDto = {
  format: 'github-issues',
  files: [
    { path: 'README.md', content: 'read me\n' },
    { path: 'issues.json', content: '[]\n' },
    { path: 'issues/001-first.md', content: 'Ünïcode body ✓\n' },
  ],
  findingCount: 1,
  suggestedName: 'sentry-github-issues.zip',
  mimeType: 'application/zip',
};

describe('ZIP writer', () => {
  it('writes entries a real unzip can read back, with correct checksums and UTF-8 names', () => {
    const files = [
      { path: 'a.txt', content: 'hello' },
      { path: 'dir/b ünï.md', content: 'second ✓\n'.repeat(50) },
      { path: 'empty.txt', content: '' },
    ];
    const entries = readZip(buildZip(files, new Date('2026-11-14T10:20:30Z')));
    expect(entries.map((entry) => entry.name)).toEqual(files.map((file) => file.path));
    expect(entries.map((entry) => entry.text)).toEqual(files.map((file) => file.content));
    expect(entries.every((entry) => entry.crcOk)).toBe(true);
  });

  it('is the same bytes for the same files and time', () => {
    const files = [{ path: 'a.txt', content: 'x' }];
    const when = new Date('2026-11-14T10:20:30Z');
    expect(buildZip(files, when).equals(buildZip(files, when))).toBe(true);
  });

  it('refuses names that could climb out of the folder it is unpacked in, and duplicates', () => {
    for (const bad of [
      '',
      '/etc/passwd',
      '../escape.txt',
      'a/../../b',
      'a//b',
      './a',
      'C:/Windows/x',
      'a\\b',
      'a/b/',
      'x'.repeat(301),
      'line' + String.fromCharCode(10) + 'break',
    ]) {
      expect(() => assertSafeZipName(bad), JSON.stringify(bad)).toThrow(/Unsafe name/);
      expect(() => buildZip([{ path: bad, content: 'x' }])).toThrow();
    }
    expect(() =>
      buildZip([
        { path: 'a.txt', content: '1' },
        { path: 'a.txt', content: '2' },
      ]),
    ).toThrow(/Duplicate/);
  });
});

describe('saving a findings export', () => {
  const when = new Date('2026-11-14T10:20:30Z');

  it('saves a Markdown report as the file itself, with a Markdown save dialog', async () => {
    const requestSavePath = vi.fn().mockResolvedValue('C:\\Users\\me\\report.md');
    const writes: Array<{ destination: string; bytes: Buffer }> = [];
    const result = await saveFindingsExport({
      requestSavePath,
      fetchExport: async () => markdown,
      writeDestination: async (destination, bytes) => void writes.push({ destination, bytes }),
      now: () => when,
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

  it('saves GitHub issues as one ZIP with every file in it', async () => {
    const writes: Buffer[] = [];
    const result = await saveFindingsExport({
      requestSavePath: async (options) => {
        expect(options.suggestedFilename).toBe('sentry-github-issues.zip');
        expect(options.filters[0]).toEqual({ name: 'ZIP archives', extensions: ['zip'] });
        return 'C:\\Users\\me\\issues.zip';
      },
      fetchExport: async () => issues,
      writeDestination: async (_destination, bytes) => void writes.push(bytes),
      now: () => when,
    });
    expect(result).toMatchObject({ status: 'saved', files: 3, findingCount: 1 });
    const entries = readZip(writes[0]!);
    expect(entries.map((entry) => entry.name)).toEqual(issues.files.map((file) => file.path));
    expect(entries[2]!.text).toBe('Ünïcode body ✓\n');
    expect(entries.every((entry) => entry.crcOk)).toBe(true);
  });

  it('writes a SARIF export as a plain file with a SARIF filter', () => {
    const sarif: FindingExportResultDto = {
      ...markdown,
      format: 'sarif',
      suggestedName: 'sentry-findings.sarif',
      files: [{ path: 'sentry-findings.sarif', content: '{}\n' }],
    };
    expect(saveOptionsForFindingsExport(sarif).filters[0]).toEqual({
      name: 'SARIF files',
      extensions: ['sarif', 'json'],
    });
    expect(findingsExportBytes(sarif, when).toString('utf8')).toBe('{}\n');
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
