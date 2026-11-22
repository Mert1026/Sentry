import { redactSecrets } from '@qa/evidence-pipeline';
import type { HarnessEvent } from '@qa/schemas';

/** A value with every string inside it passed through the redactor; other values are kept as they are. */
function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactDeep(item),
      ]),
    ) as T;
  return value;
}

/**
 * The event as it is stored: whatever an agent wrote in its messages, findings and evidence has any known
 * secret format replaced first, so a credential an agent quoted by mistake never reaches the database,
 * the log or the screen. Events that carry no agent text are returned untouched.
 */
export function redactEventSecrets(event: HarnessEvent): HarnessEvent {
  switch (event.type) {
    case 'agent.message':
      return { ...event, message: redactSecrets(event.message) };
    // The plan and a discovered hypothesis are the agent's own words too, so they are redacted like a message.
    case 'investigation.plan.created':
      return { ...event, plan: redactDeep(event.plan) };
    case 'investigation.hypothesis.discovered':
      return { ...event, hypothesis: redactDeep(event.hypothesis) };
    // The text of what the agent ran and of what went wrong is redacted here as well, whatever the harness
    // already did before it built the event.
    case 'agent.status':
      return event.message === undefined
        ? event
        : { ...event, message: redactSecrets(event.message) };
    case 'tool.started':
      return event.tool.inputSummary === undefined
        ? event
        : {
            ...event,
            tool: { ...event.tool, inputSummary: redactSecrets(event.tool.inputSummary) },
          };
    case 'tool.completed':
      return event.tool.errorPreview === undefined
        ? event
        : {
            ...event,
            tool: { ...event.tool, errorPreview: redactSecrets(event.tool.errorPreview) },
          };
    case 'command.executed':
      return { ...event, command: redactSecrets(event.command) };
    case 'test.result':
      return event.suite === undefined ? event : { ...event, suite: redactSecrets(event.suite) };
    case 'warning':
      return { ...event, message: redactSecrets(event.message) };
    case 'run.failed':
      return {
        ...event,
        failure: { ...event.failure, message: redactSecrets(event.failure.message) },
      };
    case 'run.cancelled':
      return event.reason === undefined ? event : { ...event, reason: redactSecrets(event.reason) };
    case 'finding.submitted':
      return { ...event, finding: redactDeep(event.finding) };
    case 'evidence.submitted':
      return { ...event, evidence: redactDeep(event.evidence) };
    case 'report.checkpoint':
      return {
        ...event,
        findings: redactDeep(event.findings),
        evidence: redactDeep(event.evidence),
      };
    default:
      return event;
  }
}
