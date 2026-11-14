import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CI_TARGET_IDS, TEST_FRAMEWORK_IDS, type CiExportRequest } from '@qa/schemas';
import { buildCiFiles } from '../src/index.js';

const yamlFiles = (request: CiExportRequest) =>
  buildCiFiles(request).files.filter((file) => file.path.endsWith('.yml'));

describe('CI files', () => {
  it('gives valid YAML for every CI system and framework, and the same files every time', () => {
    for (const target of CI_TARGET_IDS)
      for (const framework of TEST_FRAMEWORK_IDS) {
        const request = { target, framework };
        const files = yamlFiles(request);
        expect(files.length, target + '/' + framework).toBeGreaterThan(0);
        for (const file of files) {
          expect(() => parse(file.content), file.path).not.toThrow();
          expect(file.content.endsWith('\n')).toBe(true);
        }
        expect(buildCiFiles(request)).toEqual(buildCiFiles(request));
      }
  });

  it('GitHub: a tests workflow that runs on pushes and the framework command, plus a SARIF upload', () => {
    const result = buildCiFiles({ target: 'github-actions', framework: 'pytest' });
    expect(result).toMatchObject({
      format: 'ci-files',
      suggestedName: 'sentry-github-actions-pytest.zip',
      mimeType: 'application/zip',
    });
    expect(result.files.map((file) => file.path)).toEqual([
      'README.md',
      '.github/workflows/sentry-regression-tests.yml',
      '.github/workflows/sentry-code-scanning.yml',
    ]);
    const tests = parse(result.files[1]!.content) as {
      on: Record<string, unknown>;
      jobs: { tests: { steps: Array<{ uses?: string; run?: string }> } };
    };
    expect(Object.keys(tests.on)).toEqual(['push', 'pull_request']);
    const steps = tests.jobs.tests.steps;
    expect(steps[0]?.uses).toBe('actions/checkout@v4');
    expect(steps.some((step) => step.uses === 'actions/setup-python@v5')).toBe(true);
    expect(steps.at(-1)?.run).toBe('python -m pytest');
    const scanning = parse(result.files[2]!.content) as {
      jobs: {
        upload: {
          permissions: Record<string, string>;
          steps: Array<{ uses?: string; with?: object }>;
        };
      };
    };
    expect(scanning.jobs.upload.permissions['security-events']).toBe('write');
    expect(scanning.jobs.upload.steps[1]).toEqual({
      uses: 'github/codeql-action/upload-sarif@v3',
      with: { sarif_file: 'sentry.sarif' },
    });
  });

  it('GitLab: one job on the right image; no SARIF file, and the README says why', () => {
    const result = buildCiFiles({ target: 'gitlab-ci', framework: 'xunit' });
    expect(result.files.map((file) => file.path)).toEqual([
      'README.md',
      'sentry-tests.gitlab-ci.yml',
    ]);
    const job = (
      parse(result.files[1]!.content) as Record<string, { image: string; script: string[] }>
    )['sentry-regression-tests']!;
    expect(job.image).toBe('mcr.microsoft.com/dotnet/sdk:8.0');
    expect(job.script).toEqual(['dotnet test']);
    expect(result.files[0]!.content).toContain('does not read SARIF');
  });

  it('GitLab: a script line with a colon or comment stays one plain line', () => {
    const job = (
      parse(buildCiFiles({ target: 'gitlab-ci', framework: 'pytest' }).files[1]!.content) as Record<
        string,
        { script: string[] }
      >
    )['sentry-regression-tests']!;
    expect(job.script).toEqual(['python -m pip install --upgrade pip pytest', 'python -m pytest']);
  });

  it('Azure: a pipeline with the framework step', () => {
    const result = buildCiFiles({ target: 'azure-pipelines', framework: 'go-test' });
    const pipeline = parse(result.files[1]!.content) as {
      trigger: string[];
      pool: { vmImage: string };
      steps: Array<{ task?: string; script?: string }>;
    };
    expect(pipeline.trigger).toEqual(['main']);
    expect(pipeline.pool.vmImage).toBe('ubuntu-latest');
    expect(pipeline.steps.map((step) => step.task ?? step.script)).toEqual([
      'GoTool@0',
      'go test ./...',
    ]);
  });

  it('every README says these are templates, where to copy the tests and that good tests fail until fixed', () => {
    for (const target of CI_TARGET_IDS) {
      const readme = buildCiFiles({ target, framework: 'vitest' }).files[0]!.content;
      expect(readme).toContain('fixed templates');
      expect(readme).toContain('Copy the test files');
      expect(readme).toContain('fails while the problem');
    }
  });
});
