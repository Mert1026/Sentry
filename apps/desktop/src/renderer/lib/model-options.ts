import type { CatalogModel } from '../../shared/ipc-contract.js';

/** One entry of a model picker: what a person reads to choose, and the exact id that is saved. */
export interface ModelOption {
  /** The exact id that is saved. */
  readonly id: string;
  /** A readable name, from the model catalog; the id itself when the catalog has none. */
  readonly name: string;
  /** What the id says about itself (for example a smaller, faster model). */
  readonly note?: string | undefined;
  readonly releasedAt?: string | undefined;
  /** Context window, in tokens. */
  readonly context?: number | undefined;
  /** "new": in the updated list but not in the list that comes with the app. "legacy": an older or retired model. */
  readonly badge?: 'new' | 'legacy' | undefined;
}

export interface ModelOptionSources {
  /** Ids that are old aliases rather than current models. */
  readonly legacyIds?: readonly string[] | undefined;
  /** A short note for an id, from what the id says. */
  readonly note?: ((id: string) => string | undefined) | undefined;
}

/**
 * The options of a picker: the list that comes with the app, plus what the last update of the list added,
 * with the catalog's names, dates and context sizes filled in. Nothing is taken away: an id in the built-in
 * list stays, and a model of the updated list that the app did not know is marked new. With an update, the
 * options are ordered newest first (those with no date keep their place after the dated ones); without one,
 * the order is the built-in order.
 */
export function buildModelOptions(
  baseline: readonly string[],
  catalog: readonly CatalogModel[] | undefined,
  sources: ModelOptionSources = {},
): ModelOption[] {
  const legacy = new Set(sources.legacyIds ?? []);
  const known = new Map((catalog ?? []).map((model) => [model.id, model]));
  const options: ModelOption[] = baseline.map((id) => {
    const fact = known.get(id);
    return {
      id,
      name: fact?.name ?? id,
      note: sources.note?.(id),
      releasedAt: fact?.releasedAt,
      context: fact?.context,
      badge: legacy.has(id) || fact?.deprecated === true ? 'legacy' : undefined,
    };
  });
  const have = new Set(baseline);
  for (const model of catalog ?? []) {
    if (have.has(model.id)) continue;
    options.push({
      id: model.id,
      name: model.name,
      note: sources.note?.(model.id),
      releasedAt: model.releasedAt,
      context: model.context,
      badge: model.deprecated === true ? 'legacy' : 'new',
    });
  }
  if (catalog === undefined) return options;
  const position = new Map(options.map((option, index) => [option.id, index]));
  return [...options].sort((a, b) => {
    const left = a.releasedAt ?? '';
    const right = b.releasedAt ?? '';
    if (left !== '' && right !== '')
      return right.localeCompare(left) || position.get(a.id)! - position.get(b.id)!;
    if (left !== '') return -1;
    if (right !== '') return 1;
    return position.get(a.id)! - position.get(b.id)!;
  });
}

/** Whether to show the option among the current models or the older ones. */
export function isCurrentOption(option: ModelOption): boolean {
  return option.badge !== 'legacy';
}

/** Options that match what was typed in the search box: in the name, the id or the note. */
export function filterModelOptions(options: readonly ModelOption[], query: string): ModelOption[] {
  const text = query.trim().toLowerCase();
  if (text === '') return [...options];
  return options.filter((option) =>
    [option.name, option.id, option.note ?? ''].some((part) => part.toLowerCase().includes(text)),
  );
}

/** "200K", "1M": a context window, short. */
export function formatContext(tokens: number | undefined): string | undefined {
  if (tokens === undefined || tokens <= 0) return undefined;
  if (tokens >= 1_000_000)
    return (tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1) + 'M';
  return Math.round(tokens / 1000) + 'K';
}
