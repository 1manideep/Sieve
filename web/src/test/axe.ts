// Runs axe on rendered markup (60 section 3.4: every screen state test runs axe and asserts no violations).
import axe from 'axe-core';
import { expect } from 'vitest';

export async function expectNoAxeViolations(node: Element = document.body): Promise<void> {
  const result = await axe.run(node, {
    rules: {
      // jsdom does not compute layout or colours; contrast is checked in e2e (40 section 14.4).
      'color-contrast': { enabled: false },
    },
  });
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(summary).toEqual([]);
}
