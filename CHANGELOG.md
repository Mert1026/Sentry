# Changelog

## [Unreleased]

- **More fixes from a second QA run on Sentry's own code.** Stored events now have secrets removed from the text of
  commands, tool summaries and errors, status, warnings, failures, cancel reasons and test suites, not only from
  messages, plans and findings. The redactor also catches a token after an underscore (`GH_ghp_…`), camelCase
  names such as `dbPassword`, and a value followed by `&` in a URL. A failed workspace creation removes the
  partial workspace it wrote. The check that a data root does not sit inside the project follows a link even
  when two or more of its folders do not exist yet. The Claude sign-in refuses an account folder that is a link,
  and the Claude agents delete their disposable home only when Sentry made it.
- **Fixes from a QA run on Sentry's own code.** The Markdown export now escapes brackets and angle brackets
  in findings, so an agent's text cannot form a link, an image or an HTML tag (the file's own promise).
  Secret redaction now also covers investigation plans and hypotheses, `Bearer` and `Basic` credentials,
  `Cookie` headers, bare `token=` and `password=` values (with prefixed names such as `GITHUB_TOKEN`),
  JSON fields and quoted values with spaces, and every harness runs the shared redactor too; plain prose
  and code such as `password = get_password()` are left alone. A toolchain or add-on marker of the wrong
  shape counts as not installed instead of throwing, an add-on program folder that is a link leading
  outside the add-on is refused, a project id must name one project folder, and workspace cleanup removes
  only agent workspaces.
- **The stages in an agent's details are a timeline.** Each stage has a marker joined to the next by a line,
  its name, and a coloured state badge (completed green, observed grey-green, active yellow, warning, failed
  red, not reached dashed), with the count of stages reached in the heading. Long names wrap on a narrow
  panel instead of being cut off.
- **A clearer agent box on the run canvas.** Each box has a fixed width and every line is trimmed to it,
  so long model names and translated words no longer spill out. It shows the name, the model without its
  provider prefix, a status badge with the elapsed time, the stage bars across the full width with how many
  stages are done and where the agent is, the live activity line while it works, three equal cells for
  findings, evidence and the secrets light, and a thin bar of the findings by severity.
  A **Legend** button on the canvas toolbar opens a dropdown that names the colour of every stage bar and
  every severity in the findings bar, one per line with its full word. It closes on a click elsewhere,
  on Escape or on the button.
- **A tidier Overview on the run page.** It now shows only what the page does not already show: the run
  status, mode, run depth, time limit, the add-ons and the agent counts. The add-ons (web access, tool
  and SDK downloads, secrets check, project profile) are one list with a clear On or Off for each, and the
  secrets check is listed for every production run. The per-agent rows, the progress bar and the
  snapshot ids are gone because the canvas and the run header already show them.
  "Agents rated these differently" is a section of its own, and it no longer ties two different issues
  together because one long title touches both (for example a code execution finding and a duplicate-keys
  finding that only shared the word "attacker").
  When the panel is dragged narrow the add-ons become a row of coloured icons (green on, dim off, a
  tooltip names each), the small tiles keep their value, and the agent counts keep a short word under
  the number (the words go only in a very narrow panel). Selected and Running have clearer icons.
- **Token counts mean the same for every agent.** Input is now the whole prompt (new tokens plus cache
  reads and writes) and cached is the cached part of it, so Claude no longer shows a few hundred input
  tokens next to the others' hundreds of thousands. OpenCode and ChatGPT count their reasoning tokens
  as output, which they used to leave out. Numbers for new runs are larger than before; old runs keep
  the figures they were stored with.
- **Agents that report in a fresh session keep the lines they read.** Each file read was cut to 260
  characters before the report stage, and the long workspace path used most of that, so OpenCode and
  ChatGPT saw no line numbers (every finding said line 1) and listed the output as truncated. Reads now
  keep up to 1,500 characters, without the workspace path.
- A **Claude** agent, the fifth, opt-in like ChatGPT. It runs the official Claude Code app against
  Anthropic itself, in its own harness package (`@qa/harness-claude`), so it is fully apart from the
  GLM agent: GLM keeps its Z.AI endpoint and token, and the Claude agent never receives them (its
  child environment strips them, and a test checks it). Under **Settings → Providers → Claude** a
  switch, like ChatGPT's, chooses how it signs in: an Anthropic API key, or **Claude account**.
  Account sign-in is **Sign in with Claude**: Sentry runs Anthropic's own `claude setup-token` in
  the Linux runtime, shows the sign-in link, and you paste back the code the page shows (no
  third-party bridge). The one-year token it returns stays in a private file in the runtime data
  folder and goes only to the Claude agent; **Sign out** deletes it. The model and reasoning effort
  are its own (`SENTRY_ANTHROPIC_MODEL`, `SENTRY_ANTHROPIC_REASONING`). It shares the
  Sentry-managed Claude Code binary with GLM and nothing else. In the CLI it is `claude` (`--agents claude`, `agent doctor claude`,
  `settings effort claude …`). `sentry setup` and `sentry doctor` now also check the util-linux `script` tool the
  account sign-in needs (a warning if it is missing; the API key sign-in does not need it).
