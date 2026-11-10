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
    expect(html).toContain('1 finding');
    expect(html).toContain('4 evidence');
    expect(html).not.toContain('Thinking');
    expect(html).not.toContain('%');
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
    const footer = html.slice(html.indexOf('class="metrics"'));
    expect(footer).not.toContain('Elapsed time');
    expect(footer.match(/metric-chip/g)).toHaveLength(2);
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

  it('styles that stage as yellow diagonal stripes that blink, with no other colour', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const rule = /\.flow-node \.stage-dots i\.warning \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('repeating-linear-gradient');
    expect(rule).toContain('animation: stage-breathe');
    expect(rule).toContain('var(--running)');
    expect(rule).not.toMatch(/black|#000|rgba?\(0,\s*0,\s*0/);
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
});
