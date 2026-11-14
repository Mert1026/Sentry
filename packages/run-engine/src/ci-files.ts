import {
  CI_TARGETS,
  testFramework,
  type CiExportRequest,
  type FindingExportResultDto,
  type TestFrameworkId,
} from '@qa/schemas';

/**
 * Fixed CI templates that run the tests Sentry wrote (and, on GitHub, upload the SARIF export to code
 * scanning). Nothing here comes from a finding or from the project: the same request always gives the
 * same files. They run the project's WHOLE test suite, so they pick up the copied tests wherever the
 * person put them, and they are a starting point to adjust (versions, install step), not a promise
 * that the project builds.
 */

interface FrameworkCi {
  /** GitHub Actions steps (already indented for `steps:`), after checkout. */
  readonly github: string;
  /** GitLab CI: the image and the script lines. */
  readonly gitlab: { readonly image: string; readonly script: readonly string[] };
  /** Azure Pipelines steps (already indented for `steps:`), after the implicit checkout. */
  readonly azure: string;
  /** Where the tests go, in words. */
  readonly where: string;
}

const FRAMEWORK_CI: Record<TestFrameworkId, FrameworkCi> = {
  vitest: {
    github: [
      '      - uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 20',
      '          cache: npm',
      '      - run: npm ci',
      '      - run: npx vitest run',
    ].join('\n'),
    gitlab: { image: 'node:20', script: ['npm ci', 'npx vitest run'] },
    azure: [
      '  - task: NodeTool@0',
      '    inputs:',
      "      versionSpec: '20.x'",
      '  - script: npm ci',
      '    displayName: Install dependencies',
      '  - script: npx vitest run',
      '    displayName: Run the tests',
    ].join('\n'),
    where: 'next to your other tests, for example `tests/sentry/`',
  },
  jest: {
    github: [
      '      - uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 20',
      '          cache: npm',
      '      - run: npm ci',
      '      - run: npx jest',
    ].join('\n'),
    gitlab: { image: 'node:20', script: ['npm ci', 'npx jest'] },
    azure: [
      '  - task: NodeTool@0',
      '    inputs:',
      "      versionSpec: '20.x'",
      '  - script: npm ci',
      '    displayName: Install dependencies',
      '  - script: npx jest',
      '    displayName: Run the tests',
    ].join('\n'),
    where: 'next to your other tests, for example `tests/sentry/`',
  },
  pytest: {
    github: [
      '      - uses: actions/setup-python@v5',
      '        with:',
      "          python-version: '3.12'",
      '      - run: python -m pip install --upgrade pip pytest',
      '      # Install your own dependencies here, for example:',
      '      # - run: pip install -r requirements.txt',
      '      - run: python -m pytest',
    ].join('\n'),
    gitlab: {
      image: 'python:3.12',
      script: [
        'python -m pip install --upgrade pip pytest',
        '# Install your own dependencies here, for example: pip install -r requirements.txt',
        'python -m pytest',
      ],
    },
    azure: [
      '  - task: UsePythonVersion@0',
      '    inputs:',
      "      versionSpec: '3.12'",
      '  - script: python -m pip install --upgrade pip pytest',
      '    displayName: Install pytest',
      '  # Install your own dependencies here, for example: pip install -r requirements.txt',
      '  - script: python -m pytest',
      '    displayName: Run the tests',
    ].join('\n'),
    where: 'in your tests folder, for example `tests/sentry/`',
  },
  xunit: {
    github: [
      '      - uses: actions/setup-dotnet@v4',
      '        with:',
      "          dotnet-version: '8.0.x'",
      '      - run: dotnet test',
    ].join('\n'),
    gitlab: { image: 'mcr.microsoft.com/dotnet/sdk:8.0', script: ['dotnet test'] },
    azure: [
      '  - task: UseDotNet@2',
      '    inputs:',
      '      packageType: sdk',
      "      version: '8.0.x'",
      '  - script: dotnet test',
      '    displayName: Run the tests',
    ].join('\n'),
    where: 'in your test project, next to its other `*Tests.cs` files',
  },
  junit: {
    github: [
      '      - uses: actions/setup-java@v4',
      '        with:',
      '          distribution: temurin',
      "          java-version: '21'",
      '          cache: maven',
      '      # Use `./gradlew test` instead if the project builds with Gradle.',
      '      - run: mvn -B test',
    ].join('\n'),
    gitlab: {
      image: 'maven:3.9-eclipse-temurin-21',
      script: ['# Use ./gradlew test instead if the project builds with Gradle.', 'mvn -B test'],
    },
    azure: [
      '  - task: JavaToolInstaller@0',
      '    inputs:',
      '      versionSpec: 21',
      '      jdkArchitectureOption: x64',
      '      jdkSourceOption: PreInstalled',
      '  # Use ./gradlew test instead if the project builds with Gradle.',
      '  - script: mvn -B test',
      '    displayName: Run the tests',
    ].join('\n'),
    where: 'in `src/test/java`, in the package of the code each test is about',
  },
  'go-test': {
    github: [
      '      - uses: actions/setup-go@v5',
      '        with:',
      '          go-version-file: go.mod',
      '      - run: go test ./...',
    ].join('\n'),
    gitlab: { image: 'golang:1.22', script: ['go test ./...'] },
    azure: [
      '  - task: GoTool@0',
      '    inputs:',
      "      version: '1.22'",
      '  - script: go test ./...',
      '    displayName: Run the tests',
    ].join('\n'),
    where: 'in the package of the code each test is about (Go tests sit beside the code)',
  },
};

const HEADER = [
  '# Written by Sentry. A starting point: adjust versions and the install step to your project.',
  '# It runs your whole test suite, including the regression tests copied in from Sentry.',
];

