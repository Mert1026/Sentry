import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import React from 'react';
import { AgentCanvasNode } from '../../src/renderer/components/nodes/AgentCanvasNode.js';
import { makeAgentNodeView } from '../fixtures.js';

function withFlow(element: React.ReactElement): React.ReactElement {
  return React.createElement(ReactFlowProvider, null, element);
}

describe('canvas node components', () => {
  it('renders the agent signature: name, model, stage, operation, counts', () => {
    const view = makeAgentNodeView();
    const html = renderToStaticMarkup(
      withFlow(
        React.createElement(AgentCanvasNode, {
          id: 'agent-x',
          type: 'agentNode',
          selected: false,
          zIndex: 1,
          isConnectable: false,
          xPos: 0,
          yPos: 0,
          dragging: false,
          data: {
            label: view.displayName,
            status: view.status,
            kind: 'agent',
            payload: { view, agentStackId: view.agentStackId },
          },
        } as never),
      ),
    );
    expect(html).toContain('Muse');
    expect(html).toContain('muse-spark-1.3-contributor');
    expect(html).toContain('Read src/auth/session.ts');
    // Each count is a number with its word under it.
    expect(html).toContain('<strong>1</strong><span>finding</span>');
    expect(html).toContain('<strong>4</strong><span>evidence</span>');
    expect(html).not.toContain('Thinking');
    expect(html).not.toContain('%');
  });

  it('shows the model without its provider prefix, and keeps the full id in the tooltip', () => {
    const view = { ...makeAgentNodeView(), model: 'opencode-go/muse-spark-1.3-contributor' };
    const html = renderToStaticMarkup(
      withFlow(
        React.createElement(AgentCanvasNode, {
          id: 'agent-x',
          type: 'agentNode',
          selected: false,
          zIndex: 1,
          isConnectable: false,
          xPos: 0,
          yPos: 0,
          dragging: false,
          data: {
            label: view.displayName,
            status: view.status,
            kind: 'agent',
            payload: { view, agentStackId: view.agentStackId },
          },
        } as never),
      ),
    );
    expect(html).toContain(
      'title="opencode-go/muse-spark-1.3-contributor">muse-spark-1.3-contributor<',
    );
  });

  it('shows how far the agent got and where, and a severity bar for its findings', () => {
    const base = makeAgentNodeView({ status: 'running' });
    const view = {
      ...base,
      findingsCount: 4,
      severityCounts: { critical: 1, medium: 3 },
      stages: base.stages.map((stage, index) => ({
        ...stage,
        state:
          index < 3
            ? ('completed' as const)
            : index === 3
              ? ('active' as const)
              : ('not_started' as const),
      })),
    };
    const html = renderToStaticMarkup(
      withFlow(
        React.createElement(AgentCanvasNode, {
          id: 'agent-x',
          type: 'agentNode',
          selected: false,
          zIndex: 1,
          isConnectable: false,
          xPos: 0,
          yPos: 0,
          dragging: false,
          data: {
            label: view.displayName,
            status: view.status,
            kind: 'agent',
            payload: { view, agentStackId: view.agentStackId },
          },
        } as never),
      ),
    );
    expect(html).toContain('<span class="node-stage-count">4/' + view.stages.length + '</span>');
    expect(html).toContain('aria-label="1 critical, 3 medium"');
    // Widths come from flex proportions, never from percentages.
    expect(html).toContain('class="sev-critical" style="flex-grow:1"');
    expect(html).toContain('class="sev-medium" style="flex-grow:3"');
  });

  it('draws the stage bars as one line: a stage no event showed, before the furthest one, is passed', () => {
    const base = makeAgentNodeView({ status: 'running' });
    const states = [
      'observed',
      'observed',
      'observed',
      'observed',
      'not_started',
      'warning',
      'not_started',
    ] as const;
    const view = {
      ...base,
      stages: base.stages.map((stage, index) => ({ ...stage, state: states[index]! })),
    };
    const html = renderToStaticMarkup(
      withFlow(
        React.createElement(AgentCanvasNode, {
          id: 'agent-x',
          type: 'agentNode',
          selected: false,
          zIndex: 1,
          isConnectable: false,
          xPos: 0,
          yPos: 0,
          dragging: false,
          data: {
            label: view.displayName,
            status: view.status,
            kind: 'agent',
            payload: { view, agentStackId: view.agentStackId },
          },
        } as never),
      ),
    );
    const bars = [...html.matchAll(/<i class="([^"]*)" title="([^"]*)"/g)].map((m) => m[1]);
    // Evidence (5th) was never seen, but Reporting (6th) was reached: it is drawn as passed, not as empty.
    expect(bars).toEqual(['observed', 'observed', 'observed', 'observed', 'passed', 'warning', '']);
    // Its tooltip still says nothing claims it was seen.
    expect(html).toContain('title="Evidence — Not observed"');
    // The count is the position of the furthest stage, so it agrees with the bars and the stage word.
    expect(html).toContain('<span class="node-stage-count">6/7</span>');
  });

  it('fills the bars up to the stage the agent is in and leaves the rest empty, whatever else was observed', () => {
    const render = (states: readonly string[]) => {
      const base = makeAgentNodeView({ status: 'running' });
      const view = {
        ...base,
        stages: base.stages.map((stage, index) => ({ ...stage, state: states[index]! as never })),
      };
      const html = renderToStaticMarkup(
        withFlow(
          React.createElement(AgentCanvasNode, {
            id: 'agent-x',
            type: 'agentNode',
            selected: false,
            zIndex: 1,
            isConnectable: false,
            xPos: 0,
            yPos: 0,
            dragging: false,
            data: {
              label: view.displayName,
              status: view.status,
              kind: 'agent',
              payload: { view, agentStackId: view.agentStackId },
            },
          } as never),
        ),
      );
      return {
        bars: [...html.matchAll(/<i class="([^"]*)" title="/g)].map((m) => m[1]),
        html,
      };
    };
    // Planning, although commands already ran (they happen inside the phase): the commands bar stays empty.
    const planning = render([
      'observed',
      'warning',
      'not_started',
      'observed',
      'not_started',
      'not_started',
      'not_started',
    ]);
    expect(planning.bars).toEqual(['observed', 'warning', '', '', '', '', '']);
    expect(planning.html).toContain('<span class="node-stage-count">2/7</span>');
    // Investigating with commands and findings observed after it: still nothing filled after the marker.
    const investigating = render([
      'observed',
      'observed',
      'warning',
      'observed',
      'observed',
      'not_started',
      'not_started',
    ]);
    expect(investigating.bars).toEqual(['observed', 'observed', 'warning', '', '', '', '']);
    expect(investigating.html).toContain('<span class="node-stage-count">3/7</span>');
  });

  it('keeps every line of the agent node inside its width', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    expect(css).toMatch(/\.flow-node\.agent-node \{[^}]*width: 244px/);
    expect(css).toMatch(/\.flow-node\.agent-node \.node-name \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.flow-node\.agent-node \.node-stat span \{[^}]*text-overflow: ellipsis/);
  });

  it('has no clock chip in the footer, only the counts', () => {
    const view = makeAgentNodeView({ status: 'completed', elapsedMs: 102_000 });
    const html = renderToStaticMarkup(
      withFlow(
        React.createElement(AgentCanvasNode, {
          id: 'agent-x',
          type: 'agentNode',
          selected: false,
          zIndex: 1,
          isConnectable: false,
          xPos: 0,
          yPos: 0,
          dragging: false,
          data: {
            label: view.displayName,
            status: view.status,
            kind: 'agent',
            payload: { view, agentStackId: view.agentStackId },
          },
        } as never),
      ),
    );
    const footer = html.slice(html.indexOf('class="node-stats"'));
    expect(footer).not.toContain('Elapsed time');
    expect(footer.match(/class="node-stat[ "]/g)).toHaveLength(2);
    // The time stays in the status line under the name.
    expect(html).toContain('01:42');
  });

  it('marks the stage where the agent hit a warning, so it can blink in yellow stripes', () => {
    const base = makeAgentNodeView();
    const view = {
      ...base,
      stages: base.stages.map((stage) =>
        stage.id === 'investigation' ? { ...stage, state: 'warning' as const } : stage,
      ),
    };
    const html = renderToStaticMarkup(
      withFlow(
        React.createElement(AgentCanvasNode, {
          id: 'agent-x',
          type: 'agentNode',
          selected: false,
          zIndex: 1,
          isConnectable: false,
          xPos: 0,
          yPos: 0,
          dragging: false,
          data: {
            label: view.displayName,
            status: view.status,
            kind: 'agent',
            payload: { view, agentStackId: view.agentStackId },
          },
        } as never),
      ),
    );
    expect(html).toMatch(/<i class="warning"[^>]*title="Investigation — Warning"/);
  });

  it('styles that stage as calm yellow diagonal stripes, with no other colour and no strong glow', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const rule = /\.flow-node \.stage-dots i\.warning \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('repeating-linear-gradient');
    expect(rule).toContain('animation: stage-breathe-soft');
    expect(rule).not.toMatch(/black|#000|rgba?\(0,\s*0,\s*0/);
    // Every colour in it is the same yellow.
    const colours = rule.match(/rgba?\([^)]*\)/g) ?? [];
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) expect(colour).toMatch(/^rgba\(212, 192, 11,/);
    // A faint glow (not the active stage's 0.75) and a shallow blink (not the active stage's 0.45).
    const glow = Number(/box-shadow:[^;]*rgba\(212, 192, 11, ([\d.]+)\)/.exec(rule)?.[1]);
    expect(glow).toBeLessThanOrEqual(0.3);
    const lowest = Number(
      /@keyframes stage-breathe-soft \{[\s\S]*?50% \{\s*opacity: ([\d.]+);/.exec(css)?.[1],
    );
    expect(lowest).toBeGreaterThanOrEqual(0.7);
  });

  it('renders waiting placeholders for unstarted agents', () => {
    const html = renderToStaticMarkup(
      withFlow(
        React.createElement(AgentCanvasNode, {
          id: 'agent-x',
          type: 'agentNode',
          selected: false,
          zIndex: 1,
          isConnectable: false,
          xPos: 0,
          yPos: 0,
          dragging: false,
          data: {
            label: 'GLM',
            status: 'waiting',
            kind: 'agent',
            payload: { agentStackId: 'stack_glm_main' },
          },
        } as never),
      ),
    );
    expect(html).toContain('Waiting');
  });

  it('shows the secrets light in the agent box only when the agent reported on it', () => {
    const render = (secrets?: { state: 'found' | 'clear' | 'unclear' }) => {
      const view = makeAgentNodeView({ status: 'completed', ...(secrets ? { secrets } : {}) });
      return renderToStaticMarkup(
        withFlow(
          React.createElement(AgentCanvasNode, {
            id: 'agent-x',
            type: 'agentNode',
            selected: false,
            zIndex: 1,
            isConnectable: false,
            xPos: 0,
            yPos: 0,
            dragging: false,
            data: {
              label: view.displayName,
              status: view.status,
              kind: 'agent',
              payload: { view, agentStackId: view.agentStackId },
            },
          } as never),
        ),
      );
    };
    expect(render()).not.toContain('secrets-light');
    expect(render({ state: 'found' })).toContain('secrets-light found');
    expect(render({ state: 'found' })).toContain('Secrets found');
    expect(render({ state: 'clear' })).toContain('secrets-light clear');
    expect(render({ state: 'unclear' })).toContain('secrets-light unclear');
  });
});
