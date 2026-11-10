/**
 * Desktop application service: typed RPC adapter over the host runtime.
 *
 * Production-only desktop: Electron main owns NO Sentry domain state — no
 * database, no RunCoordinator, no provider adapters. Every QA operation is
 * a typed `RuntimeClient.request()` over the shared stdio transport to the long-lived Linux runtime.
 * Host keeps: safeStorage credentials, runtime lifecycle, path preparation,
 * live-update fan-out. Secrets stay in main; renderer receives statuses.
 */
import { z } from 'zod';
import {
  AGENT_EFFORT_SETTING,
  EFFORT_AGENTS,
  RUN_TIME_LIMIT_DEFAULT_MS,
  RUN_TIME_LIMIT_SETTING,
  RUN_TIMEOUT_MS_MAX,
  RUN_TIMEOUT_MS_MIN,
  parseAgentEffort,
  parseRunTimeLimit,
} from '@qa/shared';
import type { AgentStackDefinition } from '@qa/schemas';
import type { DesktopOperation, RunSnapshot } from '../../shared/ipc-contract.js';
import { toSafeError } from '../desktop-command-router.js';
import type { ProviderCredentialService } from './provider-credentials.js';
import type { RuntimeClient } from '../runtime/runtime-client.js';
import type { HostPlatform } from '../platform/host-platform.js';

export interface DesktopServiceDeps {
  readonly runtime: RuntimeClient;
  readonly host: HostPlatform;
  readonly agentStacks: readonly AgentStackDefinition[];
  readonly credentials: ProviderCredentialService;
  readonly legacyDataRoot?: string;
}

const ProjectIdInput = z.string().min(1).max(200);
const RunIdInput = z.string().regex(/^run_[0-9A-HJKMNP-TV-Z]{26}$/);
const StartRunOptions = z
  .object({
    mode: z.enum(['full', 'targeted']),
    revisionId: z
      .string()
      .regex(/^rev_[0-9A-HJKMNP-TV-Z]{26}$/)
      .optional(),
    includePaths: z.array(z.string().min(1).max(500)).max(100).optional(),
    instructions: z.string().min(1).max(5000).optional(),
    agentStackIds: z.array(z.string().min(1).max(200)).min(1).max(10).optional(),
    runTimeoutMs: z.number().int().min(RUN_TIMEOUT_MS_MIN).max(RUN_TIMEOUT_MS_MAX).optional(),
    webAccess: z.boolean().optional(),
    toolDownloads: z.boolean().optional(),
    depth: z.enum(['fast', 'full']).optional(),
    useProfile: z.boolean().optional(),
    retest: z
      .object({
        findings: z
          .array(
            z
              .object({
                runId: z.string().min(1).max(100),
                findingId: z.string().min(1).max(100),
              })
              .strict(),
          )
          .min(1)
          .max(12),
        who: z.enum(['reporter', 'all']),
      })
      .strict()
      .optional(),
  })
  .strict();

function sanitizeError(
  error: unknown,
  redactSecrets?: (text: string) => string,
): { code: string; message: string } {
  return toSafeError(error, redactSecrets === undefined ? {} : { redactSecrets });
}

