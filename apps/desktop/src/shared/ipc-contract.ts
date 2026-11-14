/**
 * Phase 8 typed desktop bridge contract.
 * Renderer sees window.sentry only. Every channel is named, typed, and
 * validated in main with Zod at the boundary. Subscriptions deliver
 * payloads only — never Electron event objects.
 */

export const IPC_CHANNELS = [
  'projects:list',
  'projects:add',
  'projects:cancel-add',
  'projects:cancel-update',
  'projects:get',
  'projects:revisions',
  'projects:update',
  'projects:delete',
  'projects:doctor',
  'projects:suggest-targets',
  'projects:profile',
  'projects:build-profile',
  'projects:toolchain-needs',
  'projects:assess-toolchains',
  'projects:findings-by-revision',
  'projects:export-findings',
  'projects:save-findings-export',
  'runs:export-tests',
  'runs:save-tests-export',
  'ci:export',
  'ci:save-export',
  'projects:toolchain-selection',
  'runs:list',
  'runs:get',
  'runs:status',
  'runs:start',
  'runs:start-production',
  'runs:cancel',
  'runs:export',
  'runs:export-save',
  'runs:export-reveal',
  'doctors:environment',
  'providers:status',
  'providers:save',
  'providers:clear',
  'providers:persist',
  'providers:forget-file',
  'providers:forget-all',
  'providers:detect-binaries',
  'settings:set',
  'production:readiness',
  'system:info',
  'toolchains:status',
  'toolchains:install',
  'toolchains:remove',
  'toolchains:custom-status',
  'toolchains:custom-install',
  'toolchains:custom-remove',
  'openai:account-status',
  'openai:account-login',
  'openai:account-cancel-login',
  'openai:account-logout',
  'system:active-runs',
  'runtime:status',
  'runtime:distros',
  'runtime:select-distro',
  'runtime:reclaim-space',
  'cli:status',
  'cli:set-enabled',
  'app:set-language',
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

export interface WslSpaceResult {
  readonly distro: string;
  readonly diskBytesBefore: number;
  readonly diskBytesAfter: number;
  readonly windowsFreeBytesBefore: number;
  readonly windowsFreeBytesAfter: number;
  readonly reconnected: boolean;
}

export interface DesktopOperation {
  readonly operationId: string;
  readonly runId?: string | undefined;
  // Persisted initial status for async starts (e.g. agents_running): lets
  // CLI callers return the created runId without a follow-up status request.
  readonly status?: string | undefined;
}

export interface DesktopRunSnapshot {
  readonly run: unknown;
  readonly agentRuns: unknown[];
  readonly findings: unknown[];
  readonly evidence: unknown[];
  readonly activities: unknown[];
  readonly events: unknown[];
  readonly targetSpec?: unknown;
}

export type RunSnapshot = DesktopRunSnapshot;

export type RunUpdateKind = 'run-created' | 'run-snapshot' | 'active-runs';

export interface ActiveRunsPayload {
  readonly activeRuns: Array<{ runId: string; projectId: string; status: string }>;
}

export interface RunUpdatePayload {
  readonly kind: RunUpdateKind;
  readonly runId?: string | undefined;
  readonly operationId?: string | undefined;
  readonly snapshot?: RunSnapshot | undefined;
}

export type RunUpdateCallback = (payload: RunUpdatePayload) => void;

export interface ProjectProfileAgent {
  readonly agentStackId: string;
  readonly state: 'none' | 'fresh' | 'stale';
  readonly createdAt?: string;
  readonly text?: string;
  readonly building: boolean;
  readonly error?: string;
}

export interface ProjectProfileStatus {
  readonly projectId: string;
  readonly agents: readonly ProjectProfileAgent[];
}

export interface ToolchainNeedItem {
  readonly packId: string;
  readonly version: string;
  readonly reason: string;
}

export interface ToolchainNeedsAgent {
  readonly agentStackId: string;
  readonly state: 'none' | 'fresh' | 'stale';
  readonly createdAt?: string;
  readonly summary?: string;
  readonly needs?: readonly ToolchainNeedItem[];
  readonly assessing: boolean;
  readonly error?: string;
}

export interface ToolchainNeedsStatus {
  readonly projectId: string;
  readonly agents: readonly ToolchainNeedsAgent[];
}

export interface RevisionFindingItem {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly severity: string;
  readonly confidence: string;
  readonly location: string;
}

export interface RevisionRetestOutcome {
  readonly n: number;
  readonly findingId: string;
  readonly title: string;
  readonly verdict: 'still_reproduces' | 'no_longer_reproduces' | 'cannot_tell';
  readonly details?: string;
}

export interface RevisionTestWritingOutcome {
  readonly n: number;
  readonly findingId: string;
  readonly title: string;
  /** "fails_as_expected" is a good regression test: it ran and catches the problem. */
  readonly verdict: 'fails_as_expected' | 'passes_unexpectedly' | 'could_not_run';
  readonly details?: string;
}

export interface RevisionAgentRunItem {
  readonly runId: string;
  readonly mode: string;
  /** "fast" for a fast run; absent for the usual full depth. */
  readonly depth?: 'fast';
  readonly runStatus: string;
  readonly agentStatus: string;
  readonly at: string;
  readonly findings: readonly RevisionFindingItem[];
  /** Present only in a retest run: the agent's verdict on each earlier finding it was given. */
  readonly retest?: readonly RevisionRetestOutcome[];
  /** Present only in a test-writing run: the framework and how each test ended. */
  readonly testWriting?: {
    readonly framework: string;
    readonly style: 'new-files' | 'patch';
    readonly tests: readonly RevisionTestWritingOutcome[];
  };
}

export interface RevisionAgentItem {
  readonly agentStackId: string;
  readonly runs: readonly RevisionAgentRunItem[];
}

export interface RevisionFindingsItem {
  readonly revisionId: string;
  readonly contentHash: string;
  readonly importedAt: string;
  readonly agents: readonly RevisionAgentItem[];
}

export interface FindingsByRevision {
  readonly projectId: string;
  readonly currentRevisionId: string;
  readonly revisions: readonly RevisionFindingsItem[];
}

export interface ToolchainRequestItem {
  readonly packId: string;
  readonly label: string;
  readonly requested: string;
  readonly offered?: string;
  readonly installed: readonly string[];
  readonly selected?: string;
  readonly state: 'match' | 'fallback' | 'not_installed' | 'not_offered';
}

export interface ToolchainSelection {
  readonly projectId: string;
  readonly items: readonly ToolchainRequestItem[];
}

export interface OpenAiAccountStatus {
  readonly installed: boolean;
  readonly signedIn: boolean;
  readonly bridgeRunning: boolean;
  readonly login: 'idle' | 'waiting' | 'done' | 'failed';
  /** Sign-in link while a login is waiting. */
  readonly loginUrl?: string;
  readonly error?: string;
  readonly version: string;
}

export interface CustomAddonStatus {
  readonly name: string;
  readonly command: string;
  readonly pathEntries: readonly string[];
  readonly installed: boolean;
  readonly installing: boolean;
  readonly installedAt?: string;
  readonly sizeMb?: number;
  readonly error?: string;
}

export interface ToolchainVersionStatus {
  readonly version: string;
  readonly installed: boolean;
  readonly installing: boolean;
  readonly sizeMb?: number;
  readonly error?: string;
  readonly verification?: string;
}

export interface ToolchainPackStatus {
  readonly id: string;
  readonly category: 'language' | 'package' | 'build' | 'qa' | 'infra' | 'database';
  readonly label: string;
  readonly description: string;
  readonly approxSizeMb: number;
  readonly defaultVersion: string;
  readonly note?: string;
  readonly versions: readonly ToolchainVersionStatus[];
}

export interface SentryDesktopApi {
  readonly projects: {
    list(): Promise<unknown[]>;
    add(sourcePath: string): Promise<unknown>;
    cancelAdd?(): Promise<{ cancelled: boolean; count?: number }>;
    cancelUpdate?(): Promise<{ cancelled: boolean; count?: number }>;
    get(projectId: string): Promise<unknown>;
    revisions(projectId: string): Promise<unknown[]>;
    update(projectId: string, sourcePath?: string): Promise<unknown>;
    /** Permanently remove Sentry's stored materials and history; preserve the original source. */
    remove(projectId: string): Promise<{ projectId: string; deleted: true }>;
    doctor(projectId: string): Promise<unknown>;
    suggestTargets(projectId: string): Promise<{ projectId: string; paths: string[] }>;
    /** Each agent's own orientation notes for the project: none, fresh, or stale after an update. */
    profile(projectId: string): Promise<ProjectProfileStatus>;
    /** Starts the agents writing their notes (all, or the listed stacks); returns at once. */
    buildProfile(
      projectId: string,
      agentStackIds?: string[],
    ): Promise<{ projectId: string; started: string[] }>;
    /** What the project's own files ask for, per toolchain, against what is installed. */
    toolchainSelection(projectId: string): Promise<ToolchainSelection>;
    /** What each agent says it would need from the Toolchains library for the project. */
    toolchainNeeds(projectId: string): Promise<ToolchainNeedsStatus>;
    /** Every revision with runs, newest first: each agent's runs and raw findings, kept apart. */
    findingsByRevision(projectId: string): Promise<FindingsByRevision>;
    /**
     * Save the selected findings as a file: opens the native Save As dialog, then writes a Markdown
     * report, a SARIF file or (for GitHub issues) a ZIP. The renderer only names the findings and the
     * format; the destination always comes from the dialog.
     */
    /**
     * Save fixed CI templates (GitHub Actions, GitLab CI or Azure Pipelines) for the written tests as a
     * ZIP: opens the native Save As dialog; the destination always comes from it.
     */
    saveCiExport(
      request: import('@qa/schemas').CiExportRequest,
    ): Promise<
      | { status: 'saved'; path: string; files: number; findingCount: number }
      | { status: 'cancelled' }
    >;
    saveFindingsExport(
      projectId: string,
      request: import('@qa/schemas').FindingExportRequest,
    ): Promise<
      | { status: 'saved'; path: string; files: number; findingCount: number }
      | { status: 'cancelled' }
    >;
    /** Asks the agents (all, or the listed stacks) what they need; returns at once. */
    assessToolchains(
      projectId: string,
      agentStackIds?: string[],
    ): Promise<{ projectId: string; started: string[] }>;
  };
  readonly runs: {
    list(projectId: string): Promise<unknown[]>;
    get(runId: string): Promise<RunSnapshot>;
    status(runId: string): Promise<unknown>;
    /**
     * Start a production QA run (the only execution mode). Consumes provider
     * budget. Requires configured credentials; backend stays authoritative
     * and surfaces structured errors.
     */
    start(
      projectId: string,
      options: {
        mode: 'full' | 'targeted';
        includePaths?: string[];
        instructions?: string;
        agentStackIds?: string[];
        revisionId?: string;
        webAccess?: boolean;
        toolDownloads?: boolean;
        /** How deep the run investigates; fast plans fewer checks. Omitted means full. */
        depth?: 'fast' | 'full';
        useProfile?: boolean;
        /** Re-test findings from earlier revisions on this one; replaces the agents' own planning. */
        retest?: {
          findings: Array<{ runId: string; findingId: string }>;
          who: 'reporter' | 'all';
        };
        /** Write one regression test per finding in this framework; replaces the agents' own planning. */
        testWriting?: import('@qa/schemas').TestWritingRequest;
      },
    ): Promise<DesktopOperation>;
    /** Back-compat alias for start. */
    startProduction(
      projectId: string,
      options: {
        mode: 'full' | 'targeted';
        includePaths?: string[];
        instructions?: string;
        agentStackIds?: string[];
        revisionId?: string;
        webAccess?: boolean;
        toolDownloads?: boolean;
        /** How deep the run investigates; fast plans fewer checks. Omitted means full. */
        depth?: 'fast' | 'full';
        useProfile?: boolean;
        /** Re-test findings from earlier revisions on this one; replaces the agents' own planning. */
        retest?: {
          findings: Array<{ runId: string; findingId: string }>;
          who: 'reporter' | 'all';
        };
        /** Write one regression test per finding in this framework; replaces the agents' own planning. */
        testWriting?: import('@qa/schemas').TestWritingRequest;
      },
    ): Promise<DesktopOperation>;
    cancel(runId: string): Promise<unknown>;
    /**
     * Save the tests a test-writing run kept as one ZIP (a README and the tests): opens the native
     * Save As dialog; the destination always comes from it.
     */
    saveTestsExport(
      runId: string,
    ): Promise<
      | { status: 'saved'; path: string; files: number; findingCount: number }
      | { status: 'cancelled' }
    >;
    exportRun(runId: string, format: 'log' | 'json'): Promise<unknown>;
    /**
     * Native Save As: main shows the dialog, streams the canonical
     * export bytes, and writes the chosen destination atomically.
     * Cancelled dialogs resolve { status: 'cancelled' } — never an error.
     */
    exportSave(
      runId: string,
      format: 'log' | 'json',
    ): Promise<{ status: 'saved'; path: string } | { status: 'cancelled' }>;
    /**
     * Show in folder: reveals a destination this session saved via
     * Export in the OS file manager. Unknown paths are rejected.
     */
    revealExport(path: string): Promise<{ status: 'shown' }>;
  };
  readonly doctors: {
    environment(): Promise<unknown>;
  };
  readonly providers: {
    status(): Promise<
      Array<{
        name: string;
        configured: boolean;
        persistence: string;
        source: string;
        hint: string;
      }>
    >;
    /** Encrypt + persist + load into runtime. The only write mode. */
    save(name: string, value: string): Promise<unknown>;
    clearKey(name: string): Promise<unknown>;
    persist(): Promise<{ path: string; keys: number }>;
    forgetFile(): Promise<{ forgotten: boolean }>;
    forgetAll(): Promise<{ forgotten: boolean }>;
    detectBinaries(): Promise<{
      deepseek: { detected: string | null; configured: string | null; effective: string };
    }>;
  };
  readonly production: {
    readiness(input?: {
      agentStackIds?: string[];
    }): Promise<{ ready: boolean; reasons: string[]; productionWired: boolean }>;
  };
  readonly runtime: {
    status(): Promise<{
      connected: boolean;
      distro: string | undefined;
      hello:
        | {
            protocolVersion: number;
            runtimeVersion: string;
            platform: string;
            isWsl: boolean;
            nodeVersion: string;
            processExecPath: string;
            distro?: string;
            dataRoot: string;
          }
        | undefined;
      lastError: string | undefined;
    }>;
    distros(): Promise<{
      distros: Array<{ name: string; state: string; version: number }>;
      preferred: string | null;
      selected: string | null;
    }>;
    selectDistro(distro: string): Promise<{ saved: string; restartRequired: boolean }>;
    reclaimSpace(): Promise<WslSpaceResult>;
  };
  readonly toolchains: {
    status(): Promise<ToolchainPackStatus[]>;
    install(packId: string, version: string): Promise<{ started: boolean }>;
    remove(packId: string, version: string): Promise<{ removed: true }>;
    /** Add-ons installed with the person's own command, apart from the listed packs. */
    customStatus(): Promise<CustomAddonStatus[]>;
    customInstall(input: {
      name: string;
      command: string;
      pathEntries?: string[];
    }): Promise<{ started: boolean }>;
    customRemove(name: string): Promise<{ removed: true }>;
  };
  readonly openai: {
    accountStatus(): Promise<OpenAiAccountStatus>;
    /** Starts the ChatGPT sign-in; resolves with the link to open in a browser. */
    accountLogin(): Promise<{ url: string }>;
    accountCancelLogin(): Promise<{ cancelled: true }>;
    accountLogout(): Promise<{ signedOut: true }>;
  };
  readonly system: {
    info(): Promise<{ dataRoot: string; versions: Record<string, string> }>;
    activeRuns(): Promise<Array<{ runId: string; projectId: string; status: string }>>;
  };
  readonly cli: {
    status(): Promise<{
      started: boolean;
      pipePath: string;
      error?: string;
      connectedClients: Array<{ id: string; name: string; version?: string; connectedAt: string }>;
    }>;
    setEnabled?(enabled: boolean): Promise<{
      started: boolean;
      pipePath: string;
      error?: string;
      connectedClients: Array<{ id: string; name: string; version?: string; connectedAt: string }>;
    }>;
  };
  readonly subscribe: {
    onRunUpdate(callback: RunUpdateCallback): () => void;
  };
  readonly app: {
    /**
     * Mirror the renderer-selected interface language to the main-process
     * store so native dialogs and the fatal boot screen can translate.
     * Best-effort: the renderer selection applies regardless of the write.
     */
    setLanguage(language: 'en' | 'bg'): Promise<{ saved: boolean; language: 'en' | 'bg' }>;
  };
}
