import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { translateText } from '../../src/renderer/lib/i18n.js';

/**
 * Every complete piece of interface text in the renderer source must have a Bulgarian translation,
 * so a new label cannot ship in English only. Text that is built from parts at run time is covered
 * by the assembled samples below. Text that is the same in both languages goes on the allowlist.
 */

const ROOT = join(__dirname, '../../src/renderer');
const bg = (text: string): string => translateText(text, 'bg');

/** Proper nouns, product and file-format names, keyboard keys and code samples: the same in Bulgarian. */
const SAME_IN_BOTH = new Set([
  'Markdown (.md)',
  'JSON (.json)',
  'OpenCode',
  'DeepSeek',
  'ChatGPT',
  'Claude',
  'GLM',
  'Ctrl+K',
  'TargetSpec',
  'Node',
  '(WSL)',
  'WSL',
  'Linux',
  'Windows',
  'Native Linux',
  'Ubuntu',
  'API',
  'JSON',
  'Markdown',
  'OpenCode API key (Zen & Go)',
  'Escape',
  'Home',
  'End',
  'ArrowLeft',
  'ArrowRight',
  'PATH:',
  'localStorage sentry:last-error',
]);

const TEXT_ATTRS = new Set([
  'title',
  'aria-label',
  'placeholder',
  'label',
  'description',
  'alt',
  'heading',
  'message',
  'hint',
  'text',
  'summary',
  'subtitle',
  'tooltip',
  'caption',
]);
const TEXT_KEYS = new Set([
  'label',
  'title',
  'description',
  'message',
  'hint',
  'summary',
  'subtitle',
  'heading',
  'detail',
  'help',
  'tooltip',
  'caption',
  'placeholder',
]);

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'locales') sourceFiles(path, files);
    } else if (/\.tsx?$/.test(name)) files.push(path);
  }
  return files;
}

