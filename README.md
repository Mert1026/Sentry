# Sentry

Sentry is a local-first AI QA desktop application. Several AI agents each
investigate the same immutable snapshot of your project on their own and report
findings, evidence, token usage and a persistent run history. Findings are never
merged or ranked across agents, so you can compare what each one found.

**Stable release:** [Sentry v2.0.1 — Windows](https://github.com/Mert1026/Sentry/releases/tag/v2.0.1)
for **Windows 11 x64 with WSL2** (Ubuntu preferred). The ZIP is unsigned and uses an
online Linux runtime bootstrap. Native Linux Desktop is deferred.
Version 2.0 removes the 1.x merge, verification and issue features and keeps your
Full and Targeted runs. Already on 2.0.0? See [Updating from 2.0.0](#updating-from-200).
What changed: [What's new](#whats-new).

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install and start](#install-and-start)
- [Configuration](#configuration)
- [Run QA](#run-qa)
- [Re-test earlier findings](#re-test-earlier-findings)
- [Toolchains](#toolchains)
- [CLI automation](#cli-automation)
- [Security and recovery](#security-and-recovery)
- [What's new](#whats-new)
- [Updating from 2.0.0](#updating-from-200)
- [Documentation and development](#documentation-and-development)

## Features

| Area                 | What it does                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Independent agents   | OpenCode, DeepSeek and GLM (through Claude Code) by default; ChatGPT is opt-in. Each agent works alone on the same snapshot. |
| Run modes            | Full QA for the whole project, or Targeted QA for chosen paths.                                                              |
| Evidence             | Findings with evidence, token usage and exports as JSON or log files.                                                        |
| Findings by revision | Browse what every agent reported in every run, per project revision. Nothing is merged or matched between runs.              |
| Re-test              | Pick findings from an older revision and check, on the current one, whether each is resolved and why not if it is not.       |
| Project profile      | Optional per-agent orientation notes for a project, labelled unverified and never containing past findings.                  |
| Toolchains           | A library of 59 host-side installable packs in six groups, plus custom add-ons.                                              |
| CLI                  | A packaged `sentry cli` that drives the running Desktop with machine-readable JSON.                                          |
| Languages            | The interface is available in English and Bulgarian (Settings → Application).                                                |
| Local-first          | Projects and history stay on your machine; the original source folder is never changed.                                      |

## Requirements

- Windows 11 x64 with WSL2 (Ubuntu preferred).
- Windows Node, pnpm and Git are **not** required for the packaged Desktop.
- Inside WSL: standalone Linux Node >=22, pnpm **9.12.3**, systemd user services,
  bubblewrap and socat. Prerequisites can need manual administrator actions and a reboot.
- Provider accounts for the agents you want to use. Third-party accounts and
  provider charges may apply.

There is no automatic updater and no signed installer.

## Install and start

Use the PowerShell download/install block on the stable Release page to obtain the
Windows ZIP and its SHA256 sidecar from any working directory.
[Verify the checksum and extract into a new directory](docs/setup/distribution.md),
then run from the extracted archive:

```powershell
.\sentry.ps1 version
.\sentry.ps1 setup -Distro Ubuntu
.\sentry.ps1 tools -Distro Ubuntu
.\sentry.ps1 open
```

Successful setup registers the per-user command. In a new PowerShell or Command
Prompt window use `sentry open`, `sentry stop`, `sentry status`, `sentry doctor` or
`sentry version` from any folder. Keep the extracted archive in place; after moving
it, run `.\sentry.ps1 register-command` there.

More detail: [getting started](docs/getting-started.md) and the
[installation and maintenance guide](docs/setup/distribution.md).

## Updating from 2.0.0

There is no automatic updater. Finish or cancel active runs, stop Sentry (`sentry stop`) and back up
your data, then run the **Update an existing installation** block on the
[v2.0.1 Release page](https://github.com/Mert1026/Sentry/releases/tag/v2.0.1): it downloads and
verifies the new ZIP, sets up the matching runtime and registers the new command. Your projects,
runs, history and provider settings are kept (no database migration). Afterwards check
`sentry version` shows 2.0.1 and `sentry cli capabilities --json` lists `runDepth` and `settings`.
Full steps: [release notes](docs/releases/v2.0.1.md#updating-from-v200).

## Configuration

1. **Settings → Providers**: add the credentials for the agents you will use.
   Credentials use OS-backed encryption; there is no plaintext fallback.
   Each agent card also has a **Reasoning effort** choice (how hard the model thinks; higher
   usually finds more but takes longer and costs more). The levels offered are the ones that
   agent's tool accepts, and **Default** leaves it to the provider.
   **Settings → Runtime** sets the default **run time limit** for every run: 3 hours (default),
   6 hours, No limit or a custom value.
2. **Environment**: check readiness. Diagnostics never make paid calls, and a
   ready state does not guarantee account credit or provider acceptance.
3. **Settings → Application**: theme, interface language (English or Bulgarian),
   local CLI and developer diagnostics. Agent messages stay in their original language.
4. **Settings → Toolchains** (optional): install language runtimes and tools, see
   [Toolchains](#toolchains).

| Agent    | Harness     | Default in runs | Credentials                             |
| -------- | ----------- | --------------- | --------------------------------------- |
| OpenCode | OpenCode    | yes             | OpenCode / OpenRouter provider settings |
| DeepSeek | DeepSeek    | yes             | DeepSeek API key                        |
| GLM      | Claude Code | yes             | Z.AI GLM token                          |
| ChatGPT  | OpenCode    | no (opt-in)     | API key or a signed-in ChatGPT account  |

Optional per-run settings: **Allow web access** and **Allow tool and SDK downloads**.
Package registries (npm, PyPI, crates.io, Go, RubyGems, Maven, NuGet, Packagist) are
always reachable for dependency installs; every other host stays blocked unless you
allow it for that run.

## Run QA

1. Add a project. Sentry creates a managed copy and an immutable revision and leaves
   the original folder untouched. New imports skip common generated caches and
   environments; see [project imports](docs/setup/distribution.md#project-imports).
2. Choose the agents and the **run depth** (**Fast** plans fewer checks, **Full** is the usual
   depth), then start **Full QA**, or **Targeted QA** with project-relative paths.
   Optionally use the project profile and choose the revision to run.
3. Watch the run, open an agent to see its stages, findings and evidence, and export
   JSON or logs when it ends.
4. Cancel active work and wait for it to settle before shutdown or maintenance.

Project removal confirms deletion of the managed data and history and keeps the
imported original. Optional WSL disk reclamation needs confirmation and administrator
consent; the space returned to Windows varies.

## Re-test earlier findings

In **Findings by revision** on the project page, choose an older revision, tick its
findings (up to 12) and re-test them on the **current** revision. Each finding becomes
one check for the agent that reported it, or for all chosen agents.

The run's **Re-test** tab lists every finding with one of three answers:

- **Passed**: the agent re-ran it and it no longer reproduces (resolved).
- **Not passed**: it still reproduces, with the reason.
- **Could not complete**: the agent could not tell; this should be rare.

A re-test adds no findings of its own and never changes the original finding.
It uses provider budget.

## Toolchains

**Settings → Toolchains** installs tools on the host, into a Sentry-managed folder with
one folder per version. Agents never install them. The library has 59 packs in six
groups: languages, package managers, build tools, QA and security tools,
infrastructure, and databases and services. The page has search and an
"installed only" filter, and **custom add-ons** let you install a program with your
own shell command.

Each run uses the version the project asks for (for example `global.json`, `go.mod`,
`.nvmrc`, `.python-version`, `rust-toolchain`) and falls back to the newest installed
version. The project page shows what its files ask for, what is installed and what a
run would use, and lets agents suggest which toolchains a project needs. Nothing
installs until you press Install.

## CLI automation

Keep Desktop open. The packaged CLI uses the same projects, runs and results and
needs no Windows Node installation. Always pass `--json` for automation:

```powershell
sentry cli capabilities --json
sentry cli project list --json
sentry cli run start proj_ID --mode full --agents opencode,deepseek,glm --json
sentry cli run status run_ID --json
sentry cli run result run_ID --json
```

Newer commands:

```powershell
sentry cli project findings proj_ID --json
sentry cli run start proj_ID --retest run_ID:finding_ID --wait --json
sentry cli run start proj_ID --mode full --agents chatgpt --profile --tools --json
sentry cli project profile proj_ID --json
sentry cli toolchain status --json
sentry cli run start proj_ID --mode full --depth fast --json
sentry cli settings show --json
sentry cli settings run-limit 6h --json
sentry cli settings effort glm high --json
```

Replace `proj_ID`, `run_ID` and `finding_ID` with real IDs. See the
[complete CLI reference](docs/beta/cli.md) for exit codes, the error contract,
exports, cancellation and the protocol. Published v1.0.0 and v1.0.1 archives lack the
CLI frontend; use the
[update instructions](docs/setup/distribution.md#explicit-release-upgrade-repair-and-source-beta-migration).

## Security and recovery

Projects and history stay local, but the agents you select send relevant source and
evidence to their providers. Assess provider policies before importing confidential
code. Model output is untrusted and QA cannot guarantee every defect is found.
Never share provider keys, profile databases, credential stores or unreviewed logs.

Read the [threat model](docs/security/V1_THREAT_MODEL.md), the
[maintenance boundary](docs/security/wsl-maintenance.md) and the
[recovery policy](docs/releases/v1-recovery-policy-decision.md).
The original beta executable is not an approved credential downgrade target.

## What's new

### 2.0.1

- **Run depth:** choose Fast (at most 3 planned checks) or Full when starting a run, in the app or
  with `run start --depth fast|full`.
- **Run time limit:** Settings → Runtime sets the window every run gets: 3 hours (default),
  6 hours, No limit (7 days) or a custom value.
- **Reasoning effort per agent** in Settings → Providers, shown on the Environment page and on
  the project page's agent cards.
- **CLI:** `settings show`, `settings effort` and `settings run-limit`; run output reports depth and
  time limit; `capabilities` reports `settings` and `runDepth`; the help lists every command.
- **Fixes:** symlink targets with a backslash are copied exactly on Linux and macOS; finding
  titles can no longer forge lines in the log export; a malformed artifact path is refused
  before its database row is deleted.
- More Bulgarian translations and small run-page tweaks.

### 2.0.0

- Re-test of earlier findings with Passed / Not passed / Could not complete answers.
- Findings by revision, and a project profile with per-agent notes.
- Toolchain library of 59 packs, version detection per project, and custom add-ons.
- ChatGPT as an opt-in agent.
- CLI parity for re-test, findings, profile, toolchains and ChatGPT.
- Bulgarian interface translations covering statuses and generated text.
- Containment and path-safety fixes for project copies and recovery.

The full list is in the [changelog](CHANGELOG.md).

## Documentation and development

- [Documentation index](docs/README.md)
- [Troubleshooting](docs/beta/troubleshooting.md)
- [CLI reference and automation](docs/beta/cli.md)
- [Contributing and development](CONTRIBUTING.md)
- [Architecture](docs/architecture/README.md) and [decision records](docs/adr/0001-monorepo.md)
- [Stable notes](docs/releases/v2.0.1.md) and [changelog](CHANGELOG.md)
- [Testing](docs/development/testing.md), [release procedure](docs/releases/RELEASE_CHECKLIST.md)
  and [branching policy](docs/development/branching.md)
- [Historical reports and failed-test evidence](docs/history.md)

Development uses `dev` as the integration branch and `main` for releases.
See [LICENSE](LICENSE).