- The CLI now has what the app has. New commands: `project suggest-targets` (paths for a targeted run),
  `project toolchain-needs`, `project toolchain-selection` and `project toolchain-assess` (the Setup tab's
  toolchain needs; the last one asks the agents and uses provider budget), and `toolchain custom status|remove`
  (custom add-ons). Installing a custom add-on stays app-only on purpose, because it runs a shell command the
  caller supplies. `sentry doctor` now reports the headless browser agents use (PASS with the Chrome version
  once it rendered a test page just now, or a warning if it is missing or unusable), and `capabilities` lists
  the new features so scripts can detect them.
- Notes for the agents. Before a run, **Run QA** now has a **Notes for the agents** box: what to focus on,
  known problems, things to leave alone. One note goes to every agent, or a switch gives each selected
  agent a note of its own (an agent only ever sees its own). The agents treat it as your instruction but
  still have to prove every finding, and a note cannot switch off the safety rules, the network limits or
  the secrets check. A new run always starts with empty notes. The notes are saved with the run, shown in
  the run summary and on each agent's page as **User description / note**, and included in findings
  exports under the same heading (Markdown, JSON and plain text). Re-test runs take no notes. Behind the
  box, the run API gained `agentInstructions` (a note per agent); `sentry cli run start --instructions`
  keeps sending one note to everyone.
- Export in **Findings by revision** now works, and saves one .md, .json or .txt file. Pressing Export
  failed with `Unknown runtime method: projects.exportFindings`: the runtime only accepts methods on
  its allowed list, and this one was never added to it, so the export (and `sentry cli project
export-findings`) could not run at all. The list and the handlers are now checked against each
  other by a test. The export formats are Markdown (.md), JSON (.json) and plain text (.txt),
  replacing GitHub issues (ZIP) and SARIF, so every export is a single file.
- The hazard sweep no longer scans what an agent unpacked into its workspace. After the planned checks,
  Sentry probes the riskiest-looking source files, but it walked the live workspace, so a Go SDK an
  agent had downloaded into a plain `go/` folder outranked the five real project files. In a reviewed
  run that sweep spent about 25 minutes on the Go standard distribution and one agent recorded two
  findings about it. The sweep now only looks at files that existed before the agent started.
- A provider's safety filter at the report stage is now named for what it is. When OpenAI's filter flags a security-testing run ("flagged for possible cybersecurity risk") while an agent writes its report,
  the agent used to fail with a generic `OPENCODE_START_FAILED` and a cut-off message. It now fails with `OPENCODE_PROVIDER_REFUSED`, says the provider declined the content (not an outage or a
  credential problem), that retrying does not help, and shows the provider's own explanation, which can name its permissive-access program for authorized security work. The agent's finished checks are
  still kept in the run's Activity as `[not reported]`; they are unverified and never recorded as findings.
- Agents now have a real headless browser. Until now agents could not get one (browser downloads are
  skipped and their hosts are outside the network allowlist), so checks on web pages (narrow-viewport
  overflow, focus order, mobile menus, link targets) ended `inconclusive` on hand-built replicas.
  `sentry setup` and `sentry update` now install one managed browser (Chrome headless shell and
  `puppeteer-core`, plus the few system libraries a minimal host lacks; rootless, about 350 MB, once)
  under `~/.local/share/sentry/tools/browser`, and the check prompt of OpenCode, ChatGPT, DeepSeek and
  GLM tells agents how to use it. If the install fails, setup warns and continues; agents run as before.
  In a reviewed run, the one agent that found a browser on its own needed about 30 commands to do it.
- Agents no longer reinstall dependencies that Sentry already installed. Sentry prepares each agent's
  workspace (`node_modules`) before a run, but agents then ran a plain `pnpm install`, which deleted and
  recreated it: 135-145 s per agent in a reviewed run, and when the tool timed out the workspace was left
  half rebuilt, which cost one agent its executable checks. The check prompt now says the dependencies are
  already there, why not to reinstall them, and what to run instead (for example a scoped
  `pnpm --filter <package>... build`); an install is still allowed once a command proves a dependency is
  missing.
- A failed report no longer loses a finished investigation. When an agent has investigated but its report
  cannot be produced (a quota or billing error, a provider outage, an invalid answer), its own closing
  statement for each check is kept in the run's Activity as `[not reported] ...`, with a line saying why.
  They are unverified and never recorded as findings or evidence. In a reviewed run a DeepSeek agent lost
  6.6 minutes of paid investigation to an `Insufficient Balance` error at its report stage.
