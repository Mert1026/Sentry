import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenAiAccount } from '../src/openai-account.js';

/**
 * A stand-in for the openai-oauth CLI so the tests never touch the network or a real account:
 * `login` prints a sign-in link then writes the auth file; the default command serves /v1/models.
 */
const FAKE_CLI = `
const fs = require('node:fs');
const http = require('node:http');
const args = process.argv.slice(2);
const file = args[args.indexOf('--oauth-file') + 1];
if (args[0] === 'login') {
  if (process.env.FAKE_LOGIN === 'fail') {
    console.error('login refused by test');
    process.exit(1);
  }
  console.log('OpenAI OAuth login URL: https://auth.example.test/authorize?state=abc&x=1');
  setTimeout(() => {
    fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"tokens":"fake"}');
    process.exit(0);
  }, Number(process.env.FAKE_LOGIN_MS || 200));
} else {
  const port = Number(args[args.indexOf('--port') + 1]);
  const host = args[args.indexOf('--host') + 1];
  if (host !== '127.0.0.1') { console.error('bad host ' + host); process.exit(2); }
  http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
  }).listen(port, host);
}
`;

let dir: string;
let account: OpenAiAccount | undefined;

async function makeAccount(port: number, urlTimeoutMs?: number): Promise<OpenAiAccount> {
  const cliPath = join(dir, 'fake-cli.cjs');
  await writeFile(cliPath, FAKE_CLI);
  account = new OpenAiAccount({
    dataRoot: dir,
    cliPath,
    port,
    ...(urlTimeoutMs === undefined ? {} : { urlTimeoutMs }),
    bridgeTimeoutMs: 8000,
  });
  return account;
}

async function waitFor(check: () => Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('condition not met in time');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sentry-openai-account-'));
});

afterEach(async () => {
  account?.dispose();
  account = undefined;
  delete process.env['FAKE_LOGIN'];
  delete process.env['FAKE_LOGIN_MS'];
  await rm(dir, { recursive: true, force: true });
});

describe('OpenAI account sign-in', () => {
  it('starts not signed in and refuses the bridge until a sign-in exists', async () => {
    const target = await makeAccount(18731);
    const status = await target.status();
    expect(status.signedIn).toBe(false);
    expect(status.login).toBe('idle');
    await expect(target.ensureBridge()).rejects.toThrow(/Not signed in/);
  });

  it('returns the sign-in link, then marks the account signed in when the login finishes', async () => {
    const target = await makeAccount(18732);
    const { url } = await target.startLogin();
    expect(url).toBe('https://auth.example.test/authorize?state=abc&x=1');
    expect((await target.status()).login).toBe('waiting');
    expect((await target.status()).loginUrl).toBe(url);
    await waitFor(async () => (await target.status()).login === 'done');
    const done = await target.status();
    expect(done.signedIn).toBe(true);
    expect(done.loginUrl).toBeUndefined();
    // The token file is private to the owner.
    const mode = (await stat(join(dir, 'openai-account', 'auth.json'))).mode & 0o777;
    if (process.platform !== 'win32') expect(mode).toBe(0o600);
  });

  it('reports a failed sign-in without marking the account signed in', async () => {
    process.env['FAKE_LOGIN'] = 'fail';
    const target = await makeAccount(18733);
    await expect(target.startLogin()).rejects.toThrow(/login refused by test/);
    const status = await target.status();
    expect(status.login).toBe('failed');
    expect(status.error).toContain('login refused by test');
    expect(status.signedIn).toBe(false);
  });

  it('can cancel a waiting sign-in', async () => {
    process.env['FAKE_LOGIN_MS'] = '60000';
    const target = await makeAccount(18734);
    await target.startLogin();
    target.cancelLogin();
    const status = await target.status();
    expect(status.login).toBe('idle');
    expect(status.signedIn).toBe(false);
  });

  it('runs the bridge on loopback after sign-in and reuses it', async () => {
    const target = await makeAccount(18735);
    await target.startLogin();
    await waitFor(async () => (await target.status()).signedIn);
    const base = await target.ensureBridge();
    expect(base).toBe('http://127.0.0.1:18735/v1');
    const models = (await (await fetch(base + '/models')).json()) as {
      data: Array<{ id: string }>;
    };
    expect(models.data[0]?.id).toBe('gpt-test');
    expect((await target.status()).bridgeRunning).toBe(true);
    expect(await target.ensureBridge()).toBe(base);
  });

  it('signing out stops the bridge and deletes the stored sign-in', async () => {
    const target = await makeAccount(18736);
    await target.startLogin();
    await waitFor(async () => (await target.status()).signedIn);
    await target.ensureBridge();
    await target.logout();
    const status = await target.status();
    expect(status.signedIn).toBe(false);
    expect(status.bridgeRunning).toBe(false);
    expect(status.login).toBe('idle');
    await expect(target.ensureBridge()).rejects.toThrow(/Not signed in/);
  });
});
