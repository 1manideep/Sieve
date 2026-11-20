import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RedactedText, splitRedactions } from './RedactedText';

describe('RedactedText', () => {
  it('turns each token from the privacy pipeline into a chip and keeps the text exactly', () => {
    const text = 'Hi [name 1], call [phone] about [card ending 1111]. Link: [link: login.example]. [removed: a sentence that looked like an instruction to an AI]';
    const { container } = render(<p><RedactedText text={text} /></p>);
    const chips = [...container.querySelectorAll('[title="Hidden on this device"]')].map((c) => c.textContent);
    expect(chips).toEqual(['[name 1]', '[phone]', '[card ending 1111]', '[link: login.example]', '[removed: a sentence that looked like an instruction to an AI]']);
    expect(container.textContent).toBe(text);
  });

  it('handles adjacent tokens and text without tokens; ordinary brackets stay text', () => {
    expect(splitRedactions('[name][address]')).toEqual([
      { kind: 'redaction', text: '[name]' },
      { kind: 'redaction', text: '[address]' },
    ]);
    expect(splitRedactions('No details here.')).toEqual([{ kind: 'text', text: 'No details here.' }]);
    const { container } = render(<p><RedactedText text="Totals [see table 3] and [OK]" /></p>);
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
    expect(container.textContent).toBe('Totals [see table 3] and [OK]');
  });

  it('renders markup in content as text, never as HTML', () => {
    const { container } = render(<p><RedactedText text={'<img src=x onerror="window.__xss=1"> [name]'} /></p>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror="window.__xss=1"> [name]');
  });
});
