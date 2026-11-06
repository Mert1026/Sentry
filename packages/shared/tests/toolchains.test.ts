import { describe, expect, it } from 'vitest';
import {
  checkCustomAddonName,
  checkCustomAddonPathEntries,
  customAddonDir,
  toolchainDir,
  withToolchains,
} from '../src/index.js';

describe('withToolchains', () => {
  const setup = {
    binds: ['/data/toolchains'],
    path: ['/data/toolchains/java/21/jdk/bin', '/data/toolchains/java/21/maven/bin'],
    env: { JAVA_HOME: '/data/toolchains/java/21/jdk' },
  };

  it('puts the toolchain folders ahead of the existing PATH and adds their variables', () => {
    const result = withToolchains({ PATH: '/usr/bin', HOME: '/h' }, setup);
    expect(result['PATH']).toBe(
      '/data/toolchains/java/21/jdk/bin:/data/toolchains/java/21/maven/bin:/usr/bin',
    );
    expect(result['JAVA_HOME']).toBe('/data/toolchains/java/21/jdk');
    expect(result['HOME']).toBe('/h');
  });

  it('works without an existing PATH and does not change the input', () => {
    const input = { HOME: '/h' };
    expect(withToolchains(input, setup)['PATH']).toBe(
      '/data/toolchains/java/21/jdk/bin:/data/toolchains/java/21/maven/bin',
    );
    expect(input).toEqual({ HOME: '/h' });
  });

  it('returns the environment as it is when nothing is installed', () => {
    const input = { PATH: '/usr/bin' };
    expect(withToolchains(input, undefined)).toBe(input);
    expect(withToolchains(input, { binds: [], path: [], env: {} })).toBe(input);
  });
});

describe('custom add-on names and folders', () => {
  it('accepts plain names and rejects listed packs, odd characters and long names', () => {
    for (const ok of ['my-tool', 'a', 'tool2', '9lives', 'x'.repeat(40)])
      expect(checkCustomAddonName(ok), ok).toBeUndefined();
    for (const bad of ['', 'My', 'my_tool', '-x', 'a/b', '..', 'x'.repeat(41)])
      expect(checkCustomAddonName(bad), bad).toBeDefined();
    for (const listed of ['node', 'python', 'c', 'postgres'])
      expect(checkCustomAddonName(listed)).toContain('listed toolchain');
  });

  it('keeps add-on folders apart from every listed pack folder', () => {
    const add = customAddonDir('/data', 'my-tool');
    expect(add).toContain('custom');
    expect(add.startsWith(toolchainDir('/data', 'node', '24'))).toBe(false);
    expect(toolchainDir('/data', 'node', '24').startsWith(add)).toBe(false);
  });

  it('accepts folders inside the add-on and rejects ones that leave it', () => {
    expect(checkCustomAddonPathEntries(['bin', 'tools/bin', '.', 'a_b-c.d'])).toBeUndefined();
    for (const bad of ['..', '../x', 'a/../b', '/abs', 'a b', '', '-x'])
      expect(checkCustomAddonPathEntries([bad]), bad).toBeDefined();
    expect(checkCustomAddonPathEntries(['a', 'b', 'c', 'd', 'e', 'f'])).toContain('At most');
  });
});
