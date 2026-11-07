import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * OpenAI account sign-in (ChatGPT Plus/Pro) through a loopback bridge.
 *
 * The third-party `openai-oauth` package runs OUTSIDE every run sandbox, on
 * 127.0.0.1 only, backed by the person's own ChatGPT session. Sentry's
 * OpenCode proxy then uses it as the upstream for provider `openai`, so the
 * login token never enters an OpenCode run scope (the same isolation the API
 * keys get). The token file lives under Sentry's data root with owner-only
 * permissions; Sentry never reads or logs its contents.
 *
 * Never change the host from 127.0.0.1: exposing the bridge to a network
 * would let others spend the signed-in account's quota.
 */

export const OPENAI_OAUTH_VERSION = '2.0.0';
export const OPENAI_BRIDGE_HOST = '127.0.0.1';
export const OPENAI_BRIDGE_PORT = 10531;

export type OpenAiLoginState = 'idle' | 'waiting' | 'done' | 'failed';

export interface OpenAiAccountStatus {
  readonly installed: boolean;
  readonly signedIn: boolean;
  readonly bridgeRunning: boolean;
  readonly login: OpenAiLoginState;
  /** Sign-in URL while a login is waiting (the person opens it in a browser). */
  readonly loginUrl?: string;
  readonly error?: string;
  readonly version: string;
}

export interface OpenAiAccountOptions {
  readonly dataRoot: string;
  /** Test seam: a stand-in CLI script instead of the installed package. */
  readonly cliPath?: string;
  readonly port?: number;
  readonly urlTimeoutMs?: number;
  readonly bridgeTimeoutMs?: number;
}

const URL_LINE = /OpenAI OAuth login URL:\s*(https:\/\/\S+)/;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return (lines[lines.length - 1] ?? '').slice(0, 300);
}

export class OpenAiAccount {
  private readonly toolDir: string;
  private readonly cli: string;
  private readonly authFile: string;
  private readonly port: number;
  private readonly urlTimeoutMs: number;
  private readonly bridgeTimeoutMs: number;
  private readonly cliOverride: boolean;
  private loginChild: ChildProcess | undefined;
  private loginState: OpenAiLoginState = 'idle';
  private loginUrl: string | undefined;
  private loginError: string | undefined;
  private bridgeChild: ChildProcess | undefined;
  private bridgeStarting: Promise<string> | undefined;
  private installing: Promise<void> | undefined;

  constructor(options: OpenAiAccountOptions) {
    this.toolDir = join(options.dataRoot, 'tools', 'openai-oauth');
    this.cliOverride = options.cliPath !== undefined;
    this.cli =
      options.cliPath ?? join(this.toolDir, 'node_modules', 'openai-oauth', 'dist', 'cli.js');
    this.authFile = join(options.dataRoot, 'openai-account', 'auth.json');
    this.port = options.port ?? OPENAI_BRIDGE_PORT;
    this.urlTimeoutMs = options.urlTimeoutMs ?? 30_000;
    this.bridgeTimeoutMs = options.bridgeTimeoutMs ?? 25_000;
  }

  /** Base URL the OpenCode proxy uses as the OpenAI upstream. */
  get baseUrl(): string {
    return 'http://' + OPENAI_BRIDGE_HOST + ':' + String(this.port) + '/v1';
  }

  async status(): Promise<OpenAiAccountStatus> {
    return {
      installed: await exists(this.cli),
      signedIn: await exists(this.authFile),
      bridgeRunning: this.bridgeChild !== undefined && this.bridgeChild.exitCode === null,
      login: this.loginState,
      ...(this.loginUrl === undefined ? {} : { loginUrl: this.loginUrl }),
      ...(this.loginError === undefined ? {} : { error: this.loginError }),
      version: OPENAI_OAUTH_VERSION,
    };
  }

  async signedIn(): Promise<boolean> {
    return exists(this.authFile);
  }

  /** Install the pinned package into the Sentry-managed tools folder. */
  install(): Promise<void> {
    if (this.cliOverride) return Promise.resolve();
    this.installing ??= this.runInstall().finally(() => {
      this.installing = undefined;
    });
    return this.installing;
  }

