#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_AGENT_STACKS } from '@qa/domain';
import { FakeHarnessAdapter, HARNESS_PROTOCOL_VERSION } from '@qa/harness-protocol';
import { SentryDatabase, resolveSentryDataRoot } from '@qa/persistence';
import { AgentStackDefinitionSchema, HarnessEventSchema, ProjectSchema } from '@qa/schemas';
import { commandHint, parseCommand } from './arguments.js';
import { executeCommand } from './application.js';
import { executeFrontendCommand, frontendErrorEnvelope } from './frontend-application.js';
import { errorEnvelope, errorExitCode } from './errors.js';
import {
  consoleIo,
  emitHumanError,
  emitHumanSuccess,
  emitMachine,
  successExitCode,
  type CliIo,
} from './output.js';

export const QA_VERSION = '2.0.2';

export function versionLine(): string {
  return 'qa ' + QA_VERSION;
}

export interface DoctorOptions {
  readonly probeRuntime?: boolean;
  readonly dataRoot?: string;
}

export function doctorLines(options: DoctorOptions = {}): string[] {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const domainReady =
    INITIAL_AGENT_STACKS.length > 0 &&
    INITIAL_AGENT_STACKS.every((stack) => AgentStackDefinitionSchema.safeParse(stack).success);
  const schemasReady = ProjectSchema.safeParse({
    schemaVersion: 1,
    id: 'proj_01K7777777777777777777A8W1',
    name: 'Doctor probe',
    sourcePath: 'C:/doctor-probe',
    createdAt: '2026-09-09T19:00:00.000Z',
    updatedAt: '2026-09-09T19:00:00.000Z',
  }).success;
  const protocolReady =
    HARNESS_PROTOCOL_VERSION === 1 &&
    typeof FakeHarnessAdapter === 'function' &&
    HarnessEventSchema.safeParse({
      schemaVersion: 1,
      eventId: 'evt_01K7777777777777777777A8WX',
      agentRunId: 'arun_01K7777777777777777777A8W4',
      timestamp: '2026-09-09T19:00:00.000Z',
      type: 'run.started',
    }).success;
  const dataRoot = options.dataRoot ?? resolveSentryDataRoot();
  let filesystemReady = true;
  let sqliteReady = true;
  if (options.probeRuntime === true) {
    try {
      mkdirSync(dataRoot, { recursive: true });
    } catch {
      filesystemReady = false;
    }
    try {
      const database = new SentryDatabase({ dataRoot });
      database.close();
    } catch {
      sqliteReady = false;
    }
  }
  const status = (ready: boolean) => (ready ? 'OK' : 'ERROR');
  return [
    'Sentry',
    '',
    'Node         ' + status(nodeMajor >= 22),
    'Data Root    ' + status(dataRoot.length > 0) + '  ' + dataRoot,
    'SQLite       ' + status(sqliteReady),
    'Filesystem   ' + status(filesystemReady),
    'Domain       ' + status(domainReady),
    'Schemas      ' + status(schemasReady),
    'Protocol     ' + status(protocolReady),
    '',
    'OpenCode, DeepSeek, GLM, ChatGPT, and Claude are the real agent stacks; use qa agent doctor opencode|deepseek|glm|chatgpt|claude for runtime checks.',
  ];
}

