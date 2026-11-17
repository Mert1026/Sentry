import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentInspector } from '../../src/renderer/components/AgentInspector.js';
import { RunNotes } from '../../src/renderer/components/RunNotes.js';
import { RunSummaryPanel } from '../../src/renderer/components/RunSummaryPanel.js';
import { projectAgentTelemetry } from '../../src/renderer/lib/agent-telemetry.js';
import {
  EMPTY_RUN_NOTES,
  NOTE_MAX_CHARS,
  hasUserNotes,
  notesForAgent,
  notesToOptions,
  type RunNotesDraft,
} from '../../src/renderer/lib/run-notes.js';
import { makeAgentRun } from '../fixtures.js';

afterEach(cleanup);

const AGENTS = [
  { id: 'stack_opencode_main', displayName: 'OpenCode' },
  { id: 'stack_deepseek_main', displayName: 'DeepSeek' },
];

describe('what a draft adds to a run start', () => {
  const ids = AGENTS.map((agent) => agent.id);

  it('adds nothing for an empty or blank draft', () => {
    expect(notesToOptions(EMPTY_RUN_NOTES, ids)).toEqual({});
    expect(notesToOptions({ ...EMPTY_RUN_NOTES, shared: '  \n ' }, ids)).toEqual({});
    expect(
      notesToOptions({ shared: '', perAgent: true, agents: { [ids[0]!]: '   ' } }, ids),
    ).toEqual({});
  });

  it('sends the shared note, trimmed, as instructions', () => {
    expect(notesToOptions({ ...EMPTY_RUN_NOTES, shared: '  Focus on login.  ' }, ids)).toEqual({
      instructions: 'Focus on login.',
    });
  });

  it('sends only the selected agents’ notes in per-agent mode, and never the shared text', () => {
    const draft: RunNotesDraft = {
      shared: 'Old shared text',
      perAgent: true,
      agents: { [ids[0]!]: 'For OpenCode', stack_glm_main: 'For an agent no longer selected' },
    };
    expect(notesToOptions(draft, ids)).toEqual({
      agentInstructions: { [ids[0]!]: 'For OpenCode' },
    });
  });

  it('never sends more than the runtime accepts', () => {
    const long = 'x'.repeat(NOTE_MAX_CHARS + 50);
    expect(notesToOptions({ ...EMPTY_RUN_NOTES, shared: long }, ids).instructions).toHaveLength(
      NOTE_MAX_CHARS,
    );
  });
});

describe('reading the notes a run stored', () => {
  it('gives an agent the shared note and its own, and nothing for an unknown run', () => {
    const stored = { shared: 'For everyone', agents: { stack_opencode_main: 'Own note' } };
    expect(notesForAgent(stored, 'stack_opencode_main')).toEqual({
      shared: 'For everyone',
      own: 'Own note',
    });
    expect(notesForAgent(stored, 'stack_deepseek_main')).toEqual({ shared: 'For everyone' });
    expect(notesForAgent(undefined, 'stack_opencode_main')).toEqual({});
    expect(hasUserNotes(stored)).toBe(true);
    expect(hasUserNotes({ agents: {} })).toBe(false);
    expect(hasUserNotes(undefined)).toBe(false);
  });
});

