// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasLegend } from '../../src/renderer/components/CanvasLegend.js';

afterEach(cleanup);

describe('the canvas legend', () => {
  it('names every severity colour of the findings bar and every stage colour', () => {
    render(<CanvasLegend />);
    const legend = screen.getByRole('region', { name: 'Legend' });
    for (const severity of ['critical', 'high', 'medium', 'low', 'info'])
      expect(legend.textContent).toContain(severity);
    for (const state of ['Completed', 'Observed', 'Active', 'Warning', 'Failed', 'Not observed'])
      expect(legend.textContent).toContain(state);
    expect(legend.querySelectorAll('.legend-swatch')).toHaveLength(5);
    expect(legend.querySelectorAll('.stage-dots i')).toHaveLength(6);
  });

  it('draws its swatches with the same colours as the boxes, so the two cannot drift apart', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    for (const name of ['critical', 'high', 'medium', 'low', 'info']) {
      const rule = new RegExp(
        String.raw`\.flow-node\.agent-node \.node-severity \.sev-${name},\s*\.legend-swatch\.sev-${name} \{([^}]*)\}`,
      ).exec(css)?.[1];
      expect(rule, name).toContain('var(--sev-' + name + ')');
    }
    for (const tone of ['done', 'observed', 'active', 'warning', 'failed'])
      expect(css).toContain(
        '.canvas-legend .stage-dots i.' + tone + ',\n.flow-node .stage-dots i.' + tone,
      );
  });
});
