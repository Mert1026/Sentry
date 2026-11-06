import { describe, expect, it } from 'vitest';
import { withToolchains } from '../src/index.js';

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
