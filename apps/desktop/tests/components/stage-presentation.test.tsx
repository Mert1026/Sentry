import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentInspector } from '../../src/renderer/components/AgentInspector.js';
import { AgentCanvasNode } from '../../src/renderer/components/nodes/AgentCanvasNode.js';
import { projectAgentTelemetry, projectTimeline } from '../../src/renderer/lib/agent-telemetry.js';
import type { HarnessEventLike } from '../../src/renderer/lib/types.js';
import { makeAgentRun } from '../fixtures.js';

afterEach(cleanup);
const timestamp = '2026-10-12T01:02:03Z';
function telemetry(status = 'completed', events: HarnessEventLike[] = []) {
  return projectAgentTelemetry({
    agentRun: makeAgentRun({ id: 'a', agentStackId: 'stack_opencode_main', status }),
    events,
    activities: [],
    findings: [],
    evidence: [],
  });
}
function canvas(view?: ReturnType<typeof telemetry>, status = 'waiting') {
  return render(
    <ReactFlowProvider>
      {React.createElement(AgentCanvasNode, {
        id: 'a',
        type: 'agentNode',
        selected: false,
        zIndex: 1,
        isConnectable: false,
        xPos: 0,
        yPos: 0,
        dragging: false,
        data: { label: 'OpenCode', status, payload: { view, agentStackId: 'stack_opencode_main' } },
      } as never)}
    </ReactFlowProvider>,
  );
}

/** Each stage row of the inspector as "label — state", read from the timeline. */
function stageRows(): string[] {
  return [...document.querySelectorAll('.stage-step')].map(
    (row) =>
      (row.querySelector('.stage-step-label')?.textContent ?? '') +
      ' — ' +
      (row.querySelector('.stage-step-state')?.textContent ?? ''),
  );
}

describe('observed stage and activity presentation', () => {
  it('classifies generic output as Message and preserves content, time and agent attribution', () => {
    const event = {
      type: 'agent.message',
      agentRunId: 'a',
      timestamp,
      message: 'Inspecting fixture files',
    };
    expect(projectTimeline([event], [])).toEqual([
      {
        timestamp,
        category: 'Message',
        title: 'Agent message — Inspecting fixture files',
        status: 'agent.message',
      },
    ]);
    expect(event.agentRunId).toBe('a');
    expect(telemetry('running', [event]).stages.find((s) => s.id === 'reporting')?.state).toBe(
      'not_started',
    );
  });

  it('an explicit reporting signal establishes Reporting as active without completing other stages', () => {
    const view = telemetry('running', [
      { type: 'agent.status', status: 'reporting', agentRunId: 'a', timestamp },
    ]);
    render(<AgentInspector data={{ view }} />);
    expect(stageRows()).toContain('Reporting — Active');
    expect(stageRows()).toContain('Planning — No events');
    expect(view.currentStage).toBe('reporting');
    expect(view.stages.some((s) => s.state === 'completed')).toBe(false);
  });

  it('shows the stages as a timeline with how many were reached and a state on each step', () => {
    const view = telemetry('completed', [
      { type: 'file.read', relativePath: 'fixture.ts', agentRunId: 'a', timestamp },
    ]);
    render(<AgentInspector data={{ view }} />);
    const timeline = screen.getByRole('region', { name: 'Stages' });
    const steps = [...timeline.querySelectorAll('.stage-step')];
    expect(steps).toHaveLength(view.stages.length);
    expect(steps.map((step) => step.getAttribute('data-state'))).toEqual(
      view.stages.map((stage) => stage.state),
    );
    // The count is the position of the furthest stage reached.
    const furthest = view.stages.reduce(
      (last, stage, index) => (stage.state === 'not_started' ? last : index),
      -1,
    );
    expect(timeline.querySelector('.stage-timeline-count')?.textContent).toBe(
      furthest + 1 + '/' + view.stages.length,
    );
  });

  it('a sparse historical completion shows the milestones it passed as having no events', () => {
    const view = telemetry();
    render(<AgentInspector data={{ view }} />);
    for (const label of [
      'Preparation',
      'Planning',
      'Investigation',
      'Commands / Tests',
      'Reporting',
      'Evidence',
    ]) {
      expect(stageRows()).toContain(label + ' — No events');
    }
    expect(stageRows()).toContain('Completed — Completed');
    expect(screen.queryByText(/not_started|Not started/)).toBeNull();
    expect(view.stages.filter((s) => s.state === 'completed')).toHaveLength(1);
  });

  it('preserves observed milestones in readable inspector and accessible canvas labels', () => {
    const view = telemetry('completed', [
      { type: 'file.read', relativePath: 'fixture.ts', agentRunId: 'a', timestamp },
    ]);
    render(<AgentInspector data={{ view }} />);
    expect(stageRows()).toContain('Investigation — Observed');
    cleanup();
    canvas(view);
    const stages = screen.getByRole('img', {
      name: /Stage:.*Investigation Observed.*Commands \/ Tests No events/,
    });
    expect(stages.querySelector('[title="Investigation — Observed"]')?.className).toBe('observed');
    expect(screen.getByLabelText('OpenCode completed')).toBeTruthy();
    expect(stages.getAttribute('aria-label')).not.toContain('not_started');
  });

  it.each([
    ['waiting', 'Waiting'],
    ['not_started', 'Not started'],
  ])('a selected worker without an AgentRun stays %s', (status, label) => {
    canvas(undefined, status);
    expect(screen.getByText('Configured · ' + label)).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Stage:/ })).toBeNull();
  });

  it('messages remain in All activity, preserve event detail, and do not leak into category filters', () => {
    const events: HarnessEventLike[] = [
      { type: 'agent.message', message: 'Inspecting fixture files', agentRunId: 'a', timestamp },
      {
        type: 'command.executed',
        command: 'fixture command',
        exitCode: 0,
        agentRunId: 'a',
        timestamp,
      },
    ];
    render(
      <AgentInspector
        initialTab="activity"
        data={{ view: telemetry('completed', events), events }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Agent message — Inspecting fixture files · Message' }),
    ).toBeTruthy();
    expect(screen.queryByText('· Reporting')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Inspect event Agent message — Inspecting fixture files',
      }),
    );
    expect(screen.getByText(timestamp)).toBeTruthy();
    expect(screen.getByText('Inspecting fixture files')).toBeTruthy();
    for (const filter of ['Files', 'Commands', 'Tests', 'Findings', 'Warnings']) {
      fireEvent.click(screen.getByRole('button', { name: filter, exact: true }));
      expect(screen.queryByRole('button', { name: /Agent message/ })).toBeNull();
      if (filter === 'Commands')
        expect(
          screen.getByRole('button', { name: 'fixture command — exit 0 · Command' }),
        ).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'All', exact: true }));
    expect(
      screen.getByRole('button', { name: 'Agent message — Inspecting fixture files · Message' }),
    ).toBeTruthy();
  });
});
