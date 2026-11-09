/** A finding a retest run was asked to re-test, as the run configuration stores it. */
export interface RetestItemInfo {
  readonly n: number;
  readonly findingId: string;
  readonly title: string;
}

export type RetestAnswer = 'resolved' | 'not_resolved' | 'undetermined';

export interface RetestRow {
  readonly n: number;
  readonly title: string;
  readonly answer: RetestAnswer;
  readonly reason: string;
}

const LINE = /^\[(passed|failed|inconclusive|not_run)\] Retest #(\d+): /;

/**
 * One row per finding the agent was given, from the agent's report lines
 * ("[passed] Retest #1: title — reason"). A finding the agent never reported on is
 * "undetermined", never "resolved".
 */
export function retestRows(
  items: readonly RetestItemInfo[],
  messages: readonly string[],
): RetestRow[] {
  const reported = new Map<number, { answer: RetestAnswer; reason: string }>();
  for (const message of messages) {
    const match = LINE.exec(message);
    if (match === null) continue;
    const separator = message.indexOf(' \u2014 ', match[0].length);
    reported.set(Number(match[2]), {
      answer:
        match[1] === 'passed'
          ? 'resolved'
          : match[1] === 'failed'
            ? 'not_resolved'
            : 'undetermined',
      reason: separator < 0 ? '' : message.slice(separator + 3).trim(),
    });
  }
  return items.map((item) => {
    const result = reported.get(item.n);
    return {
      n: item.n,
      title: item.title,
      answer: result?.answer ?? 'undetermined',
      reason: result?.reason ?? 'The agent did not report a result for this finding.',
    };
  });
}
