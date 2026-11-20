import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MODEL_CATALOG_MAX_CHARS,
  MODEL_CATALOG_URL,
  ModelCatalogStore,
  buildModelCatalog,
} from '../src/model-catalog.js';

const roots: string[] = [];
const dataRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'sentry-models-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const model = (extra: Record<string, unknown> = {}) => ({
  tool_call: true,
  modalities: { input: ['text'], output: ['text'] },
  ...extra,
});

/** A small stand-in for the public catalog: only the shape matters. */
const CATALOG = {
  anthropic: {
    models: {
      'claude-old': model({
        id: 'claude-old',
        name: 'Claude Old',
        release_date: '2025-01-10',
        status: 'deprecated',
      }),
      'claude-new': model({
        id: 'claude-new',
        name: 'Claude New',
        release_date: '2026-10-01',
        limit: { context: 200000, output: 64000 },
      }),
      'claude-embed': model({ id: 'claude-embed', name: 'Embed', tool_call: false }),
      'claude-image': model({
        id: 'claude-image',
        name: 'Image',
        modalities: { output: ['image'] },
      }),
      'bad id with spaces': model({ id: 'bad id with spaces', name: 'Bad' }),
    },
  },
  'zai-coding-plan': {
    models: { 'glm-5.3': model({ id: 'glm-5.3', name: 'GLM 5.3', release_date: '2026-09' }) },
  },
  zai: {
    models: {
      'glm-5.3': model({ id: 'glm-5.3', name: 'duplicate' }),
      'glm-5.4': model({ id: 'glm-5.4', name: 'GLM 5.4', release_date: '2026-11-02' }),
    },
  },
  deepseek: {
    models: { 'deepseek-flash': model({ id: 'deepseek-flash', name: 'DeepSeek Flash' }) },
  },
  unrelated: { models: { x: model({ id: 'x', name: 'X' }) } },
};

const response = (body: string, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => body,
});

describe('buildModelCatalog', () => {
  const catalog = buildModelCatalog(CATALOG, '2026-11-19T10:00:00.000Z');

  it('keeps the models an agent can use, newest first, with the facts the catalog gives', () => {
    expect(catalog.providers['anthropic']?.map((m) => m.id)).toEqual(['claude-new', 'claude-old']);
    const fresh = catalog.providers['anthropic']?.[0];
    expect(fresh).toMatchObject({ name: 'Claude New', releasedAt: '2026-10-01', context: 200000 });
    expect(catalog.providers['anthropic']?.[1]).toMatchObject({ deprecated: true });
  });

  it('leaves out models that cannot use tools, cannot write text or have an odd id', () => {
    const ids = catalog.providers['anthropic']?.map((m) => m.id) ?? [];
    expect(ids).not.toContain('claude-embed');
    expect(ids).not.toContain('claude-image');
    expect(ids.some((id) => id.includes(' '))).toBe(false);
  });

  it('puts the two Z.AI entries together without repeating a model', () => {
    expect(catalog.providers['zai']?.map((m) => m.id)).toEqual(['glm-5.4', 'glm-5.3']);
    expect(catalog.providers['zai']?.find((m) => m.id === 'glm-5.3')?.name).toBe('GLM 5.3');
  });

  it('keeps nothing from providers Sentry does not use', () => {
    expect(Object.keys(catalog.providers).sort()).toEqual(
      ['anthropic', 'deepseek', 'opencode', 'opencode-go', 'openai', 'zai'].sort(),
    );
  });

  it('refuses something that is not the catalog', () => {
    expect(() => buildModelCatalog([], 'now')).toThrow(/expected format/);
    expect(() => buildModelCatalog({ unrelated: {} }, 'now')).toThrow(/none of the providers/);
  });
});

describe('ModelCatalogStore', () => {
  it('has nothing before the first update', async () => {
    expect(await new ModelCatalogStore(await dataRoot()).read()).toBeUndefined();
  });

  it('fetches only the public catalog, keeps it in a file and reads it back', async () => {
    const root = await dataRoot();
    const urls: string[] = [];
    const store = new ModelCatalogStore(
      root,
      async (url) => {
        urls.push(url);
        return response(JSON.stringify(CATALOG));
      },
      () => new Date('2026-11-19T10:00:00.000Z'),
    );
    const { catalog, added } = await store.refresh();
    expect(urls).toEqual([MODEL_CATALOG_URL]);
    expect(catalog.fetchedAt).toBe('2026-11-19T10:00:00.000Z');
    expect(added).toEqual({});
    expect(await store.read()).toEqual(catalog);
    expect((await readdir(root)).sort()).toEqual(['model-catalog.json']);
    expect(JSON.parse(await readFile(join(root, 'model-catalog.json'), 'utf8')).source).toBe(
      MODEL_CATALOG_URL,
    );
  });

  it('says which models are new since the last update', async () => {
    const root = await dataRoot();
    let body: unknown = CATALOG;
    const store = new ModelCatalogStore(root, async () => response(JSON.stringify(body)));
    await store.refresh();
    body = {
      ...CATALOG,
      anthropic: {
        models: {
          ...CATALOG.anthropic.models,
          'claude-newer': model({
            id: 'claude-newer',
            name: 'Claude Newer',
            release_date: '2026-11-10',
          }),
        },
      },
    };
    const { added } = await store.refresh();
    expect(added).toEqual({ anthropic: ['claude-newer'] });
  });

  it('keeps the copy it has when the site cannot be reached, answers with an error or sends rubbish', async () => {
    const root = await dataRoot();
    let next: () => Promise<ReturnType<typeof response>> = async () =>
      response(JSON.stringify(CATALOG));
    const store = new ModelCatalogStore(root, () => next());
    const first = (await store.refresh()).catalog;
    next = async () => {
      throw new Error('getaddrinfo ENOTFOUND models.dev');
    };
    await expect(store.refresh()).rejects.toThrow(/Could not reach the model catalog/);
    next = async () => response('', false, 503);
    await expect(store.refresh()).rejects.toThrow(/HTTP 503/);
    next = async () => response('<html>not json</html>');
    await expect(store.refresh()).rejects.toThrow(/could not be read/);
    next = async () => response('x'.repeat(MODEL_CATALOG_MAX_CHARS + 1));
    await expect(store.refresh()).rejects.toThrow(/larger than expected/);
    expect(await store.read()).toEqual(first);
  });

  it('ignores a damaged file and a file with the wrong shape', async () => {
    const root = await dataRoot();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'model-catalog.json'), '{not json');
    expect(await new ModelCatalogStore(root).read()).toBeUndefined();
    await writeFile(join(root, 'model-catalog.json'), JSON.stringify({ providers: 'x' }));
    expect(await new ModelCatalogStore(root).read()).toBeUndefined();
  });
});