function toError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export class DesktopApplicationService {
  constructor(private readonly deps: DesktopServiceDeps) {}

  private call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const redact = (text: string): string => this.redactSecretsFromText(text);
    const toMappedError = (error: unknown): Error => {
      const sanitized = sanitizeError(error, redact);
      return toError(sanitized.code, sanitized.message);
    };
    try {
      const pending = this.deps.runtime.request(method, params);
      // Async rejections sanitize through the same boundary as sync throws;
      // success values pass through untouched, failures map identically.
      return pending.catch((error: unknown) => {
        throw toMappedError(error);
      });
    } catch (error) {
      throw toMappedError(error);
    }
  }

  /**
   * Boundary scrubber for error surfaces (IPC/CLI/log warnings): removes
   * exact known secret-lane values; see ProviderCredentialService.
   */
  redactSecretsFromText(text: string): string {
    // Intentionally no catch here: a failing scrubber must propagate to
    // the shared fail-closed mapping (toSafeError), never silently keep
    // the original text.
    return this.deps.credentials.redactSecretsFromText(text);
  }

  get dataRoot(): string {
    return this.deps.legacyDataRoot ?? 'wsl-runtime';
  }

  get productionCoordinator(): unknown {
    return undefined;
  }

  get productionRegistry(): unknown {
    return undefined;
  }

  runtimeStatus(): unknown {
    return this.deps.runtime.status;
  }

  // ---- projects (Windows paths translated via wslpath before RPC) ----
  listProjects(): Promise<unknown[]> {
    return this.call('projects.list') as Promise<unknown[]>;
  }

  async addProject(sourcePath: string): Promise<unknown> {
    const input = z.string().min(1).max(2000).parse(sourcePath);
    const translated = await this.translateSourcePath(input);
    return this.call('projects.add', { sourcePath: translated });
  }

  cancelAddProject(): Promise<unknown> {
    return this.call('projects.cancelAdd', {});
  }

  cancelUpdateProject(): Promise<unknown> {
    return this.call('projects.cancelUpdate', {});
  }

  getProject(projectId: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.get', { projectId: id });
  }

  listRevisions(projectId: string): Promise<unknown[]> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.revisions', { projectId: id }) as Promise<unknown[]>;
  }

  suggestTargets(projectId: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.suggestTargets', { projectId: id });
  }

  openAiAccountStatus(): Promise<unknown> {
    return this.call('openai.accountStatus', {});
  }

  openAiAccountLogin(): Promise<unknown> {
    return this.call('openai.accountLogin', {});
  }

  openAiAccountCancelLogin(): Promise<unknown> {
    return this.call('openai.accountCancelLogin', {});
  }

  openAiAccountLogout(): Promise<unknown> {
    return this.call('openai.accountLogout', {});
  }

  toolchainStatus(): Promise<unknown> {
    return this.call('toolchains.status', {});
  }

  toolchainInstall(packId: string, version: string): Promise<unknown> {
    return this.call('toolchains.install', { packId, version });
  }

  toolchainRemove(packId: string, version: string): Promise<unknown> {
    return this.call('toolchains.remove', { packId, version });
  }

  customAddonStatus(): Promise<unknown> {
    return this.call('toolchains.customStatus', {});
  }

  customAddonInstall(input: {
    name: string;
    command: string;
    pathEntries?: string[];
  }): Promise<unknown> {
    return this.call('toolchains.customInstall', input);
  }

  customAddonRemove(name: string): Promise<unknown> {
    return this.call('toolchains.customRemove', { name });
  }

  profileStatus(projectId: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.profile', { projectId: id });
  }

  buildProfiles(projectId: string, agentStackIds?: string[]): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.buildProfile', {
      projectId: id,
      ...(agentStackIds === undefined ? {} : { agentStackIds }),
    });
  }

  toolchainNeedsStatus(projectId: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.toolchainNeeds', { projectId: id });
  }

  toolchainSelection(projectId: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.toolchainSelection', { projectId: id });
  }

  findingsByRevision(projectId: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.findingsByRevision', { projectId: id });
  }

  assessToolchains(projectId: string, agentStackIds?: string[]): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.assessToolchains', {
      projectId: id,
      ...(agentStackIds === undefined ? {} : { agentStackIds }),
    });
  }

  async updateProject(projectId: string, sourcePath?: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    if (sourcePath === undefined) return this.call('projects.update', { projectId: id });
    const parsed = z.string().min(1).max(2000).parse(sourcePath);
    const translated = await this.translateSourcePath(parsed);
    return this.call('projects.update', { projectId: id, sourcePath: translated });
  }

  deleteProject(projectId: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.delete', { projectId: id });
  }

  projectDoctor(projectId: string): Promise<unknown> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('projects.doctor', { projectId: id });
  }

  private async translateSourcePath(input: string): Promise<string> {
    return this.deps.host.prepareSourcePath(input);
  }

  // ---- runs (all inside the Linux execution runtime) ----
  listRuns(projectId: string): Promise<unknown[]> {
    const id = ProjectIdInput.parse(projectId);
    return this.call('runs.list', { projectId: id }) as Promise<unknown[]>;
  }

  runSnapshot(runId: string): Promise<RunSnapshot> {
    const id = RunIdInput.parse(runId);
    return this.call('runs.get', { runId: id }) as Promise<RunSnapshot>;
  }

  runStatus(runId: string): Promise<unknown> {
    const id = RunIdInput.parse(runId);
    return this.call('runs.status', { runId: id });
  }

  async startRun(projectId: string, options: unknown): Promise<DesktopOperation> {
    const id = ProjectIdInput.parse(projectId);
    const parsed = StartRunOptions.parse(options);
    // A run that does not name its own window gets the default chosen in Settings (3 hours if none).
    const runTimeoutMs =
      parsed.runTimeoutMs ??
      parseRunTimeLimit(this.deps.credentials.getValue(RUN_TIME_LIMIT_SETTING));
    try {
      return (await this.call('runs.start', {
        projectId: id,
        mode: parsed.mode,
        ...(parsed.revisionId === undefined ? {} : { revisionId: parsed.revisionId }),
        ...(parsed.includePaths === undefined ? {} : { includePaths: [...parsed.includePaths] }),
        ...(parsed.instructions === undefined ? {} : { instructions: parsed.instructions }),
        ...(parsed.agentStackIds === undefined ? {} : { agentStackIds: [...parsed.agentStackIds] }),
        ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
        ...(parsed.webAccess === true ? { webAccess: true } : {}),
        ...(parsed.toolDownloads === true ? { toolDownloads: true } : {}),
        ...(parsed.depth === undefined ? {} : { depth: parsed.depth }),
        ...(parsed.useProfile === true ? { useProfile: true } : {}),
        ...(parsed.retest === undefined ? {} : { retest: parsed.retest }),
      })) as DesktopOperation;
    } catch (error) {
      // A client-side timeout does NOT mean the runtime didn't start the run:
      // reconcile before reporting, so the UI never hides a paid run that is
      // actually executing (and the user never double-starts blindly).
      if (error instanceof Error && (error as { code?: unknown }).code === 'RUNTIME_TIMEOUT') {
        const reconciled = await this.recentRunForProject(id).catch(() => undefined);
        if (reconciled !== undefined) {
          throw toError(
            'RUN_MAY_HAVE_STARTED',
            'Runtime request timed out, but a run (' +
              reconciled +
              ') appeared for this project — open Runs before retrying.',
          );
        }
      }
      throw error;
    }
  }

  /** Most recent nonterminal run row for a project, if any (timeout reconciliation). */
  private async recentRunForProject(projectId: string): Promise<string | undefined> {
    const runs = (await this.call('runs.list', { projectId: projectId as string })) as Array<{
      id: string;
      status: string;
      createdAt: string;
    }>;
    const active = runs
      .filter((r) => !['completed', 'partial', 'failed', 'cancelled'].includes(r.status))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return active[0]?.id;
  }

  requestRunCancellation(runId: string): Promise<unknown> {
    const id = RunIdInput.parse(runId);
    return this.call('runs.cancel', { runId: id });
  }

  /** Canonical export bytes for Save As. Renderer controls runId + format
   *  only; the destination always originates from the native dialog. */
  exportContent(
    runId: string,
    format: 'log' | 'json',
  ): Promise<{
    filename: string;
    mimeType: string;
    format: string;
    sizeBytes: number;
    contentBase64: string;
  }> {
    const id = RunIdInput.parse(runId);
    const parsed = z.enum(['log', 'json']).parse(format);
    return this.call('runs.exportContent', { runId: id, format: parsed }) as Promise<{
      filename: string;
      mimeType: string;
      format: string;
      sizeBytes: number;
      contentBase64: string;
    }>;
  }

  exportRun(runId: string, format: 'log' | 'json'): Promise<unknown> {
    const id = RunIdInput.parse(runId);
    const parsed = z.enum(['log', 'json']).parse(format);
    return this.call('runs.export', { runId: id, format: parsed });
  }

  // ---- doctors / system ----
  environmentDoctors(): Promise<unknown> {
    return this.call('runtime.environment', {});
  }

  runtimeEnvironment(): Promise<unknown> {
    return this.call('runtime.environment', {});
  }

  // ---- provider credentials (statuses only to renderer; never values) ----
  providerStatuses(): unknown {
    return this.deps.credentials.statuses();
  }

  async providerSaveKey(name: string, value: string): Promise<unknown> {
    const parsed = z
      .object({ name: z.string().min(1).max(200), value: z.string().min(1).max(5000) })
      .strict()
      .parse({ name, value });
    const status = await this.deps.credentials.saveKey(parsed.name, parsed.value);
    const runtimeSynced = await this.pushRuntimeConfigurationBestEffort();
    return { ...(status as unknown as Record<string, unknown>), runtimeSynced };
  }

  async providerClearKey(name: string): Promise<unknown> {
    const parsed = z.string().min(1).max(200).parse(name);
    const status = await this.deps.credentials.clearKey(parsed);
    const runtimeSynced = await this.pushRuntimeConfigurationBestEffort();
    return { ...(status as unknown as Record<string, unknown>), runtimeSynced };
  }

  /**
   * Change one of the two run settings the CLI may set (the same values Settings → Providers and
   * Settings → Runtime save). "default" removes the setting. A value the agent's tool does not take,
   * or a window outside the allowed range, is refused rather than saved.
   */
  async setRunSetting(input: unknown): Promise<unknown> {
    const parsed = z
      .discriminatedUnion('setting', [
        z
          .object({
            setting: z.literal('reasoning-effort'),
            agent: z.enum(EFFORT_AGENTS as [string, ...string[]]),
            value: z.string().min(1).max(20),
          })
          .strict(),
        z
          .object({ setting: z.literal('run-time-limit'), value: z.string().min(1).max(20) })
          .strict(),
      ])
      .parse(input);
    if (parsed.setting === 'reasoning-effort') {
      const agent = parsed.agent as (typeof EFFORT_AGENTS)[number];
      const name = AGENT_EFFORT_SETTING[agent];
      if (parsed.value === 'default') {
        await this.providerClearKey(name);
        return { agent, reasoningEffort: 'default' };
      }
      const level = parseAgentEffort(agent, parsed.value);
      if (level === undefined)
        throw toError(
          'INVALID_ARGUMENT',
          'The ' + agent + ' agent does not take reasoning effort "' + parsed.value + '"',
        );
      await this.providerSaveKey(name, level);
      return { agent, reasoningEffort: level };
    }
    if (parsed.value === 'default') {
      await this.providerClearKey(RUN_TIME_LIMIT_SETTING);
      return { ms: RUN_TIME_LIMIT_DEFAULT_MS, isDefault: true };
    }
    const ms = parseRunTimeLimit(parsed.value);
    if (ms === undefined)
      throw toError(
        'INVALID_ARGUMENT',
        'The run time limit must be between 10 minutes and 7 days (in milliseconds)',
      );
    await this.providerSaveKey(RUN_TIME_LIMIT_SETTING, String(ms));
    return { ms, isDefault: ms === RUN_TIME_LIMIT_DEFAULT_MS };
  }

  providerPersist(): Promise<unknown> {
    return this.deps.credentials.persist();
  }

  providerForgetFile(): Promise<unknown> {
    return this.deps.credentials.forgetFile().then(() => ({ forgotten: true }));
  }

  async providerForgetAll(): Promise<unknown> {
    const result = await this.deps.credentials.forgetAll();
    const runtimeSynced = await this.pushRuntimeConfigurationBestEffort();
    return { ...(result as Record<string, unknown>), runtimeSynced };
  }

  /**
   * Push live config to the runtime, retrying once after a short delay. A
   * transient IPC/runtime blip must not silently leave agent health
   * showing stale models: callers report the acknowledgement so the UI
   * can warn instead of presenting stale values as current.
   */
  private async pushRuntimeConfigurationBestEffort(): Promise<boolean> {
    try {
      await this.pushRuntimeConfiguration();
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        await this.pushRuntimeConfiguration();
        return true;
      } catch {
        return false;
      }
    }
  }

  detectHarnessBinaries(): Promise<unknown> {
    return Promise.resolve({
      deepseek: { detected: null, configured: null, effective: 'linux-runtime' },
      note: 'Provider executables resolve inside the Linux execution runtime; host paths do not apply.',
    });
  }

  /** Push models + secrets + binary overrides (memory-only) to the runtime. */
  async pushRuntimeConfiguration(): Promise<unknown> {
    const get = (name: string): string | undefined => this.deps.credentials.getValue(name);
    const models: Record<string, string> = {};
    const opencode = get('SENTRY_OPENCODE_MODEL');
    const deepseek = get('SENTRY_DEEPSEEK_MODEL');
    const glm = get('SENTRY_GLM_MODEL');
    const chatgpt = get('SENTRY_CHATGPT_MODEL');
    if (opencode !== undefined) models['opencode'] = opencode;
    if (deepseek !== undefined) models['deepseek'] = deepseek;
    if (glm !== undefined) models['glm'] = glm;
    if (chatgpt !== undefined) models['chatgpt'] = chatgpt;
    const providers: Record<string, string> = {};
    const openRouterKey = get('OPENROUTER_API_KEY');
    const openCodeKey = get('OPENCODE_API_KEY');
    const deepseekKey = get('DEEPSEEK_API_KEY');
    const glmToken = get('ANTHROPIC_AUTH_TOKEN');
    const glmEndpoint = get('ANTHROPIC_BASE_URL');
    if (openRouterKey !== undefined) providers['openRouterApiKey'] = openRouterKey;
    if (openCodeKey !== undefined) providers['openCodeApiKey'] = openCodeKey;
    const openAiKey = get('OPENAI_API_KEY');
    if (openAiKey !== undefined) providers['openAiApiKey'] = openAiKey;
    if (deepseekKey !== undefined) providers['deepseekApiKey'] = deepseekKey;
    if (glmToken !== undefined) providers['anthropicAuthToken'] = glmToken;
    if (glmEndpoint !== undefined) providers['anthropicBaseUrl'] = glmEndpoint;
    const binaries: Record<string, string> = {};
    const opencodeBinary = get('SENTRY_OPENCODE_BINARY');
    const deepseekBinary = get('SENTRY_DEEPSEEK_BINARY');
    const glmBinary = get('SENTRY_GLM_BINARY');
    if (opencodeBinary !== undefined) binaries['opencode'] = opencodeBinary;
    if (deepseekBinary !== undefined) binaries['deepseek'] = deepseekBinary;
    if (glmBinary !== undefined) binaries['glm'] = glmBinary;
    const openCodeProvider = get('SENTRY_OPENCODE_PROVIDER')?.trim().toLowerCase();
    const provider =
      openCodeProvider === 'openrouter' ||
      openCodeProvider === 'opencode' ||
      openCodeProvider === 'opencode-go' ||
      openCodeProvider === 'openai'
        ? { openCodeProvider }
        : {};
    const openAiAuth =
      get('SENTRY_OPENAI_AUTH')?.trim().toLowerCase() === 'account' ? 'account' : 'key';
    return this.call('runtime.configure', {
      models,
      providers,
      binaries,
      ...provider,
      openAiAuth,
      reasoningEffort: Object.fromEntries(
        EFFORT_AGENTS.map((agent) => [
          agent,
          parseAgentEffort(agent, get(AGENT_EFFORT_SETTING[agent])) ?? 'default',
        ]),
      ),
    });
  }

  productionReadiness(input?: { agentStackIds?: string[] }): Promise<unknown> {
    return this.call('production.readiness', {
      ...(input?.agentStackIds === undefined ? {} : { agentStackIds: [...input.agentStackIds] }),
    });
  }

  preRunGate(agentStackIds?: string[]): Promise<{
    readonly ready: boolean;
    readonly warnings: readonly string[];
    readonly stacks: ReadonlyArray<{
      readonly id: string;
      readonly ready: boolean;
      readonly reasons: readonly string[];
      readonly warnings: readonly string[];
    }>;
  }> {
    return this.call('production.preRunGate', {
      ...(agentStackIds === undefined ? {} : { agentStackIds: [...agentStackIds] }),
    }) as Promise<{
      readonly ready: boolean;
      readonly warnings: readonly string[];
      readonly stacks: ReadonlyArray<{
        readonly id: string;
        readonly ready: boolean;
        readonly reasons: readonly string[];
        readonly warnings: readonly string[];
      }>;
    }>;
  }

  systemInfo(): Promise<{ dataRoot: string; versions: Record<string, string> }> {
    return this.call('system.info', {}) as Promise<{
      dataRoot: string;
      versions: Record<string, string>;
    }>;
  }

  activeRuns(): Promise<Array<{ runId: string; projectId: string; status: string }>> {
    return this.call('system.activeRuns', {}) as Promise<
      Array<{ runId: string; projectId: string; status: string }>
    >;
  }

  /**
   * Runtime target choices live behind the host platform: WSL distro data
   * on Windows, normalized native host info on Linux (no distro to pick).
   */
  async runtimeDistros(): Promise<unknown> {
    return this.deps.host.runtimeDistros();
  }

  async runtimeSelectDistro(distro: string): Promise<unknown> {
    const parsed = z.string().min(1).max(200).parse(distro);
    return this.deps.host.runtimeSelectDistro(parsed);
  }
}
