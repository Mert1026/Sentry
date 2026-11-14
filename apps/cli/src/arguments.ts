import type { CliCommand } from '@qa/schemas';
import type { SimulationScenario } from '@qa/run-engine';
import {
  AGENT_EFFORT_LEVELS,
  RUN_TIME_LIMIT_CUSTOM_MIN_MS,
  RUN_TIME_LIMIT_DEFAULT_MS,
  RUN_TIME_LIMIT_UNLIMITED_MS,
  RUN_TIMEOUT_MS_MAX,
  RUN_TIMEOUT_MS_MIN,
} from '@qa/shared';

export class CliUsageError extends Error {
  readonly code = 'INVALID_ARGUMENT';

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'CliUsageError';
  }
}

interface BaseCommand<C extends CliCommand> {
  readonly command: C;
}

export type AgentName = 'opencode' | 'deepseek' | 'glm' | 'chatgpt';

export const AGENT_NAMES: readonly AgentName[] = ['opencode', 'deepseek', 'glm', 'chatgpt'];
/** Chosen when --agents is omitted. ChatGPT is opt-in: it needs an API key or a signed-in account. */
export const DEFAULT_AGENT_NAMES: readonly AgentName[] = ['opencode', 'deepseek', 'glm'];

function isAgentName(value: string): value is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(value);
}

export type ParsedCliCommand =
  | BaseCommand<'capabilities'>
  | BaseCommand<'agent.list'>
  | (BaseCommand<'agent.doctor'> & { readonly agent: AgentName })
  | (BaseCommand<'project.add'> & { readonly sourcePath: string })
  | BaseCommand<'project.list'>
  | (BaseCommand<'project.show'> & { readonly projectId: string })
  | (BaseCommand<'project.update'> & {
      readonly projectId: string;
      readonly sourcePath?: string;
    })
  | (BaseCommand<'project.delete'> & { readonly projectId: string })
  | (BaseCommand<'run.simulate'> & {
      readonly projectId: string;
      readonly scenario: SimulationScenario;
      readonly instructions?: string;
      readonly agents?: string;
    })
  | (BaseCommand<'run.start'> & {
      readonly projectId: string;
      readonly mode: 'full' | 'targeted';
      readonly agents: readonly AgentName[];
      readonly wait: boolean;
      readonly instructions?: string;
      readonly runTimeoutMs?: number;
      readonly webAccess?: boolean;
      readonly paths?: string;
      readonly toolDownloads?: boolean;
      /** How deep the run investigates; omitted means full. */
      readonly depth?: 'fast' | 'full';
      readonly useProfile?: boolean;
      readonly revisionId?: string;
      /** Write one regression test per finding, in this framework, on the current revision. */
      readonly testWriting?: {
        readonly framework: string;
        readonly style?: 'new-files' | 'patch';
        readonly findings: ReadonlyArray<{ readonly runId: string; readonly findingId: string }>;
      };
      /** Re-test findings from earlier runs on the current revision. */
      readonly retest?: {
        readonly findings: ReadonlyArray<{ readonly runId: string; readonly findingId: string }>;
        readonly who: 'reporter' | 'all';
      };
    })
  | (BaseCommand<'run.list'> & { readonly projectId: string })
  | (BaseCommand<'run.show'> & { readonly runId: string })
  | (BaseCommand<'run.status'> & { readonly runId: string })
  | (BaseCommand<'run.export'> & {
      readonly runId: string;
      readonly format: 'log' | 'json';
      readonly out?: string;
    })
  | (BaseCommand<'run.export-tests'> & { readonly runId: string; readonly out: string })
  | (BaseCommand<'ci.export'> & {
      readonly target: 'github-actions' | 'gitlab-ci' | 'azure-pipelines';
      readonly framework: 'vitest' | 'jest' | 'pytest' | 'xunit' | 'junit' | 'go-test';
      readonly out: string;
    })
  | (BaseCommand<'run.result'> & { readonly runId: string })
  | (BaseCommand<'run.cancel'> & { readonly runId: string })
  | (BaseCommand<'project.revisions'> & { readonly projectId: string })
  | (BaseCommand<'project.findings'> & { readonly projectId: string })
  | (BaseCommand<'project.export-findings'> & {
      readonly projectId: string;
      readonly format: 'markdown' | 'github-issues' | 'sarif';
      readonly selection:
        | {
            readonly findings: ReadonlyArray<{
              readonly runId: string;
              readonly findingId: string;
            }>;
          }
        | { readonly runId: string }
        | { readonly revisionIds: readonly string[] };
      readonly out: string;
    })
  | (BaseCommand<'project.profile'> & { readonly projectId: string })
  | (BaseCommand<'project.profile-build'> & {
      readonly projectId: string;
      readonly agents?: readonly AgentName[];
    })
  | BaseCommand<'settings.show'>
  | (BaseCommand<'settings.set-effort'> & { readonly agent: AgentName; readonly value: string })
  | (BaseCommand<'settings.set-run-limit'> & { readonly value: string })
  | BaseCommand<'toolchain.status'>
  | (BaseCommand<'toolchain.install'> & { readonly packId: string; readonly version: string })
  | (BaseCommand<'toolchain.remove'> & { readonly packId: string; readonly version: string })
  | BaseCommand<'doctor.storage'>
  | (BaseCommand<'doctor.cleanup'> & { readonly apply: boolean })
  | BaseCommand<'doctor.config'>
  | (BaseCommand<'project.doctor'> & { readonly projectId: string });