describe('the notes field on the start screen', () => {
  function Harness({ onDraft }: { onDraft: (draft: RunNotesDraft) => void }) {
    const [draft, setDraft] = React.useState<RunNotesDraft>(EMPTY_RUN_NOTES);
    return (
      <RunNotes
        agents={AGENTS}
        value={draft}
        onChange={(next) => {
          setDraft(next);
          onDraft(next);
        }}
      />
    );
  }

  it('starts empty, with one note for all agents and a counter', () => {
    render(<Harness onDraft={() => undefined} />);
    const field = screen.getByLabelText('Note for all agents') as HTMLTextAreaElement;
    expect(field.value).toBe('');
    expect(field.maxLength).toBe(NOTE_MAX_CHARS);
    expect(screen.getByText(`0 / ${NOTE_MAX_CHARS}`)).toBeTruthy();
    fireEvent.change(field, { target: { value: 'Focus on login.' } });
    expect(screen.getByText(`${'Focus on login.'.length} / ${NOTE_MAX_CHARS}`)).toBeTruthy();
    expect(screen.queryByLabelText('Note for OpenCode')).toBeNull();
  });

  it('splits into one field per selected agent, starting from the shared note', () => {
    const drafts: RunNotesDraft[] = [];
    render(<Harness onDraft={(draft) => drafts.push(draft)} />);
    fireEvent.change(screen.getByLabelText('Note for all agents'), {
      target: { value: 'Shared start' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Different notes for each agent' }));
    expect(screen.queryByLabelText('Note for all agents')).toBeNull();
    const opencode = screen.getByLabelText('Note for OpenCode') as HTMLTextAreaElement;
    const deepseek = screen.getByLabelText('Note for DeepSeek') as HTMLTextAreaElement;
    expect(opencode.value).toBe('Shared start');
    expect(deepseek.value).toBe('Shared start');
    fireEvent.change(deepseek, { target: { value: 'Only for DeepSeek' } });
    expect(drafts.at(-1)).toMatchObject({
      perAgent: true,
      agents: { stack_opencode_main: 'Shared start', stack_deepseek_main: 'Only for DeepSeek' },
    });
    expect(
      notesToOptions(
        drafts.at(-1)!,
        AGENTS.map((a) => a.id),
      ),
    ).toEqual({
      agentInstructions: {
        stack_opencode_main: 'Shared start',
        stack_deepseek_main: 'Only for DeepSeek',
      },
    });
  });

  it('goes back to the shared field without losing what was written there', () => {
    render(<Harness onDraft={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Note for all agents'), {
      target: { value: 'Keep me' },
    });
    const toggle = screen.getByRole('switch', { name: 'Different notes for each agent' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect((screen.getByLabelText('Note for all agents') as HTMLTextAreaElement).value).toBe(
      'Keep me',
    );
  });

  it('says what to do when no agent is selected in per-agent mode', () => {
    const onChange = vi.fn();
    render(
      <RunNotes
        agents={[]}
        value={{ shared: '', perAgent: true, agents: {} }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Select at least one agent to write its note.')).toBeTruthy();
  });
});

describe('the notes on the run page', () => {
  const summary = (userNotes?: Record<string, unknown>) =>
    ({
      run: {
        id: 'run_01K7777777777777777777777Q',
        projectId: 'proj_alpha',
        status: 'completed',
        mode: 'full',
        executionKind: 'production',
        configuration: {
          agentStackIds: ['stack_opencode_main', 'stack_deepseek_main'],
          ...(userNotes === undefined ? {} : { userNotes }),
        },
      },
      agentRuns: [],
      findings: [],
    }) as unknown as Record<string, unknown>;

  it('shows what the user wrote in the run summary, for everyone and for single agents', () => {
    render(
      <RunSummaryPanel
        snapshot={summary({
          createdAt: '2026-11-17T08:00:00.000Z',
          shared: 'Focus on login.',
          agents: { stack_deepseek_main: 'Check the parser.' },
        })}
      />,
    );
    const region = screen.getByRole('region', { name: 'User description / note' });
    expect(region.textContent).toContain('For all agents');
    expect(region.textContent).toContain('Focus on login.');
    expect(region.textContent).toContain('Check the parser.');
  });

  it('shows no notes section when nothing was written', () => {
    render(<RunSummaryPanel snapshot={summary()} />);
    expect(screen.queryByRole('region', { name: 'User description / note' })).toBeNull();
  });

  const view = projectAgentTelemetry({
    agentRun: makeAgentRun({ id: 'a', agentStackId: 'stack_opencode_main', status: 'completed' }),
    events: [],
    activities: [],
    findings: [],
    evidence: [],
  });

  it('shows an agent its note for everyone and its own note on its page', () => {
    render(
      <AgentInspector
        data={{ view, userNote: { shared: 'For everyone', own: 'Only for this agent' } }}
      />,
    );
    expect(screen.getByText('User description / note')).toBeTruthy();
    expect(screen.getByText('For everyone')).toBeTruthy();
    expect(screen.getByText('For this agent')).toBeTruthy();
    expect(screen.getByText('Only for this agent')).toBeTruthy();
  });

  it('shows no note card for an agent that was given none', () => {
    render(<AgentInspector data={{ view, userNote: {} }} />);
    expect(screen.queryByText('User description / note')).toBeNull();
  });
});
