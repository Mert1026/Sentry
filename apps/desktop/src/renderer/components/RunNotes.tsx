import React from 'react';
import { InfoPopover } from './InfoPopover.js';
import { NOTE_MAX_CHARS, type RunNotesDraft } from '../lib/run-notes.js';

/**
 * Notes for the agents, written before a run starts. One note goes to every agent; a switch gives each
 * selected agent a note of its own instead. Nothing is remembered between runs: the draft starts empty.
 */
export function RunNotes({
  agents,
  value,
  onChange,
}: {
  agents: ReadonlyArray<{ id: string; displayName: string }>;
  value: RunNotesDraft;
  onChange: (next: RunNotesDraft) => void;
}): React.JSX.Element {
  const switchPerAgent = (perAgent: boolean): void => {
    if (!perAgent) {
      onChange({ ...value, perAgent: false });
      return;
    }
    // Start each agent's note from the shared one, so splitting up never loses what was written.
    const copied: Record<string, string> = { ...value.agents };
    for (const agent of agents)
      if ((copied[agent.id] ?? '') === '') copied[agent.id] = value.shared;
    onChange({ ...value, perAgent: true, agents: copied });
  };
  return (
    <div className="project-form-section run-notes">
      <div className="project-info-title">
        <h3 className="project-form-heading">Notes for the agents</h3>
        <InfoPopover title="Notes for the agents">
          <p>
            Tell the agents what matters for this run: areas to focus on, known problems, things to
            leave alone. They treat it as your instruction, but they still have to prove every
            finding with evidence, so a note that points at a suspected bug is a hint, not a
            verdict.
          </p>
          <p>
            Notes cannot switch off Sentry’s safety rules, the network limits or the secrets check.
            They are saved with the run, shown on the run page and included in findings exports. A
            fresh run always starts with empty notes. Do not paste passwords or keys here.
          </p>
          <p>
            A Fast run plans only a couple of checks, so a long wish list cannot all be covered.
          </p>
        </InfoPopover>
      </div>
      <label className="run-notes-switch">
        <input
          type="checkbox"
          role="switch"
          aria-label="Different notes for each agent"
          checked={value.perAgent}
          onChange={(event) => switchPerAgent(event.target.checked)}
        />
        <span>Different notes for each agent</span>
      </label>
      {value.perAgent ? (
        <div className="run-notes-fields">
          {agents.length === 0 ? (
            <span className="muted">Select at least one agent to write its note.</span>
          ) : (
            agents.map((agent) => {
              const text = value.agents[agent.id] ?? '';
              return (
                <label key={agent.id} className="run-notes-field">
                  <span className="run-notes-label">
                    {agent.displayName}
                    <small className="metadata">
                      {' '}
                      {text.length} / {NOTE_MAX_CHARS}
                    </small>
                  </span>
                  <textarea
                    aria-label={'Note for ' + agent.displayName}
                    rows={3}
                    maxLength={NOTE_MAX_CHARS}
                    value={text}
                    placeholder="Leave empty to give this agent no note."
                    onChange={(event) =>
                      onChange({
                        ...value,
                        agents: { ...value.agents, [agent.id]: event.target.value },
                      })
                    }
                  />
                </label>
              );
            })
          )}
        </div>
      ) : (
        <label className="run-notes-field">
          <span className="run-notes-label">
            Note for all agents
            <small className="metadata">
              {' '}
              {value.shared.length} / {NOTE_MAX_CHARS}
            </small>
          </span>
          <textarea
            aria-label="Note for all agents"
            rows={4}
            maxLength={NOTE_MAX_CHARS}
            value={value.shared}
            placeholder="Optional. For example: focus on the login flow; the payment module is known to be slow."
            onChange={(event) => onChange({ ...value, shared: event.target.value })}
          />
        </label>
      )}
    </div>
  );
}