function githubTests(framework: TestFrameworkId): string {
  return (
    [
      ...HEADER,
      'name: Sentry regression tests',
      '',
      'on:',
      '  push:',
      '  pull_request:',
      '',
      'jobs:',
      '  tests:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      FRAMEWORK_CI[framework].github,
    ].join('\n') + '\n'
  );
}

function githubCodeScanning(): string {
  return (
    [
      '# Written by Sentry. Uploads the SARIF file from a Sentry findings export to GitHub code scanning.',
      '# Commit the file as `sentry.sarif` in the repository root, then push it (or run this by hand).',
      '# Code scanning needs a repository where it is available (public, or GitHub Advanced Security).',
      'name: Sentry code scanning',
      '',
      'on:',
      '  workflow_dispatch:',
      '  push:',
      '    paths:',
      '      - sentry.sarif',
      '',
      'jobs:',
      '  upload:',
      '    runs-on: ubuntu-latest',
      '    permissions:',
      '      security-events: write',
      '      contents: read',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: github/codeql-action/upload-sarif@v3',
      '        with:',
      '          sarif_file: sentry.sarif',
    ].join('\n') + '\n'
  );
}

function gitlabTests(framework: TestFrameworkId): string {
  const { image, script } = FRAMEWORK_CI[framework].gitlab;
  return (
    [
      ...HEADER,
      '# Add it to your pipeline with:',
      '#   include:',
      '#     - local: sentry-tests.gitlab-ci.yml',
      'sentry-regression-tests:',
      '  stage: test',
      `  image: ${image}`,
      '  script:',
      // A comment is a comment line, never a list item (`- # ...` would be an empty entry).
      ...script.map((line) =>
        line.startsWith('#') ? '    ' + line : '    - ' + quoteIfNeeded(line),
      ),
    ].join('\n') + '\n'
  );
}

/** A YAML list item is a plain scalar unless it holds `: ` or ` #`, which would change its meaning. */
function quoteIfNeeded(line: string): string {
  return /: | #/.test(line) ? "'" + line.replace(/'/g, "''") + "'" : line;
}

function azureTests(framework: TestFrameworkId): string {
  return (
    [
      ...HEADER,
      'trigger:',
      '  - main',
      '',
      'pool:',
      '  vmImage: ubuntu-latest',
      '',
      'steps:',
      FRAMEWORK_CI[framework].azure,
    ].join('\n') + '\n'
  );
}

function readme(request: CiExportRequest): string {
  const framework = testFramework(request.framework);
  const target = CI_TARGETS.find((item) => item.id === request.target);
  const lines = [
    '# CI files from Sentry',
    '',
    `For ${target?.label ?? request.target}, running ${framework.label} tests.`,
    '',
    '> These are fixed templates, not generated from your project. They run your whole test suite, so check the language version, the install step and the branch names against your project before relying on them. Sentry has not added anything to your repository.',
    '',
    '## Where the files go',
    '',
  ];
  if (request.target === 'github-actions')
    lines.push(
      '- `.github/workflows/sentry-regression-tests.yml`: runs the tests on every push and pull request.',
      '- `.github/workflows/sentry-code-scanning.yml`: uploads a `sentry.sarif` file (from a Sentry findings export, format SARIF) to GitHub code scanning. Commit `sentry.sarif` in the repository root first.',
    );
  else if (request.target === 'gitlab-ci')
    lines.push(
      '- `sentry-tests.gitlab-ci.yml`: put it in the repository and add it to `.gitlab-ci.yml` with `include: - local: sentry-tests.gitlab-ci.yml`. It adds one job, `sentry-regression-tests`, to the `test` stage.',
      '',
      'GitLab does not read SARIF files directly (its security reports use another format), so there is no code-scanning file for GitLab.',
    );
  else
    lines.push(
      '- `azure-pipelines-sentry-tests.yml`: put it in the repository, then create a pipeline from it (Pipelines, New pipeline, Existing Azure Pipelines YAML file). It runs on pushes to `main`.',
      '',
      'Azure DevOps shows SARIF files only through a marketplace extension, so no SARIF upload file is included.',
    );
  lines.push(
    '',
    '## The regression tests',
    '',
    `Copy the test files from a Sentry tests export (Download tests, a ZIP) and put them ${FRAMEWORK_CI[request.framework].where}. The pipeline then runs them with the rest of your tests.`,
    '',
    'A good regression test fails while the problem it describes exists, so the pipeline fails until the problem is fixed. Mark such a test as expected to fail, or add it together with the fix.',
  );
  return lines.join('\n') + '\n';
}

/** The CI files for one CI system and one test framework, ready to save as a ZIP. */
export function buildCiFiles(request: CiExportRequest): FindingExportResultDto {
  const files: Array<{ path: string; content: string }> = [
    { path: 'README.md', content: readme(request) },
  ];
  if (request.target === 'github-actions') {
    files.push(
      {
        path: '.github/workflows/sentry-regression-tests.yml',
        content: githubTests(request.framework),
      },
      { path: '.github/workflows/sentry-code-scanning.yml', content: githubCodeScanning() },
    );
  } else if (request.target === 'gitlab-ci') {
    files.push({ path: 'sentry-tests.gitlab-ci.yml', content: gitlabTests(request.framework) });
  } else {
    files.push({
      path: 'azure-pipelines-sentry-tests.yml',
      content: azureTests(request.framework),
    });
  }
  return {
    format: 'ci-files',
    files,
    findingCount: files.length - 1,
    suggestedName: `sentry-${request.target}-${request.framework}.zip`,
    mimeType: 'application/zip',
  };
}
