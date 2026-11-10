# Changelog

## [Unreleased]

- Fix three findings from run `run_01M727R5E0B1H9Y2214H7FFS22`:
  - A symlink whose target contains a backslash is now copied exactly on Linux and macOS (it was
    rewritten to a forward slash, so the copy pointed at a different file). Windows still treats a
    backslash as a path separator. A project with such a link gets a different revision hash on
    its next import.
  - The human-readable log keeps every entry on one line: line breaks and control characters in
    finding titles and other free text become spaces, so a title can no longer forge a status line.
    The JSON export is unchanged.
  - A stored artifact whose path names the data root itself (for example `.`) is refused before its
    database row is deleted.
- Reasoning effort for every agent, in Settings → Providers: each agent card has its own
  "Reasoning effort" choice with the levels that agent's tool takes (OpenCode and ChatGPT: low,
  medium, high; GLM through Claude Code: low to maximum; DeepSeek: off, low, high, maximum).
  "Default" passes nothing and the provider decides. The setting applies to every run of that
  agent. It is not yet recorded on the run, and GLM and DeepSeek effort has not been exercised
  against the live providers.

## [2.0.0] - 2026-11-09

Major release. It removes the merge, verification, issue and retest features of 1.x
(migration 7 is one-way) and adds staged QA, project profiles, toolchains, re-test of
earlier findings, ChatGPT as an opt-in agent, CLI parity and Bulgarian translations.
See the [release notes](docs/releases/v2.0.0.md).

- ChatGPT is an opt-in agent (API key or signed-in ChatGPT account); the default agents
  stay OpenCode, DeepSeek and GLM.
- CLI parity: `run start --retest/--profile/--tools/--revision`, `project findings`,
  `project profile`, `project profile-build` and `toolchain status|install|remove`.
- The re-test tab on a run shows each finding as Passed, Not passed or Could not complete,
  with the agent's reason. Re-test answers are strict: Passed only when the agent re-ran
  the check and saw different behaviour.
- Info buttons on the project profile page open boxes with dropdown sections.
- Bulgarian translations now cover text built at run time, every status word in any case,
  and the run graph node labels.
- Project copy, update, delete and recovery refuse symbolic links below the data root and
  never follow them; files named like generated folders are kept on import.
- Toolchain dropdowns slide open and closed.
- Remove the merger and verifier packages and the merge, verification, issue and
  retest services, RPCs, CLI commands (`run merge`, `issue`, `retest`, `verify`)
  and Desktop pages. See [ADR 0015](docs/adr/0015-remove-merge-verification-issue-retest.md).
- Add persistence migration 7: drops the merge, verification, issue and retest
  tables and legacy retest runs. Full and Targeted runs, findings, evidence and
  exports are kept; issue and retest history is not.
- Move the workspace-preparation sandbox into `@qa/run-engine`.
- Staged QA flow: frozen plan, host-driven per-check investigation, deepening,
  hazard sweep and report, with a proof gate and an operation receipt.
- Project profile: per-agent orientation notes for a project, a "Use project
  profile" run option, and a profile-usage record on each run. Notes are labelled
  unverified and never store past findings.
- Missing-tools ladder: run it, otherwise a labelled `[replica]`, otherwise a
  labelled `[traced]` fallback. Replica and trace results can never certify a pass.
- Toolchain packs (Settings → Toolchains): host-side installs of Python (uv), .NET,
  Rust, Go and Java, mounted read-only into OpenCode tool shells. Each run picks the
  project's pinned version (global.json, target framework, go.mod, .python-version,
  rust-toolchain, pom, .nvmrc, .ruby-version, composer.json, .tool-versions) and falls
  back to the pack default. The library now also has newer versions of those five, plus
  Node.js, Bun, Deno, Ruby, PHP, Swift, Dart, Elixir, Kotlin, Scala (sbt), a C / C++
  toolchain (gcc, make, cmake, ninja), Zig, Gradle, utilities, PostgreSQL, MySQL, Redis
  and SQLite. Most install with micromamba from conda-forge, with no root.
