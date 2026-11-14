import { z } from 'zod';
import {
  AgentRunIdSchema,
  AgentStackIdSchema,
  FindingIdSchema,
  IsoTimestampSchema,
  ProjectContextSnapshotIdSchema,
  ProjectIdSchema,
  QARunIdSchema,
  SchemaVersionSchema,
  SnapshotIdSchema,
  NonNegativeIntSchema,
  RuntimeInstanceIdSchema,
} from './primitives.js';
import { AGENT_RUN_STATUSES, AGENT_TASK_TYPES, QARUN_STATUSES } from './enums.js';
import { AgentUsageSchema } from './usage.schema.js';
import { ExecutionSafeguardsSchema } from './agent.schema.js';
import { RunInstructionsSchema } from './context.schema.js';
import { RunProfileUsageSchema } from './profile.schema.js';
import {
  TEST_GENERATION_MAX_FINDINGS,
  TestFrameworkIdSchema,
  TestWritingStyleSchema,
} from './test-generation.schema.js';

/** Most findings one retest run may take on: each one is a full check for an agent. */
export const RETEST_MAX_FINDINGS = 12;

/**
 * A run that re-tests findings reported on earlier revisions against the revision it runs on.
 * Each item is numbered across the whole run; `assignedAgentStackIds` says who re-tests it.
 */
export const RunRetestSchema = z
  .object({
    who: z.enum(['reporter', 'all']),
    items: z
      .array(
        z
          .object({
            n: z.number().int().min(1).max(RETEST_MAX_FINDINGS),
            findingId: FindingIdSchema,
            sourceRunId: QARunIdSchema,
            sourceAgentStackId: AgentStackIdSchema,
            title: z.string().min(1).max(200),
            assignedAgentStackIds: z.array(AgentStackIdSchema).min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(RETEST_MAX_FINDINGS),
  })
  .strict();
export type RunRetest = z.infer<typeof RunRetestSchema>;

/**
 * A run that writes one regression test per finding reported on earlier revisions, in one test
 * framework. Each item is numbered across the whole run; `agentStackId` says who writes it.
 */
export const RunTestWritingSchema = z
  .object({
    framework: TestFrameworkIdSchema,
    style: TestWritingStyleSchema.optional(),
    items: z
      .array(
        z
          .object({
            n: z.number().int().min(1).max(TEST_GENERATION_MAX_FINDINGS),
            findingId: FindingIdSchema,
            sourceRunId: QARunIdSchema,
            sourceAgentStackId: AgentStackIdSchema,
            title: z.string().min(1).max(200),
            agentStackId: AgentStackIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(TEST_GENERATION_MAX_FINDINGS),
  })
  .strict();
export type RunTestWriting = z.infer<typeof RunTestWritingSchema>;

export const QARunConfigurationSchema = z
  .object({
    agentStackIds: z.array(AgentStackIdSchema).min(1),
    instructions: RunInstructionsSchema.optional(),
    policy: z.object({ id: z.string().min(1).max(100), version: z.number().int().min(1) }).strict(),
    executionProfileId: z.string().min(1).max(100).optional(),
    executionSafeguards: ExecutionSafeguardsSchema.optional(),
    profileUsage: RunProfileUsageSchema.optional(),
    retest: RunRetestSchema.optional(),
    testWriting: RunTestWritingSchema.optional(),
  })
  .strict();
export type QARunConfiguration = z.infer<typeof QARunConfigurationSchema>;

export const QARunSummarySchema = z
  .object({
    agentRuns: z
      .object({
        configured: NonNegativeIntSchema,
        completed: NonNegativeIntSchema,
        failed: NonNegativeIntSchema,
        interrupted: NonNegativeIntSchema.optional(),
      })
      .strict(),
    findings: z.object({ total: NonNegativeIntSchema }).strict(),
    issues: z
      .object({
        critical: NonNegativeIntSchema,
        high: NonNegativeIntSchema,
        medium: NonNegativeIntSchema,
        low: NonNegativeIntSchema,
        info: NonNegativeIntSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type QARunSummary = z.infer<typeof QARunSummarySchema>;

const QARunBaseSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: QARunIdSchema,
    projectId: ProjectIdSchema,
    snapshotId: SnapshotIdSchema,
    projectContextSnapshotId: ProjectContextSnapshotIdSchema,
    runtimeInstanceId: RuntimeInstanceIdSchema.optional(),
    executionKind: z.enum(['simulation', 'production']).optional(),
    status: z.enum(QARUN_STATUSES),
    configuration: QARunConfigurationSchema,
    createdAt: IsoTimestampSchema,
    startedAt: IsoTimestampSchema.optional(),
    completedAt: IsoTimestampSchema.optional(),
    summary: QARunSummarySchema.optional(),
  })
  .strict();

export const QARunSchema = QARunBaseSchema.extend({
  mode: z.enum(['full', 'targeted'] as const),
}).strict();
export const CanonicalQARunSchema = QARunSchema;
export type QARun = z.infer<typeof QARunSchema>;

export const AgentRuntimeIdentitySchema = z
  .object({
    modelId: z.string().min(1).max(200).optional(),
    // Provider id when the harness separates provider from model
    // (e.g. OpenCode harness + OpenRouter provider). Optional and
    // additive: historical rows without it still validate.
    provider: z.string().min(1).max(100).optional(),
    modelVersion: z.string().min(1).max(100).optional(),
    adapterId: z.string().min(1).max(100).optional(),
    adapterVersion: z.string().min(1).max(100).optional(),
    harnessVersion: z.string().min(1).max(100).optional(),
    sdkVersion: z.string().min(1).max(100).optional(),
    executable: z.string().min(1).max(2000).optional(),
    executableVersion: z.string().min(1).max(200).optional(),
    policyId: z.string().min(1).max(100).optional(),
    policyVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type AgentRuntimeIdentity = z.infer<typeof AgentRuntimeIdentitySchema>;

export const AgentRunFailureSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(2000),
    retryable: z.boolean().default(false),
  })
  .strict();
export type AgentRunFailure = z.infer<typeof AgentRunFailureSchema>;

export const AgentRunSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: AgentRunIdSchema,
    qaRunId: QARunIdSchema,
    agentStackId: AgentStackIdSchema,
    taskType: z.enum(AGENT_TASK_TYPES),
    status: z.enum(AGENT_RUN_STATUSES),
    runtimeIdentity: AgentRuntimeIdentitySchema.optional(),
    startedAt: IsoTimestampSchema.optional(),
    completedAt: IsoTimestampSchema.optional(),
    failure: AgentRunFailureSchema.optional(),
    usage: AgentUsageSchema.optional(),
  })
  .strict()
  .superRefine((run, ctx) => {
    const requiresFailure =
      run.status === 'failed' || run.status === 'interrupted' || run.status === 'timed_out';
    if (requiresFailure && run.failure === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failure'],
        message: run.status + ' AgentRun requires structured failure details',
      });
    }
    if (!requiresFailure && run.failure !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failure'],
        message: 'Only failed, interrupted, or timed_out AgentRuns may carry failure details',
      });
    }
  });
export type AgentRun = z.infer<typeof AgentRunSchema>;
