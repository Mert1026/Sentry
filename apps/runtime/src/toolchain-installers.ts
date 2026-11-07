import type { ToolchainPackId } from '@qa/shared';

/**
 * Most packs are installed with micromamba from conda-forge into a private prefix
 * (`<pack dir>/env`). One installer covers Node, Ruby, compilers, build tools, databases
 * and more, with no root and no system packages. micromamba itself and its package cache
 * are deleted once the prefix exists.
 */
export interface CondaRecipe {
  /** conda match specs; `name=1.2` matches every 1.2.x. */
  readonly specs: readonly string[];
  /** Shell commands run with the new prefix first on PATH; a failure fails the install. */
  readonly check: string;
}

const JDK = 'openjdk=21';

/** The conda recipe for a pack version, or undefined for packs with their own installer. */
export function condaRecipe(id: ToolchainPackId, version: string): CondaRecipe | undefined {
  switch (id) {
    case 'node':
      return { specs: [`nodejs=${version}`], check: 'node --version && npm --version' };
    case 'bun':
      return { specs: [`bun=${version}`], check: 'bun --version' };
    case 'deno':
      return { specs: [`deno=${version}`], check: 'deno --version' };
    case 'ruby':
      return { specs: [`ruby=${version}`], check: 'ruby --version && gem --version' };
    case 'dart':
      return { specs: [`dart-sdk=${version}`], check: 'dart --version' };
    case 'elixir':
      return { specs: [`elixir=${version}`], check: 'elixir --version' };
    case 'scala':
      return { specs: [`sbt=${version}`, JDK], check: 'command -v sbt' };
    case 'kotlin':
      return { specs: [`kotlin=${version}`, JDK], check: 'kotlinc -version' };
    case 'gradle':
      return { specs: [`gradle=${version}`, JDK], check: 'gradle --version' };
    case 'zig':
      return { specs: [`zig=${version}`], check: 'zig version' };
    case 'postgres':
      return { specs: [`postgresql=${version}`], check: 'postgres --version && initdb --version' };
    case 'mysql':
      return { specs: [`mysql=${version}`], check: 'mysqld --version' };
    case 'redis':
      return { specs: [`redis-server=${version}`], check: 'redis-server --version' };
    case 'sqlite':
      return { specs: [`sqlite=${version}`], check: 'sqlite3 --version' };
    case 'utilities':
      return {
        specs: ['jq', 'ripgrep', 'unzip', 'zip', 'bzip2', 'zstd', 'git-lfs', 'patch'],
        check:
          'jq --version && rg --version && git-lfs --version && command -v unzip zip bzip2 zstd patch',
      };
    case 'c':
      return {
        specs: [`gcc=${version}`, `gxx=${version}`, 'make', 'cmake', 'ninja', 'pkg-config'],
        // conda names the compilers with a target prefix; give them the usual names, then prove
        // that C and C++ programs really compile, link and run before calling the pack installed.
        check: [
          'ARCH=$(uname -m)',
          'for t in gcc g++ cc c++ ar ranlib nm strip ld; do',
          '  if [ ! -e "$SENTRY_TC_DIR/env/bin/$t" ] && [ -e "$SENTRY_TC_DIR/env/bin/$ARCH-conda-linux-gnu-$t" ]; then',
          '    ln -s "$ARCH-conda-linux-gnu-$t" "$SENTRY_TC_DIR/env/bin/$t"',
          '  fi',
          'done',
          "printf 'int main(void){return 0;}\\n' > smoke.c",
          "printf '#include <iostream>\\nint main(){std::cout<<1;}\\n' > smoke.cpp",
          'cc smoke.c -o smoke_c && ./smoke_c',
          'c++ smoke.cpp -o smoke_cpp && ./smoke_cpp',
          'make --version | sed -n 1,1p && cmake --version | sed -n 1,1p && ninja --version',
          'rm -f smoke.c smoke.cpp smoke_c smoke_cpp',
        ].join('\n'),
      };
    // package managers
    case 'pnpm':
      return { specs: [`pnpm=${version}`], check: 'pnpm --version' };
    case 'yarn':
      return { specs: [`yarn=${version}`], check: 'yarn --version' };
    case 'poetry':
      return { specs: [`poetry=${version}`], check: 'poetry --version' };
    case 'pdm':
      return { specs: [`pdm=${version}`], check: 'pdm --version' };
    case 'pipx':
      return { specs: [`pipx=${version}`], check: 'pipx --version' };
    // build tools
    case 'bazelisk':
      // `bazelisk version` would download Bazel, so only prove the launcher is there.
      return { specs: [`bazelisk=${version}`], check: 'command -v bazelisk' };
    case 'just':
      return { specs: [`just=${version}`], check: 'just --version' };
    case 'task':
      return { specs: [`go-task=${version}`], check: 'task --version' };
    case 'meson':
      return { specs: [`meson=${version}`, 'ninja'], check: 'meson --version && ninja --version' };
    case 'protobuf':
      return { specs: [`libprotobuf=${version}`], check: 'protoc --version' };
    case 'buf':
      return { specs: [`buf=${version}`], check: 'buf --version' };
    case 'autotools':
      return {
        specs: ['autoconf', 'automake', 'libtool'],
        check:
          'autoconf --version | sed -n 1,1p && automake --version | sed -n 1,1p && libtool --version | sed -n 1,1p',
      };
    // QA and security tools
    case 'ruff':
      return { specs: [`ruff=${version}`], check: 'ruff --version' };
    case 'shellcheck':
      return { specs: [`shellcheck=${version}`], check: 'shellcheck --version | sed -n 1,2p' };
    case 'actionlint':
      return { specs: [`actionlint=${version}`], check: 'actionlint -version | sed -n 1,1p' };
    case 'trivy':
      return { specs: [`trivy=${version}`], check: 'trivy --version | sed -n 1,1p' };
    case 'osv-scanner':
      return { specs: [`osv-scanner=${version}`], check: 'osv-scanner --version | sed -n 1,1p' };
    case 'yamllint':
      return { specs: [`yamllint=${version}`], check: 'yamllint --version' };
    case 'biome':
      return { specs: [`biome=${version}`], check: 'biome --version' };
    case 'sqlfluff':
      return { specs: [`sqlfluff=${version}`], check: 'sqlfluff --version' };
    case 'checkov':
      return { specs: [`checkov=${version}`], check: 'checkov --version' };
    // infrastructure
    case 'opentofu':
      return { specs: [`opentofu=${version}`], check: 'tofu version | sed -n 1,1p' };
    case 'terraform':
      return { specs: [`terraform=${version}`], check: 'terraform version | sed -n 1,1p' };
    case 'kustomize':
      return { specs: [`kustomize=${version}`], check: 'kustomize version' };
    case 'ansible':
      return { specs: [`ansible=${version}`], check: 'ansible --version | sed -n 1,1p' };
    // databases and services
    case 'mongodb':
      return { specs: [`mongodb=${version}`], check: 'mongod --version | sed -n 1,1p' };
    case 'duckdb':
      return { specs: [`duckdb-cli=${version}`], check: 'duckdb --version' };
    case 'rabbitmq':
      // Starting a broker is the agent's job; here the programs only have to be present.
      return {
        specs: [`rabbitmq-server=${version}`],
        check: 'command -v rabbitmq-server rabbitmqctl',
      };
    case 'nats':
      return { specs: [`nats-server=${version}`], check: 'nats-server --version' };
    // more languages
    case 'r':
      return { specs: [`r-base=${version}`], check: 'R --version | sed -n 1,1p' };
    case 'julia':
      return { specs: [`julia=${version}`], check: 'julia --version' };
    case 'lua':
      return { specs: [`lua=${version}`], check: 'lua -v' };
    case 'perl':
      return { specs: [`perl=${version}`], check: 'perl -e \'print "$^V\\n"\'' };
    case 'powershell':
      return { specs: [`powershell=${version}`], check: 'pwsh --version' };
    case 'ocaml':
      return { specs: [`ocaml=${version}`], check: 'ocaml -version' };
    case 'clojure':
      return { specs: [`clojure=${version}`, JDK], check: 'command -v clojure clj' };
    case 'python':
    case 'dotnet':
    case 'rust':
    case 'go':
    case 'java':
    case 'php':
    case 'swift':
      return undefined;
  }
}