- Retest: in "Findings by revision", tick findings of an older revision and re-test them on the
  current one. Each finding becomes one fixed check, given to the agent that reported it (or to all
  chosen agents). A finding is only "No longer reproduces" when the agent re-ran it and saw
  different behaviour; a probe that does not build, or cannot run, is "Cannot tell". The verdicts
  sit in the retest run and never change the original finding. A retest always runs on the
  current revision, and does no lead follow-ups, deepening or hazard sweep.
- Toolchains library grows from 23 to 59 packs in six groups (languages, package managers,
  build tools, QA and security tools, infrastructure, databases and services): pnpm, Yarn,
  Poetry, PDM, pipx; Bazelisk, just, Task, Meson, protoc, Buf, Autotools; Ruff, ShellCheck,
  actionlint, Trivy, OSV-Scanner, yamllint, Biome, SQLFluff, Checkov; OpenTofu, Terraform,
  kustomize, Ansible; MongoDB, DuckDB, RabbitMQ, NATS; R, Julia, Lua, Perl, PowerShell, OCaml,
  Clojure. The page has search and an "installed only" filter.
- Toolchain installs now end by running what they installed; the first lines it printed are
  kept as the installed version and shown on the page. The Node pack no longer claims Corepack,
  pnpm or Yarn, which its check never proved; pnpm and Yarn are separate packs.
- The project page shows what the project's own files ask for (including the `packageManager`
  line of package.json and Poetry's lockfile), what is installed and what a run would use, and
  flags a mismatch instead of silently falling back.
- Custom add-ons (Settings → Toolchains): install a program with your own shell command. It runs
  on the host, not in an agent sandbox, into its own folder under `toolchains/custom/`. Its program
  folders go on PATH after every listed toolchain, so an add-on never replaces a listed tool.
- "Findings by revision" on the project page: pick a revision and see what each agent reported in
  each run on it, as raw lists. A new revision starts a fresh list; older ones stay to browse.
  Nothing is merged or matched, and agents never see the lists.
- "Toolchains the agents need" on the project page: every agent reads the project once and
  names the Toolchains library entries it would need (runtime versions, compilers, build tools,
  databases). The answers sit next to what is installed, with Install buttons. Advice only:
  nothing installs until pressed and runs do not change.
- Per-run "Allow tool and SDK downloads" option widens the shell allowlist to
  official vendor hosts. Package registries stay allowed in every run.
- OpenCode tool shells hide Windows drives, `/mnt` and the WSL interop socket, set
  `XDG_RUNTIME_DIR` to the private tmp, and stop .NET build servers from holding the
  shell's output pipe open until the tool timeout.
