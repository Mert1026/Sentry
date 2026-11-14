import { contextBridge, ipcRenderer } from 'electron';
import type { RunUpdateCallback, SentryDesktopApi } from '../shared/ipc-contract.js';

interface Envelope {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { code: string; message: string };
}

async function invoke(channel: string, payload: unknown): Promise<never> {
  const response = (await ipcRenderer.invoke(channel, payload)) as Envelope;
  if (response.ok) return response.result as never;
  const error = Object.assign(new Error(response.error?.message ?? 'Desktop operation failed'), {
    code: response.error?.code ?? 'DESKTOP_ERROR',
  });
  throw error;
}

async function pickDirectory(): Promise<string | null> {
  const response = (await ipcRenderer.invoke('sentry:dialog:open-directory')) as Envelope;
  if (response.ok) return (response.result ?? null) as string | null;
  throw Object.assign(new Error('Directory picker failed'), { code: 'DIALOG_FAILED' });
}

const api: SentryDesktopApi & {
  dialogs: {
    pickDirectory(): Promise<string | null>;
    pickTargets(projectId: string, kind: 'files' | 'folder'): Promise<string[]>;
  };
} = {
  projects: {
    list: () => invoke('projects:list', {}),
    add: (sourcePath: string) => invoke('projects:add', { sourcePath }),
    cancelAdd: () => invoke('projects:cancel-add', {}),
    cancelUpdate: () => invoke('projects:cancel-update', {}),
    get: (projectId: string) => invoke('projects:get', { projectId }),
    revisions: (projectId: string) => invoke('projects:revisions', { projectId }),
    remove: (projectId: string) => invoke('projects:delete', { projectId }),
    update: (projectId: string, sourcePath?: string) =>
      invoke(
        'projects:update',
        sourcePath === undefined ? { projectId } : { projectId, sourcePath },
      ),
    doctor: (projectId: string) => invoke('projects:doctor', { projectId }),
    suggestTargets: (projectId: string) => invoke('projects:suggest-targets', { projectId }),
    profile: (projectId: string) => invoke('projects:profile', { projectId }),
    buildProfile: (projectId: string, agentStackIds?: string[]) =>
      invoke(
        'projects:build-profile',
        agentStackIds === undefined ? { projectId } : { projectId, agentStackIds },
      ),
    toolchainNeeds: (projectId: string) => invoke('projects:toolchain-needs', { projectId }),
    toolchainSelection: (projectId: string) =>
      invoke('projects:toolchain-selection', { projectId }),
    findingsByRevision: (projectId: string) =>
      invoke('projects:findings-by-revision', { projectId }),
    saveCiExport: (request: import('@qa/schemas').CiExportRequest) =>
      invoke('ci:save-export', { ...request }),
    saveFindingsExport: (projectId: string, request: import('@qa/schemas').FindingExportRequest) =>
      invoke('projects:save-findings-export', { projectId, ...request }),
    assessToolchains: (projectId: string, agentStackIds?: string[]) =>
      invoke(
        'projects:assess-toolchains',
        agentStackIds === undefined ? { projectId } : { projectId, agentStackIds },
      ),
  },
  runs: {
    list: (projectId: string) => invoke('runs:list', { projectId }),
    get: (runId: string) => invoke('runs:get', { runId }),
    status: (runId: string) => invoke('runs:status', { runId }),
    start: (projectId: string, options) => invoke('runs:start', { projectId, ...options }),
    saveTestsExport: (runId: string) => invoke('runs:save-tests-export', { runId }),
    startProduction: (projectId: string, options) =>
      invoke('runs:start', { projectId, ...options }),
    cancel: (runId: string) => invoke('runs:cancel', { runId }),
    exportRun: (runId: string, format: 'log' | 'json') => invoke('runs:export', { runId, format }),
    exportSave: (runId: string, format: 'log' | 'json') =>
      invoke('runs:export-save', { runId, format }),
    revealExport: (path: string) => invoke('runs:export-reveal', { path }),
  },
  doctors: {
    environment: () => invoke('doctors:environment', {}),
  },
  providers: {
    status: () => invoke('providers:status', {}),
    save: (name: string, value: string) => invoke('providers:save', { name, value }),
    clearKey: (name: string) => invoke('providers:clear', { name }),
    persist: () => invoke('providers:persist', {}),
    forgetFile: () => invoke('providers:forget-file', {}),
    forgetAll: () => invoke('providers:forget-all', {}),
    detectBinaries: () => invoke('providers:detect-binaries', {}),
  },
  production: {
    readiness: (input?: { agentStackIds?: string[] }) =>
      invoke(
        'production:readiness',
        input?.agentStackIds === undefined ? {} : { agentStackIds: input.agentStackIds },
      ),
  },
  toolchains: {
    status: () => invoke('toolchains:status', {}),
    install: (packId: string, version: string) => invoke('toolchains:install', { packId, version }),
    remove: (packId: string, version: string) => invoke('toolchains:remove', { packId, version }),
    customStatus: () => invoke('toolchains:custom-status', {}),
    customInstall: (input: { name: string; command: string; pathEntries?: string[] }) =>
      invoke('toolchains:custom-install', input),
    customRemove: (name: string) => invoke('toolchains:custom-remove', { name }),
  },
  openai: {
    accountStatus: () => invoke('openai:account-status', {}),
    accountLogin: () => invoke('openai:account-login', {}),
    accountCancelLogin: () => invoke('openai:account-cancel-login', {}),
    accountLogout: () => invoke('openai:account-logout', {}),
  },
  system: {
    info: () => invoke('system:info', {}),
    activeRuns: () => invoke('system:active-runs', {}),
  },
  cli: {
    status: () => invoke('cli:status', {}),
    setEnabled: (enabled: boolean) => invoke('cli:set-enabled', { enabled }),
  },
  app: {
    setLanguage: (language: 'en' | 'bg') => invoke('app:set-language', { language }),
  },
  runtime: {
    status: () => invoke('runtime:status', {}),
    distros: () => invoke('runtime:distros', {}),
    selectDistro: (distro: string) => invoke('runtime:select-distro', { distro }),
    reclaimSpace: () => invoke('runtime:reclaim-space', {}),
  },
  subscribe: {
    onRunUpdate: (callback: RunUpdateCallback) => {
      const isRunUpdate = (value: unknown): value is Parameters<RunUpdateCallback>[0] => {
        if (typeof value !== 'object' || value === null) return false;
        const kind = (value as { kind?: unknown }).kind;
        return kind === 'run-created' || kind === 'run-snapshot';
      };
      const listener = (_event: unknown, payload: unknown) => {
        if (isRunUpdate(payload)) callback(payload);
      };
      ipcRenderer.on('sentry:run-update', listener as never);
      const activeListener = (_event: unknown, payload: unknown) => {
        if (!Array.isArray(payload)) return;
        const activeRuns = (payload as unknown[]).filter(
          (item): item is { runId: string; projectId: string; status: string } =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { runId?: unknown }).runId === 'string',
        );
        callback({ kind: 'active-runs', snapshot: { activeRuns } } as never);
      };
      ipcRenderer.on('sentry:active-runs', activeListener as never);
      return () => {
        ipcRenderer.removeListener('sentry:run-update', listener as never);
        ipcRenderer.removeListener('sentry:active-runs', activeListener as never);
      };
    },
  },
  dialogs: {
    pickDirectory,
    pickTargets: (projectId, kind) => invoke('sentry:dialog:pick-targets', { projectId, kind }),
  },
};

contextBridge.exposeInMainWorld('sentry', api);

declare global {
  interface Window {
    readonly sentry: typeof api;
  }
}
