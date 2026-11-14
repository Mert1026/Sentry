import { z } from 'zod';

/** The file formats findings can be exported as. */
export const FINDING_EXPORT_FORMATS = ['markdown', 'github-issues', 'sarif'] as const;
export type FindingExportFormat = (typeof FINDING_EXPORT_FORMATS)[number];

/** Most findings one export takes. */
export const FINDING_EXPORT_MAX_FINDINGS = 500;

/** Which findings to export: explicit ones, every finding of one run, or of some revisions. */
export const FindingExportSelectionSchema = z.union([
  z
    .object({
      findings: z
        .array(
          z
            .object({ runId: z.string().min(1).max(100), findingId: z.string().min(1).max(100) })
            .strict(),
        )
        .min(1)
        .max(FINDING_EXPORT_MAX_FINDINGS + 1),
    })
    .strict(),
  z.object({ runId: z.string().min(1).max(100) }).strict(),
  z
    .object({
      revisionIds: z
        .array(z.string().regex(/^rev_[0-9A-HJKMNP-TV-Z]{26}$/))
        .min(1)
        .max(50),
    })
    .strict(),
]);
export type FindingExportSelection = z.infer<typeof FindingExportSelectionSchema>;

export const FindingExportRequestSchema = z
  .object({
    format: z.enum(FINDING_EXPORT_FORMATS),
    selection: FindingExportSelectionSchema,
  })
  .strict();
export type FindingExportRequest = z.infer<typeof FindingExportRequestSchema>;

/** What an export returns: the files, and how to name and label them. */
export const FindingExportResultSchema = z
  .object({
    // 'test-files' only comes from a test-writing run, never from a findings selection.
    format: z.enum([...FINDING_EXPORT_FORMATS, 'test-files']),
    files: z.array(z.object({ path: z.string().min(1).max(300), content: z.string() }).strict()),
    findingCount: z.number().int().min(0),
    suggestedName: z.string().min(1).max(200),
    mimeType: z.string().min(1).max(100),
  })
  .strict();
export type FindingExportResultDto = z.infer<typeof FindingExportResultSchema>;