export const CONDA_SCRIPT = `
case "$(uname -m)" in aarch64|arm64) A=linux-aarch64 ;; *) A=linux-64 ;; esac
curl -fsSL --retry 3 -o micromamba "https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-$A"
chmod +x micromamba
export MAMBA_ROOT_PREFIX="$SENTRY_TC_DIR/mamba-root"
# The spec list is split into words on purpose.
./micromamba create -y -q -p "$SENTRY_TC_DIR/env" --override-channels -c conda-forge $SENTRY_CONDA_SPECS
export PATH="$SENTRY_TC_DIR/env/bin:$PATH"
eval "$SENTRY_CONDA_CHECK"
rm -rf "$SENTRY_TC_DIR/mamba-root" micromamba
`;

/** Static PHP command-line builds (newest patch of the minor) plus Composer. */
export const PHP_SCRIPT = `
mkdir -p bin
NAME=$(python3 - "$SENTRY_TC_VERSION" <<'PY'
import json, re, sys, urllib.request
minor = sys.argv[1]
items = json.load(urllib.request.urlopen('https://dl.static-php.dev/static-php-cli/common/?format=json', timeout=30))
best = None
for item in items:
    m = re.match(r'php-' + re.escape(minor) + r'\\.(\\d+)-cli-linux-x86_64\\.tar\\.gz$', item['name'])
    if m and (best is None or int(m.group(1)) > best[0]):
        best = (int(m.group(1)), item['name'])
if best is None:
    sys.exit('No static PHP ' + minor + ' build found.')
print(best[1])
PY
)
curl -fsSL --retry 3 -o php.tar.gz "https://dl.static-php.dev/static-php-cli/common/$NAME"
tar -xzf php.tar.gz -C bin
rm -f php.tar.gz
curl -fsSL --retry 3 -o composer.phar https://getcomposer.org/download/latest-stable/composer.phar
printf '#!/bin/sh\\nexec "%s/bin/php" "%s/composer.phar" "$@"\\n' "$SENTRY_TC_DIR" "$SENTRY_TC_DIR" > bin/composer
chmod +x bin/php bin/composer
bin/php --version | sed -n 1,1p
bin/composer --version
`;

