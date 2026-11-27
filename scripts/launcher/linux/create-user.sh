#!/usr/bin/env bash
# Create the everyday Linux account for a freshly installed distro, so the person never has to
# type a username and password into Ubuntu's first-run prompt. Used by the setup wizard.
# Runs as root via `wsl -d <distro> -u root` (no interactive sudo).
# $1 = account name (already sanitized by the wizard; checked again here).
# Prints USER_EXISTS=<name> when a normal account is already there, USER_CREATED=<name> otherwise.
set -eu
NAME="${1:-}"
if ! printf '%s' "$NAME" | grep -Eq '^[a-z_][a-z0-9_-]{0,30}$'; then
  echo 'INVALID_NAME' >&2
  exit 2
fi
# A normal account (UID 1000 or above with a home directory) already exists: keep it.
existing="$(awk -F: '$3 >= 1000 && $3 < 60000 && $6 ~ /^\/home\// { print $1; exit }' /etc/passwd)"
if [ -n "$existing" ]; then
  NAME="$existing"
  echo "USER_EXISTS=$NAME"
else
  useradd --create-home --shell /bin/bash --groups sudo "$NAME"
  # No password is set: the account cannot log in with one, and Windows reaches it as root with
  # `wsl -u root` when needed. The person can set one later: wsl -d <distro> -u root passwd <name>
  passwd --lock "$NAME" >/dev/null
  echo "USER_CREATED=$NAME"
fi
# Make it the distro's default user, keeping every other wsl.conf setting.
if [ -f /etc/wsl.conf ]; then
  cp -n /etc/wsl.conf /etc/wsl.conf.sentry-bak 2>/dev/null || true
fi
if grep -q '^\[user\]' /etc/wsl.conf 2>/dev/null; then
  if sed -n '/^\[user\]/,/^\[/p' /etc/wsl.conf | grep -q '^default='; then
    sed -i '/^\[user\]/,/^\[/ s/^default=.*/default='"$NAME"'/' /etc/wsl.conf
  else
    sed -i '/^\[user\]/a default='"$NAME" /etc/wsl.conf
  fi
else
  printf '[user]\ndefault=%s\n' "$NAME" >>/etc/wsl.conf
fi
