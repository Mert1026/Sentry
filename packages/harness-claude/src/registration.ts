import { AgentStackDefinitionSchema, type AgentRuntimeIdentity } from '@qa/schemas';
import type { HarnessAdapterRegistration } from '@qa/harness-protocol';
import { ClaudeAgentHarnessError } from './errors.js';
import { ClaudeAgentHarnessAdapter, type ClaudeAgentHarnessAdapterOptions } from './adapter.js';
import {
  assertClaudeAuthConfigured,
  assertClaudeEndpointConfigured,
  probeClaudeExecutable,
  resolveClaudeExecutableIdentity,
  resolveClaudeRuntime,
} from './discovery.js';
import { CLAUDE_CODE_TESTED_VERSION } from './sdk.js';

export function createClaudeRegistration(
  options: ClaudeAgentHarnessAdapterOptions = {},
): HarnessAdapterRegistration {
  // Runtime config resolves lazily so registering an unselected stack
  // never throws: only the selected stacks' preflight/adapter paths report
  // CLAUDE_MODEL_NOT_CONFIGURED.
  let runtime: { modelId: string; executable: string } | undefined;
  const resolveRuntime = () => (runtime ??= resolveClaudeRuntime(options));
  const stack = AgentStackDefinitionSchema.parse({
    schemaVersion: 1,
    id: 'stack_claude_main',
    displayName: 'Claude QA Agent',
    enabled: true,
    // Placeholder until preflight resolves the real model: the stack
    // definition requires a non-empty modelId, and the authoritative
    // configured value is reported by preflight/runtimeIdentity.
    model: {
      provider: 'anthropic',
      modelId: 'unconfigured',
      displayName: 'Claude',
    },
    harness: { adapterId: 'claude', expectedProtocolVersion: 1 },
    execution: { supportsLocalExecution: true },
    policy: { id: 'qa-standard', version: 1 },
  });
  const runtimeIdentity: Partial<AgentRuntimeIdentity> = {
    adapterId: 'claude',
    adapterVersion: '0.1.0',
    // sdkVersion names the TESTED Claude version (honest label: this is
    // what Sentry validated, not necessarily what runs). The actual
    // binary version rides in executableVersion (probed) and in the
    // CLAUDE_VERSION_UNVERIFIED run warning on drift.
    sdkVersion: CLAUDE_CODE_TESTED_VERSION,
  };
  return {
    stack,
    preflight: async () => {
      const resolved = resolveRuntime();
      assertClaudeEndpointConfigured(options.environment ?? process.env);
      assertClaudeAuthConfigured(options.environment ?? process.env);
      runtimeIdentity.modelId = resolved.modelId;
      runtimeIdentity.executable = resolved.executable;
      try {
        const identity = await resolveClaudeExecutableIdentity(
          resolved.executable,
          options.environment ?? process.env,
        );
        runtimeIdentity.executable = identity.resolved;
        if (identity.version !== undefined) runtimeIdentity.executableVersion = identity.version;
      } catch (identityError) {
        if (identityError instanceof ClaudeAgentHarnessError) throw identityError;
        runtimeIdentity.executableVersion = await probeClaudeExecutable(
          resolved.executable,
          options.environment ?? process.env,
        );
      }
    },
    createAdapter: () =>
      new ClaudeAgentHarnessAdapter({
        ...options,
        // Probed at preflight (runs before createAdapter): lets the run
        // emit CLAUDE_VERSION_UNVERIFIED on tested/actual drift.
        ...(runtimeIdentity.executableVersion === undefined
          ? {}
          : { executableVersion: runtimeIdentity.executableVersion }),
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