function helpText(): string {
  return [
    'Usage: qa <command>',
    '',
    '  qa --version',
    '  qa doctor',
    '  qa capabilities [--json]',
    '  qa agent list [--json]',
    '  qa agent doctor opencode|deepseek|glm|chatgpt|claude [--json]',
    '  qa project add <path> [--json]',
    '  qa project list [--json]',
    '  qa project show <project-id> [--json]',
    '  qa project update <project-id> [path] [--json]',
    '  qa project delete <project-id> --yes [--json]',
    '  qa project revisions <project-id> [--json]',
    '  qa project findings <project-id> [--json]   findings per revision; re-test results with PASSED / NOT PASSED / COULD NOT COMPLETE',
    '  qa project export-findings <project-id> --format markdown|json|text (--findings <run-id>:<finding-id>,... | --run <run-id> | --revision <rev-id>,...) --out <path> [--json]   saves a report as one .md, .json or .txt file',
    '  qa project profile <project-id> [--json]',
    '  qa project profile-build <project-id> [--agents opencode,deepseek,glm,chatgpt,claude] [--json]   uses provider budget',
    '  qa toolchain status [--json]',
    '  qa toolchain install|remove <pack-id> <version> [--json]',
    '  qa project suggest-targets <project-id> [--json]',
    '  qa project toolchain-needs|toolchain-selection <project-id> [--json]',
    '  qa project toolchain-assess <project-id> [--agents opencode,deepseek,glm,chatgpt,claude] [--json]   uses provider budget',
    '  qa toolchain custom status [--json]',
    '  qa toolchain custom remove <name> --yes [--json]',
    '  qa settings show [--json]',
    '  qa settings effort <opencode|deepseek|glm|chatgpt|claude> <level|default> [--json]',
    '  qa settings run-limit <default|3h|6h|none|90m|12h> [--json]',
    '  qa settings note-limit <default|5k|20k|none|12000> [--json]',
    '  qa models list [--agent opencode|deepseek|glm|chatgpt|claude] [--json]',
    '  qa models update [--json]',
    '  qa provider status [--json]',
    '  qa provider set <NAME> (--value <text> | --stdin | --env <VARIABLE>) [--json]   keys: --stdin or --env only',
    '  qa provider clear <NAME> [--json]',
    '  qa provider forget-all | forget-file | persist | detect-binaries [--json]',
    '  qa account status|login|logout|cancel <openai|claude> [--json]',
    '  qa account code claude <code> [--json]',
    '  qa runtime status | distros | select <distro> | reclaim-space [--json]',
    '  qa system info | runs | environment | broker [--json]',
    '  qa app language <en|bg> [--json]',
    '  qa toolchain custom install <name> --command "<command>" [--path-entries a,b] [--json]',
    '  qa run simulate <project-id> [--scenario success|partial|all-fail|transport-loss|timeout|protocol-error] [--json]',
    '  qa run start <project-id> --mode full --agents opencode,deepseek,glm [--wait] [--instructions <text>] [--agent-note <agent>=<text>] [--timeout-ms <ms>] [--web] [--json]',
    '  qa run start <project-id> --mode targeted --paths src/auth,src/middleware [--wait] [--instructions <text>] [--json]',
    '  qa run start <project-id> --retest <run-id>:<finding-id>,... [--retest-with reporter|all] [--agents ...] [--wait] [--json]   re-test earlier findings on the current revision',
    '  qa run start ... [--depth fast|full] [--profile] [--tools] [--revision <rev-id>]   --profile hands agents their project notes; --tools allows toolchain downloads',
    '  qa run list <project-id> [--json]',
    '  qa run show <run-id> [--json]',
    '  qa run status <run-id> [--json]',
    '  qa run cancel <run-id> [--json]',
    '  qa doctor storage [--json]',
    '  qa doctor cleanup [--apply] [--json]',
    '  qa doctor config [--json]',
    '  qa project doctor <project-id> [--json]',
    '  qa run result <run-id> [--json]',
    '  qa run export <run-id> --format log|json [--out <path>] [--json]',
    '',
    'run simulate is FAKE / DEVELOPMENT ONLY. run start executes the selected real agent stacks.',
    'Production commands run against the Desktop broker (sentry open must be running).',
    '--timeout-ms (1000-604800000) overrides the run time window; omitted uses the default set in Settings (3 hours if none).',
    '--depth fast plans fewer checks (up to 2) and skips the deepening round and hazard sweep; full, the default, plans up to 8 and makes the extra passes.',
    '--no-secrets turns off the per-agent "Secrets in code" check for this run (no search, no secrets light); it adds about a minute or two per agent.',
    '--web lets agents fetch and search the web for this run; package installs are always allowed, web access is off by default.',
    'Identify automation with SENTRY_CLI_CLIENT_NAME / SENTRY_CLI_CLIENT_VERSION (shown in Desktop, never a secret).',
    'SENTRY_CLI_TRANSPORT=direct is development-only: it does not represent Desktop state, may use',
    'Windows-local data, is not supported for automation client, and must not be used as production automation.',
  ].join('\n');
}

export function runCli(argv: readonly string[], io: CliIo = consoleIo): number | Promise<number> {
  const originalArgs = argv.slice(2);
  const machine = originalArgs.includes('--json');
  const args = originalArgs.filter((value) => value !== '--json');
  if (!machine && (args.length === 0 || args.includes('--help') || args.includes('-h'))) {
    io.stdout(helpText());
    return 0;
  }
  if (!machine && (args.includes('--version') || args.includes('-V'))) {
    io.stdout(versionLine());
    return 0;
  }
  if (!machine && args[0] === 'doctor' && args.length === 1) {
    io.stdout(doctorLines({ probeRuntime: true }).join('\n'));
    return 0;
  }

  const hint = commandHint(args);
  let parsed;
  try {
    parsed = parseCommand(args);
  } catch (cause) {
    const response = errorEnvelope(hint, cause);
    if (machine) emitMachine(response, io);
    else emitHumanError(response, io);
    return errorExitCode(response.error);
  }

  // Production path: the CLI is a frontend of the running Desktop broker.
  // SENTRY_CLI_TRANSPORT=direct keeps the historical direct execution for
  // deterministic development/test use only; it is never the production path.
  const direct = (process.env['SENTRY_CLI_TRANSPORT'] ?? '').toLowerCase() === 'direct';
  const pending = direct
    ? executeCommand(parsed, { onDiagnostic: io.stderr })
    : executeFrontendCommand(parsed, { onDiagnostic: io.stderr });
  return pending
    .then((response) => {
      if (machine) emitMachine(response, io);
      else emitHumanSuccess(response, io);
      return successExitCode(response);
    })
    .catch((cause: unknown) => {
      const response = direct
        ? errorEnvelope(parsed.command, cause)
        : frontendErrorEnvelope(parsed.command, cause);
      if (machine) emitMachine(response, io);
      else emitHumanError(response, io);
      return errorExitCode(response.error);
    });
}

export function isMainModule(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (argvEntry === undefined) return false;
  const modulePath = resolve(fileURLToPath(moduleUrl));
  const entryPath = resolve(argvEntry);
  return process.platform === 'win32'
    ? modulePath.toLowerCase() === entryPath.toLowerCase()
    : modulePath === entryPath;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const result = runCli(process.argv);
  if (result instanceof Promise) {
    result
      .then((code) => {
        process.exitCode = code;
      })
      .catch(() => {
        process.exitCode = 1;
      });
  } else {
    process.exitCode = result;
  }
}
