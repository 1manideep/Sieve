// The Requests notice while auto-approve is on (40 sections 13.5 and 13.8.9).
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CATEGORIES } from '@sieve/shared';
import { REQUESTS } from '@/copy/screens-controls';
import { AUTO_APPROVE_KEY, useAutoApprove } from '@/state/autoApprove';
import { useGrants } from '@/state/grants';
import type { GrantView } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { formatClock } from '../settings/kit/when';
import { AutoApproveNotice, autoApproveNoticeText } from './RequestNotices';

const NOW = Date.now();
const DAY = 86_400_000;

function grant(over: Partial<GrantView>): GrantView {
  return {
    id: 'g1', aiName: 'Claude', maxStep: 'answer', allowedCategories: CATEGORIES.filter((c) => c !== 'Health'),
    allowedSources: ['gmail'], createdAt: NOW - DAY, expiresAt: NOW + 20 * DAY, linkHint: 'k3x9', state: 'active', ...over,
  };
}

let stop: () => void = () => undefined;

const noticeText = () => document.querySelector('[data-tone="warning"]')?.textContent ?? null;
const sentence = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

function renderNotice() {
  return render(
    <MemoryRouter>
      <main>
        <AutoApproveNotice />
      </main>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useGrants.setState({
    status: 'ready',
    grants: [grant({}), grant({ id: 'g2', aiName: 'ChatGPT' }), grant({ id: 'g3', aiName: 'Gemini' }), grant({ id: 'g4', aiName: 'Old', state: 'revoked', revokedAt: NOW - DAY })],
  });
  stop = useAutoApprove.getState().start('u1');
});

afterEach(() => {
  stop();
  window.localStorage.clear();
});

describe('AutoApproveNotice', () => {
  it('shows nothing while auto-approve is off', () => {
    const { container } = renderNotice();
    expect(container.querySelector('main')).toBeEmptyDOMElement();
  });

  it('names the connections, says until when, and links to Settings', async () => {
    const t1 = Date.now() + 30 * 60_000;
    const t2 = Date.now() + 90 * 60_000;
    window.localStorage.setItem(AUTO_APPROVE_KEY('u1'), JSON.stringify({ g1: t1, g2: t2, g4: t2 + 20 * 60_000 }));
    act(() => {
      stop();
      stop = useAutoApprove.getState().start('u1');
    });
    renderNotice();
    // The revoked connection is left out; the time is when the last one ends.
    const text = autoApproveNoticeText(['Claude', 'ChatGPT'], formatClock(t2));
    expect(text).toBe(`Auto-approving answers for Claude and ChatGPT until ${formatClock(t2)}. Stop in Settings.`);
    expect(screen.getByText(sentence(text))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: REQUESTS.autoApproveStop })).toHaveAttribute('href', '/settings#ais');
    await expectNoAxeViolations();
  });

  it('joins three names and goes away at once when the last one stops', () => {
    act(() => {
      useAutoApprove.getState().turnOn('g1');
      useAutoApprove.getState().turnOn('g2');
      useAutoApprove.getState().turnOn('g3');
    });
    renderNotice();
    expect(noticeText()).toMatch(/^Auto-approving answers for Claude, ChatGPT and Gemini until /);
    act(() => {
      useAutoApprove.getState().turnOff('g1');
      useAutoApprove.getState().turnOff('g2');
    });
    expect(noticeText()).toMatch(/^Auto-approving answers for Gemini until /);
    act(() => useAutoApprove.getState().turnOff('g3'));
    expect(noticeText()).toBeNull();
  });
});
