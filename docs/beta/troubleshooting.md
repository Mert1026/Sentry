# Troubleshooting

For the packaged release, run `.\sentry.ps1 doctor` from its extracted directory;
use `.\sentry.ps1 setup -Distro Ubuntu` / `tools -Distro Ubuntu` to repair installation.
The detailed source-launcher sections below can install prerequisites; packaged
bootstrap requires the manual prerequisites in the [distribution guide](../setup/distribution.md).

For a source installation, run `sentry doctor` first. It performs zero paid requests and never prints
secrets — only presence information.

```powershell
sentry doctor
sentry status -Json   # attach this (with FAIL/WARN lines) to bug reports
```

Never paste API keys, provider tokens, or credential files into bug reports.

## `sentry cli` says Desktop is not running

`sentry cli` is a frontend: it needs the broker inside the running Desktop.
Start it first with `sentry open`, then retry. The Environment page shows
`CLI started` when the broker is listening. Automation should match on the
`SENTRY_DESKTOP_NOT_RUNNING` error code, not on message text.

## `sentry` command not found

The shim lives at `%LOCALAPPDATA%\Sentry\bin\sentry.cmd` with that
directory on your **user** PATH. Open a new PowerShell window after setup.
If it is still missing, rerun `sentry setup` (it reinstalls the shim) and
check `sentry status`.

## Setup says reboot required

First-time WSL installation needs a Windows restart. This is normal, not a
failure. After restarting:

```powershell
cd <your-clone-path>
.\sentry.ps1 setup
```

Setup resumes where it left off (exit code 75 means "reboot requested").

## WSL installed but distro missing

Setup installs Ubuntu via `wsl --install -d Ubuntu` when no usable WSL2
distro exists, then asks you to rerun setup. Utility distros such as
`docker-desktop` are intentionally ignored — they cannot host the runtime.

## WSL distro is WSL1

Setup detects a WSL1-only distro and asks for confirmation before
converting exactly that distro (`wsl --set-version <distro> 2`); it never
installs a duplicate Ubuntu first. Non-interactive setup converts only a
distro named with `-Distro`. The conversion result is re-checked before
setup continues.

## Node missing in WSL

The runtime launches as `wsl.exe -d <distro> -- node <entry> --stdio`, so
Node must resolve under **direct** execution — an `nvm`-only install that
lives in `.bashrc` is not enough. Verify with:

```powershell
wsl -d Ubuntu -- node --version   # must print v22+
```

Setup installs Node 22 via NodeSource on apt distros. On non-apt distros,
install Node >= 22 manually so the command above works, then rerun setup.
A missing `systemd` binary set is repaired by setup (apt install) where
possible; that is a different state from systemd being installed but
disabled in `/etc/wsl.conf`, which setup enables and re-probes.

## Agents report "no browser"

`sentry doctor` shows whether it is there: `Headless browser` is PASS (Chrome version, and it rendered a test page just
now), or a warning saying not installed / installed but unusable.

Web-page checks need the managed headless browser that `sentry setup` / `sentry update` installs under
`~/.local/share/sentry/tools/browser` (about 350 MB, no sudo). Setup prints `Headless browser for QA agents
(managed)` when it works, or a warning with the reason when it does not (no network to the Chrome download
host, a CPU other than x86_64, system libraries that could not be fetched). Agents then run without a
browser and report browser checks as inconclusive. Fix the cause and rerun `sentry setup`; it is idempotent.
To test it by hand inside WSL: `SENTRY_BROWSER_HOME=~/.local/share/sentry/tools/browser bash
scripts/launcher/linux/install-browser.sh` prints `BROWSER_READY=...` or `BROWSER_FAILED=<reason>`.

## "Sign in with Claude" says the script tool is missing

