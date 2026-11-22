/**
 * Save As for the CLI command reference (Electron main process).
 *
 * Same safety contract as the exports: the renderer asks only for "the CLI reference". The text always comes
 * from the guide compiled into the app, the destination always comes from the native Save As dialog, and a
 * failed write never leaves a partial file at the chosen path.
 */
import { CLI_REFERENCE_MARKDOWN } from '../../shared/cli-reference.generated.js';
import { noteSavedExport, writeAtomically, type SaveDialogOptions } from './export-save.js';

export type CliReferenceSaveResult =
  { readonly status: 'saved'; readonly path: string } | { readonly status: 'cancelled' };

export interface CliReferenceSaveDeps {
  readonly requestSavePath: (options: SaveDialogOptions) => Promise<string | null>;
  readonly writeDestination?: (destination: string, bytes: Buffer) => Promise<void>;
}

export const CLI_REFERENCE_FILE_NAME = 'sentry-cli-commands.md';

export function saveOptionsForCliReference(): SaveDialogOptions {
  return {
    suggestedFilename: CLI_REFERENCE_FILE_NAME,
    filters: [
      { name: 'Markdown files', extensions: ['md'] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
}

export async function saveCliReference(
  deps: CliReferenceSaveDeps,
): Promise<CliReferenceSaveResult> {
  const destination = await deps.requestSavePath(saveOptionsForCliReference());
  // Cancelling the dialog is a normal outcome: no error, no file.
  if (destination === null || destination.length === 0) return { status: 'cancelled' };
  await (deps.writeDestination ?? writeAtomically)(
    destination,
    Buffer.from(CLI_REFERENCE_MARKDOWN, 'utf8'),
  );
  noteSavedExport(destination);
  return { status: 'saved', path: destination };
}
