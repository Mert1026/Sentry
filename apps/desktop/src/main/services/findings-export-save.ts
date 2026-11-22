/**
 * Save As for findings exports (Electron main process).
 *
 * Same safety contract as run exports: the renderer chooses only the findings and the format. The
 * destination always comes from the native Save As dialog, the bytes always come from the runtime's
 * export, and a failed write never leaves a partial file at the chosen path. Every format is one
 * file: Markdown (.md), JSON (.json) or plain text (.txt).
 */
import type { FindingExportResultDto } from '@qa/schemas';
import { noteSavedExport, writeAtomically, type SaveDialogOptions } from './export-save.js';

export type FindingsExportSaveResult =
  | {
      readonly status: 'saved';
      readonly path: string;
      readonly files: number;
      readonly findingCount: number;
    }
  | { readonly status: 'cancelled' };

export interface FindingsExportSaveDeps {
  readonly requestSavePath: (options: SaveDialogOptions) => Promise<string | null>;
  readonly fetchExport: () => Promise<FindingExportResultDto>;
  readonly writeDestination?: (destination: string, bytes: Buffer) => Promise<void>;
}

export function saveOptionsForFindingsExport(result: FindingExportResultDto): SaveDialogOptions {
  const all = { name: 'All files', extensions: ['*'] };
  if (result.format === 'markdown')
    return {
      suggestedFilename: result.suggestedName,
      filters: [{ name: 'Markdown files', extensions: ['md'] }, all],
    };
  if (result.format === 'json')
    return {
      suggestedFilename: result.suggestedName,
      filters: [{ name: 'JSON files', extensions: ['json'] }, all],
    };
  return {
    suggestedFilename: result.suggestedName,
    filters: [{ name: 'Text files', extensions: ['txt'] }, all],
  };
}

/** The bytes to save: the one report file exactly as the runtime built it. */
export function findingsExportBytes(result: FindingExportResultDto): Buffer {
  const [only] = result.files;
  if (result.files.length !== 1 || only === undefined)
    throw new Error('A findings export is exactly one file.');
  return Buffer.from(only.content, 'utf8');
}

export async function saveFindingsExport(
  deps: FindingsExportSaveDeps,
): Promise<FindingsExportSaveResult> {
  // Fetch first: a selection that cannot be exported fails before any dialog opens.
  const result = await deps.fetchExport();
  const destination = await deps.requestSavePath(saveOptionsForFindingsExport(result));
  // Cancelling the dialog is a normal outcome: no error, no file.
  if (destination === null || destination.length === 0) return { status: 'cancelled' };
  const bytes = findingsExportBytes(result);
  await (deps.writeDestination ?? writeAtomically)(destination, bytes);
  noteSavedExport(destination);
  return {
    status: 'saved',
    path: destination,
    files: result.files.length,
    findingCount: result.findingCount,
  };
}
