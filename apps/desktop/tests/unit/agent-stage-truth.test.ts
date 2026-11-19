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
    // Commands were observed during planning, without proving runtime validation.
    expect(byId.get('runtime')).toBe('observed');
    for (const id of ['investigation', 'evidence', 'reporting', 'completed']) {
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

  describe('a running agent shows one line, with its marker at the head', () => {
    const running = (extra: Array<Record<string, unknown>> = []) => {
      const agentRun = makeAgentRun({ status: 'running' });
      const base = { agentRunId: agentRun.id, timestamp: '2026-11-19T09:00:00.000Z' };
      return projectAgentTelemetry({
        agentRun,
        events: [
          { type: 'run.started', ...base },
          { type: 'agent.status', ...base, status: 'planning' },
          { type: 'agent.status', ...base, status: 'running' },
          { type: 'file.read', ...base, relativePath: 'a.ts' },
          { type: 'tool.started', ...base, operationId: 'op1', tool: { name: 'Bash' } },
          { type: 'tool.completed', ...base, operationId: 'op1', tool: { name: 'Bash' } },
          ...extra,
        ] as never,
        activities: [],
        findings: [],
        evidence: [],
      });
    };
    const states = (view: ReturnType<typeof running>) => view.stages.map((stage) => stage.state);

    it('puts the active marker on the furthest stage, not on one the agent has already passed', () => {
      // The lifecycle says "running" (Investigation), but the commands (a later stage) already ran.
      const view = running();
      expect(states(view)).toEqual([
        'observed',
        'observed',
        'observed',
        'active',
        'not_started',
        'not_started',
        'not_started',
      ]);
      expect(view.currentStage).toBe('runtime');
    });

    it('does the same for a warning, so the striped bar sits at the head', () => {
      const view = running([
        { type: 'warning', agentRunId: 'a', timestamp: '2026-11-19T09:01:00.000Z', message: 'x' },
      ]);
      expect(states(view)).toEqual([
        'observed',
        'observed',
        'observed',
        'warning',
        'not_started',
        'not_started',
        'not_started',
      ]);
    });

    it('leaves a failure where it really happened', () => {
      const agentRun = makeAgentRun({ status: 'failed' });
      const base = { agentRunId: agentRun.id, timestamp: '2026-11-19T09:00:00.000Z' };
      const view = projectAgentTelemetry({
        agentRun,
        events: [
          { type: 'run.started', ...base },
          { type: 'agent.status', ...base, status: 'planning' },
          { type: 'tool.started', ...base, operationId: 'op1', tool: { name: 'Bash' } },
        ] as never,
        activities: [],
        findings: [],
        evidence: [],
      });
      expect(view.stages.find((stage) => stage.id === 'planning')?.state).toBe('failed');
      expect(view.currentStage).toBe('planning');
    });
  });
});
