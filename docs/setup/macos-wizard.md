# macOS Setup Wizard DMG

Packaging and runtime onboarding flow for Sentry Desktop on Apple Silicon (`macos-arm64`).

## Layout

- **Wizard Main Entrypoint:** [`apps/desktop/src/main/wizard-entry.ts`](../../apps/desktop/src/main/wizard-entry.ts)
  - On launch, skips straight to Desktop (`./index.js`) when control flags are passed or when `~/Library/Application Support/Sentry/wizard-state.json` matches `sourceCommit` and the `sentry-linux` Lima VM already exists.
  - Pass `--setup-wizard` to force the wizard UI open on an already-provisioned Mac (or click **Configure AI Keys** on Step 1 to jump to Step 2).
  - Step 1 provisions the hardened Lima VZ VM (`sentry-linux`), builds and deploys `runtime-source`, installs pinned agent harnesses (`opencode-ai@1.18.32`, `@anthropic-ai/claude-code@2.1.270`, `@deepseek-ai/dsh@0.1.5-rc.2`), creates `/usr/local/bin/{opencode,claude,dsh}` symlinks as `root`, and verifies `bubblewrap` + `systemd-run`.
  - Step 2 provides optional AI key onboarding using Electron `safeStorage` (macOS Keychain) into `~/Library/Application Support/@qa/desktop/credentials/providers.json` (`0600`) and non-secret model/endpoint defaults into `sentry-prefs/models.json`.
- **Wizard Static Assets:** [`scripts/distribution/macos-wizard/`](../../scripts/distribution/macos-wizard/)
  - `wizard.html` — 2-step Step 1 (VM/Harnesses) + Step 2 (AI Keys) UI.
  - `wizard-preload.cjs` — Sandboxed `contextBridge` API (`window.sentryWizard`).
  - `entitlements-electron.plist` — Hardened Runtime entitlements for Developer ID signing (`Sentry.app` and Electron helpers).
  - `install-deepseek-tool.sh` — Guest `dsh` CLI wrapper invoking exported `runCli()` on Node `22.14`.
- **Packager:** [`scripts/distribution/build-macos-wizard.mjs`](../../scripts/distribution/build-macos-wizard.mjs)

## Build, Sign, and Notarize

1. Build the desktop package and standard macOS distribution first:

   ```bash
   pnpm build
   pnpm distribution:build -- --target macos-arm64
   ```

2. Package and sign the Setup Wizard DMG (uses `SENTRY_APPLE_IDENTITY` or auto-detects `Developer ID Application:` in Keychain, falling back to ad-hoc `-`):

   ```bash
   node scripts/distribution/build-macos-wizard.mjs
   ```

3. To also notarize, staple, and Gatekeeper-verify (`--notarize` uses `--keychain-profile sentry-notary` or `SENTRY_NOTARY_PROFILE`):

   ```bash
   node scripts/distribution/build-macos-wizard.mjs --notarize --keychain-profile sentry-notary
   ```

Output artifact: `dist/distributions/Sentry-<version>-Setup-Wizard-arm64.dmg`.
