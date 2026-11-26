import { describe, expect, it } from 'vitest';
import { projectAgentTelemetry } from '../../src/renderer/lib/agent-telemetry.js';
import { makeAgentRun } from '../fixtures.js';

describe('agent stage truth', () => {
  it('queued + no events marks no future stage completed', () => {
    const agentRun = makeAgentRun({ status: 'queued' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [],
      activities: [],
      findings: [],
      evidence: [],
    });
    expect(view.currentStage).toBe('working');
    expect(view.stages.filter((s) => s.state === 'completed')).toHaveLength(0);
  });

  it('starting + no events activates Preparation without completing futures', () => {
    const agentRun = makeAgentRun({ status: 'starting' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [],
      activities: [],
      findings: [],
      evidence: [],
    });
    expect(view.currentStage).toBe('preparation');
    const byId = new Map(view.stages.map((s) => [s.id, s.state]));
    expect(byId.get('preparation')).toBe('active');
    for (const id of ['planning', 'investigation', 'runtime', 'evidence', 'reporting']) {
      expect(byId.get(id)).toBe('not_started');
    }
  });

  it('agent.status planning activates Planning', () => {
    const agentRun = makeAgentRun({ status: 'planning' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        {
          type: 'agent.status',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:14:10.000Z',
          status: 'planning',
        },
      ],
      activities: [],
      findings: [],
      evidence: [],
    });
    expect(view.currentStage).toBe('planning');
  });

  it('file.read activates Investigation', () => {
    const agentRun = makeAgentRun({ status: 'running' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        {
          type: 'file.read',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:14:19.000Z',
          relativePath: 'src/a.ts',
        },
      ],
      activities: [],
      findings: [],
      evidence: [],
    });
    expect(view.currentStage).toBe('investigation');
  });

  it('tool.started activates Runtime Validation', () => {
    const agentRun = makeAgentRun({ status: 'running' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        {
          type: 'tool.started',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:14:42.000Z',
          operationId: 'op_1',
          tool: { name: 'shell' },
        },
      ],
      activities: [],
      findings: [],
      evidence: [],
    });
    expect(view.currentStage).toBe('runtime');
  });

  it('finding.submitted activates Evidence', () => {
    const agentRun = makeAgentRun({ status: 'running' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        {
          type: 'finding.submitted',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:15:03.000Z',
          finding: { title: 't', severity: 'high' },
        } as never,
      ],
      activities: [],
      findings: [],
      evidence: [],
    });
    expect(view.currentStage).toBe('evidence');
  });

  it('agent.message after evidence retains Evidence without inventing Reporting', () => {
    const agentRun = makeAgentRun({ status: 'running' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        {
          type: 'finding.submitted',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:15:03.000Z',
          finding: { title: 't', severity: 'high' },
        } as never,
        {
          type: 'agent.message',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:16:00.000Z',
          message: 'Summary of findings for review',
        } as never,
      ],
      activities: [],
      findings: [{ id: 'f1', agentRunId: agentRun.id, severity: 'high', title: 't' }],
      evidence: [],
    });
    expect(view.currentStage).toBe('evidence');
    expect(view.currentOperation.title).toBe('Agent message');
  });

  it('usage.updated after evidence retains Evidence', () => {
    const agentRun = makeAgentRun({ status: 'running' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        {
          type: 'evidence.submitted',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:15:03.000Z',
          evidence: { id: 'e1', type: 'test' },
        } as never,
        {
          type: 'usage.updated',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:16:00.000Z',
          usage: { inputTokens: 10 },
        } as never,
      ],
      activities: [],
      findings: [],
      evidence: [{ id: 'e1', agentRunId: agentRun.id, type: 'test' }],
    });
    expect(view.currentStage).toBe('evidence');
  });

  it('run.completed proves completion without inventing unobserved stages', () => {
    const agentRun = makeAgentRun({ status: 'completed' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        { type: 'run.completed', agentRunId: agentRun.id, timestamp: '2026-09-18T22:17:20.000Z' },
      ],
      activities: [],
      findings: [],
      evidence: [],
    });
    expect(view.currentStage).toBe('completed');
    expect(view.stages.filter((s) => s.state === 'completed').map((s) => s.id)).toEqual([
      'completed',
    ]);
  });

  it('planning tool failures with messages stay in Planning, never Reporting', () => {
    // Production regression (run_01M33YXNW80W2Q7H1HK5EA5K7Q): planning Bash
    // failures emit agent.message tool-result texts. Those must not
    // promote the run to Reporting nor complete later stages.
    const agentRun = makeAgentRun({ status: 'failed' });
    const base = { agentRunId: agentRun.id, timestamp: '2026-09-22T07:05:31.000Z' };
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        { type: 'run.started', ...base },
        { type: 'agent.status', ...base, status: 'planning' },
        { type: 'tool.started', ...base, operationId: 'op1', tool: { name: 'Bash' } },
        {
          type: 'tool.completed',
          ...base,
          operationId: 'op1',
          tool: { name: 'Bash', errorPreview: "Exit code 1 bwrap: Can't mkdir X" },
        },
        { type: 'agent.message', ...base, message: 'tool Bash result: bwrap ...' },
        { type: 'tool.started', ...base, operationId: 'op2', tool: { name: 'Bash' } },
        {
          type: 'tool.completed',
          ...base,
          operationId: 'op2',
          tool: { name: 'Bash', errorPreview: "Exit code 1 bwrap: Can't mkdir X" },
        },
        { type: 'tool.started', ...base, operationId: 'op3', tool: { name: 'Bash' } },
        {
          type: 'tool.completed',
          ...base,
          operationId: 'op3',
          tool: { name: 'Bash', errorPreview: "Exit code 1 bwrap: Can't mkdir X" },
        },
        {
          type: 'run.failed',
          ...base,
          failure: { code: 'GLM_TOOL_PERMISSION_UNAVAILABLE', message: 'tool layer down' },
        },
      ],
      activities: [],
      findings: [],
      evidence: [],
    });
    const byId = new Map(view.stages.map((s) => [s.id, s.state]));
    expect(byId.get('preparation')).toBe('observed');
    expect(byId.get('planning')).toBe('failed');
    // Commands ran during planning, but the line ends at Planning: nothing after it reads as seen.
    for (const id of ['investigation', 'runtime', 'evidence', 'reporting', 'completed']) {
      expect(byId.get(id)).toBe('not_started');
    }
    expect(view.currentStage).toBe('planning');
  });

  it('failure never completes future stages', () => {
    const agentRun = makeAgentRun({ status: 'failed' });
    const view = projectAgentTelemetry({
      agentRun,
      events: [
        {
          type: 'file.read',
          agentRunId: agentRun.id,
          timestamp: '2026-09-18T22:14:19.000Z',
          relativePath: 'a.ts',
        },
      ],
      activities: [],
      findings: [],
      evidence: [],
    });
    const byId = new Map(view.stages.map((s) => [s.id, s.state]));
    expect(byId.get('investigation')).toBe('failed');
    for (const id of ['runtime', 'evidence', 'reporting', 'completed']) {
      expect(byId.get(id)).toBe('not_started');
    }
  });
});