  private async runInstall(): Promise<void> {
    if (await exists(this.cli)) return;
    await mkdir(this.toolDir, { recursive: true });
    const run = (args: string[]): Promise<void> =>
      new Promise((resolve, reject) => {
        const child = spawn('npm', args, { cwd: this.toolDir, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
        child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
        child.on('error', (cause) => reject(cause));
        child.on('close', (code) =>
          code === 0
            ? resolve()
            : reject(new Error('npm ' + args[0] + ' failed: ' + lastLine(output))),
        );
      });
    if (!(await exists(join(this.toolDir, 'package.json')))) await run(['init', '-y']);
    await run(['install', '--no-audit', '--no-fund', 'openai-oauth@' + OPENAI_OAUTH_VERSION]);
    if (!(await exists(this.cli))) throw new Error('openai-oauth installed but its CLI is missing');
  }

  /** Start the sign-in; resolves with the URL the person opens in a browser. */
  async startLogin(): Promise<{ url: string }> {
    this.cancelLogin();
    await this.install();
    await mkdir(dirname(this.authFile), { recursive: true, mode: 0o700 });
    this.loginState = 'waiting';
    this.loginUrl = undefined;
    this.loginError = undefined;
    const child = spawn(
      process.execPath,
      [this.cli, 'login', '--no-open', '--oauth-file', this.authFile],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.loginChild = child;
    let output = '';
    return new Promise<{ url: string }>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.failLogin(child, 'Timed out waiting for the sign-in link.');
        reject(new Error('Timed out waiting for the sign-in link.'));
      }, this.urlTimeoutMs);
      const onData = (chunk: Buffer): void => {
        output += chunk.toString();
        const match = URL_LINE.exec(output);
        if (match?.[1] !== undefined && !settled) {
          settled = true;
          clearTimeout(timer);
          this.loginUrl = match[1];
          resolve({ url: match[1] });
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (cause) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(cause);
        }
        this.failLogin(child, cause.message);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (this.loginChild !== child) return; // cancelled or replaced
        this.loginChild = undefined;
        void (async () => {
          if (code === 0 && (await exists(this.authFile))) {
            try {
              await chmod(this.authFile, 0o600);
            } catch {
              /* best effort */
            }
            this.loginState = 'done';
            this.loginUrl = undefined;
            this.loginError = undefined;
          } else {
            this.loginState = 'failed';
            this.loginUrl = undefined;
            this.loginError = lastLine(output) || 'Sign-in did not complete.';
          }
          if (!settled) {
            settled = true;
            reject(new Error(this.loginError ?? 'Sign-in did not complete.'));
          }
        })();
      });
    });
  }

  private failLogin(child: ChildProcess, message: string): void {
    if (this.loginChild === child) this.loginChild = undefined;
    child.kill('SIGTERM');
    this.loginState = 'failed';
    this.loginUrl = undefined;
    this.loginError = message;
  }

  cancelLogin(): void {
    const child = this.loginChild;
    this.loginChild = undefined;
    if (child !== undefined) child.kill('SIGTERM');
    if (this.loginState === 'waiting') {
      this.loginState = 'idle';
      this.loginUrl = undefined;
    }
  }

  /** Start (or reuse) the loopback bridge; resolves with its base URL. */
  ensureBridge(): Promise<string> {
    if (this.bridgeChild !== undefined && this.bridgeChild.exitCode === null) {
      return Promise.resolve(this.baseUrl);
    }
    this.bridgeStarting ??= this.startBridge().finally(() => {
      this.bridgeStarting = undefined;
    });
    return this.bridgeStarting;
  }

  private async startBridge(): Promise<string> {
    if (!(await this.signedIn())) {
      throw new Error('Not signed in to OpenAI. Use "Sign in with ChatGPT" in Providers first.');
    }
    await this.install();
    const child = spawn(
      process.execPath,
      [
        this.cli,
        '--host',
        OPENAI_BRIDGE_HOST,
        '--port',
        String(this.port),
        '--oauth-file',
        this.authFile,
        '--no-open',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.bridgeChild = child;
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const died = new Promise<never>((_, reject) => {
      child.on('error', (cause) => reject(cause));
      child.on('close', () =>
        reject(new Error('OpenAI bridge stopped: ' + (lastLine(output) || 'no output'))),
      );
    });
    died.catch(() => undefined);
    const deadline = Date.now() + this.bridgeTimeoutMs;
    for (;;) {
      if (child.exitCode !== null) {
        this.bridgeChild = undefined;
        throw new Error('OpenAI bridge stopped: ' + (lastLine(output) || 'no output'));
      }
      try {
        const response = await fetch(this.baseUrl + '/models', {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) return this.baseUrl;
      } catch {
        /* not ready yet */
      }
      if (Date.now() > deadline) {
        child.kill('SIGTERM');
        this.bridgeChild = undefined;
        throw new Error('OpenAI bridge did not become ready: ' + (lastLine(output) || 'no output'));
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  stopBridge(): void {
    const child = this.bridgeChild;
    this.bridgeChild = undefined;
    if (child !== undefined && child.exitCode === null) child.kill('SIGTERM');
  }

  /** Stop the bridge and delete the stored sign-in. */
  async logout(): Promise<void> {
    this.cancelLogin();
    this.stopBridge();
    await rm(this.authFile, { force: true });
    this.loginState = 'idle';
    this.loginUrl = undefined;
    this.loginError = undefined;
  }

  dispose(): void {
    this.cancelLogin();
    this.stopBridge();
  }
}
