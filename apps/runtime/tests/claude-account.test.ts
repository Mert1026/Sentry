import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClaudeAccount,
  cleanTerminalText,
  findLoginUrl,
  findToken,
} from '../src/claude-account.js';

const TOKEN = 'sk-ant-oat01-' + 'AbCdEfGhIj0123456789_-'.repeat(4) + 'Zz';

/**
 * A stand-in for `claude setup-token`, written the way the real one behaves with no terminal: a
 * banner, the sign-in link twice (a terminal hyperlink repeats it), a prompt for the pasted code,
 * then, for the right code, the token wrapped at 80 columns.
 */
const FAKE_CLAUDE = `
const ESC = String.fromCharCode(27);
const url = 'https://claude.com/cai/oauth/authorize?code=true&client_id=test&state=abc_DEF-1';
if (process.env.FAKE_NO_URL === '1') { setTimeout(() => process.exit(0), 100); return; }
console.log('Welcome to Claude Code v2.1.270');
console.log(ESC + ']8;id=1;' + url + ESC + '\\\\' + url + ESC + ']8;;' + ESC + '\\\\');
process.stdout.write('Paste code here if prompted > ');
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk.toString();
  if (!input.includes('\\n')) return;
  const code = input.split('\\n')[0].trim();
  if (code !== 'good-code#state') {
    console.log('');
    console.log('Invalid authorization code');
    process.exit(1);
  }
  const token = process.env.FAKE_TOKEN;
  console.log('');
  console.log('Your OAuth token (valid for 1 year):');
  for (let i = 0; i < token.length; i += 80) console.log(token.slice(i, i + 80));
  console.log('Store this token securely.');
  setTimeout(() => process.exit(0), 50);
});
`;

let dir: string;
let account: ClaudeAccount | undefined;

async function makeAccount(env: Record<string, string> = {}): Promise<ClaudeAccount> {
  const script = join(dir, 'fake-claude.cjs');
  await writeFile(script, FAKE_CLAUDE.replace('return;', 'process.exit(0);'));
  account = new ClaudeAccount({
    extraEnv: { FAKE_TOKEN: TOKEN, ...env },
    dataRoot: dir,
    executable: () => process.execPath,
    argsPrefix: [script],
    urlTimeoutMs: 4000,
    codeTimeoutMs: 6000,
  });
  return account;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'claude-account-'));
});
afterEach(async () => {
  account?.dispose();
  account = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('reading the program output', () => {
  it('finds the link once, even when the terminal repeats it as a hyperlink', () => {
    const esc = String.fromCharCode(27);
    const url = 'https://claude.com/cai/oauth/authorize?code=true&state=abc';
    const raw = `${esc}]8;id=1;${url}${esc}\\${url}${esc}]8;;${esc}\\`;
    expect(findLoginUrl(raw)).toBe(url);
    expect(cleanTerminalText(raw)).toBe(url);
  });

  it('joins a token that was wrapped onto several lines', () => {
    const wrapped = [TOKEN.slice(0, 80), TOKEN.slice(80)].join('\n');
    expect(findToken('Your token:\n' + wrapped + '\nStore it safely.')).toBe(TOKEN);
  });

  it('does not take the next sentence for part of a short token', () => {
    const short = 'sk-ant-oat01-' + 'x'.repeat(70);
    expect(findToken(short + '\nStore this token securely.')).toBe(short);
  });

  it('finds no token in a refusal', () => {
    expect(findToken('Invalid authorization code')).toBeUndefined();
  });
});

describe('Claude account sign-in', () => {
  it('shows the link, takes the code, and keeps the token in a private file', async () => {
    const a = await makeAccount();
    expect(await a.signedIn()).toBe(false);
    const { url } = await a.startLogin();
    expect(url).toContain('https://claude.com/cai/oauth/authorize');
    expect((await a.status()).login).toBe('waiting');
    expect((await a.status()).loginUrl).toBe(url);

    await a.submitCode('good-code#state');
    expect(await a.signedIn()).toBe(true);
    expect(await a.token()).toBe(TOKEN);
    const status = await a.status();
    expect(status.login).toBe('done');
    // The token itself never appears in what the app is shown.
    expect(JSON.stringify(status)).not.toContain('sk-ant-oat');
    if (process.platform !== 'win32') {
      const mode = (await stat(join(dir, 'claude-account', 'oauth-token'))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    expect((await readFile(join(dir, 'claude-account', 'oauth-token'), 'utf8')).trim()).toBe(TOKEN);
  });

  it('keeps nothing and says why when the code is wrong', async () => {
    const a = await makeAccount();
    await a.startLogin();
    await expect(a.submitCode('wrong#code')).rejects.toThrow(/Invalid authorization code/);
    expect(await a.signedIn()).toBe(false);
    const status = await a.status();
    expect(status.login).toBe('failed');
    expect(status.error).toContain('Invalid authorization code');
  });

  it('refuses a code when no sign-in is waiting, and a code with spaces', async () => {
    const a = await makeAccount();
    await expect(a.submitCode('good-code#state')).rejects.toThrow(/No sign-in is waiting/);
    await a.startLogin();
    await expect(a.submitCode('two words')).rejects.toThrow(/exactly as shown/);
  });

  it('fails clearly when the program never shows a link', async () => {
    const a = await makeAccount({ FAKE_NO_URL: '1' });
    await expect(a.startLogin()).rejects.toThrow();
    expect((await a.status()).login).toBe('failed');
  });

  it('can be cancelled, and signing out removes the token', async () => {
    const a = await makeAccount();
    await a.startLogin();
    a.cancelLogin();
    expect((await a.status()).login).toBe('idle');

    await a.startLogin();
    await a.submitCode('good-code#state');
    expect(await a.signedIn()).toBe(true);
    await a.logout();
    expect(await a.signedIn()).toBe(false);
    expect(await a.token()).toBeUndefined();
  });
});