const SIMULATION_SCENARIOS = new Set<SimulationScenario>([
  'success',
  'partial',
  'all-fail',
  'transport-loss',
  'timeout',
  'protocol-error',
]);

/**
 * A run time limit as the broker takes it: "default" (3 hours; removes the saved choice) or a number of
 * milliseconds. Written as 3h, 6h, none (the longest window, 7 days), 90m or 2h.
 */
export function parseRunLimit(text: string): string {
  const value = text.trim().toLowerCase();
  if (value === 'default' || value === '3h') return 'default';
  if (value === '6h') return '21600000';
  if (value === 'none') return String(RUN_TIME_LIMIT_UNLIMITED_MS);
  const match = /^(\d{1,5})(m|h)$/.exec(value);
  const ms = match === null ? NaN : Number(match[1]) * (match[2] === 'h' ? 3_600_000 : 60_000);
  if (!(ms >= RUN_TIME_LIMIT_CUSTOM_MIN_MS && ms <= RUN_TIME_LIMIT_UNLIMITED_MS))
    fail(
      'The run time limit is default, 3h, 6h, none, or 10m to 168h (for example 90m or 12h)',
      text,
    );
  return ms === RUN_TIME_LIMIT_DEFAULT_MS ? 'default' : String(ms);
}

function fail(message: string, argument?: string): never {
  throw new CliUsageError(message, argument === undefined ? undefined : { argument });
}

function positional(args: readonly string[]): string[] {
  return args.filter((value, index) => {
    if (value.startsWith('--')) return false;
    return index === 0 || !args[index - 1]?.startsWith('--');
  });
}

function option(args: readonly string[], name: string): string | undefined {
  const indexes = args.flatMap((value, index) => (value === name ? [index] : []));
  if (indexes.length > 1) fail(name + ' may only be supplied once', name);
  const index = indexes[0];
  if (index === undefined) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) fail(name + ' requires a value', name);
  return value;
}

function assertFlags(args: readonly string[], allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const value of args) {
    if (value.startsWith('--') && !allowedSet.has(value)) fail('Unknown option: ' + value, value);
  }
}

function assertPositionals(args: readonly string[], count: number, usage: string): string[] {
  const values = positional(args);
  if (values.length !== count) fail('Usage: ' + usage);
  return values;
}

export function commandHint(args: readonly string[]): CliCommand | 'unknown' {
  if (args[0] === 'capabilities') return 'capabilities';
  const candidate = args[0] + '.' + (args[1] ?? '');
  const known = new Set<CliCommand>([
    'project.add',
    'project.list',
    'project.show',
    'project.update',
    'project.delete',
    'project.revisions',
    'project.findings',
    'project.export-findings',
    'project.profile',
    'project.profile-build',
    'toolchain.status',
    'toolchain.install',
    'toolchain.remove',
    'settings.show',
    'settings.set-effort',
    'settings.set-run-limit',
    'agent.list',
    'agent.doctor',
    'run.simulate',
    'run.start',
    'run.list',
    'run.show',
    'run.status',
    'run.result',
    'run.export',
    'run.export-tests',
    'ci.export',
    'run.cancel',
    'doctor.storage',
    'doctor.cleanup',
    'doctor.config',
    'project.doctor',
  ]);
  return known.has(candidate as CliCommand) ? (candidate as CliCommand) : 'unknown';
}

