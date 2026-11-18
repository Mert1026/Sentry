/**
 * Findings that different agents reported for the same defect but rated differently. Severity is the
 * agent's own judgment (nothing checks it afterwards), so when two agents describe the same issue the
 * run says so instead of letting the spread go unnoticed. This is a hint, not a verdict: the matching
 * is deliberately simple (same file, nearby lines, a shared distinctive word in the title).
 */

export const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'] as const;

export interface SeverityFinding {
  readonly id: string;
  /** The agent that reported it (a stack id, a name: any value that tells agents apart). */
  readonly agent: string;
  readonly title: string;
  readonly severity: string;
  readonly file?: string | undefined;
  readonly line?: number | undefined;
}

export interface SeverityRating {
  readonly agent: string;
  readonly severity: string;
  readonly title: string;
  readonly id: string;
}

export interface SeverityDisagreement {
  /** The title of the highest-rated finding, as the name of the issue. */
  readonly title: string;
  readonly highest: string;
  readonly lowest: string;
  /** One rating per agent: the highest that agent gave inside this issue. */
  readonly ratings: readonly SeverityRating[];
}

/** Lines apart that still count as the same place (a function line and the statement inside it). */
const LINE_WINDOW = 3;

/** One shared word this long is enough to call two titles the same issue. */
const MIN_NAMING_WORD = 6;

/** Words that carry no meaning about WHICH defect a title is about. */
const GENERIC = new Set([
  'accept',
  'allow',
  'cannot',
  'cause',
  'default',
  'crash',
  'during',
  'error',
  'fail',
  'input',
  'instead',
  'invalid',
  'parser',
  'parsing',
  'raise',
  'return',
  'silent',
  'silently',
  'there',
  'their',
  'under',
  'using',
  'which',
  'where',
  'without',
]);

function stem(word: string): string {
  // value/values, key/keys, accepts/accept: one word each.
  return word.length > 5 && word.endsWith('s') ? word.slice(0, -1) : word;
}

function fileStem(file: string | undefined): string {
  if (file === undefined) return '';
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.[^.]+$/, '').toLowerCase();
}

/** The distinctive words of a title: five letters or more, not generic, not the file's own name. */
function words(finding: SeverityFinding): Set<string> {
  const own = fileStem(finding.file);
  const out = new Set<string>();
  for (const raw of finding.title.toLowerCase().split(/[^a-z0-9]+/)) {
    const word = stem(raw);
    if (word.length < 5 || GENERIC.has(word) || word === own || word === stem(own)) continue;
    out.add(word);
  }
  return out;
}

function sameIssue(
  a: SeverityFinding,
  b: SeverityFinding,
  wa: Set<string>,
  wb: Set<string>,
): boolean {
  if (a.agent === b.agent) return false;
  if (a.file === undefined || b.file === undefined || a.file !== b.file) return false;
  // A finding without a line (undefined, or null from stored data) is compared by file only.
  if (
    typeof a.line === 'number' &&
    typeof b.line === 'number' &&
    Math.abs(a.line - b.line) > LINE_WINDOW
  )
    return false;
  // Two shared words, or one that is long enough to name the defect (a type, a class, a mechanism).
  const shared = [...wa].filter((word) => wb.has(word));
  return shared.length >= 2 || shared.some((word) => word.length >= MIN_NAMING_WORD);
}

const rank = (severity: string): number => SEVERITY_ORDER.indexOf(severity as never);

/**
 * Issues that two or more agents reported with different severities, widest spread first. Each
 * finding is taken as an anchor and compared with the other agents' findings that look like the same
 * issue, so one vague title cannot pull two different issues into one group.
 */
export function severityDisagreements(
  findings: readonly SeverityFinding[],
): SeverityDisagreement[] {
  const items = findings.filter((finding) => rank(finding.severity) >= 0);
  const wordSets = items.map(words);
  const groups = new Map<string, SeverityFinding[]>();
  items.forEach((anchor, i) => {
    const members = [anchor];
    items.forEach((other, j) => {
      if (
        i !== j &&
        sameIssue(anchor, other, wordSets[i] as Set<string>, wordSets[j] as Set<string>)
      )
        members.push(other);
    });
    // One rating per agent: the highest it gave inside this issue.
    const best = new Map<string, SeverityFinding>();
    for (const finding of members) {
      const current = best.get(finding.agent);
      if (current === undefined || rank(finding.severity) > rank(current.severity))
        best.set(finding.agent, finding);
    }
    if (best.size < 2) return;
    const ratings = [...best.values()];
    if (new Set(ratings.map((r) => r.severity)).size < 2) return;
    const key = ratings
      .map((r) => r.agent + ':' + r.id)
      .sort()
      .join('|');
    if (!groups.has(key)) groups.set(key, ratings);
  });

  // The same issue seen from another anchor can give a smaller group: keep the largest.
  const all = [...groups.entries()];
  const kept = all.filter(
    ([key], index) =>
      !all.some(([other, ratings], otherIndex) => {
        if (otherIndex === index) return false;
        const set = new Set(other.split('|'));
        const mine = key.split('|');
        return (
          mine.length < set.size && mine.every((entry) => set.has(entry)) && ratings.length > 0
        );
      }),
  );

  const result: SeverityDisagreement[] = kept.map(([, group]) => {
    const ratings = [...group].sort((a, b) => rank(b.severity) - rank(a.severity));
    const highest = ratings[0] as SeverityFinding;
    const lowest = ratings[ratings.length - 1] as SeverityFinding;
    return {
      title: highest.title,
      highest: highest.severity,
      lowest: lowest.severity,
      ratings: ratings.map((r) => ({
        agent: r.agent,
        severity: r.severity,
        title: r.title,
        id: r.id,
      })),
    };
  });
  return result.sort(
    (a, b) =>
      rank(b.highest) - rank(b.lowest) - (rank(a.highest) - rank(a.lowest)) ||
      rank(b.highest) - rank(a.highest),
  );
}

/** "src/app.py:12" → file and line; a bare path has no line. */
export function splitLocation(location: string): { file?: string; line?: number } {
  const match = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(location.trim());
  const file = match?.[1] ?? '';
  if (file.length === 0) return {};
  return match?.[2] === undefined ? { file } : { file, line: Number(match[2]) };
}