describe('stage line during a live investigation (the run the screenshot came from)', () => {
  const agentRun = makeAgentRun({ status: 'running' });
  const at = (second: number) => ({
    agentRunId: agentRun.id,
    timestamp: '2026-11-25T06:52:' + String(second).padStart(2, '0') + '.000Z',
  });
  const events = [
    { type: 'run.started', ...at(1) },
    // an early notice from preparation
    { type: 'warning', ...at(2), code: 'QA_PREPARATION_LIMITED', message: 'pinned pnpm only' },
    { type: 'agent.status', ...at(3), status: 'planning', message: 'OpenCode is creating a plan.' },
    { type: 'tool.started', ...at(4), operationId: 'op1', tool: { name: 'read' } },
    { type: 'tool.completed', ...at(5), operationId: 'op1', tool: { name: 'read' } },
    {
      type: 'agent.status',
      ...at(6),
      status: 'investigating',
      message: 'OpenCode is investigating check 3/8: OrderedMap order',
    },
    { type: 'tool.started', ...at(7), operationId: 'op2', tool: { name: 'bash' } },
    { type: 'tool.completed', ...at(8), operationId: 'op2', tool: { name: 'bash', exitCode: 0 } },
    { type: 'usage.updated', ...at(9) },
  ];
  // the run's own activity stays running until the agent ends
  const activities = [
    {
      id: 'act1',
      kind: 'agent',
      status: 'running',
      title: 'Agent started',
      startedAt: at(1).timestamp,
    },
  ];
  const view = () =>
    projectAgentTelemetry({ agentRun, events, activities, findings: [], evidence: [] } as never);

  it('ends the line at Commands / Tests while the agent runs commands, with nothing seen after it', () => {
    const v = view();
    const byId = new Map(v.stages.map((s) => [s.id, s.state]));
    expect(v.currentStage).toBe('runtime');
    expect(byId.get('investigation')).toBe('observed');
    expect(byId.get('runtime')).toBe('active');
    for (const id of ['evidence', 'reporting', 'completed'])
      expect(byId.get(id)).toBe('not_started');
  });

  it('does not keep an early warning on the stage in progress', () => {
    expect(view().stages.some((s) => s.state === 'warning')).toBe(false);
  });

  it('marks the stage when a warning comes during the current step', () => {
    const warned = projectAgentTelemetry({
      agentRun,
      events: [...events, { type: 'warning', ...at(10), code: 'QA_APPROACH_CHANGE', message: 'x' }],
      activities,
      findings: [],
      evidence: [],
    } as never);
    expect(warned.stages.find((s) => s.id === 'runtime')?.state).toBe('warning');
  });

  it('shows the agent step, not "Agent started" or a usage update, as the current operation', () => {
    expect(view().currentOperation.title).toBe(
      'OpenCode is investigating check 3/8: OrderedMap order',
    );
  });

  it('shows a tool in flight as the current operation', () => {
    const busy = projectAgentTelemetry({
      agentRun,
      events: [
        ...events,
        { type: 'tool.started', ...at(11), operationId: 'op3', tool: { name: 'bash' } },
      ],
      activities,
      findings: [],
      evidence: [],
    } as never);
    expect(busy.currentOperation.title).toBe('Tool started: bash');
  });
});

