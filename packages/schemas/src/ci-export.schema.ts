import { z } from 'zod';
import { TestFrameworkIdSchema } from './test-generation.schema.js';

/**
 * Ready-made CI files for the files Sentry exports. They are fixed templates: nothing in them comes
 * from a finding or from the project, and nothing is written into the project (the person copies
 * them where they belong).
 */
export const CI_TARGETS = [
  {
    id: 'github-actions',
    label: 'GitHub Actions',
  },
  {
    id: 'gitlab-ci',
    label: 'GitLab CI',
  },
  {
    id: 'azure-pipelines',
    label: 'Azure Pipelines',
  },
] as const;

export const CI_TARGET_IDS = CI_TARGETS.map((target) => target.id) as [
  (typeof CI_TARGETS)[number]['id'],
  ...(typeof CI_TARGETS)[number]['id'][],
];
export const CiTargetIdSchema = z.enum(CI_TARGET_IDS);
export type CiTargetId = z.infer<typeof CiTargetIdSchema>;

/** Which CI system, and which test framework the pipeline should run the written tests with. */
export const CiExportRequestSchema = z
  .object({ target: CiTargetIdSchema, framework: TestFrameworkIdSchema })
  .strict();
export type CiExportRequest = z.infer<typeof CiExportRequestSchema>;
