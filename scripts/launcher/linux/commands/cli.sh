#!/usr/bin/env bash
# commands/cli.sh — forward to the Sentry automation CLI (same contract).
# The Desktop must be running: the CLI is a frontend and never starts
# its own runtime. Mirrors the Windows `sentry cli` forwarding exactly.
set -u

sentry_cli_help() {
  echo ""
  echo "Sentry CLI (same runtime as Desktop)"
  echo ""
  echo "Usage:"
  echo "  sentry cli <command>"
  echo ""
  echo "Sentry Desktop must be running (sentry open). The CLI is a frontend:"
  echo "it never opens the database or starts its own runtime."
  echo ""
  echo "Commands:"
  echo "  capabilities [--json]"
  echo "  project list [--json]"
  echo "  project add \"<path>\" [--json]"
  echo "  project show <project-id> [--json]"
  echo "  project update <project-id> [path] [--json]"
  echo "  project delete <project-id> --yes [--json]"
  echo "  project revisions <project-id> [--json]"
  echo "  project findings <project-id> [--json]"
  echo "  project export-findings <project-id> --format markdown|github-issues|sarif (--findings <run-id>:<finding-id>,... | --run <run-id> | --revision <rev-id>,...) --out <path> [--json]"
  echo "  project profile <project-id> [--json]"
  echo "  project profile-build <project-id> [--agents opencode,deepseek,glm,chatgpt] [--json]"
  echo "  project doctor <project-id> [--json]"
  echo "  agent list [--json]"
  echo "  agent doctor opencode|deepseek|glm|chatgpt [--json]"
  echo "  run start <project-id> --mode full|targeted [--agents opencode,deepseek,glm,chatgpt] [--paths a,b] [--depth fast|full] [--wait] [--timeout-ms <ms>] [--web] [--tools] [--profile] [--revision <rev-id>] [--json]"
  echo "  run start <project-id> --retest <run-id>:<finding-id>,... [--retest-with reporter|all] [--agents ...] [--wait] [--json]"
  echo "  run list <project-id> [--json]"
  echo "  run show <run-id> [--json]"
  echo "  run status <run-id> [--json]"
  echo "  run cancel <run-id> [--json]"
  echo "  run result <run-id> [--json]"
  echo "  run export <run-id> --format log|json --out <path> [--json]"
  echo "  run start <project-id> --write-tests <run-id>:<finding-id>,... --framework vitest|jest|pytest|xunit|junit|go-test [--wait] [--json]"
  echo "  run export-tests <run-id> --out <folder> [--json]"
  echo "  ci export --target github-actions|gitlab-ci|azure-pipelines --framework vitest|jest|pytest|xunit|junit|go-test --out <folder> [--json]"
  echo "  toolchain status [--json]"
  echo "  toolchain install|remove <pack-id> <version> [--json]"
  echo "  settings show [--json]"
  echo "  settings effort <opencode|deepseek|glm|chatgpt> <level|default> [--json]"
  echo "  settings run-limit <default|3h|6h|none|90m|12h> [--json]"
  echo ""
  echo "Automation: always pass --json and parse stdout with JSON.parse."
  return 0
}

cmd_cli() {
  local repo="$REPO_ROOT"
  if [ $# -eq 0 ]; then sentry_cli_help; return 0; fi
  local arg
  for arg in "$@"; do
    case "$arg" in
      --help | -h) sentry_cli_help; return 0 ;;
    esac
  done
  local entry="$repo/apps/cli/dist/index.js"
  if [ ! -f "$entry" ]; then
    sentry_fail "Sentry CLI is not built. Run: sentry setup"
    return 1
  fi
  local node_bin="$(sentry_preferred_node)"
  if [ -z "$node_bin" ]; then node_bin="node"; fi
  "$node_bin" "$entry" "$@"
  return "$?"
}