describe('Evidence comes after Reporting: findings arrive with the report', () => {
  const agentRun = makeAgentRun({ status: 'running' });
  const base = { agentRunId: agentRun.id, timestamp: '2026-11-25T07:18:14.000Z' };
  const upToReport = [
    { type: 'run.started', ...base },
    { type: 'agent.status', ...base, status: 'planning' },
    { type: 'agent.status', ...base, status: 'investigating' },
    { type: 'tool.started', ...base, operationId: 'op1', tool: { name: 'bash' } },
    { type: 'tool.completed', ...base, operationId: 'op1', tool: { name: 'bash' } },
    { type: 'agent.status', ...base, status: 'reporting' },
  ];
  const finding = {
    type: 'finding.submitted',
    ...base,
    finding: { title: 'slice(-3) wrong', severity: 'medium' },
  };
  const project = (events: unknown[], status = 'running', findings: unknown[] = []) =>
    projectAgentTelemetry({
      agentRun: makeAgentRun({ status: status as never }),
      events,
      activities: [],
      findings,
      evidence: [],
    } as never);
  const order = (view: ReturnType<typeof project>) => view.stages.map((s) => s.id);

  it('lists the stages in the order they happen', () => {
    expect(order(project(upToReport))).toEqual([
      'preparation',
      'planning',
      'investigation',
      'runtime',
      'reporting',
      'evidence',
      'completed',
    ]);
  });

  it('while the report is written, the line ends at Reporting with nothing after it', () => {
    const byId = new Map(project(upToReport).stages.map((s) => [s.id, s.state]));
    expect(byId.get('runtime')).toBe('observed');
    expect(byId.get('reporting')).toBe('active');
    expect(byId.get('evidence')).toBe('not_started');
  });

  it('once the findings arrive, the line moves on to Evidence and every step before it was seen', () => {
    const view = project([...upToReport, finding], 'running', [{ severity: 'medium' }]);
    const byId = new Map(view.stages.map((s) => [s.id, s.state]));
    expect(view.currentStage).toBe('evidence');
    expect(byId.get('reporting')).toBe('observed');
    expect(byId.get('evidence')).toBe('active');
    expect(view.stages.slice(0, 5).every((s) => s.state === 'observed')).toBe(true);
  });

  it('a clean run with no findings shows Evidence as passed with no events, not as never reached', async () => {
    const { stageDisplayLabel } = await import('../../src/renderer/lib/agent-telemetry.js');
    const view = project([...upToReport, { type: 'run.completed', ...base }], 'completed');
    const evidence = view.stages.findIndex((s) => s.id === 'evidence');
    expect(view.stages[evidence]?.state).toBe('not_started');
    expect(stageDisplayLabel(view.stages, evidence)).toBe('No events');
    expect(stageDisplayLabel(view.stages, view.stages.length - 1)).toBe('Completed');
  });
});
