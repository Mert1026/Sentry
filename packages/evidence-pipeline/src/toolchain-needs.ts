import { TOOLCHAIN_PACKS, toolchainPack } from '@qa/shared';

/** One library entry an agent asked for, checked against the real catalog. */
export interface ParsedToolchainNeed {
  readonly packId: string;
  readonly version: string;
  readonly reason: string;
}

const MAX_NEEDS = 40;
const SUMMARY_MAX = 4000;
const LINE = /^\s*([a-z][a-z0-9-]*)\s+([A-Za-z0-9._-]+)\s*(?:[|:—–-]+\s*(.*))?$/;

/** The Toolchains library as the agent must name it: one line per pack with its versions. */
export function toolchainCatalogText(): string {
  return TOOLCHAIN_PACKS.map(
    (pack) => `- ${pack.id} (${pack.label}): versions ${pack.versions.join(', ')}`,
  ).join('\n');
}

/** The picked version when the pack lists it ("22.3" counts as "22"), otherwise undefined. */
function matchVersion(versions: readonly string[], asked: string): string | undefined {
  return versions.find((version) => asked === version || asked.startsWith(version + '.'));
}

/**
 * The needs an agent wrote into the plan's flow lines ("node 24 | .nvmrc pins Node 24"). Lines that
 * name no pack or version of the library are dropped, repeated entries are kept once.
 */
export function parseToolchainNeeds(plan: {
  readonly projectUnderstanding: string;
  readonly criticalFlows?: readonly string[] | undefined;
}): { readonly summary: string; readonly needs: ParsedToolchainNeed[]; readonly ignored: number } {
  const needs: ParsedToolchainNeed[] = [];
  let ignored = 0;
  for (const line of plan.criticalFlows ?? []) {
    const match = LINE.exec(line);
    const pack = match === null ? undefined : toolchainPack(match[1] as string);
    const version =
      pack === undefined ? undefined : matchVersion(pack.versions, match?.[2] as string);
    if (pack === undefined || version === undefined) {
      ignored += 1;
      continue;
    }
    if (needs.some((need) => need.packId === pack.id && need.version === version)) continue;
    const reason = (match?.[3] ?? '').trim().slice(0, 500);
    needs.push({
      packId: pack.id,
      version,
      reason: reason.length === 0 ? 'No reason given.' : reason,
    });
    if (needs.length >= MAX_NEEDS) break;
  }
  const summary = plan.projectUnderstanding.trim();
  return {
    summary:
      summary.length <= SUMMARY_MAX ? summary : summary.slice(0, SUMMARY_MAX - 20) + ' [cut]',
    needs,
    ignored,
  };
}
