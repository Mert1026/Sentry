import { describe, expect, it } from 'vitest';
import {
  findingStats,
  formatDuration,
  runStats,
  type DashboardRun,
} from '../../src/renderer/lib/dashboard-stats.js';
import { translateText } from '../../src/renderer/lib/i18n.js';

const now = Date.parse('2026-11-26T12:00:00Z');
const at = (daysAgo: number, minutes = 0) =>
  new Date(now - daysAgo * 86_400_000 + minutes * 60_000).toISOString();
const run = (id: string, status: string, daysAgo: number, minutes?: number): DashboardRun => ({
  runId: id,
  projectId: 'p',
  status,
  startedAt: at(daysAgo),
  ...(minutes === undefined ? {} : { completedAt: at(daysAgo, minutes) }),
});

describe('dashboard run statistics', () => {
  const runs = [
    run('a', 'completed', 0, 20),
    run('b', 'completed', 1, 40),
    run('c', 'partial', 2, 30),
    run('d', 'failed', 3, 5),
    run('e', 'cancelled', 9, 1),
    run('f', 'agents_running', 0),
    run('g', 'completed', 30, 60),
  ];
  const stats = runStats(runs, now);

  it('counts runs, the last week and the completed share of finished runs', () => {
    expect(stats.total).toBe(7);
    expect(stats.last7Days).toBe(5);
    expect(stats.finished).toBe(6);
    // completed and partial count as completed; failed and cancelled do not
    expect(stats.completed).toBe(4);
    expect(stats.successRate).toBe(67);
  });

  it('takes the median duration of completed runs only', () => {
    // 20, 30, 40, 60 minutes -> 35
    expect(stats.medianDurationMs).toBe(35 * 60_000);
    expect(formatDuration(stats.medianDurationMs as number)).toBe('35 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min');
    expect(formatDuration(120 * 60_000)).toBe('2 h');
  });

  it('draws 14 days ending today, split by outcome, and lists the newest runs first', () => {
    expect(stats.daily).toHaveLength(14);
    const today = stats.daily.at(-1)!;
    expect(today).toMatchObject({ completed: 1, problem: 0, running: 1 });
    const total = stats.daily.reduce((sum, d) => sum + d.completed + d.problem + d.running, 0);
    // the 30-day-old run is outside the window
    expect(total).toBe(6);
    expect(
      stats.recent
        .map((r) => r.runId)
        .slice(0, 2)
        .sort(),
    ).toEqual(['a', 'f']);
    expect(stats.recent).toHaveLength(6);
  });

  it('has no rate or median before anything finished', () => {
    const empty = runStats([], now);
    expect(empty.successRate).toBeUndefined();
    expect(empty.medianDurationMs).toBeUndefined();
    expect(empty.daily.every((d) => d.completed + d.problem + d.running === 0)).toBe(true);
  });
});

describe('dashboard finding statistics', () => {
  it('totals findings by severity, confirmation and agent across projects', () => {
    const stats = findingStats([
      {
        revisions: [
          {
            agents: [
              {
                agentStackId: 'stack_claude_main',
                runs: [
                  {
                    findings: [
                      { id: '1', severity: 'high', confidence: 'confirmed' },
                      { id: '2', severity: 'medium', confidence: 'strong' },
                    ],
                  },
                ],
              },
              {
                agentStackId: 'stack_opencode_main',
                runs: [{ findings: [{ id: '3', severity: 'high', confidence: 'confirmed' }] }],
              },
            ],
          },
        ],
      },
      undefined,
      {
        revisions: [
          {
            agents: [
              {
                agentStackId: 'stack_claude_main',
                runs: [{ findings: [{ id: '4', severity: 'low' }] }],
              },
            ],
          },
        ],
      },
    ]);
    expect(stats.total).toBe(4);
    expect(stats.confirmed).toBe(2);
    expect(stats.bySeverity).toEqual({ critical: 0, high: 2, medium: 1, low: 1, info: 0 });
    expect(stats.byAgent).toEqual([
      { agentStackId: 'stack_claude_main', count: 3 },
      { agentStackId: 'stack_opencode_main', count: 1 },
    ]);
  });
});

describe('dashboard text in Bulgarian', () => {
  it('translates every label and note', () => {
    for (const text of [
      'Success rate',
      'Typical run time',
      'median of completed runs',
      'nothing running',
      'Ready to run',
      'WSL connected',
      'min',
      'Completed runs',
      'Median run time',
      'completed runs',
      'Runs in the last 14 days',
      'Failed or cancelled',
      'Findings by severity',
      'No findings reported yet.',
      'By agent',
      'No runs yet.',
      '12 in the last 7 days',
      '40 of 52 finished',
      '17 confirmed',
      '35 min',
      '2 h',
    ])
      expect(translateText(text, 'bg'), text).not.toBe(text);
  });
});
