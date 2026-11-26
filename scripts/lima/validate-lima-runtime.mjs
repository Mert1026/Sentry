// Lima validation: drives the real runtime inside a Lima VM through the macOS Lima host platform.
// usage: node scripts/lima/validate-lima-runtime.mjs <lima-instance> <guest runtime entry (host.js)> <guest data root> <fixture project>
// No credentials, no model calls: runs must fail closed, everything else is exercised for real.
import { createMacosLimaPlatform } from '../../apps/desktop/dist/main/platform/macos-lima-platform.js';
const [instance, runtimeEntry, dataRoot, fixture] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(
    (ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + String(detail).slice(0, 200) : ''),
  );
};
const platform = createMacosLimaPlatform({
  instance,
  runtimeEntry,
  dataRoot,
  ...(process.env['SENTRY_LIMA_HOME'] === undefined
    ? {}
    : { limaHome: process.env['SENTRY_LIMA_HOME'] }),
  ...(process.env['SENTRY_LIMACTL_PATH'] === undefined
    ? {}
    : { limactlExecutable: process.env['SENTRY_LIMACTL_PATH'] }),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot() {
  const client = await platform.createRuntimeClient();
  const t0 = Date.now();
  await client.start();
  return { client, ms: Date.now() - t0 };
}
let { client, ms } = await boot();
check('Lima VM start of the runtime + Runtime Protocol handshake', true, `${ms} ms`);
const env = await client.request('runtime.environment', {});
check(
  'runtime environment reports linux guest',
  env && JSON.stringify(env).includes('linux'),
  JSON.stringify(env).slice(0, 120),
);
const prepared = await platform.prepareSourcePath(fixture);
const added = await client.request('projects.add', { sourcePath: prepared });
const pid = added.project.id;
check('project import over prepared source path', !!pid, pid);
const revs1 = await client.request('projects.revisions', { projectId: pid });
check(
  'revision identity recorded',
  (revs1.revisions ?? revs1).length >= 1,
  JSON.stringify(revs1).slice(0, 120),
);
await client
  .request('production.preRunGate', { mode: 'full', agentStackIds: ['stack_opencode_main'] })
  .catch((e) => ({ error: e }));
try {
  const started = await client.request('runs.start', {
    projectId: pid,
    mode: 'full',
    agentStackIds: ['stack_opencode_main'],
  });
  check('run without credentials fails closed', false, 'run started: ' + JSON.stringify(started));
} catch (e) {
  check(
    'run without credentials fails closed (no run, explicit error)',
    /PROVIDER_NOT_READY|NOT_CONFIGURED|not ready|not configured/i.test(
      String(e.message ?? e) + (e.code ?? ''),
    ),
    (e.code ?? '') + ' ' + e.message,
  );
}
const prepared2 = await platform.prepareSourcePath(fixture);
await client.request('projects.update', { projectId: pid, sourcePath: prepared2 });
const revs2 = await client.request('projects.revisions', { projectId: pid });
check(
  'project update creates a new revision (history kept)',
  (revs2.revisions ?? revs2).length > (revs1.revisions ?? revs1).length,
  `${(revs1.revisions ?? revs1).length} -> ${(revs2.revisions ?? revs2).length}`,
);
const ex = await client
  .request('projects.exportFindings', {
    projectId: pid,
    format: 'markdown',
    selection: { revisionIds: [(revs2.revisions ?? revs2)[0].id] },
  })
  .then(
    (r) => ({ ok: true, r }),
    (e) => ({ ok: false, e }),
  );
check(
  'findings export on a project without findings answers with a valid result',
  ex.ok && ex.r?.findingCount === 0,
  ex.ok ? 'ok' : ex.e?.code + ' ' + ex.e?.message,
);
await client.stop();
check('graceful runtime shutdown', true);
({ client, ms } = await boot());
const again = await client.request('projects.list', {});
check('restart keeps data (crash-free)', JSON.stringify(again).includes(pid), `${ms} ms`);
const child = client.child ?? client.process ?? client.proc;
if (child?.kill) {
  child.kill('SIGKILL');
  await sleep(1500);
}
({ client, ms } = await boot());
const afterCrash = await client.request('projects.list', {});
check(
  'crash recovery: runtime restarts and the project is still there',
  JSON.stringify(afterCrash).includes(pid),
  `${ms} ms (child kill ${child?.kill ? 'sent' : 'unavailable'})`,
);
await client.stop();
console.log(
  `SUMMARY pass=${results.filter((r) => r.ok).length} fail=${results.filter((r) => !r.ok).length}`,
);
process.exit(results.every((r) => r.ok) ? 0 : 1);
