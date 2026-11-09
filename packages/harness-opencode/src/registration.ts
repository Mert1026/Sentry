import { AgentStackDefinitionSchema, type AgentRuntimeIdentity } from '@qa/schemas';
import type { HarnessAdapterRegistration } from '@qa/harness-protocol';
import { OpenCodeHarnessAdapter, type OpenCodeHarnessAdapterOptions } from './adapter.js';
import {
  assertSupportedOpenCodeProvider,
  assertTestedOpenCodeVersion,
  credentialEnvForProvider,
  OPENCODE_TESTED_VERSION,
  openCodeCredentialPresent,
  openCodeSandboxBypassed,
  probeOpenCodeSandbox,
  probeResolvedOpenCodeExecutable,
  resolveOpenCodeRuntime,
} from './discovery.js';
import { OpenCodeHarnessError } from './errors.js';

/**
 * The ChatGPT agent runs the OpenCode harness against provider `openai`.
 * Live view of the process environment where the OpenCode provider/model
 * variables are replaced by the ChatGPT agent's own, so it never shares the
 * OpenCode agent's model or provider choice. Live (a Proxy), because the
 * desktop pushes configuration after registration.
 */
export function chatGptEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return new Proxy(source, {
    get(target, key) {
      if (key === 'SENTRY_OPENCODE_PROVIDER') return 'openai';
      if (key === 'SENTRY_OPENCODE_MODEL') return target['SENTRY_CHATGPT_MODEL'];
      // The ChatGPT agent's own reasoning-effort choice reaches the harness as its variant.
      if (key === 'SENTRY_OPENCODE_VARIANT') return target['SENTRY_CHATGPT_REASONING'];
      return typeof key === 'string' ? target[key] : undefined;
    },
    has(target, key) {
      if (key === 'SENTRY_OPENCODE_PROVIDER') return true;
      if (key === 'SENTRY_OPENCODE_MODEL') return target['SENTRY_CHATGPT_MODEL'] !== undefined;
      if (key === 'SENTRY_OPENCODE_VARIANT')
        return target['SENTRY_CHATGPT_REASONING'] !== undefined;
      return typeof key === 'string' && key in target;
    },
  });
}

/**
 * Context window the ChatGPT agent assumes for its OpenAI model. The OpenCode
 * default (200k) made it restart its session four times in one run; current
 * OpenAI models accept at least this much input. Override with
 * SENTRY_CHATGPT_CONTEXT_TOKENS in the runtime environment.
 */
export const CHATGPT_CONTEXT_WINDOW_TOKENS = 272_000;