- Claude Code and DeepSeek runs now get the installed toolchains on PATH (with the project's pinned versions) and the same tool and SDK download guidance as OpenCode. DeepSeek's sandbox has no network policy, so its host list is guidance, not enforced.
- Compatibility: see [docs/beta/compatibility.md](docs/beta/compatibility.md).

## [1.0.2] - 2026-10-16

- Ship the production CLI frontend and command forwarding in Windows archives,
  using the included Electron runtime without Windows Node/pnpm/Git.
- Preserve opaque arguments, UTF-8 machine output, stderr and exit codes; use the
  existing Desktop broker and canonical runtime with no development DB fallback.
- Require the CLI payload in archive inventory validation; include CLI.md with
  complete project, QA, status/cancellation, result and JSON/log export examples.
- Consolidate active documentation, retain historical evidence at immutable tags,
  and add explicit existing-install upgrade guidance and generic automation wording.
- Align product/Desktop/runtime/CLI/launcher identity to1.0.2; protocol1, schemas,
  migrations, provider pins, secure settings and history formats are unchanged.
- Earlier published ZIPs and tags remain immutable. See [release notes](docs/releases/v1.0.2.md).

## [1.0.1] - 2026-10-15

- Fix imports and updates of Python/Next/Nuxt working directories containing
  unreadable generated caches. Preserve existing revision hash compatibility.
- Report permission failures with their path and provide actionable disk-space
  diagnostics instead of a generic managed-copy error.
- Register the packaged Windows `sentry` command during successful setup, with
  explicit `register-command` repair, safe path/argument handling and exit codes.
- Align product, Desktop, runtime, CLI and launcher identity to `1.0.1`; retain
  protocol `1`, schemas, migrations, provider pins and credential contracts.
- Keep the original v1.0.0 tag and downloads unchanged. See
  [patch notes](docs/releases/v1.0.1.md) and the official Release page for assets.

## [1.0.0] - 2026-10-15

- Reconcile root, Desktop, runtime, CLI and source launchers to stable `1.0.0`.
- Preserve runtime protocol `1`, schemas/migrations, provider/model/tool pins and
  existing project/history/credential contracts.
- Integrate owner-merged Phase 6.5 WSL maintenance hardening: fixed inline UAC
  execution, private ACL/path checks and authenticated atomic operation receipts.
- Windows 11 x64 + WSL2 only; unsigned ZIP with online runtime bootstrap. Native
  Linux Desktop deferred. No public RC, automatic updater or signed installer.
- See [stable notes](docs/releases/v1.0.0.md) and the
  [verification handoff](https://github.com/Mert1026/Sentry/blob/v1.0.0/docs/releases/v1-phase-6-6-stable-readiness.md).
  Published Windows Stable; original preparation receipts keep their historical scope.

## [1.0.0-rc.1] - Historical internal Windows preparation (never published)

- Initial release target: Windows 11 x64 with WSL2 (Ubuntu preferred).
- Native Linux Desktop: DEFERRED — FUTURE NATIVE LINUX RELEASE; existing
  CachyOS implementation, results and unresolved import evidence retained.
- Windows Electron continues using the Linux execution runtime, systemd user
  services, bubblewrap, existing protocol and secure DPAPI storage.
- Windows unsigned ZIP review packaging is independent of native Desktop
  packaging; shared Linux runtime/security validation remains required.
- Correct packaged PowerShell WSL-mode forwarding and visible Desktop launch.
- Ground DeepSeek persistent Bash outcomes in explicit tool completion evidence;
  retain strong-finding evidence validation and fail closed on unknown outcomes.
- Confirmed project removal with managed-data/history cleanup, active-operation
  refusal, missing-folder handling and preservation of original source folders.
- Explicit Windows WSL disk reclamation, administrator consent, other-distro
  refusal, bounded disk-lock release waiting and Desktop reconnection.
- Freeze verification and exact-source private Windows archive provenance in the
  [Phase 6.3 handoff](https://github.com/Mert1026/Sentry/blob/v1.0.0/docs/releases/v1-phase-6-3-windows-rc-freeze.md).
- Recovery Option A remains limited to the exact historical corrected I1 pair
  and tested Windows account/machine/DPAPI context. Original-beta rollback FAIL
  is retained. No new version bump, official RC publication or updater.

See the [Windows draft notes](https://github.com/Mert1026/Sentry/blob/v1.0.0/docs/releases/v1.0.0-rc.1.md).

## [0.1.0-beta.1] - 2026-10-09 (historical)

First source-based beta candidate. Publication/gate status is recorded in the
[validation report](https://github.com/Mert1026/Sentry/blob/v1.0.0/docs/releases/v0.1.0-beta.1-validation.md).

### Included

- Electron/React Desktop, projects, immutable revisions, independent findings,
  evidence inspection and persistent history.
- Windows 11 + WSL2 and native CachyOS setup, launchers, diagnostics,
  versioned Linux runtime deployment and handshake validation.
- OpenCode 1.18.32, DeepSeek SDK 0.1.5-rc.2 and GLM through Claude Code
  2.1.270; Full/Targeted QA and cancellation.
- JSON/log export, Save As, CLI control and Desktop provider settings.

### Stabilization

- Setup/update blocks failed graceful shutdown on both hosts.
- Electron quit awaits bootstrap and runtime cleanup.
- Linux launch detects immediate Electron failure with log guidance.
- Runtime staging excludes local credentials, databases and logs.
- Verifier path portability and Claude argv fixture corrections.
- CLI version alignment, pinned beta installs and explicit development updates.
- Release/hotfix CI and owner review policy.

### Limitations

- Source installation; no signed installer/tested binary bundle.
- Provider accounts/credit required; failures can prevent 3/3 completion.
- Beta tags stay pinned; `sentry update` follows the selected source channel (`dev` tracks `origin/dev`, `main` tracks `origin/main`).
- Sandbox proofs require capabilities absent on some runners.
- Legacy merge/verification ingestion is outside current Desktop RPC.
- Private repository access required for testers.
