import { describe, expect, it } from 'vitest';
import {
  projectRelativeSelections,
  sourcePathForDialog,
} from '../../src/main/target-picker-paths.js';

describe('project scope picker paths', () => {
  it('maps Windows drives, WSL paths, and native Linux paths', () => {
    expect(sourcePathForDialog('/mnt/c/Work/Project', 'win32', 'Ubuntu')).toBe('C:\\Work\\Project');
    expect(sourcePathForDialog('/home/me/project', 'win32', 'Ubuntu')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\project',
    );
    expect(sourcePathForDialog('/home/me/project', 'linux')).toBe('/home/me/project');
    expect(() => sourcePathForDialog('/home/me/project', 'win32')).toThrow();
  });
  it('accepts nested files and folders but refuses paths outside the project', () => {
    expect(
      projectRelativeSelections(
        'C:\\work\\project',
        ['C:\\work\\project\\src\\app.ts', 'C:\\work\\project\\tests'],
        'win32',
      ),
    ).toEqual(['src/app.ts', 'tests']);
    for (const bad of ['C:\\work\\project', 'C:\\work\\project-other\\file', 'D:\\file'])
      expect(() => projectRelativeSelections('C:\\work\\project', [bad], 'win32')).toThrow();
    expect(
      projectRelativeSelections('/home/me/project', ['/home/me/project/src'], 'linux'),
    ).toEqual(['src']);
  });
});