export function parseCommand(args: readonly string[]): ParsedCliCommand {
  if (args[0] === 'capabilities') {
    assertFlags(args, []);
    assertPositionals(args, 1, 'qa capabilities');
    return { command: 'capabilities' };
  }

  const area = args[0];
  const action = args[1];
  const tail = args.slice(2);
  if (area === 'agent' && action === 'list') {
    assertFlags(tail, []);
    assertPositionals(tail, 0, 'qa agent list');
    return { command: 'agent.list' };
  }
  if (area === 'agent' && action === 'doctor') {
    assertFlags(tail, []);
    const [agent] = assertPositionals(tail, 1, 'qa agent doctor opencode|deepseek|glm|chatgpt');
    if (agent === undefined || !isAgentName(agent))
      fail('Unknown agent: ' + agent + ' (expected opencode, deepseek, glm, or chatgpt)', agent);
    return { command: 'agent.doctor', agent };
  }
  if (area === 'project' && action === 'add') {
    assertFlags(tail, []);
    const [sourcePath] = assertPositionals(tail, 1, 'qa project add <path>');
    return { command: 'project.add', sourcePath: sourcePath as string };
  }
  if (area === 'project' && action === 'list') {
    assertFlags(tail, []);
    assertPositionals(tail, 0, 'qa project list');
    return { command: 'project.list' };
  }
  if (area === 'project' && action === 'show') {
    assertFlags(tail, []);
    const [projectId] = assertPositionals(tail, 1, 'qa project show <project-id>');
    return { command: 'project.show', projectId: projectId as string };
  }
  if (area === 'project' && action === 'update') {
    assertFlags(tail, []);
    const values = positional(tail);
    if (values.length < 1 || values.length > 2) {
      fail('Usage: qa project update <project-id> [path]');
    }
    return {
      command: 'project.update',
      projectId: values[0] as string,
      ...(values[1] === undefined ? {} : { sourcePath: values[1] }),
    };
  }
  if (area === 'project' && action === 'delete') {
    assertFlags(tail, ['--yes']);
    const values = tail.filter((value) => value !== '--yes');
    const [projectId] = assertPositionals(values, 1, 'qa project delete <project-id> --yes');
    if (!tail.includes('--yes')) fail('Project deletion requires --yes', '--yes');
    return { command: 'project.delete', projectId: projectId as string };
  }
  if (area === 'run' && action === 'simulate') {
    assertFlags(tail, ['--scenario', '--instructions', '--agents']);
    const projectId = positional(tail)[0];
    if (projectId === undefined || positional(tail).length !== 1) {
      fail('Usage: qa run simulate <project-id> [--scenario <scenario>]');
    }
    const scenario = option(tail, '--scenario') ?? 'success';
    if (!SIMULATION_SCENARIOS.has(scenario as SimulationScenario)) {
      fail('Unsupported simulation scenario: ' + scenario, '--scenario');
    }
    const instructions = option(tail, '--instructions');
    const agents = option(tail, '--agents');
    if (agents !== undefined && agents.split(',').every((value) => value.length === 0)) {
      fail('--agents requires at least one agent stack', '--agents');
    }
    return {
      command: 'run.simulate',
      projectId,
      scenario: scenario as SimulationScenario,
      ...(instructions === undefined ? {} : { instructions }),
      ...(agents === undefined ? {} : { agents }),
    };
  }
  if (area === 'run' && action === 'start') {
    assertFlags(tail, [
      '--mode',
      '--agents',
      '--wait',
      '--no-wait',
      '--instructions',
      '--timeout-ms',
      '--paths',
      '--web',
      '--tools',
      '--profile',
      '--depth',
      '--revision',
      '--retest',
      '--retest-with',
      '--write-tests',
      '--framework',
      '--style',
    ]);
    const [projectId] = positional(tail);
    if (projectId === undefined || positional(tail).length !== 1) {
      fail(
        'Usage: qa run start <project-id> --mode full|targeted [--agents opencode,deepseek,glm,chatgpt] --wait [--paths a,b] [--instructions text] | --retest <run-id>:<finding-id>,...',
      );
    }
    const retestText = option(tail, '--retest');
    const retestWith = option(tail, '--retest-with');
    const isRetest = retestText !== undefined;
    if (!isRetest && retestWith !== undefined)
      fail('--retest-with only applies together with --retest', '--retest-with');
    if (retestWith !== undefined && retestWith !== 'reporter' && retestWith !== 'all')
      fail('--retest-with must be reporter or all', '--retest-with');
    const writeTestsText = option(tail, '--write-tests');
    const frameworkText = option(tail, '--framework');
    const styleText = option(tail, '--style');
    const isTestWriting = writeTestsText !== undefined;
    if (!isTestWriting && frameworkText !== undefined)
      fail('--framework only applies together with --write-tests', '--framework');
    if (!isTestWriting && styleText !== undefined)
      fail('--style only applies together with --write-tests', '--style');
    if (styleText !== undefined && styleText !== 'new-files' && styleText !== 'patch')
      fail('--style must be new-files or patch', '--style');
    if (isTestWriting && isRetest)
      fail('--write-tests and --retest cannot be combined', '--write-tests');
    // A retest or test-writing run always runs full on the current revision; --mode may be omitted.
    const mode = option(tail, '--mode') ?? (isRetest || isTestWriting ? 'full' : undefined);
    const agentsText = option(tail, '--agents');
    if (mode !== 'full' && mode !== 'targeted') fail('--mode must be full or targeted', '--mode');
    let retest:
      | { findings: Array<{ runId: string; findingId: string }>; who: 'reporter' | 'all' }
      | undefined;
    if (isRetest) {
      if (mode !== 'full') fail('--retest runs in full mode only', '--retest');
      const findings = retestText
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => {
          const [runId, findingId, extra] = value.split(':');
          if (!runId || !findingId || extra !== undefined)
            fail('--retest entries look like <run-id>:<finding-id>', '--retest');
          return { runId, findingId };
        });
      if (findings.length === 0)
        fail('--retest needs at least one <run-id>:<finding-id>', '--retest');
      if (findings.length > 12) fail('--retest takes at most 12 findings', '--retest');
      if (new Set(findings.map((f) => f.runId + ':' + f.findingId)).size !== findings.length)
        fail('--retest lists a duplicate finding', '--retest');
      retest = { findings, who: retestWith === 'all' ? 'all' : 'reporter' };
      if (option(tail, '--instructions') !== undefined || option(tail, '--paths') !== undefined)
        fail('--retest takes no --instructions or --paths', '--retest');
    }
    let testWriting:
      | {
          framework: string;
          style?: 'new-files' | 'patch';
          findings: Array<{ runId: string; findingId: string }>;
        }
      | undefined;
    if (isTestWriting) {
      if (mode !== 'full') fail('--write-tests runs in full mode only', '--write-tests');
      if (
        frameworkText === undefined ||
        !'vitest|jest|pytest|xunit|junit|go-test'.split('|').includes(frameworkText)
      )
        fail(
          '--framework must be one of vitest, jest, pytest, xunit, junit, go-test',
          '--framework',
        );
      const findings = writeTestsText
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => {
          const [runId, findingId, extra] = value.split(':');
          if (!runId || !findingId || extra !== undefined)
            fail('--write-tests entries look like <run-id>:<finding-id>', '--write-tests');
          return { runId, findingId };
        });
      if (findings.length === 0)
        fail('--write-tests needs at least one <run-id>:<finding-id>', '--write-tests');
      if (findings.length > 12) fail('--write-tests takes at most 12 findings', '--write-tests');
      if (new Set(findings.map((f) => f.runId + ':' + f.findingId)).size !== findings.length)
        fail('--write-tests lists a duplicate finding', '--write-tests');
      testWriting = {
        framework: frameworkText,
        ...(styleText === undefined ? {} : { style: styleText }),
        findings,
      };
      if (option(tail, '--instructions') !== undefined || option(tail, '--paths') !== undefined)
        fail('--write-tests takes no --instructions or --paths', '--write-tests');
    }
    // Omitted --agents selects the stable real AgentStacks. A retest with the default
    // "reporter" choice leaves the agents to the findings (each goes to the agent that reported it).
    const agents: AgentName[] =
      agentsText === undefined
        ? (isRetest && retest?.who === 'reporter') || isTestWriting
          ? []
          : [...DEFAULT_AGENT_NAMES]
        : (agentsText
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0) as AgentName[]);
    if (agentsText !== undefined && agents.length === 0)
      fail('--agents requires at least one agent stack', '--agents');
    for (const name of agents) {
      if (!isAgentName(name))
        fail(
          'Unknown agent: ' + name + ' (expected opencode, deepseek, glm, or chatgpt)',
          '--agents',
        );
    }
    const depth = option(tail, '--depth');
    if (depth !== undefined && depth !== 'fast' && depth !== 'full')
      fail('--depth must be fast or full', '--depth');
    if (isRetest && depth !== undefined)
      fail('--retest has its own fixed checks; --depth does not apply', '--depth');
    if (isTestWriting && depth !== undefined)
      fail('--write-tests has its own fixed checks; --depth does not apply', '--depth');
    const revisionId = option(tail, '--revision');
    if (revisionId !== undefined && !/^rev_[0-9A-HJKMNP-TV-Z]{26}$/.test(revisionId))
      fail('--revision must be a revision id (rev_...)', '--revision');
    if (isRetest && revisionId !== undefined)
      fail('--retest always runs on the current revision', '--revision');
    if (isTestWriting && revisionId !== undefined)
      fail('--write-tests always runs on the current revision', '--revision');
    if (new Set(agents).size !== agents.length)
      fail('--agents lists a duplicate agent', '--agents');
    // Async start is the default machine flow: the runtime owns the run and
    // the CLI exits. --wait observes the canonical run until it terminalizes.
    if (tail.includes('--wait') && tail.includes('--no-wait'))
      fail('--wait and --no-wait are mutually exclusive', '--wait');
    const wait = tail.includes('--wait');
    const instructions = option(tail, '--instructions');
    const timeoutText = option(tail, '--timeout-ms');
    const runTimeoutMs = timeoutText === undefined ? undefined : Number(timeoutText);
    if (
      runTimeoutMs !== undefined &&
      (!Number.isSafeInteger(runTimeoutMs) ||
        runTimeoutMs < RUN_TIMEOUT_MS_MIN ||
        runTimeoutMs > RUN_TIMEOUT_MS_MAX)
    ) {
      fail(
        '--timeout-ms must be an integer between ' +
          RUN_TIMEOUT_MS_MIN +
          ' and ' +
          RUN_TIMEOUT_MS_MAX,
        '--timeout-ms',
      );
    }
    const paths = option(tail, '--paths');
    if (mode === 'targeted' && (paths === undefined || paths.trim().length === 0)) {
      fail('Targeted QA requires --paths <comma-separated project-relative paths>', '--paths');
    }
    if (mode === 'full' && paths !== undefined) {
      fail('Full QA takes no --paths; use --mode targeted', '--paths');
    }
    return {
      command: 'run.start',
      projectId,
      mode: mode as 'full' | 'targeted',
      agents,
      wait,
      ...(instructions === undefined ? {} : { instructions }),
      ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
      ...(tail.includes('--web') ? { webAccess: true } : {}),
      ...(tail.includes('--tools') ? { toolDownloads: true } : {}),
      ...(tail.includes('--profile') ? { useProfile: true } : {}),
      ...(depth === undefined ? {} : { depth }),
      ...(revisionId === undefined ? {} : { revisionId }),
      ...(retest === undefined ? {} : { retest }),
      ...(testWriting === undefined ? {} : { testWriting }),
      ...(paths === undefined ? {} : { paths }),
    };
  }
  if (area === 'run' && action === 'list') {
    assertFlags(tail, []);
    const [projectId] = assertPositionals(tail, 1, 'qa run list <project-id>');
    return { command: 'run.list', projectId: projectId as string };
  }
  if (area === 'run' && (action === 'show' || action === 'status')) {
    assertFlags(tail, []);
    const [runId] = assertPositionals(tail, 1, 'qa run ' + action + ' <run-id>');
    return { command: action === 'show' ? 'run.show' : 'run.status', runId: runId as string };
  }
  if (area === 'run' && action === 'cancel') {
    assertFlags(tail, []);
    const [runId] = assertPositionals(tail, 1, 'qa run cancel <run-id>');
    return { command: 'run.cancel', runId: runId as string };
  }
  if (area === 'project' && action === 'findings') {
    assertFlags(tail, []);
    const [projectId] = assertPositionals(tail, 1, 'qa project findings <project-id>');
    return { command: 'project.findings', projectId: projectId as string };
  }
  if (area === 'project' && action === 'export-findings') {
    assertFlags(tail, ['--format', '--findings', '--run', '--revision', '--out', '--json']);
    const usage =
      'Usage: qa project export-findings <project-id> --format markdown|github-issues|sarif (--findings <run-id>:<finding-id>,... | --run <run-id> | --revision <rev-id>,...) --out <path>';
    const [projectId] = positional(tail);
    if (projectId === undefined || positional(tail).length !== 1) fail(usage);
    const format = option(tail, '--format');
    if (format !== 'markdown' && format !== 'github-issues' && format !== 'sarif')
      fail('--format must be markdown, github-issues or sarif', '--format');
    const out = option(tail, '--out');
    if (out === undefined)
      fail('--out is required: a file, or a folder for github-issues', '--out');
    const findingsText = option(tail, '--findings');
    const runText = option(tail, '--run');
    const revisionText = option(tail, '--revision');
    if ([findingsText, runText, revisionText].filter((v) => v !== undefined).length !== 1)
      fail('Choose exactly one of --findings, --run or --revision', '--findings');
    const list = (text: string): string[] =>
      text
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    let selection:
      | { findings: Array<{ runId: string; findingId: string }> }
      | { runId: string }
      | { revisionIds: string[] };
    if (findingsText !== undefined) {
      const findings = list(findingsText).map((value) => {
        const [runId, findingId, extra] = value.split(':');
        if (!runId || !findingId || extra !== undefined)
          fail('--findings entries look like <run-id>:<finding-id>', '--findings');
        return { runId, findingId };
      });
      if (findings.length === 0)
        fail('--findings needs at least one <run-id>:<finding-id>', '--findings');
      if (findings.length > 500) fail('--findings takes at most 500 findings', '--findings');
      selection = { findings };
    } else if (runText !== undefined) {
      selection = { runId: runText };
    } else {
      const revisionIds = list(revisionText as string);
      if (revisionIds.length === 0) fail('--revision needs at least one revision id', '--revision');
      if (revisionIds.length > 50) fail('--revision takes at most 50 revisions', '--revision');
      selection = { revisionIds };
    }
    return {
      command: 'project.export-findings',
      projectId,
      format,
      selection,
      out,
    };
  }
  if (area === 'project' && action === 'profile') {
    assertFlags(tail, []);
    const [projectId] = assertPositionals(tail, 1, 'qa project profile <project-id>');
    return { command: 'project.profile', projectId: projectId as string };
  }
  if (area === 'project' && action === 'profile-build') {
    assertFlags(tail, ['--agents']);
    const [projectId] = positional(tail);
    if (projectId === undefined || positional(tail).length !== 1)
      fail('Usage: qa project profile-build <project-id> [--agents opencode,deepseek,glm,chatgpt]');
    const agentsText = option(tail, '--agents');
    const agents =
      agentsText === undefined
        ? undefined
        : agentsText
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
    if (agents !== undefined && agents.length === 0)
      fail('--agents requires at least one agent stack', '--agents');
    for (const name of agents ?? []) {
      if (!isAgentName(name))
        fail(
          'Unknown agent: ' + name + ' (expected opencode, deepseek, glm, or chatgpt)',
          '--agents',
        );
    }
    return {
      command: 'project.profile-build',
      projectId,
      ...(agents === undefined ? {} : { agents: agents as AgentName[] }),
    };
  }
  if (area === 'settings' && action === 'show') {
    assertFlags(tail, []);
    assertPositionals(tail, 0, 'qa settings show');
    return { command: 'settings.show' };
  }
  if (area === 'settings' && action === 'effort') {
    assertFlags(tail, []);
    const [agent, level] = assertPositionals(
      tail,
      2,
      'qa settings effort <opencode|deepseek|glm|chatgpt> <level|default>',
    );
    if (agent === undefined || !isAgentName(agent))
      fail('Unknown agent: ' + agent + ' (expected opencode, deepseek, glm, or chatgpt)', agent);
    const value = (level ?? '').toLowerCase();
    const allowed = AGENT_EFFORT_LEVELS[agent] as readonly string[];
    if (value !== 'default' && !allowed.includes(value))
      fail(
        'The ' +
          agent +
          ' agent takes: ' +
          [...allowed, 'default'].join(', ') +
          ' (not "' +
          level +
          '")',
        level,
      );
    return { command: 'settings.set-effort', agent, value };
  }
  if (area === 'settings' && action === 'run-limit') {
    assertFlags(tail, []);
    const [text] = assertPositionals(
      tail,
      1,
      'qa settings run-limit <default|3h|6h|none|<number>m|<number>h>',
    );
    return { command: 'settings.set-run-limit', value: parseRunLimit(text as string) };
  }
  if (area === 'toolchain' && action === 'status') {
    assertFlags(tail, []);
    assertPositionals(tail, 0, 'qa toolchain status');
    return { command: 'toolchain.status' };
  }
  if (area === 'toolchain' && (action === 'install' || action === 'remove')) {
    assertFlags(tail, []);
    const [packId, version] = assertPositionals(
      tail,
      2,
      'qa toolchain ' + action + ' <pack-id> <version>',
    );
    return {
      command: action === 'install' ? 'toolchain.install' : 'toolchain.remove',
      packId: packId as string,
      version: version as string,
    };
  }
  if (area === 'project' && action === 'revisions') {
    assertFlags(tail, []);
    const [projectId] = assertPositionals(tail, 1, 'qa project revisions <project-id>');
    return { command: 'project.revisions', projectId: projectId as string };
  }
  if (area === 'run' && action === 'export') {
    assertFlags(tail, ['--format', '--out']);
    const [runId] = positional(tail);
    if (runId === undefined || positional(tail).length !== 1) {
      fail('Usage: qa run export <run-id> --format log|json [--out <path>]');
    }
    const format = option(tail, '--format');
    if (format !== 'log' && format !== 'json') fail('--format must be log or json', '--format');
    const out = option(tail, '--out');
    return { command: 'run.export', runId, format, ...(out === undefined ? {} : { out }) };
  }
  if (area === 'ci' && action === 'export') {
    assertFlags(tail, ['--target', '--framework', '--out', '--json']);
    assertPositionals(tail, 0, 'qa ci export --target <ci> --framework <framework> --out <folder>');
    const target = option(tail, '--target');
    if (target !== 'github-actions' && target !== 'gitlab-ci' && target !== 'azure-pipelines')
      fail('--target must be github-actions, gitlab-ci or azure-pipelines', '--target');
    const framework = option(tail, '--framework');
    if (
      framework !== 'vitest' &&
      framework !== 'jest' &&
      framework !== 'pytest' &&
      framework !== 'xunit' &&
      framework !== 'junit' &&
      framework !== 'go-test'
    )
      fail('--framework must be one of vitest, jest, pytest, xunit, junit, go-test', '--framework');
    const out = option(tail, '--out');
    if (out === undefined) fail('--out is required: a folder for the CI files', '--out');
    return { command: 'ci.export', target, framework, out };
  }
  if (area === 'run' && action === 'export-tests') {
    assertFlags(tail, ['--out', '--json']);
    const [runId] = positional(tail);
    if (runId === undefined || positional(tail).length !== 1)
      fail('Usage: qa run export-tests <run-id> --out <folder>');
    const out = option(tail, '--out');
    if (out === undefined)
      fail('--out is required: a folder for the README and the tests', '--out');
    return { command: 'run.export-tests', runId, out };
  }
  if (area === 'run' && action === 'result') {
    assertFlags(tail, []);
    const [runId] = assertPositionals(tail, 1, 'qa run result <run-id>');
    return { command: 'run.result', runId: runId as string };
  }
  if (area === 'doctor' && action === 'storage') {
    assertFlags(tail, ['--json']);
    assertPositionals(tail, 0, 'qa doctor storage');
    return { command: 'doctor.storage' };
  }
  if (area === 'doctor' && action === 'cleanup') {
    assertFlags(tail, ['--json', '--apply']);
    assertPositionals(tail, 0, 'qa doctor cleanup [--apply]');
    return { command: 'doctor.cleanup', apply: tail.includes('--apply') };
  }
  if (area === 'doctor' && action === 'config') {
    assertFlags(tail, ['--json']);
    assertPositionals(tail, 0, 'qa doctor config');
    return { command: 'doctor.config' };
  }
  if (area === 'project' && action === 'doctor') {
    assertFlags(tail, ['--json']);
    const [projectId] = assertPositionals(tail, 1, 'qa project doctor <project-id>');
    return { command: 'project.doctor', projectId: projectId as string };
  }
  fail('Unknown command: ' + args.join(' '));
}
