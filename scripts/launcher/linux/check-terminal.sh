#!/usr/bin/env bash
# Report the pseudo-terminal tool the Claude account sign-in needs.
#
# Claude Code's sign-in only reads the pasted code from a terminal, so the runtime runs
# `claude setup-token` under util-linux `script`, which provides one (see apps/runtime
# claude-account.ts). This checks that `script` is there and really gives a terminal of the size
# the runtime asks for, with its input a pipe and no terminal of its own, as the runtime has it.
# Prints one of:
#   TERMINAL_OK                 `script` provided a 50x1000 terminal just now
#   TERMINAL_MISSING            no `script` on PATH
#   TERMINAL_BROKEN <reason>    `script` is there but did not provide a terminal
# SENTRY_SCRIPT_BIN replaces the program name (used by the tests).
set -u
BIN="${SENTRY_SCRIPT_BIN:-script}"

if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "TERMINAL_MISSING"
  exit 0
fi

# Input from a pipe that closes at once is how a service without a terminal looks to the tool.
size="$(printf '' | timeout 20 "$BIN" -qec 'stty cols 1000 rows 50; stty size' /dev/null 2>/dev/null | tr -d '\r' | tail -n 1)"
if [ "$size" = "50 1000" ]; then
  echo "TERMINAL_OK"
else
  echo "TERMINAL_BROKEN it did not provide a terminal (answered: ${size:-nothing})"
fi
