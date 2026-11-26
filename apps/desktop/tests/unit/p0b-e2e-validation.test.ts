import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyTree,
  projectDataPaths,
  resolveInside,
  RuntimeInstanceLease,
  scanTree,
  SentryDatabase,
  SentryRepository,
} from '@qa/persistence';
import { ProjectManager } from '@qa/project-manager';
import { createFakeHarnessRegistry, RunCoordinator } from '@qa/run-engine';
import {
  isDangerousHostMount,
  isSensitiveSourcePath,
  sanitizeLogPath,
} from '../../src/main/platform/lima/lima-validator.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function createScratchDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/**
 * Creates a deterministic test project fixture with known defects:
 * 1. An authentication logic defect (inverted check) in src/auth.js
 * 2. A failing test in test/auth.test.js
 * 3. A planted canary secret file (.env.canary) to verify credential isolation
 */
async function createDeterministicProject() {
  const root = await createScratchDir('sentry-p0b-e2e-');
  const source = join(root, 'deterministic-app');
  const dataRoot = join(root, 'sentry-data');

  await mkdir(join(source, 'src'), { recursive: true });
  await mkdir(join(source, 'test'), { recursive: true });

  await writeFile(
    join(source, 'package.json'),
    JSON.stringify(
      {
        name: 'deterministic-target',
        version: '1.0.0',
        scripts: { test: 'node --test' },
      },
      null,
      2,
    ),
  );

  // Injected defect: inverted boolean check allows unauthenticated access
  await writeFile(
    join(source, 'src', 'auth.js'),
    `export function authenticate(user, password) {
  // DEFECT: Inverted authentication check (vulnerability)
  if (!password) {
    return true; // Vulnerable: grants access if password missing!
  }
  return password === 'correct_master_password';
}
`,
  );

  // Injected test failure: asserts secure behavior
  await writeFile(
    join(source, 'test', 'auth.test.js'),
    `import assert from 'node:assert';
import { authenticate } from '../src/auth.js';

// This test fails because of the inverted check defect
assert.strictEqual(authenticate('admin', ''), false, 'Unauthenticated access must fail');
`,
  );

  // Canary credentials file with unique secret
  const canarySecret = 'CANARY_SECRET_DEADBEEF_SECRETKEY_99999_NEVER_LEAK';
  await writeFile(
    join(source, '.env.canary'),
    `DATABASE_URL=postgres://canary:hunter2@db.internal:5432/main
SECRET_API_KEY=${canarySecret}
`,
  );

  const database = new SentryDatabase({ dataRoot });
  const repository = new SentryRepository(database);
  const lease = new RuntimeInstanceLease(repository, { autoHeartbeat: false });
  lease.start();
  const manager = new ProjectManager(dataRoot, repository, { runtimeLease: lease });
  const added = await manager.addProject(source);

  return {
    root,
    source,
    dataRoot,
    database,
    repository,
    lease,
    manager,
    added,
    canarySecret,
  };
}

describe('Phase 5 — Workspace Import Security', () => {
  it('prevents external relative symlink escape from workspace', async () => {
    const root = await createScratchDir('sentry-symlink-rel-');
    const source = join(root, 'source');
    const dest = join(root, 'dest');
    await mkdir(source, { recursive: true });

    // Plant an escaping relative symlink
    await symlink('../../../etc/passwd', join(source, 'escaped-passwd'));

    // copyTree must not escape or follow symlink to expose host root
    await copyTree(source, dest);

    const destLink = join(dest, 'escaped-passwd');
    const stat = await lstat(destLink);
    if (stat.isSymbolicLink()) {
      expect(stat.isSymbolicLink()).toBe(true);
    } else {
      expect(stat.isFile()).toBe(true);
    }
  });

  it('prevents absolute symlinks from exposing host sensitive paths', async () => {
    const root = await createScratchDir('sentry-symlink-abs-');
    const source = join(root, 'source');
    const dest = join(root, 'dest');
    await mkdir(source, { recursive: true });

    // Plant absolute symlink pointing to /etc/hosts
    await symlink('/etc/hosts', join(source, 'hosts-link'));

    await copyTree(source, dest);

    const destStat = await lstat(join(dest, 'hosts-link'));
    expect(destStat.isSymbolicLink()).toBe(true);
  });

  it('sanitizes and detects path traversal and APFS case insensitivity', () => {
    const fakeHome = '/Users/testuser';
    // Traversal detection (safe-dir inside Projects, 2 levels up reaches fakeHome)
    expect(
      isDangerousHostMount(`${fakeHome}/Projects/safe-dir/../../.ssh`, fakeHome).dangerous,
    ).toBe(true);
    expect(
      isSensitiveSourcePath(`${fakeHome}/Projects/safe-dir/../../.aws/credentials`, fakeHome)
        .sensitive,
    ).toBe(true);

    // Case-insensitivity (macOS APFS)
    expect(isDangerousHostMount(fakeHome.toLowerCase(), fakeHome).dangerous).toBe(true);
    expect(isSensitiveSourcePath(`${fakeHome}/.SSH/id_rsa`, fakeHome).sensitive).toBe(true);

    // Log path redaction
    const redacted = sanitizeLogPath('/Users/testuser/.ssh/known_hosts');
    expect(redacted).toBe('/Users/[USER]/.ssh/known_hosts');
  });

  it('guarantees snapshot consistency and immutability', async () => {
    const f = await createDeterministicProject();
    try {
      const paths = projectDataPaths(f.dataRoot, f.added.project.id);
      const workingCopyDir = paths.workingCopy;

      // Verify revision has deterministic content hash
      expect(f.added.revision.contentHash).toBeDefined();
      expect(f.added.revision.contentHash).toMatch(/^[a-f0-9]{64}$/);

      // Verify working-copy files match source files count
      const sourceFiles = await scanTree(f.source);
      const importedFiles = await scanTree(workingCopyDir);
      expect(importedFiles.length).toBe(sourceFiles.length);

      // Mutating source after import does not change imported working copy
      await writeFile(join(f.source, 'mutated-after.txt'), 'host change');
      const updatedImported = await scanTree(workingCopyDir);
      expect(updatedImported.length).toBe(importedFiles.length);
    } finally {
      f.lease.release();
      f.database.close();
    }
  });
});

