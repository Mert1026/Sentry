import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('the setup wizard runs exactly the steps wizard.ps1 provides, in order', async () => {
  const iss = await read('../installer/sentry-setup.iss');
  const ps1 = await read('../wizard.ps1');
  const offered = /ValidateSet\(([^)]*)\)/
    .exec(ps1)[1]
    .match(/'([a-z]+)'/g)
    .map((s) => s.slice(1, -1));
  const run = [...iss.matchAll(/Names\[(\d)\] := '([a-z]+)'/g)].map((m) => m[2]);
  assert.deepEqual(run, offered);
  assert.match(iss, new RegExp(`StepCount = ${offered.length};`));
});

test('every wizard message exists in English and Bulgarian', async () => {
  const iss = await read('../installer/sentry-setup.iss');
  const names = (lang) =>
    [...iss.matchAll(new RegExp(`^${lang}\\.([A-Za-z]+)=`, 'gm'))].map((m) => m[1]).sort();
  assert.ok(names('en').length > 0);
  assert.deepEqual(names('bg'), names('en'));
  for (const used of iss.matchAll(/CustomMessage\('([A-Za-z]+)'\)/g))
    assert.ok(names('en').includes(used[1]), used[1]);
});

test('every status and problem code the step script sends has a translated text', async () => {
  const iss = await read('../installer/sentry-setup.iss');
  const ps1 = await read('../wizard.ps1');
  const sent = [
    ...ps1.matchAll(/(?:Write-WizardMessage|Write-WizardProblem|Stop-Wizard) '([A-Za-z]+)'/g),
  ].map((m) => m[1]);
  assert.ok(sent.length >= 20, 'expected the step script to send its codes');
  for (const code of new Set(sent))
    for (const lang of ['en', 'bg'])
      assert.match(iss, new RegExp(`^${lang}\\.W${code}=.+`, 'm'), `${lang}.W${code}`);
  // Nothing the person sees is written directly: only codes and indented technical output.
  assert.doesNotMatch(ps1, /Write-WizardOut \('(?!MSG |FAIL |RESULT |  ')/);
});

test('wizard exit codes match between the installer and the step script', async () => {
  const iss = await read('../installer/sentry-setup.iss');
  const ps1 = await read('../wizard.ps1');
  for (const [name, code] of [
    ['ExitReboot', 75],
    ['ExitCancelled', 10],
    ['ExitCannotRun', 11],
  ]) {
    assert.match(iss, new RegExp(`${name} = ${code};`));
    assert.match(ps1, new RegExp(`\\$code = ${code}\\b`));
  }
});