- An OpenCode or ChatGPT agent whose first turn fails to start before reaching the provider (for example
  `Unexpected server error. No upstream requests were relayed`) is retried once with a fresh OpenCode
  server. If the second try fails the same way, the message says nothing reached the provider, that the
  retry also failed, and to check the sign-in or API key in Settings → Providers.
- A silent agent no longer holds a finished run for long: once every other agent of a run has
  finished, an agent that stops sending events is stopped after 5 minutes instead of 15 (a run with
  one agent is unchanged). The failure now says "Agent stopped responding" and why, not "exceeded run
  budget". In a reviewed run one hung GLM turn kept a run open for about 42 minutes after the other
  agents had finished or failed.
- GLM sandbox: a system that lets bubblewrap start but refuses the nested user namespace the Claude Code
  sandbox needs (`apply-seccomp: write /proc/self/setgroups ... Permission denied`) is now detected on the
  first command, and the failure explains the likely cause and where to read more. `sentry setup` and
  `sentry doctor` now test that nested step too and report `nested-user-namespaces-blocked` before a run
  is wasted. New troubleshooting entry: "GLM sandbox starts but commands fail".
- Run depth: a **Fast** run now plans at most 2 checks (was 3) and skips the deepening round and
  the hazard sweep after them (a second pass on undecided checks still runs), so it is much shorter.
  In one measured run those two extras were about 55% of a 36-minute Fast run, and a Fast run
  without them took about 15 minutes with 3 checks. **Full** is unchanged.
- Run option **Check for secrets** (on by default; CLI `run start --no-secrets`): turn it off for the
  shortest run. No search is made and no secrets light is shown, and the run records that the check
  was off. A Fast run without it takes about 5 minutes.
- Secrets light: every QA run now makes each agent also search the project for hard-coded secrets
  (passwords, API keys, tokens, private keys, credentials in connection strings). Each agent's box
  on the run page shows a light: red when it found some, green when it searched and found none,
  amber when it could not check fully. The agent's own explanation (the places and kinds, never the
  values) is in the agent's Overview. Known secret formats are removed from agent messages, findings
  and evidence before they are stored. The check adds one check per agent, so a run takes slightly
  longer; re-test runs and simulations are unchanged.

- Export findings: in **Findings by revision**, tick findings (or use **Export all in this
  revision**) and save them as one file: a Markdown report (.md), a JSON document (.json) or plain
  text (.txt). The files are built from what the agents reported, with no AI, nothing is sent anywhere and nothing is
  written into your project. CLI: `project export-findings`. Up to 500 findings per export;
  re-testing is unchanged.

## [2.0.1] - 2026-11-10

Update from 2.0.0. It adds run depth (Fast / Full), a default run time limit, per-agent reasoning
effort and new CLI settings commands, and fixes three bugs found by a QA run. No database
migration, and the runtime protocol stays 1. See the [release notes](docs/releases/v2.0.1.md).

- The Environment page and the project page's agent cards show each agent's selected reasoning
  effort; the ChatGPT sign-in choice (API key or ChatGPT account) is a two-button control like Run
  depth.
- Bulgarian translations cover every run and agent status word, text built at run time and the run
  graph labels. The Details page no longer shows elapsed time, the overview no longer prints the
  total findings and evidence line, and the agent box footer has no clock. A stage where an agent
  hit a warning blinks as calm yellow stripes instead of going plain.
- The CLI help lists every command (it had listed the removed `issue` and `retest` commands).
- CLI: `settings show`, `settings effort <agent> <level|default>` and `settings run-limit
<default|3h|6h|none|90m|12h>` read and change an agent's reasoning effort and the default run time
  limit (the broker accepts only those two settings). `run list` and `run status` report each run's
  `depth` and `timeLimitMs`, fast runs are marked `FAST`, and `capabilities` reports `settings` and
  `runDepth`.
- Run depth: choose **Fast** or **Full** when starting a run (project page, or
  `run start --depth fast|full`). Full (the default) plans as before, one check per 25 minutes of
  the window up to 8 (6 for the default 3 hours); Fast plans at most 3. Both use the same time window and the same extra passes. The depth is recorded on the run.
- Default run time limit in Settings → Runtime: 3 hours (default), 6 hours, No limit or a custom
  value. It is the window every run gets unless `--timeout-ms` names its own. The window is a
  ceiling, and it also decides which extra passes have time to run. "No limit" is 7 days, and the
  longest window a run can now be given is 7 days (it was 12 hours). The CLI help and CLI docs said
  the default window was 30 minutes; it has been 3 hours.
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
