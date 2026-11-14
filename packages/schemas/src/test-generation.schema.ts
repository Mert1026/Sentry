import { z } from 'zod';

/**
 * Regression tests an agent writes for findings. The agent leaves each test as a file in its
 * private workspace; Sentry collects those files, stores them, and lets the person download
 * them. Sentry never runs them outside the agent's sandbox and never writes them into the project.
 */

/** Where, inside its workspace, the agent puts the test files Sentry collects. */
export const GENERATED_TESTS_DIR = '.sentry-tests';

/** Where the agent puts the final files of a patch (their project-relative paths below it). */
export const PATCH_FILES_DIR = '.sentry-patch';

/**
 * 'new-files': each test is a new file of its own. 'patch': the agent adds the tests to the
 * project's existing test files where it can, and Sentry turns the result into a patch to apply.
 */
export const TEST_WRITING_STYLES = ['new-files', 'patch'] as const;
export const TestWritingStyleSchema = z.enum(TEST_WRITING_STYLES);
export type TestWritingStyle = z.infer<typeof TestWritingStyleSchema>;

/** Most findings one test-writing run takes on: each one is a full check for an agent. */
export const TEST_GENERATION_MAX_FINDINGS = 12;

export const TEST_FRAMEWORKS = [
  {
    id: 'vitest',
    label: 'Vitest (TypeScript / JavaScript)',
    extensions: ['.ts', '.tsx', '.js', '.mjs'],
    convention: 'name the file <name>.test.ts, import { describe, it, expect } from "vitest"',
  },
  {
    id: 'jest',
    label: 'Jest (JavaScript / TypeScript)',
    extensions: ['.js', '.ts', '.tsx', '.mjs', '.cjs'],
    convention: 'name the file <name>.test.js, use the global describe / it / expect',
  },
  {
    id: 'pytest',
    label: 'pytest (Python)',
    extensions: ['.py'],
    convention: 'name the file test_<name>.py, plain functions named test_*, use assert',
  },
  {
    id: 'xunit',
    label: 'xUnit (C# / .NET)',
    extensions: ['.cs'],
    convention: 'name the file <Name>Tests.cs, a public class with [Fact] methods, use Assert.*',
  },
  {
    id: 'junit',
    label: 'JUnit 5 (Java)',
    extensions: ['.java'],
    convention: 'name the file <Name>Test.java, a class with @Test methods, use Assertions.*',
  },
  {
    id: 'go-test',
    label: 'go test (Go)',
    extensions: ['.go'],
    convention: 'name the file <name>_test.go, functions TestXxx(t *testing.T)',
  },
] as const;

export const TEST_FRAMEWORK_IDS = TEST_FRAMEWORKS.map((framework) => framework.id) as [
  (typeof TEST_FRAMEWORKS)[number]['id'],
  ...(typeof TEST_FRAMEWORKS)[number]['id'][],
];
export const TestFrameworkIdSchema = z.enum(TEST_FRAMEWORK_IDS);
export type TestFrameworkId = z.infer<typeof TestFrameworkIdSchema>;

/** Limits that keep one generated test small enough to read and review. */
export const GENERATED_TEST_MAX_FILES = TEST_GENERATION_MAX_FINDINGS * 2;
export const GENERATED_TEST_MAX_FILE_BYTES = 100_000;
export const GENERATED_TEST_MAX_TOTAL_BYTES = 1_000_000;

/** What a test-writing run is asked to do: which findings, in which framework. */
export const RunTestGenerationSchema = z
  .object({
    framework: TestFrameworkIdSchema,
    style: TestWritingStyleSchema.optional(),
    findings: z
      .array(
        z
          .object({
            n: z.number().int().min(1).max(TEST_GENERATION_MAX_FINDINGS),
            runId: z.string().min(1).max(100),
            findingId: z.string().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(TEST_GENERATION_MAX_FINDINGS),
  })
  .strict();
export type RunTestGeneration = z.infer<typeof RunTestGenerationSchema>;

/** What a caller asks for: which findings, in which framework. Numbers and agents are chosen by Sentry. */
export const TestWritingRequestSchema = z
  .object({
    framework: TestFrameworkIdSchema,
    style: TestWritingStyleSchema.optional(),
    findings: z
      .array(
        z
          .object({ runId: z.string().min(1).max(100), findingId: z.string().min(1).max(100) })
          .strict(),
      )
      .min(1)
      .max(TEST_GENERATION_MAX_FINDINGS),
  })
  .strict();
export type TestWritingRequest = z.infer<typeof TestWritingRequestSchema>;

/** What a test-writing agent run left behind, as kept with the run. Read back from disk, so checked. */
export const GeneratedTestsBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    framework: TestFrameworkIdSchema,
    style: TestWritingStyleSchema.optional(),
    agentStackId: z.string().min(1).max(100).nullable(),
    agentRunId: z.string().min(1).max(100),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(300),
            content: z.string().max(GENERATED_TEST_MAX_FILE_BYTES),
            n: z.number().int().min(1).max(TEST_GENERATION_MAX_FINDINGS).nullable(),
          })
          .strict(),
      )
      .max(GENERATED_TEST_MAX_FILES),
    skipped: z
      .array(z.object({ path: z.string().max(300), reason: z.string().max(100) }).strict())
      .max(500),
    // Patch style: one entry per test file that differs from the project's, with its diff.
    patch: z
      .array(
        z
          .object({
            path: z.string().min(1).max(300),
            kind: z.enum(['new', 'modified']),
            diff: z.string().min(1).max(400_000),
            content: z.string().max(GENERATED_TEST_MAX_FILE_BYTES),
            added: z.number().int().min(0),
            removed: z.number().int().min(0),
          })
          .strict(),
      )
      .max(GENERATED_TEST_MAX_FILES)
      .optional(),
  })
  .strict();
export type GeneratedTestsBundle = z.infer<typeof GeneratedTestsBundleSchema>;

export function testFramework(id: TestFrameworkId): (typeof TEST_FRAMEWORKS)[number] {
  const found = TEST_FRAMEWORKS.find((framework) => framework.id === id);
  if (found === undefined) throw new Error('Unknown test framework: ' + id);
  return found;
}
