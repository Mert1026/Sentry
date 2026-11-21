import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The list of models each agent's provider offers, kept up to date from one public catalog.
 *
 * Providers add models all the time, and a list written into the app goes stale. Pressing "Update list" in
 * Settings → Providers fetches https://models.dev/api.json (the catalog OpenCode itself reads: a public file,
 * no account, nothing of yours is sent) and keeps the part Sentry needs in a small file under the data root, so
 * the lists survive a restart and work offline. The fixed lists in the app stay as the baseline; this only adds
 * to them and fills in names, dates and context sizes. A model that is not listed can always be typed in.
 */

export const MODEL_CATALOG_URL = 'https://models.dev/api.json';
/** The file is about 700 KB compressed; anything far past that is not the catalog. */
export const MODEL_CATALOG_MAX_CHARS = 24_000_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_MODELS_PER_PROVIDER = 400;
const FILE_NAME = 'model-catalog.json';
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/;

/** The providers Sentry's agents use, and the catalog entries that carry their models. */
export const CATALOG_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['anthropic'],
  openai: ['openai'],
  deepseek: ['deepseek'],
  zai: ['zai-coding-plan', 'zai'],
  'opencode-go': ['opencode-go'],
  opencode: ['opencode'],
};

export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  /** YYYY-MM-DD, or YYYY-MM, as the catalog gives it. */
  readonly releasedAt?: string;
  /** Context window, in tokens. */
  readonly context?: number;
  readonly deprecated?: boolean;
}

export interface ModelCatalog {
  readonly fetchedAt: string;
  readonly source: string;
  readonly providers: Readonly<Record<string, readonly CatalogModel[]>>;
}

export interface ModelCatalogRefresh {
  readonly catalog: ModelCatalog;
  /** Models that were not in the previous copy of the catalog, per provider. */
  readonly added: Readonly<Record<string, readonly string[]>>;
}

type FetchLike = (
  url: string,
  init: { readonly signal: AbortSignal; readonly headers: Readonly<Record<string, string>> },
) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Models an agent can use: they must take part in a tool-using conversation and produce text. */
function modelsOf(entry: unknown): CatalogModel[] {
  const models = asRecord(asRecord(entry)?.['models']);
  if (models === undefined) return [];
  const out: CatalogModel[] = [];
  for (const [key, raw] of Object.entries(models)) {
    const model = asRecord(raw);
    if (model === undefined) continue;
    const id = typeof model['id'] === 'string' ? model['id'] : key;
    if (!MODEL_ID.test(id)) continue;
    if (model['tool_call'] !== true) continue;
    const output = asRecord(model['modalities'])?.['output'];
    if (Array.isArray(output) && !output.includes('text')) continue;
    const limit = asRecord(model['limit']);
    const context = limit?.['context'];
    const released = model['release_date'];
    out.push({
      id,
      name:
        typeof model['name'] === 'string' && model['name'].trim() !== ''
          ? model['name'].trim().slice(0, 120)
          : id,
      ...(typeof released === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(released)
        ? { releasedAt: released }
        : {}),
      ...(typeof context === 'number' && Number.isFinite(context) && context > 0
        ? { context: Math.round(context) }
        : {}),
      ...(model['status'] === 'deprecated' ? { deprecated: true } : {}),
    });
  }
  return out;
}

/** The catalog Sentry keeps, from the whole public file. Newest model first inside each provider. */
export function buildModelCatalog(raw: unknown, fetchedAt: string): ModelCatalog {
  const everything = asRecord(raw);
  if (everything === undefined) throw new Error('The model catalog is not in the expected format.');
  const providers: Record<string, CatalogModel[]> = {};
  for (const [ours, theirs] of Object.entries(CATALOG_PROVIDERS)) {
    const byId = new Map<string, CatalogModel>();
    for (const sourceId of theirs)
      for (const model of modelsOf(everything[sourceId]))
        if (!byId.has(model.id)) byId.set(model.id, model);
    providers[ours] = [...byId.values()]
      .sort(
        (a, b) =>
          (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') || a.id.localeCompare(b.id),
      )
      .slice(0, MAX_MODELS_PER_PROVIDER);
  }
  if (Object.values(providers).every((list) => list.length === 0))
    throw new Error('The model catalog had none of the providers Sentry uses.');
  return { fetchedAt, source: MODEL_CATALOG_URL, providers };
}

/** Reads a catalog file back, keeping only what has the right shape. */
function parseStored(text: string): ModelCatalog | undefined {
  try {
    const value = asRecord(JSON.parse(text));
    const providers = asRecord(value?.['providers']);
    if (value === undefined || providers === undefined || typeof value['fetchedAt'] !== 'string')
      return undefined;
    const clean: Record<string, CatalogModel[]> = {};
    for (const key of Object.keys(CATALOG_PROVIDERS)) {
      const list = providers[key];
      clean[key] = Array.isArray(list)
        ? list.flatMap((item) => {
            const model = asRecord(item);
            return model !== undefined &&
              typeof model['id'] === 'string' &&
              MODEL_ID.test(model['id']) &&
              typeof model['name'] === 'string'
              ? [
                  {
                    id: model['id'],
                    name: model['name'],
                    ...(typeof model['releasedAt'] === 'string'
                      ? { releasedAt: model['releasedAt'] }
                      : {}),
                    ...(typeof model['context'] === 'number' ? { context: model['context'] } : {}),
                    ...(model['deprecated'] === true ? { deprecated: true } : {}),
                  },
                ]
              : [];
          })
        : [];
    }
    return {
      fetchedAt: value['fetchedAt'],
      source: typeof value['source'] === 'string' ? value['source'] : MODEL_CATALOG_URL,
      providers: clean,
    };
  } catch {
    return undefined;
  }
}

export class ModelCatalogStore {
  private readonly file: string;

  constructor(
    dataRoot: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = join(dataRoot, FILE_NAME);
  }

  /** The catalog from the last update, or undefined before the first one. */
  async read(): Promise<ModelCatalog | undefined> {
    try {
      return parseStored(await readFile(this.file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  /** Fetches the public catalog and keeps it. On any failure the copy already kept is left as it was. */
  async refresh(): Promise<ModelCatalogRefresh> {
    const before = await this.read();
    let text: string;
    try {
      const response = await this.fetchImpl(MODEL_CATALOG_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!response.ok)
        throw new Error('The catalog site answered with an error (HTTP ' + response.status + ').');
      text = await response.text();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        message.startsWith('The catalog site')
          ? message
          : 'Could not reach the model catalog. Check the internet connection and try again.',
      );
    }
    if (text.length > MODEL_CATALOG_MAX_CHARS)
      throw new Error('The model catalog was larger than expected, so it was not used.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('The model catalog could not be read.');
    }
    const catalog = buildModelCatalog(parsed, this.now().toISOString());
    await mkdir(join(this.file, '..'), { recursive: true });
    const temporary = this.file + '.tmp';
    await writeFile(temporary, JSON.stringify(catalog), 'utf8');
    await rename(temporary, this.file);
    const added: Record<string, string[]> = {};
    if (before !== undefined)
      for (const [provider, list] of Object.entries(catalog.providers)) {
        const known = new Set((before.providers[provider] ?? []).map((model) => model.id));
        const fresh = list.filter((model) => !known.has(model.id)).map((model) => model.id);
        if (fresh.length > 0) added[provider] = fresh;
      }
    return { catalog, added };
  }
}