/** The official Swift toolchain for Ubuntu (24.04 build, 22.04 for older releases). */
export const SWIFT_SCRIPT = `
mkdir -p swift
URL=$(python3 - "$SENTRY_TC_VERSION" <<'PY'
import json, platform, re, sys, urllib.request
minor = sys.argv[1]
arm = platform.machine() in ('aarch64', 'arm64')
arch, suffix = ('aarch64', '-aarch64') if arm else ('x86_64', '')
releases = json.load(urllib.request.urlopen('https://www.swift.org/api/v1/install/releases.json', timeout=30))
pattern = re.compile(r'^swift-' + re.escape(minor) + r'(\\.\\d+)?-RELEASE$')
for release in reversed(releases):
    if not pattern.match(release['tag']):
        continue
    for name, folder, label in (('Ubuntu 24.04', 'ubuntu2404', 'ubuntu24.04'), ('Ubuntu 22.04', 'ubuntu2204', 'ubuntu22.04')):
        if any(p['name'] == name and arch in p.get('archs', []) for p in release['platforms']):
            tag = release['tag']
            print('https://download.swift.org/%s/%s%s/%s/%s-%s%s.tar.gz' % (tag.lower(), folder, suffix, tag, tag, label, suffix))
            sys.exit(0)
sys.exit('No Swift ' + minor + ' release found for this machine.')
PY
)
curl -fsSL --retry 3 -o swift.tar.gz "$URL"
tar -xzf swift.tar.gz --strip-components=1 -C swift
rm -f swift.tar.gz
swift/usr/bin/swift --version
`;