function looksLikeProse(text: string): boolean {
  if (text.length < 2 || !/[A-Za-z]{2,}/.test(text)) return false;
  if (/^[a-z][a-zA-Z0-9]*$/.test(text)) return false; // an identifier
  if (/^[a-z0-9_.:/#-]+$/.test(text)) return false; // a path, id or css class
  if (/^[A-Z0-9_]+$/.test(text) && !text.includes(' ')) return false; // a constant
  if (/^(e\.g\.|https?:|\/|\.\/|#|\$)/.test(text)) return false; // an example, url or path
  if (/\b(sh|bash)\b|\$SENTRY_|\bmkdir\b|\bcurl\b/.test(text)) return false; // a shell sample
  if (/^[\w-]+(\s+[\w-]+)*$/.test(text) && text === text.toLowerCase()) return false; // css classes
  if (/^(\d+(px|em|%)\s?)+$/.test(text) || text.startsWith('var(')) return false;
  return true;
}

/** A literal that stands on its own, not one piece of a longer string being assembled. */
function isWhole(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent === undefined) return true;
  if (ts.isBinaryExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent))
    return false;
  if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) return isWhole(parent);
  return true;
}

interface Found {
  readonly where: string;
  readonly text: string;
}

function untranslatedLiterals(): Found[] {
  const found = new Map<string, Found>();
  for (const file of sourceFiles(ROOT)) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const check = (node: ts.Node, raw: string): void => {
      const text = raw
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
      if (!looksLikeProse(text) || SAME_IN_BOTH.has(text)) return;
      if (bg(text) !== text) return;
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (!found.has(text)) found.set(text, { where: `${rel}:${line}`, text });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node)) check(node, node.getText());
      if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
        const name = node.name.getText();
        if (TEXT_ATTRS.has(name)) {
          const init = node.initializer;
          if (ts.isStringLiteral(init)) check(init, init.text);
          else if (ts.isJsxExpression(init) && init.expression !== undefined) {
            const e = init.expression;
            if (ts.isStringLiteralLike(e)) check(e, e.text);
            if (ts.isConditionalExpression(e))
              for (const branch of [e.whenTrue, e.whenFalse])
                if (ts.isStringLiteralLike(branch)) check(branch, branch.text);
          }
        }
      }
      if (
        ts.isPropertyAssignment(node) &&
        TEXT_KEYS.has(node.name.getText().replace(/['"]/g, ''))
      ) {
        const v = node.initializer;
        if (ts.isStringLiteralLike(v)) check(v, v.text);
      }
      // {'text'} and {cond ? 'a' : 'b'} written straight into the page
      if (
        ts.isJsxExpression(node) &&
        node.expression !== undefined &&
        !ts.isJsxAttribute(node.parent)
      ) {
        const e = node.expression;
        if (ts.isStringLiteralLike(e)) check(e, e.text);
        if (ts.isConditionalExpression(e))
          for (const branch of [e.whenTrue, e.whenFalse])
            if (ts.isStringLiteralLike(branch) && isWhole(branch)) check(branch, branch.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...found.values()];
}

describe('Bulgarian coverage of the interface source', () => {
  it('has a translation for every complete piece of interface text', () => {
    const missing = untranslatedLiterals().map((f) => `${f.where}  ${f.text}`);
    expect(missing).toEqual([]);
  });
});

describe('Bulgarian for text built from parts', () => {
  const samples: readonly string[] = [
    '3 of 3 selected agent executions completed',
    'Ask DeepSeek what it needs',
    'Build profile for GLM',
    'Rebuild profile for OpenCode',
    'ChatGPT provider settings',
    'Note for GLM',
    'Custom value for SENTRY_GLM_MODEL',
    'Value for DEEPSEEK_API_KEY',
    'Copy full ID run_01K777',
    'Copy rev_alpha',
    'Deselect DeepSeek',
    'Select OpenCode',
    'Inspect OpenCode',
    'Remove src/app.ts',
    'Install Go 1.22',
    'Raw events (4)',
    'Web access: On',
    'Tool and SDK downloads: Off',
    'Binary: Missing',
    'Credential: Saved',
    'Runtime: Not tested',
    'Status: Older revision',
    'Completed: 3',
    '14 of 59 packs',
    'Install all (3)',
    '2 QA runs in progress',
    '1 QA run in progress',
    '2 active runs · Open',
    'Open most recent active run. 2 active runs',
    'TARGETED · 2 paths',
    '· 1 could not be determined',
    '1 resolved · 0 not resolved',
    'Input 12 · Output 3 · Cached —',
    'No findings were reported before failed. Analysis is incomplete.',
    'Partial report — agent timed out. Reported findings and evidence are retained; analysis is incomplete.',
    'Analysis failed.',
    'Project is in use by run_01K7. Update cannot start until the run finishes.',
    'Node v22.1 · Protocol v1 · Sentry 2.0.1',
    '· rev rev_01K7777',
    'Reclaimed 2.0 GiB from the Ubuntu disk. Windows drive free: 40 GiB',
    'Saved model “x-1” is not in the current list. It is preserved — select a listed model above or keep this custom id.',
    'Saved provider “abc” is unrecognized. It is preserved — select a supported provider above before saving.',
    'Keep saved “abc” (unrecognized)',
    'Active upstream: openrouter (default) · no model saved',
    'SENTRY_GLM_BINARY: use an absolute Linux path, not a Windows path.',
    'HIGH · UNCATEGORIZED',
    'e.g. kimi-k3, gpt-5.5, or anthropic/claude-sonnet-4',
    'No high findings from this agent.',
    'Fourth reviewer · OpenAI through your API key or your ChatGPT account',
    'Every run gets a window of 3 hours (the default).',
    'Re-test 2 selected',
    '3 agents · Full project · uses provider budget',
  ];
  for (const sample of samples) {
    it(sample, () => {
      const out = bg(sample);
      expect(out).not.toBe(sample);
      expect(out).toMatch(/[а-яА-Я]/);
    });
  }

  it('keeps names and ids inside the sentence', () => {
    expect(bg('Ask DeepSeek what it needs')).toContain('DeepSeek');
    expect(bg('Copy full ID run_01K777')).toContain('run_01K777');
    expect(bg('Remove src/app.ts')).toContain('src/app.ts');
    expect(bg('14 of 59 packs')).toBe('14 от 59 пакета');
    expect(bg('2 active runs · Open')).toBe('2 активни изпълнения · Отвори');
  });

  it('translates the project profile line of the run add-ons', () => {
    expect(bg('Add-ons')).toBe('Допълнения');
    expect(bg('Used by 1 agent(s)')).toBe('Използван от 1 агент');
    expect(bg('Used by 3 agent(s) · 1 without (out of date or not built)')).toBe(
      'Използван от 3 агента · 1 без (остарял или непостроен)',
    );
  });

  it('leaves English as it is', () => {
    expect(translateText('Ask DeepSeek what it needs', 'en')).toBe('Ask DeepSeek what it needs');
  });
});