The Claude account sign-in runs Anthropic's `claude setup-token` in the Linux runtime under the util-linux `script` tool,
because Claude Code only reads the pasted code from a terminal. `sentry doctor` shows `Claude sign-in terminal` (PASS when
`script` gave a terminal just now, a warning when it is missing or did not), and `sentry setup` prints `Terminal tool for
the Claude account sign-in (script)` or the same warning. `script` is part of util-linux (`bsdutils` on Ubuntu), which
every supported distribution ships in its base install, so a warning means a stripped-down image: install util-linux
and rerun `sentry setup`. This never blocks anything else: signing in to Claude with an API key does not need it.

## An agent fails with "safety filter" / "flagged for possible cybersecurity risk"

Symptom: a ChatGPT (or other OpenAI-backed) agent fails with `OPENCODE_PROVIDER_REFUSED`. The model provider's own content filter declined the request, usually because a security-testing run contains exploit
payloads or vulnerability details. It is not an outage, a sign-in problem or a quota. Retrying the same run fails the same way. A single check the filter declines is reported inconclusive while the rest of
the run carries on; this error means the filter declined the final report. What the agent concluded for each check is still kept in the run's Activity as `[not reported]` lines (unverified, never a finding).
The provider's message may name its permissive-access program for authorized security work; follow it, or run the project with another agent. Sentry does not rephrase content to get past the filter.

## GLM sandbox: `socat` / `bubblewrap` missing

The GLM sandbox runs fail-closed: if `socat` or `bubblewrap` is missing
(or bubblewrap cannot initialize), GLM runs fail instead of running
unsandboxed. `sentry doctor` reports exactly which piece is missing.

Check (Ubuntu / WSL — run these **inside** Ubuntu, not in Windows
PowerShell):

```bash
command -v socat
command -v bwrap
```

Install (Ubuntu / WSL):

```bash
sudo apt update
sudo apt install -y socat bubblewrap
```

Then rerun `sentry doctor`. `sentry setup` installs these automatically on
apt distros; on other distros install them manually. Never disable the
sandbox to work around this (`sandbox.failIfUnavailable` stays on).

> Windows `winget` commands run in **Windows PowerShell** only — never
> inside Ubuntu. Conversely `sudo apt ...` runs **inside Ubuntu** only.

## GLM sandbox starts but commands fail

Symptom: a GLM run fails within seconds with `GLM_SANDBOX_UNAVAILABLE` and a diagnostic such as
`apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide
CAP_SYS_ADMIN): Permission denied`, although `socat` and `bubblewrap` are installed. `sentry setup` and
`sentry doctor` report it as `SANDBOX_INIT_FAIL=nested-user-namespaces-blocked`.

Cause: bubblewrap can start, but the system refuses a second (nested) user namespace inside it, which the
Claude Code sandbox needs. On Ubuntu 24.04 and similar this is the AppArmor setting
`kernel.apparmor_restrict_unprivileged_userns`. Check it inside Ubuntu:

```bash
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns   # 1 means unprivileged user namespaces are restricted
```