export function chatGptContextWindow(environment: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(environment['SENTRY_CHATGPT_CONTEXT_TOKENS'] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 32_000 ? parsed : CHATGPT_CONTEXT_WINDOW_TOKENS;
}

export interface OpenCodeRegistrationIdentity {
  /** Context window for this agent's model; absent keeps the harness default. */
  readonly contextWindowTokens?: () => number;
  readonly stackId: string;
  readonly displayName: string;
  readonly provider: string;
  readonly modelDisplayName: string;
}

export const CHATGPT_REGISTRATION_IDENTITY: OpenCodeRegistrationIdentity = {
  stackId: 'stack_chatgpt_main',
  displayName: 'ChatGPT QA Agent',
  provider: 'openai',
  modelDisplayName: 'OpenAI model',
  contextWindowTokens: () => chatGptContextWindow(),
};

export function createChatGptRegistration(
  options: OpenCodeHarnessAdapterOptions = {},
): HarnessAdapterRegistration {
  return createOpenCodeRegistration(
    { ...options, environment: options.environment ?? chatGptEnvironment() },
    CHATGPT_REGISTRATION_IDENTITY,
  );
}

export function createOpenCodeRegistration(
  options: OpenCodeHarnessAdapterOptions = {},
  identity: OpenCodeRegistrationIdentity = {
    stackId: 'stack_opencode_main',
    displayName: 'OpenCode QA Agent',
    provider: 'openrouter',
    modelDisplayName: 'OpenRouter model',
  },
): HarnessAdapterRegistration {
  // Runtime config resolves lazily so registering an unselected stack
  // never throws: only the selected stacks' preflight/adapter paths report
  // OPENCODE_MODEL_NOT_CONFIGURED / OPENCODE_CREDENTIAL_MISSING.
  // Deliberately NOT memoized: runtime.configure can change the binary
  // override after startup, and the next preflight must observe it without
  // a process restart.
  const resolveRuntime = () => resolveOpenCodeRuntime(options);
  const stack = AgentStackDefinitionSchema.parse({
    schemaVersion: 1,
    id: identity.stackId,
    displayName: identity.displayName,
    enabled: true,
    // Placeholder until preflight resolves the real model: the stack
    // definition requires a non-empty modelId, and the authoritative
    // configured value is reported by preflight/runtimeIdentity.
    model: {
      provider: identity.provider,
      modelId: 'unconfigured',
      displayName: identity.modelDisplayName,
    },
    harness: { adapterId: 'opencode', expectedProtocolVersion: 1 },
    execution: { supportsLocalExecution: true },
    policy: { id: 'qa-standard', version: 1 },
  });
  const runtimeIdentity: Partial<AgentRuntimeIdentity> = {
    adapterId: 'opencode',
    adapterVersion: '0.1.0',
    sdkVersion: OPENCODE_TESTED_VERSION,
  };
  return {
    stack,
    preflight: async () => {
      const resolved = resolveRuntime();
      assertSupportedOpenCodeProvider(resolved.provider, options.providerBaseUrl !== undefined);
      if (!openCodeCredentialPresent(resolved.provider, options.environment ?? process.env)) {
        throw new OpenCodeHarnessError(
          'OPENCODE_CREDENTIAL_MISSING',
          'OpenCode credential is missing. Set ' +
            credentialEnvForProvider(resolved.provider, options.environment ?? process.env) +
            ' for provider ' +
            resolved.provider +
            '.',
        );
      }
      // Truthful identity: the EFFECTIVE OpenCode model id (what --model
      // receives) plus the provider it was composed with.
      runtimeIdentity.modelId = resolved.effectiveModelId;
      runtimeIdentity.provider = resolved.provider;
      runtimeIdentity.executable = resolved.executable;
      const environment = options.environment ?? process.env;
      // Shared resolution+probe: the exact executable production launches.
      // Rethrow the original typed probe error so failure codes are unchanged.
      const probed = await probeResolvedOpenCodeExecutable({
        ...(options.executable === undefined ? {} : { executable: options.executable }),
        environment,
        ...(resolved.managedCandidate === undefined
          ? {}
          : { managedExecutable: resolved.managedCandidate }),
      });
      if (!probed.available || probed.version === undefined) throw probed.error;
      const executableVersion = probed.version;
      runtimeIdentity.executableVersion = executableVersion;
      // Fail closed on unverified wire/security contracts.
      assertTestedOpenCodeVersion(executableVersion, environment);
      // Fail closed on missing OS containment (production Linux).
      // Masking always stays hard: the adapter masks fail-closed on every
      // path. SENTRY_OPENCODE_ALLOW_DIRECT=1 (development/test only)
      // relaxes systemd/bubblewrap to warnings, never masking.
      if (process.platform === 'linux') {
        const sandbox = await probeOpenCodeSandbox({ environment });
        const bypassed = openCodeSandboxBypassed(environment);
        const unavailable = (name: string, value: boolean): string =>
          name + '=' + String(value) + (bypassed ? ' (bypassed for development)' : '');
        if (!sandbox.masking) {
          throw new OpenCodeHarnessError(
            'OPENCODE_SANDBOX_UNAVAILABLE',
            'OpenCode project-config masking unavailable; refusing execution.',
          );
        }
        if (!bypassed && (!sandbox.systemdUser || !sandbox.bubblewrap)) {
          throw new OpenCodeHarnessError(
            'OPENCODE_SANDBOX_UNAVAILABLE',
            'OpenCode OS containment unavailable (' +
              unavailable('systemd', sandbox.systemdUser) +
              ' ' +
              unavailable('bwrap', sandbox.bubblewrap) +
              '); refusing production execution.',
          );
        }
      }
    },
    createAdapter: () =>
      new OpenCodeHarnessAdapter({
        ...options,
        ...(options.contextWindowTokens === undefined && identity.contextWindowTokens !== undefined
          ? { contextWindowTokens: identity.contextWindowTokens() }
          : {}),
        onRuntimeIdentity: (identity) => {
          if (identity.harnessVersion !== undefined)
            runtimeIdentity.harnessVersion = identity.harnessVersion;
          if (identity.executableVersion !== undefined)
            runtimeIdentity.executableVersion = identity.executableVersion;
          options.onRuntimeIdentity?.(identity);
        },
      }),
    runtimeIdentity,
  };
}
