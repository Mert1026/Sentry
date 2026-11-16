/**
 * What an agent concluded before its report failed. The report stage is a separate model call that can
 * fail on its own (a quota or billing error, a provider outage, a malformed answer) after the whole
 * investigation was paid for. The investigation produces nothing durable until the report is accepted, so
 * without this the user gets an empty failure. The agent's own closing statement for each check is kept as
 * plain activity messages: unverified, never a finding, never part of a report.
 */
export interface UnreportedInvestigation {
  readonly plan: { readonly plannedChecks: readonly string[] };
  /** The closing statement the agent made for each check, by check index. */
  readonly conclusions: ReadonlyArray<string | undefined>;
}

const CHECK_NAME_CHARS = 200;
const STATEMENT_CHARS = 1500;

/**
 * The messages that preserve those statements, or none when the agent never reached a conclusion on any
 * check. `failureCode` names why the report failed.
 */
export function unreportedInvestigationMessages(
  digest: UnreportedInvestigation | undefined,
  failureCode: string,
): string[] {
  if (digest === undefined) return [];
  const entries = digest.plan.plannedChecks.flatMap((name, index) => {
    const statement = (digest.conclusions[index] ?? '').trim();
    return statement.length === 0 ? [] : [{ name, statement }];
  });
  if (entries.length === 0) return [];
  return [
    'Investigation finished but the report could not be produced (' +
      failureCode +
      '). The agent’s own closing statement for each check follows. It is unverified, and nothing here was recorded as a finding or as evidence.',
    ...entries.map(
      ({ name, statement }) =>
        '[not reported] ' +
        name.replace(/\s+/g, ' ').slice(0, CHECK_NAME_CHARS) +
        ' — ' +
        statement.slice(0, STATEMENT_CHARS),
    ),
  ];
}