Options (your choice; both change a system hardening setting, so decide with your administrator):
install an AppArmor profile that allows `bwrap`, or turn the restriction off with
`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (make it permanent in
`/etc/sysctl.d/`). Then rerun `sentry doctor`. Never disable Sentry's own sandbox to work around this.
The OpenCode, DeepSeek and ChatGPT agents do not use this sandbox and are not affected, so a run with only
those agents works without changing anything.

## An agent fails at once with "Unexpected server error"

Symptom: an OpenCode or ChatGPT agent fails within a second with `OPENCODE_START_FAILED`, a message such as
`Unexpected server error. Check server logs for details`, and "No upstream requests were relayed during the
turn". Nothing reached the provider, so nothing was billed. Sentry already retried the start once with a
fresh OpenCode server. If it still fails, check the provider sign-in or API key in **Settings → Providers**
(for the ChatGPT agent, sign in again), then start the run again. Other agents in the same run are not
affected and keep going.

## An agent investigated but has no report

If an agent finishes its investigation and then fails while writing the report (for example `QUOTA (HTTP 402)
Insufficient Balance`), its run shows as failed and has no findings. What each check concluded is kept in the
agent's **Activity** as `[not reported] ...` lines behind a line that names the failure. They are the agent's
own unverified statements, not findings: read them, fix the cause (top up the balance, retry later) and run
again if you want a proper report.

## Per-tool probes (Ubuntu / WSL)

```bash
$HOME/.local/share/sentry/tools/opencode/node_modules/.bin/opencode --version
$HOME/.local/share/sentry/tools/deepseek/bin/dsh --version
```

`$HOME` avoids username-specific paths entirely.

## systemd unavailable

Sentry uses systemd user services for worker isolation. Setup enables
`systemd=true` in `/etc/wsl.conf` (backing up your file first and
preserving your other settings), then restarts only the selected distro
(`wsl --terminate <distro>`, not a full shutdown). If it still fails, check
that your distro supports systemd and rerun `sentry setup`.

## Runtime handshake failed

`runtime.hello` must answer with protocol 1 on Linux, from a host whose
executable is not `electron.exe`. If the handshake fails after a deploy:

1. Run `sentry doctor` and read the exact failing line.
2. Rerun `sentry setup` (redeploys the versioned runtime atomically; the
   previous runtime stays usable until the new one validates).
3. Check `%LOCALAPPDATA%\Sentry\launcher\logs\` for the deploy log.

## OpenCode / DeepSeek / Claude missing

- **OpenCode**: setup installs tested `1.18.32` into the Sentry-managed
  location (`~/.local/share/sentry/tools/opencode`) and reuses an existing
  compatible install.
- **DeepSeek**: setup resolves the pinned DSH runtime (`0.1.5-rc.2`) from
  the deployed Linux runtime and exposes it at the Sentry-managed
  `~/.local/share/sentry/tools/deepseek/bin/dsh`, then persists that path
  as the `SENTRY_DEEPSEEK_BINARY` override. Setup reports DeepSeek ready
  only after the managed binary answers its version probe (the same probe
  production preflight performs). That managed file is a Bash wrapper used
  for diagnostics, version probing, and following `runtime/current`.
  Production SDK startup does not pass this wrapper as `dshBin`; the SDK
  resolves a compatible JavaScript DSH runtime independently unless
  explicitly given a real `.js/.mjs/.cjs` entrypoint. Do not replace the
  wrapper with a JavaScript file.
- **Claude**: setup uses adapter-tested `2.1.270` from a Sentry-managed
  install (`~/.local/share/sentry/tools/claude-code`) and never touches
  your global `claude` (no sudo, no global npm changes). An existing exact
  native install may be reused; version `2.1.276` is known-incompatible and
  blocked, while other unknown versions warn but allow a first run. A `claude`
  resolved from `/mnt/c/...` (Windows mount) is refused. GLM runs also
  require `ANTHROPIC_BASE_URL` set to a trusted Z.AI-compatible endpoint
  (the default `api.anthropic.com` route is refused) plus the sandbox
  prerequisites above.

After installing a tool manually, rerun `sentry doctor` to verify.

## Provider credential missing

Configure credentials in Sentry → Settings → Providers (Electron
safeStorage / Windows DPAPI). Setup and doctor never handle secrets; an
agent that reports "unconfigured" needs its provider saved in the UI.
Provider settings survive `sentry update`.

## Update refuses (branch / dirty tree)

Source updates track only the selected channel (`dev` follows `origin/dev`,
`main` follows `origin/main`): on any other checkout, `sentry update` refuses
and tells you to `git switch dev` or `git switch main` (it never switches
branches for you). It also refuses when `git status --porcelain` shows anything —
commit, stash, or discard first. Sentry never resets, cleans, rebases, or
stashes automatically, and a refused update leaves a running Sentry alone.

## Desktop already running

`sentry open` while Sentry runs focuses the existing window (single
instance) instead of starting a second runtime. If the window seems lost,
run `sentry stop`, then `sentry open` again.

## Runtime outdated after `git pull`

A manual `git pull` does not rebuild or redeploy. Run `sentry update`
(rebuilds Desktop, redeploys the versioned runtime, reopens Sentry) or
`sentry setup -NonInteractive` to resync everything.
