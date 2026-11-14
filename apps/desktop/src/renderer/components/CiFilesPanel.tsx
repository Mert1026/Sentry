import React from 'react';
import { InfoPopover } from './InfoPopover.js';
import { TEST_FRAMEWORK_OPTIONS, type TestFramework } from './RevisionFindingsPanel.js';

export type CiTarget = 'github-actions' | 'gitlab-ci' | 'azure-pipelines';
export const CI_TARGET_OPTIONS: ReadonlyArray<{ value: CiTarget; label: string }> = [
  { value: 'github-actions', label: 'GitHub Actions' },
  { value: 'gitlab-ci', label: 'GitLab CI' },
  { value: 'azure-pipelines', label: 'Azure Pipelines' },
];

/**
 * Fixed CI templates that run the written tests (and, on GitHub, upload the SARIF export to code
 * scanning). Nothing here uses a provider or depends on the project: the files come from a template.
 */
export function CiFilesPanel({
  onSave,
  saving = false,
  note,
  error,
}: {
  onSave: (request: { target: CiTarget; framework: TestFramework }) => void;
  saving?: boolean;
  note?: string | undefined;
  error?: string | undefined;
}): React.JSX.Element {
  const [target, setTarget] = React.useState<CiTarget>('github-actions');
  const [framework, setFramework] = React.useState<TestFramework>('vitest');
  return (
    <div className="ci-files-panel">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <InfoPopover title="CI files">
          Download a ready-made pipeline file that runs your test suite, including the regression
          tests from Sentry, on every push. For GitHub Actions it also includes a workflow that
          uploads a Sentry SARIF export to code scanning. These are fixed templates: they use no AI
          and no provider budget, nothing in them comes from your project or your findings, and
          nothing is added to your repository. Adjust the language version and the install step to
          your project before you rely on them.
        </InfoPopover>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>CI system</span>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value as CiTarget)}
            aria-label="CI system"
          >
            {CI_TARGET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>Test framework</span>
          <select
            value={framework}
            onChange={(event) => setFramework(event.target.value as TestFramework)}
            aria-label="Test framework for CI"
          >
            {TEST_FRAMEWORK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary compact"
          disabled={saving}
          onClick={() => onSave({ target, framework })}
        >
          {saving ? 'Saving…' : 'Download CI files (ZIP)'}
        </button>
      </div>
      {note !== undefined ? (
        <p className="metadata" role="status">
          {note}
        </p>
      ) : null}
      {error !== undefined ? (
        <p className="error-box" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
