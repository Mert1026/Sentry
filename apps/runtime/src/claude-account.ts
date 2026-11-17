import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Claude account sign-in (Claude Pro/Max) through the official Claude Code app.
 *
 * The person signs in with `claude setup-token`, Anthropic's own command for a long-lived
 * (one-year) token: Sentry runs it inside the Linux runtime, shows the sign-in link, and passes the
 * code the person pastes back to it. The token it prints is kept in a private file under Sentry's
 * data root (owner-only) and handed to the Claude agent's Claude Code process as
 * CLAUDE_CODE_OAUTH_TOKEN. There is no third-party bridge, and the token never enters a run sandbox:
 * the agent's shell children have it scrubbed. Nothing here reads, logs or returns the token.
 */

export type ClaudeLoginState = 'idle' | 'waiting' | 'done' | 'failed';

export interface ClaudeAccountStatus {
  readonly signedIn: boolean;
  readonly login: ClaudeLoginState;
  /** Sign-in link while a login is waiting (the person opens it in a browser). */
  readonly loginUrl?: string;
  readonly error?: string;
}

export interface ClaudeAccountOptions {
  readonly dataRoot: string;
  /** The Claude Code executable to run (the same managed binary the agents use). */
  readonly executable: () => string;
  /** Test seam: arguments placed before `setup-token` (a stand-in script run by node). */
  readonly argsPrefix?: readonly string[];
  /**
   * Run the program in a pseudo-terminal (the default). Claude Code's sign-in only reads the pasted
   * code from a terminal; a test with a stand-in script turns this off.
   */
  readonly useTerminal?: boolean;
  /** Test seam: extra environment for the stand-in script. */
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly urlTimeoutMs?: number;
  readonly codeTimeoutMs?: number;
}

// Terminal control sequences: colours, cursor moves and OSC-8 hyperlinks (which repeat the link).
// Built from the escape and bell characters so the patterns hold no literal control characters.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const URL_PATTERN = new RegExp(
  `https://(?:claude\\.com|claude\\.ai|console\\.anthropic\\.com)/[^\\s${ESC}]+`,
);
const TOKEN_START = /sk-ant-oat\d{2}-[A-Za-z0-9_-]+/;
/**
 * Claude Code wraps a very long line onto the next one (a sign-in link wraps by one character), at
 * a width that does not follow the terminal. A line this long, followed by a line of nothing but
 * link or token characters, is one piece of text.
 */
const WRAP_WIDTH = 200;
const MIN_TOKEN_LENGTH = 60;
const HYPERLINK = new RegExp(`${ESC}\\]8;[^;]*;([^${BEL}${ESC}]+)(?:${BEL}|${ESC}\\\\)`);
const URL_CHARS = /^[A-Za-z0-9_%.~:/?#@!$&'()*+,;=-]+$/;

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/**
 * The program wrapped so it runs in a pseudo-terminal: util-linux `script` provides one, sized wide
 * so a long link or token is not wrapped. Its own output is not kept (/dev/null).
 */
export function terminalCommand(program: readonly string[]): {
  readonly command: string;
  readonly args: string[];
} {
  const line = `stty cols 1000 rows 50; exec ${program.map(shellQuote).join(' ')}`;
  return { command: 'script', args: ['-qec', line, '/dev/null'] };
}

/** Claude Code's refusal of a pasted code ("OAuth error: ..."), without its "Press Enter" prompt. */
export function findLoginError(raw: string): string | undefined {
  const found = /OAuth error:[^\n]*/.exec(cleanTerminalText(raw));
  if (found === null) return undefined;
  return found[0]
    .replace(/Press Enter.*$/, '')
    .trim()
    .slice(0, 200);
}

export function cleanTerminalText(raw: string): string {
  return raw.replace(OSC, '').replace(CSI, '').replace(/\r/g, '');
}

/**
 * The sign-in link in the program's output, once it has printed one. The terminal hyperlink that
 * Claude Code prints carries the whole link, so that is used first; the visible text is the
 * fallback, joined where it wrapped.
 */
export function findLoginUrl(raw: string): string | undefined {
  const linked = HYPERLINK.exec(raw)?.[1];
  if (linked !== undefined && URL_PATTERN.test(linked)) return linked;
  const lines = cleanTerminalText(raw).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const found = URL_PATTERN.exec(lines[index] ?? '');
    if (found === null) continue;
    let url = found[0];
    let line = (lines[index] ?? '').trimEnd();
    let next = index + 1;
    while (line.length >= WRAP_WIDTH && URL_CHARS.test((lines[next] ?? '').trim())) {
      url += (lines[next] ?? '').trim();
      line = (lines[next] ?? '').trimEnd();
      next += 1;
    }
    return url;
  }
  return undefined;
}

