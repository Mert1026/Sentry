/** Longest note the runtime takes, for the whole run or for one agent. */
export const NOTE_MAX_CHARS = 5000;

/** What the person has typed before starting a run. It starts empty for every new run. */
export interface RunNotesDraft {
  /** One note for every agent. */
  readonly shared: string;
  /** true: a separate note for each selected agent instead of the shared one. */
  readonly perAgent: boolean;
  /** Notes by agent stack id, used only while `perAgent` is on. */
  readonly agents: Readonly<Record<string, string>>;
}

export const EMPTY_RUN_NOTES: RunNotesDraft = { shared: '', perAgent: false, agents: {} };

/**
 * The start options this draft adds to a run: the shared note, or one note per selected agent. Blank
 * notes are left out, so a run started without writing anything records nothing.
 */
export function notesToOptions(
  draft: RunNotesDraft,
  selectedAgentIds: readonly string[],
): { instructions?: string; agentInstructions?: Record<string, string> } {
  if (!draft.perAgent) {
    const shared = draft.shared.trim().slice(0, NOTE_MAX_CHARS);
    return shared.length === 0 ? {} : { instructions: shared };
  }
  const agentInstructions: Record<string, string> = {};
  for (const id of selectedAgentIds) {
    const text = (draft.agents[id] ?? '').trim().slice(0, NOTE_MAX_CHARS);
    if (text.length > 0) agentInstructions[id] = text;
  }
  return Object.keys(agentInstructions).length === 0 ? {} : { agentInstructions };
}

/** The notes a run stored, as the run page receives them. */
export interface StoredUserNotes {
  readonly shared?: string;
  readonly agents?: Readonly<Record<string, string>>;
}

/** What one agent was told by the user: the note for everyone, and its own note, when there are any. */
export function notesForAgent(
  notes: StoredUserNotes | undefined,
  agentStackId: string,
): { shared?: string; own?: string } {
  if (notes === undefined) return {};
  const own = notes.agents?.[agentStackId];
  return {
    ...(notes.shared === undefined ? {} : { shared: notes.shared }),
    ...(own === undefined ? {} : { own }),
  };
}

export function hasUserNotes(notes: StoredUserNotes | undefined): boolean {
  return (
    notes !== undefined &&
    (notes.shared !== undefined || Object.keys(notes.agents ?? {}).length > 0)
  );
}
