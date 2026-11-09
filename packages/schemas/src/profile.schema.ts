import { z } from 'zod';
import {
  AgentStackIdSchema,
  IsoTimestampSchema,
  ProjectIdSchema,
  ProjectRevisionIdSchema,
  SchemaVersionSchema,
} from './primitives.js';

/** Longest profile text stored and handed to an agent. */
export const PROJECT_PROFILE_TEXT_MAX = 8000;

/**
 * One agent's own orientation notes about a project, written before any run.
 * Facts about structure only: it is UNVERIFIED context for later runs, never
 * evidence, and never holds findings or verdicts.
 */
export const ProjectProfileSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    projectId: ProjectIdSchema,
    agentStackId: AgentStackIdSchema,
    projectRevisionId: ProjectRevisionIdSchema,
    /** Content hash of the revision the profile describes; a different hash makes it stale. */
    contentHash: z.string().min(1).max(200),
    text: z.string().min(1).max(PROJECT_PROFILE_TEXT_MAX),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

/** What a run did with the profiles: recorded on the run so runs can be compared. */
export const RunProfileUsageSchema = z
  .object({
    requested: z.boolean(),
    usedAgentStackIds: z.array(AgentStackIdSchema).default([]),
    staleAgentStackIds: z.array(AgentStackIdSchema).default([]),
    missingAgentStackIds: z.array(AgentStackIdSchema).default([]),
  })
  .strict();
export type RunProfileUsage = z.infer<typeof RunProfileUsageSchema>;

/** One library entry (a toolchain pack and version) an agent says it needs for a project. */
export const ToolchainNeedSchema = z
  .object({
    packId: z.string().min(1).max(40),
    version: z.string().min(1).max(40),
    reason: z.string().min(1).max(500),
  })
  .strict();
export type ToolchainNeed = z.infer<typeof ToolchainNeedSchema>;

/**
 * What one agent says it would need from the Toolchains library to build and test a project.
 * Advice for the person installing packs; it never changes what a run does.
 */
export const ToolchainNeedsSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    projectId: ProjectIdSchema,
    agentStackId: AgentStackIdSchema,
    projectRevisionId: ProjectRevisionIdSchema,
    /** Content hash of the revision the agent read; a different hash makes it stale. */
    contentHash: z.string().min(1).max(200),
    summary: z.string().min(1).max(4000),
    needs: z.array(ToolchainNeedSchema).max(40),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type ToolchainNeeds = z.infer<typeof ToolchainNeedsSchema>;
