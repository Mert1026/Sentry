import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { copyFile, link, mkdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative } from 'node:path';
import { once } from 'node:events';
import { createArtifactId, nowIsoTimestamp, type ProjectId, type QARunId } from '@qa/shared';
import { ArtifactSchema, type Artifact, type ArtifactType } from '@qa/schemas';
import type { SentryRepository } from './repository.js';
import { assertNoSymlinkBelow, assertNoSymlinkBelowSync, resolveInside } from './paths.js';
import { RuntimePersistenceError } from './errors.js';

export interface WriteArtifactInput {
  readonly relativePath: string;
  readonly type: ArtifactType;
  readonly source: AsyncIterable<Uint8Array | string>;
  readonly projectId?: ProjectId;
  readonly qaRunId?: QARunId;
  readonly mimeType?: string;
  readonly persistMetadata?: boolean;
}

export class FilesystemArtifactStore {
  constructor(
    private readonly dataRoot: string,
    private readonly repository: SentryRepository,
  ) {}

  async write(input: WriteArtifactInput): Promise<Artifact> {
    const id = createArtifactId();
    // Stored paths use forward slashes only. A POSIX file name that contains a backslash cannot be
    // stored faithfully (the path would be rewritten and no longer reopen), so it is refused.
    if (input.relativePath.includes('\\')) {
      throw new RuntimePersistenceError(
        'ARTIFACT_WRITE_FAILED',
        'Artifact path must use forward slashes and no backslashes: ' + input.relativePath,
      );
    }
    const finalPath = resolveInside(this.dataRoot, input.relativePath);
    const temporaryPath = finalPath + '.' + id + '.tmp';
    const previousPath = finalPath + '.' + id + '.prev';
    // A link planted under the data root must never redirect where artifact bytes are written.
    await assertNoSymlinkBelow(this.dataRoot, finalPath, { includeLeaf: false });
    await mkdir(dirname(finalPath), { recursive: true });
    let hasPrevious = false;
    const output = createWriteStream(temporaryPath, { flags: 'wx' });
    const hash = createHash('sha256');
    let sizeBytes = 0;
    let finalized = false;
    try {
      for await (const rawChunk of input.source) {
        const chunk = typeof rawChunk === 'string' ? Buffer.from(rawChunk) : Buffer.from(rawChunk);
        sizeBytes += chunk.byteLength;
        hash.update(chunk);
        if (!output.write(chunk)) await once(output, 'drain');
      }
      output.end();
      await once(output, 'finish');
      // Keep the artifact being replaced until the new one is fully recorded, so a failure
      // afterwards restores it instead of leaving nothing. A hard link costs no extra space.
      try {
        await link(finalPath, previousPath);
        hasPrevious = true;
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          try {
            await copyFile(finalPath, previousPath);
            hasPrevious = true;
          } catch (copyCause) {
            if ((copyCause as NodeJS.ErrnoException).code !== 'ENOENT') throw copyCause;
          }
        }
      }
      await rename(temporaryPath, finalPath);
      finalized = true;
      const relativeStoragePath = relative(this.dataRoot, finalPath).replaceAll('\\', '/');
      const artifact = ArtifactSchema.parse({
        schemaVersion: 1,
        id,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.qaRunId === undefined ? {} : { qaRunId: input.qaRunId }),
        type: input.type,
        relativeStoragePath,
        ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
        sizeBytes,
        sha256: hash.digest('hex'),
        createdAt: nowIsoTimestamp(),
      });
      if (input.persistMetadata ?? true) this.repository.saveArtifact(artifact);
      if (hasPrevious) await rm(previousPath, { force: true }).catch(() => undefined);
      return artifact;
    } catch (cause) {
      output.destroy();
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (hasPrevious) {
        // Put the artifact that was there back; the failed new bytes go away with it.
        await rename(previousPath, finalPath).catch(() => undefined);
      } else {
        await rm(previousPath, { force: true }).catch(() => undefined);
        if (finalized) await rm(finalPath, { force: true }).catch(() => undefined);
      }
      throw new RuntimePersistenceError(
        'ARTIFACT_WRITE_FAILED',
        'Unable to stream artifact to ' + input.relativePath,
        { cause },
      );
    }
  }

  open(artifact: Artifact): ReadStream {
    const validated = ArtifactSchema.parse(artifact);
    const path = resolveInside(this.dataRoot, validated.relativeStoragePath);
    assertNoSymlinkBelowSync(this.dataRoot, path);
    return createReadStream(path);
  }

  persist(artifact: Artifact): void {
    this.repository.saveArtifact(ArtifactSchema.parse(artifact));
  }

  async discard(artifact: Artifact): Promise<void> {
    const validated = ArtifactSchema.parse(artifact);
    const path = resolveInside(this.dataRoot, validated.relativeStoragePath);
    await assertNoSymlinkBelow(this.dataRoot, path, { includeLeaf: false });
    await rm(path, { force: true });
  }

  async delete(artifact: Artifact): Promise<void> {
    const validated = ArtifactSchema.parse(artifact);
    // Let SQLite reject deletion of a referenced artifact before touching its bytes.
    // If the file removal subsequently fails, the only residue is an unreferenced
    // file rather than live metadata pointing at missing data.
    const path = resolveInside(this.dataRoot, validated.relativeStoragePath);
    await assertNoSymlinkBelow(this.dataRoot, path, { includeLeaf: false });
    this.repository.deleteArtifact(validated.id);
    await rm(path, { force: true });
  }
}