/**
 * The token in the program's output. A token longer than the terminal is wrapped onto the next
 * line, so a full line that is followed by a line of nothing but token characters is joined.
 */
export function findToken(raw: string): string | undefined {
  const lines = cleanTerminalText(raw).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const found = TOKEN_START.exec(lines[index] ?? '');
    if (found === null) continue;
    let token = found[0];
    let line = (lines[index] ?? '').trimEnd();
    let next = index + 1;
    while (
      line.length >= WRAP_WIDTH &&
      line.endsWith(token.slice(-Math.min(token.length, 10))) &&
      /^[A-Za-z0-9_-]+$/.test((lines[next] ?? '').trim())
    ) {
      token += (lines[next] ?? '').trim();
      line = (lines[next] ?? '').trimEnd();
      next += 1;
    }
    if (token.length >= MIN_TOKEN_LENGTH) return token;
  }
  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class ClaudeAccount {
  private readonly dir: string;
  private readonly tokenFile: string;
  private readonly urlTimeoutMs: number;
  private readonly codeTimeoutMs: number;
  private child: ChildProcess | undefined;
  private output = '';
  private state: ClaudeLoginState = 'idle';
  private url: string | undefined;
  private error: string | undefined;
  private configDir: string | undefined;
  private waiter: ((token: string | undefined) => void) | undefined;

  constructor(private readonly options: ClaudeAccountOptions) {
    this.dir = join(options.dataRoot, 'claude-account');
    this.tokenFile = join(this.dir, 'oauth-token');
    this.urlTimeoutMs = options.urlTimeoutMs ?? 30_000;
    this.codeTimeoutMs = options.codeTimeoutMs ?? 60_000;
  }

  async signedIn(): Promise<boolean> {
    return exists(this.tokenFile);
  }

  /** The stored token for the Claude agent's process, or undefined. Never leaves the runtime. */
  async token(): Promise<string | undefined> {
    try {
      const text = (await readFile(this.tokenFile, 'utf8')).trim();
      return text.length > 0 ? text : undefined;
    } catch {
      return undefined;
    }
  }

  async status(): Promise<ClaudeAccountStatus> {
    return {
      signedIn: await this.signedIn(),
      login: this.state,
      ...(this.url === undefined ? {} : { loginUrl: this.url }),
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  /** Start `claude setup-token` and resolve with the link the person opens in a browser. */
  async startLogin(): Promise<{ url: string }> {
    this.cancelLogin();
    await mkdir(this.dir, { recursive: true });
    this.configDir = await mkdtemp(join(this.dir, 'login-'));
    this.output = '';
    this.state = 'waiting';
    this.url = undefined;
    this.error = undefined;
    // Only what the program needs: no provider credentials from the runtime's environment, and a
    // throwaway config folder so nothing is read from or written to anyone's real Claude config.
    const launch = this.options.useTerminal === false ? undefined : terminalCommand;
    const program = [this.options.executable(), ...(this.options.argsPrefix ?? []), 'setup-token'];
    const command =
      launch === undefined
        ? { command: program[0] ?? '', args: program.slice(1) }
        : launch(program);
    const child = spawn(command.command, command.args, {
      env: {
        PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: this.configDir,
        CLAUDE_CONFIG_DIR: this.configDir,
        TERM: 'xterm-256color',
        BROWSER: 'none',
        ...(this.options.extraEnv ?? {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const take = (chunk: Buffer): void => {
      this.output += chunk.toString();
      if (this.output.length > 200_000) this.output = this.output.slice(-100_000);
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    // Stdin errors (the program exited first) must not crash the runtime.
    child.stdin?.on('error', () => undefined);
    child.on('error', (cause) =>
      this.fail(
        child,
        (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'The sign-in needs the `script` tool (util-linux) in the Linux runtime.'
          : cause.message,
      ),
    );
    child.on('close', () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.waiter?.(findToken(this.output));
    });
    const deadline = Date.now() + this.urlTimeoutMs;
    for (;;) {
      const url = findLoginUrl(this.output);
      if (url !== undefined) {
        this.url = url;
        return { url };
      }
      if (this.child !== child) {
        // The program ended before it showed a link (or the sign-in was cancelled meanwhile).
        if (this.state === 'waiting') {
          this.state = 'failed';
          this.error = (lastUsefulLine(this.output) ?? 'Sign-in could not start.').slice(0, 300);
        }
        throw new Error(this.error ?? 'Sign-in could not start.');
      }
      if (Date.now() > deadline) {
        this.fail(child, 'Claude Code did not show a sign-in link. Try again.');
        throw new Error(this.error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Give the code from the sign-in page to the waiting program; resolves once the token is saved. */
  async submitCode(code: string): Promise<void> {
    const child = this.child;
    const clean = code.trim();
    if (child === undefined || this.state !== 'waiting')
      throw new Error('No sign-in is waiting. Start the sign-in again.');
    if (clean.length === 0 || /\s/.test(clean)) throw new Error('Paste the code exactly as shown.');
    const result = new Promise<string | undefined>((resolve) => {
      this.waiter = resolve;
      // The token can arrive before the process exits.
      const poll = setInterval(() => {
        const token = findToken(this.output);
        if (token !== undefined) {
          clearInterval(poll);
          resolve(token);
        } else if (findLoginError(this.output) !== undefined || this.child !== child) {
          // Claude Code refused the code (it then waits for Enter to retry), or it ended.
          clearInterval(poll);
          resolve(undefined);
        }
      }, 300);
      setTimeout(() => {
        clearInterval(poll);
        resolve(undefined);
      }, this.codeTimeoutMs);
    });
    // Enter in a terminal is a carriage return.
    child.stdin?.write(clean + '\r');
    const token = await result;
    this.waiter = undefined;
    if (token === undefined) {
      const reason = findLoginError(this.output) ?? lastUsefulLine(this.output);
      this.fail(child, reason ?? 'The code was not accepted. Start the sign-in again.');
      throw new Error(this.error);
    }
    await writeFile(this.tokenFile, token + '\n', { mode: 0o600 });
    try {
      await chmod(this.tokenFile, 0o600);
    } catch {
      /* best effort */
    }
    this.state = 'done';
    this.url = undefined;
    this.error = undefined;
    this.finish(child);
  }

  cancelLogin(): void {
    const child = this.child;
    this.child = undefined;
    if (child !== undefined) child.kill('SIGTERM');
    if (this.state === 'waiting') {
      this.state = 'idle';
      this.url = undefined;
    }
    void this.cleanup();
  }

  /** Delete the stored sign-in. */
  async logout(): Promise<void> {
    this.cancelLogin();
    await rm(this.tokenFile, { force: true });
    this.state = 'idle';
    this.url = undefined;
    this.error = undefined;
  }

  dispose(): void {
    this.cancelLogin();
  }

  private fail(child: ChildProcess, message: string): void {
    if (this.child === child) this.child = undefined;
    child.kill('SIGTERM');
    this.state = 'failed';
    this.url = undefined;
    this.error = message.slice(0, 300);
    void this.cleanup();
  }

  private finish(child: ChildProcess): void {
    if (this.child === child) this.child = undefined;
    child.kill('SIGTERM');
    void this.cleanup();
  }

  private async cleanup(): Promise<void> {
    this.output = '';
    const dir = this.configDir;
    this.configDir = undefined;
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The last line of the program's output that says something, without any token in it. */
function lastUsefulLine(output: string): string | undefined {
  const lines = cleanTerminalText(output)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !TOKEN_START.test(line));
  const line = lines[lines.length - 1];
  return line === undefined ? undefined : line.slice(0, 200);
}
