import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ZodType, ZodTypeDef } from 'zod';
import {
  ProjectProfileSchema,
  ToolchainNeedsSchema,
  type ProjectProfile,
  type ToolchainNeeds,
} from '@qa/schemas';
import type { AgentStackId, ProjectId } from '@qa/shared';
import { assertNoSymlinkBelow, projectDataPaths, resolveInside } from './paths.js';

/**
 * One JSON file per project and agent stack, next to (never inside) the working
 * copy. Removing a project removes its whole tree, these files included.
 */
class AgentProjectJsonStore<T extends { projectId: ProjectId; agentStackId: AgentStackId }> {
  constructor(
    private readonly dataRoot: string,
    private readonly folderName: string,
    private readonly schema: ZodType<T, ZodTypeDef, unknown>,
  ) {}

  private fileFor(projectId: ProjectId, agentStackId: AgentStackId): string {
    const folder = resolve(projectDataPaths(this.dataRoot, projectId).root, this.folderName);
    return resolveInside(folder, agentStackId + '.json');
  }

  /** The stored value, or undefined when missing or unreadable (never throws on bad content). */
  async read(projectId: ProjectId, agentStackId: AgentStackId): Promise<T | undefined> {
    try {
      const file = this.fileFor(projectId, agentStackId);
      await assertNoSymlinkBelow(this.dataRoot, file);
      const parsed = this.schema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      return parsed.success &&
        parsed.data.projectId === projectId &&
        parsed.data.agentStackId === agentStackId
        ? parsed.data
        : undefined;
    } catch {
      return undefined;
    }
  }

  async write(value: T): Promise<void> {
    const valid = this.schema.parse(value);
    const target = this.fileFor(valid.projectId, valid.agentStackId);
    await assertNoSymlinkBelow(this.dataRoot, dirname(target));
    await mkdir(dirname(target), { recursive: true });
    await assertNoSymlinkBelow(this.dataRoot, target);
    const temporary = target + '.tmp';
    await writeFile(temporary, JSON.stringify(valid), 'utf8');
    await rename(temporary, target);
  }

  async remove(projectId: ProjectId, agentStackId: AgentStackId): Promise<void> {
    const file = this.fileFor(projectId, agentStackId);
    await assertNoSymlinkBelow(this.dataRoot, file);
    await rm(file, { force: true });
  }
}

/** Each agent's orientation notes about a project. */
export class ProjectProfileStore extends AgentProjectJsonStore<ProjectProfile> {
  constructor(dataRoot: string) {
    super(dataRoot, 'profiles', ProjectProfileSchema);
  }
}

/** What each agent says it would need from the Toolchains library for a project. */
export class ToolchainNeedsStore extends AgentProjectJsonStore<ToolchainNeeds> {
  constructor(dataRoot: string) {
    super(dataRoot, 'toolchain-needs', ToolchainNeedsSchema);
  }
}
