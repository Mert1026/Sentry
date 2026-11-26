// Prompts for the two plain-agent arms. Arm 3 is Sentry itself (see run-sentry.mjs).
//
// Arm 1 (bare): what most people type.
// Arm 2 (crafted): a general bug-finding adaptation of the published Anthropic audit prompt
//   https://github.com/anthropics/claude-code-security-review (claudecode/prompts.py):
//   role, objective, critical instructions, phased methodology, JSON output, confidence bands.
//   Plus Anthropic prompting guidance that was read in full on
//   https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices :
//   be clear and direct, give motivation, give a role, structure with XML tags.
//   Investigate-before-claiming and self-check come from the same page's agentic section, which was
//   only read as a summary, so treat those two lines as "from summary".

export function bareBugPrompt(scope) {
  return `Find bugs in the code under ${scope}.`;
}

export function craftedBugPrompt(scope) {
  return `<role>
You are a senior software engineer doing a focused correctness review of one part of a codebase. You are looking for real defects that make the code behave wrongly, not style problems.
</role>

<objective>
Find genuine bugs in the code under "${scope}" (relative to the current directory). A genuine bug is code that returns a wrong result, throws or crashes on valid input, leaks state, mishandles an edge case, or violates the behavior its own comments, types or callers rely on. Precision matters: a reviewer will read every finding, so a false alarm costs real time.
</objective>

<instructions>
1. Only report a bug when you are more than 80% confident it is real. Prefer missing a doubtful issue to reporting a speculative one.
2. Skip style, naming, formatting, missing documentation, performance micro-optimizations and "could be refactored" remarks.
3. Open and read the code before making any claim about it. Never describe a function you have not read.
4. Before reporting, re-read the cited lines and check the bug against the callers and the surrounding code. Drop the finding if you cannot construct a concrete input or sequence that triggers it.
</instructions>

<methodology>
Phase 1, context: list the files under the scope, read the entry points and the public API, and note the invariants the code assumes.
Phase 2, comparison: compare similar code paths (for example, the handling of one case versus its sibling cases) and look for the one that differs without a reason.
Phase 3, assessment: for each suspicious spot, trace the data from input to the point of failure, check boundary values (empty, null/undefined, zero, negative, very large, duplicated), error paths, ordering and async/timing, and state that persists between calls.
</methodology>

<output_format>
Your final reply must contain one JSON object and nothing else:
{"findings":[{"file":"path relative to the current directory","line":123,"title":"short title","description":"what is wrong and why","trigger":"a concrete input or sequence that triggers it","confidence":0.0-1.0}],"files_reviewed":["..."]}
If you find nothing you are confident about, return an empty findings array.
</output_format>`;
}