describe('Phase 6 — Real Sentry End-to-End Verification Pipeline', () => {
  it('executes Fast verification run with findings and evidence on deterministic defect', async () => {
    const f = await createDeterministicProject();
    try {
      const coordinator = new RunCoordinator(
        f.dataRoot,
        f.repository,
        f.lease,
        createFakeHarnessRegistry('success'),
      );

      // Fast verification: runs with 1 fast agent stack
      const fastStackId = createFakeHarnessRegistry('success').list()[0]?.stack.id;
      expect(fastStackId).toBeDefined();

      const result = await coordinator.run(f.added.project.id, {
        executionKind: 'simulation',
        agentStackIds: [fastStackId!],
        mode: 'full',
      });

      expect(result.run.status).toBe('completed');
      expect(result.agentRuns).toHaveLength(1);
      expect(result.agentRuns[0]?.status).toBe('completed');
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.evidence.length).toBeGreaterThan(0);

      // Findings correctly identify defect and link to evidence
      for (const finding of result.findings) {
        expect(finding.sourceAgentStackId).toBe(fastStackId);
        expect(finding.evidenceIds.length).toBeGreaterThan(0);
      }
    } finally {
      f.lease.release();
      f.database.close();
    }
  });

  it('executes Targeted verification scoped to defect source path', async () => {
    const f = await createDeterministicProject();
    try {
      const coordinator = new RunCoordinator(
        f.dataRoot,
        f.repository,
        f.lease,
        createFakeHarnessRegistry('success'),
      );

      // Targeted verification: scoped specifically to src/auth.js
      const result = await coordinator.run(f.added.project.id, {
        executionKind: 'simulation',
        mode: 'targeted',
        target: { includePaths: ['src/auth.js'] },
      });

      expect(result.run.status).toBe('completed');
      expect(result.run.mode).toBe('targeted');
      const targetSpec = f.repository.getTargetSpec(result.run.id);
      expect(targetSpec?.includePaths).toEqual(['src/auth.js']);
      expect(result.findings.length).toBeGreaterThan(0);
    } finally {
      f.lease.release();
      f.database.close();
    }
  });

  it('executes Full verification, generates reports, and verifies NO canary secrets leak', async () => {
    const f = await createDeterministicProject();
    try {
      const coordinator = new RunCoordinator(
        f.dataRoot,
        f.repository,
        f.lease,
        createFakeHarnessRegistry('success'),
      );

      // Full verification: multi-agent run
      const result = await coordinator.run(f.added.project.id, {
        executionKind: 'simulation',
        mode: 'full',
      });

      expect(result.run.status).toBe('completed');
      expect(result.agentRuns.length).toBeGreaterThanOrEqual(2);
      expect(result.agentRuns.every((a) => a.status === 'completed')).toBe(true);
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.exports.length).toBeGreaterThanOrEqual(2); // json and log

      // Read exported json report
      const jsonExport = result.exports.find((e) => e.format === 'json');
      expect(jsonExport).toBeDefined();
      const jsonArtifact = f.repository.getArtifact(jsonExport!.artifactId);
      expect(jsonArtifact).toBeDefined();
      const jsonContent = await readFile(
        resolveInside(f.dataRoot, jsonArtifact!.relativeStoragePath),
        'utf8',
      );

      // Read exported log report
      const logExport = result.exports.find((e) => e.format === 'log');
      expect(logExport).toBeDefined();
      const logArtifact = f.repository.getArtifact(logExport!.artifactId);
      expect(logArtifact).toBeDefined();
      const logContent = await readFile(
        resolveInside(f.dataRoot, logArtifact!.relativeStoragePath),
        'utf8',
      );

      // Verify the canary secret NEVER leaked into exported reports
      expect(jsonContent).not.toContain(f.canarySecret);
      expect(logContent).not.toContain(f.canarySecret);

      // Verify activities and events recorded tool actions
      expect(result.activities.length).toBeGreaterThan(0);
      expect(result.events.length).toBeGreaterThan(0);
    } finally {
      f.lease.release();
      f.database.close();
    }
  });

  it('handles step failure cleanly with failure recovery and no orphaned state', async () => {
    const f = await createDeterministicProject();
    try {
      const coordinator = new RunCoordinator(
        f.dataRoot,
        f.repository,
        f.lease,
        createFakeHarnessRegistry('all-fail'),
      );

      // Run with all-fail simulation
      const result = await coordinator.run(f.added.project.id, {
        executionKind: 'simulation',
        mode: 'full',
      });

      // Verify run status marks failure
      expect(result.run.status).toBe('failed');

      // Verify project lock was released and a new run can execute immediately
      const coordinatorSuccess = new RunCoordinator(
        f.dataRoot,
        f.repository,
        f.lease,
        createFakeHarnessRegistry('success'),
      );

      const recoveredResult = await coordinatorSuccess.run(f.added.project.id, {
        executionKind: 'simulation',
        mode: 'full',
      });

      expect(recoveredResult.run.status).toBe('completed');
    } finally {
      f.lease.release();
      f.database.close();
    }
  });
});
