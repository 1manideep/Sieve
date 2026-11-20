import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { relayResultLine, RelayResult } from './RelayResult';

const ai = 'Gemini CLI';

describe('RelayResult', () => {
  it('every result line of 40 section 16.14', () => {
    expect(relayResultLine({ kind: 'sent', step: 'answer', itemCount: 1, by: 'app' }, ai, 'the answer')).toBe('Sent the answer to Gemini CLI. Receipt saved.');
    expect(relayResultLine({ kind: 'declined', by: 'extension' }, ai, '')).toBe('Denied. Gemini CLI was told you declined.');
    expect(relayResultLine({ kind: 'auto', status: 'blocked' }, ai, '', 'Health')).toBe(
      'Health is never shared, so Sieve told Gemini CLI no. Nothing left this device, and no model read the item.',
    );
    expect(relayResultLine({ kind: 'auto', status: 'no-match' }, ai, '')).toBe('Nothing on this device matched, so Sieve told Gemini CLI it found nothing.');
    expect(relayResultLine({ kind: 'auto', status: 'error' }, ai, '')).toBe(
      "Sieve couldn't prepare an answer, so it told Gemini CLI to try again later. Nothing was shared.",
    );
    expect(relayResultLine({ kind: 'ended', status: 'expired' }, ai, '')).toBe('This request expired before you answered it. Nothing was sent.');
    expect(relayResultLine({ kind: 'ended', status: 'revoked' }, ai, '')).toBe("Gemini CLI's connection was revoked, so this request was cancelled.");
  });

  it('after a share: the line, "See what AI has seen" and Done', async () => {
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <main>
          <RelayResult result={{ kind: 'sent', step: 'excerpt', itemCount: 1, by: 'app' }} aiName={ai} stepPhrase="an excerpt" onDone={onDone} />
        </main>
      </MemoryRouter>,
    );
    expect(screen.getByText('Sent an excerpt to Gemini CLI. Receipt saved.')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: 'See what AI has seen' })).toHaveAttribute('href', '/seen');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });
});
