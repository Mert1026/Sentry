import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CI_TARGETS } from '@qa/schemas';
import { CI_TARGET_OPTIONS, CiFilesPanel } from '../../src/renderer/components/CiFilesPanel.js';

afterEach(cleanup);

describe('CiFilesPanel', () => {
  it('offers the same CI systems as the runtime', () => {
    expect(CI_TARGET_OPTIONS.map((option) => option.value)).toEqual(
      CI_TARGETS.map((target) => target.id),
    );
    expect(CI_TARGET_OPTIONS.map((option) => option.label)).toEqual(
      CI_TARGETS.map((target) => target.label),
    );
  });

  it('saves the chosen CI system and framework', () => {
    const onSave = vi.fn();
    render(<CiFilesPanel onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CI files (ZIP)' }));
    expect(onSave).toHaveBeenLastCalledWith({ target: 'github-actions', framework: 'vitest' });
    fireEvent.change(screen.getByLabelText('CI system'), { target: { value: 'gitlab-ci' } });
    fireEvent.change(screen.getByLabelText('Test framework for CI'), {
      target: { value: 'pytest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download CI files (ZIP)' }));
    expect(onSave).toHaveBeenLastCalledWith({ target: 'gitlab-ci', framework: 'pytest' });
  });

  it('shows what was saved, an error, and blocks a second click while saving', () => {
    render(<CiFilesPanel onSave={vi.fn()} note="Saved 3 CI files to C:/x.zip" error="Disk full" />);
    expect(screen.getByRole('status').textContent).toContain('Saved 3 CI files');
    expect(screen.getByRole('alert').textContent).toBe('Disk full');
    cleanup();
    render(<CiFilesPanel onSave={vi.fn()} saving />);
    expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true);
  });
});
