import { defineConfig } from 'vitest/config';

// The release-prompt tests run the real adapter against scripted turns. On a busy CI runner each test can take
// several seconds (preparing a sandbox directory, probing the host), and the default 5 second limit then fails a
// test that is only slow, which also breaks the tests after it. Thirty seconds is far above any healthy run.
export default defineConfig({
  test: { environment: 'node', testTimeout: 30_000, hookTimeout: 30_000 },
});
