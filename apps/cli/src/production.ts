import { commandHint, parseCommand } from './arguments.js';
import { executeFrontendCommand, frontendErrorEnvelope } from './frontend-application.js';
import { errorExitCode } from './exit-codes.js';
import {
  consoleIo,
  emitHumanError,
  emitHumanSuccess,
  emitMachine,
  successExitCode,
  type CliIo,
} from './output.js';

export function productionHelp(): string {
  return [
    'Usage: sentry cli <command> [--json]',
    'Desktop must be running: sentry open',
    '',
    '  capabilities [--json]',
    '  project list [--json]',
    '  project add "<path>" [--json]',
    '  project show <project-id> [--json]',
    '  project update <project-id> [path] [--json]',
    '  project delete <project-id> --yes [--json]',
    '  project revisions <project-id> [--json]',
    '  project findings <project-id> [--json]',
    '  project profile <project-id> [--json]',
    '  project profile-build <project-id> [--agents opencode,deepseek,glm,chatgpt] [--json]',
    '  project doctor <project-id> [--json]',
    '  agent list [--json]',
    '  agent doctor opencode|deepseek|glm|chatgpt [--json]',
    '  run start <project-id> --mode full|targeted [--agents opencode,deepseek,glm,chatgpt] [--paths a,b] [--wait] [--timeout-ms <ms>] [--web] [--tools] [--profile] [--revision <rev-id>] [--json]',
    '  run start <project-id> --retest <run-id>:<finding-id>,... [--retest-with reporter|all] [--agents ...] [--wait] [--json]',
    '  run list <project-id> [--json]',
    '  run show <run-id> [--json]',
    '  run status <run-id> [--json]',
    '  run cancel <run-id> [--json]',
    '  run result <run-id> [--json]',
    '  run export <run-id> --format log|json --out <path> [--json]',
    '  toolchain status [--json]',
    '  toolchain install|remove <pack-id> <version> [--json]',
    '',
    'Automation: use --json; stdout is one JSON document and stderr carries diagnostics.',
    'Run start executes real agents and may incur provider charges.',
    'Examples: see CLI.md. Install or upgrade: see INSTALL.md.',
  ].join('\n');
}

// Packaged automation is always a frontend of Desktop. No direct transport,
// local database, provider tooling or harness implementation is imported here.
export async function runProductionCli(
  argv: readonly string[],
  version: string,
  io: CliIo = consoleIo,
): Promise<number> {
  const original = argv.slice(2);
  const machine = original.includes('--json');
  const args = original.filter((a) => a !== '--json');
  if (!machine && (args.length === 0 || args.includes('--help') || args.includes('-h'))) {
    io.stdout(productionHelp());
    return 0;
  }
  if (!machine && (args.includes('--version') || args.includes('-V'))) {
    io.stdout('Sentry CLI ' + version);
    return 0;
  }
  let command: ReturnType<typeof commandHint> = commandHint(args);
  try {
    const parsed = parseCommand(args);
    command = parsed.command;
    const response = await executeFrontendCommand(parsed, { onDiagnostic: io.stderr });
    if (machine) emitMachine(response, io);
    else emitHumanSuccess(response, io);
    return successExitCode(response);
  } catch (cause) {
    const response = frontendErrorEnvelope(command, cause);
    if (machine) emitMachine(response, io);
    else emitHumanError(response, io);
    return errorExitCode(response.error);
  }
}
