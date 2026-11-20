// Settings (40 section 13.8): every card's states with axe and exact copy, and the store calls behind each control.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { CATEGORIES } from '@sieve/shared';
import { HOME_BASE_DIALOG, SETTINGS, TEST_REQUEST, fillText } from '@/copy/screens-controls';
import { STATUS_POPOVER } from '@/copy/strings';
import { useAvailability } from '@/state/availability';
import { useGrants, type GrantsState } from '@/state/grants';
import { useHomeBase, type HomeBaseState } from '@/state/homeBase';
import { useSession } from '@/state/session';
import { DEFAULT_SETTINGS, useSettings, type SettingsState } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { GrantView } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { runDeleteAccount, type DeleteStep } from './accountService';
import { formatDate } from './kit/when';
import { Component } from './index';

vi.mock('./accountService', () => ({ runDeleteAccount: vi.fn() }));
vi.mock('@/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/index')>()),
  openDb: () => ({ name: 'sieve', sources: { toArray: async () => [] } }),
}));

const NOW = Date.now();
const DAY = 86_400_000;
const AI = 'Gemini CLI';

function grant(over: Partial<GrantView>): GrantView {
  return {
    id: 'g1',
    aiName: AI,
    maxStep: 'excerpt',
    allowedCategories: CATEGORIES.filter((c) => c !== 'Health'),
    allowedSources: ['gmail', 'folder'],
    createdAt: NOW - 10 * DAY,
    expiresAt: NOW + 20 * DAY,
    linkHint: 'k3x9',
    state: 'active',
    ...over,
  };
}

const grantActions = {
  narrow: vi.fn<GrantsState['narrow']>(async () => undefined),
  revoke: vi.fn<GrantsState['revoke']>(async () => undefined),
};
const settingsActions = {
  setCategoryRule: vi.fn<SettingsState['setCategoryRule']>(async () => undefined),
  setDefaultStep: vi.fn<SettingsState['setDefaultStep']>(async () => undefined),
  setCloudFallback: vi.fn<SettingsState['setCloudFallback']>(async () => undefined),
  setPushEnabled: vi.fn<SettingsState['setPushEnabled']>(async () => 'ok' as const),
};
const homeActions = {
  makeThisHomeBase: vi.fn<HomeBaseState['makeThisHomeBase']>(async () => undefined),
  stopBeingHomeBase: vi.fn<HomeBaseState['stopBeingHomeBase']>(async () => undefined),
};
const signOut = vi.fn(async () => undefined);

function renderSettings(path = '/settings') {
  const router = createMemoryRouter(
    [
      { path: '/settings', element: <main><Component /></main> },
      { path: '/welcome', element: <main><p>welcome page</p></main> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function cardOf(heading: string): HTMLElement {
  const h = screen.getByRole('heading', { level: 2, name: heading });
  const section = h.closest('section');
  if (!section) throw new Error(`no card for ${heading}`);
  return section;
}

const sentence = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

beforeEach(() => {
  useSession.setState({ kind: 'google', user: { uid: 'uid-1', email: 'person@example.com', isAnonymous: false }, deviceId: 'dev-1', signOut });
  useSettings.setState({ status: 'ready', settings: { ...DEFAULT_SETTINGS, categoryRules: { ...DEFAULT_SETTINGS.categoryRules } }, saving: {}, ...settingsActions });
  useGrants.setState({ status: 'ready', grants: [], ...grantActions });
  useHomeBase.setState({ role: 'not-home-base', devices: [], extension: 'off', ...homeActions });
  useAvailability.setState({ text: 'unavailable' });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  useHomeBase.getState().reset();
  vi.clearAllMocks();
});

describe('Settings', () => {
  it('lays out every card and focuses the one named by the hash', async () => {
    renderSettings('/settings#rules');
    expect(document.title).toBe('Settings · Sieve');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    for (const h of [
      SETTINGS.aisHeading, SETTINGS.rulesHeading, SETTINGS.defaultStepHeading, SETTINGS.cloudHeading,
      SETTINGS.notificationsHeading, SETTINGS.accountHeading,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: SETTINGS.rulesHeading })).toHaveFocus());
    expect(screen.getByText(SETTINGS.aisEmpty)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('shows skeleton rows while connections load', async () => {
    useGrants.setState({ status: 'loading' });
    renderSettings();
    expect(screen.getByText(SETTINGS.aisLoading)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('lists connections with their limits, and keeps past ones under a disclosure', async () => {
    const user = userEvent.setup();
    useGrants.setState({
      grants: [
        grant({ id: 'g1', lastUsedAt: NOW - 3 * 3_600_000 }),
        grant({ id: 'g2', aiName: 'Notes helper', maxStep: 'answer', allowedCategories: [...CATEGORIES], allowedSources: ['gmail', 'folder', 'upload'], state: 'expiring', expiresAt: NOW + 2 * DAY }),
        grant({ id: 'g3', aiName: 'Old helper', maxStep: 'full', allowedCategories: ['Work', 'Travel'], allowedSources: ['upload'], state: 'revoked', revokedAt: NOW - DAY }),
      ],
    });
    renderSettings();
    const ais = cardOf(SETTINGS.aisHeading);
    expect(within(ais).getByText(SETTINGS.aisSub)).toBeInTheDocument();
    expect(within(ais).getByText('Answers and excerpts · All except Health · Gmail and Local folder')).toBeInTheDocument();
    expect(within(ais).getByText(`Expires ${formatDate(NOW + 20 * DAY)} · Last used 3 hours ago · Link ends in …k3x9`)).toBeInTheDocument();
    expect(within(ais).getByText('Answers only · All categories · All sources')).toBeInTheDocument();
    expect(within(ais).getByText(`Expires ${formatDate(NOW + 2 * DAY)} · Never used · Link ends in …k3x9`)).toBeInTheDocument();
    expect(within(ais).getByText(SETTINGS.grantActive)).toBeInTheDocument();
    expect(within(ais).getByText(SETTINGS.grantExpiring)).toBeInTheDocument();
    expect(within(ais).getAllByRole('button', { name: SETTINGS.narrow })).toHaveLength(2);
    const past = within(ais).getByRole('button', { name: fillText(SETTINGS.past, { n: 1 }) });
    expect(past).toHaveAttribute('aria-expanded', 'false');
    expect(within(ais).getByText('Up to full items · Work, Travel · Files you add')).not.toBeVisible();
    await expectNoAxeViolations();
    await user.click(past);
    expect(within(ais).getByText('Up to full items · Work, Travel · Files you add')).toBeVisible();
    expect(within(ais).getByText(SETTINGS.grantRevoked)).toBeInTheDocument();
  });

  it('narrows a grant to lower steps and fewer categories or sources only (AT-22)', async () => {
    const user = userEvent.setup();
    useGrants.setState({ grants: [grant({})] });
    renderSettings();
    await user.click(screen.getByRole('button', { name: SETTINGS.narrow }));
    const dialog = screen.getByRole('dialog', { name: fillText(SETTINGS.narrowTitle, { aiName: AI }) });
    expect(within(dialog).getByText(SETTINGS.narrowNote)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([SETTINGS.capAnswer, SETTINGS.capExcerpt]);
    expect(within(dialog).getByRole('radio', { name: SETTINGS.capExcerpt })).toBeChecked();
    const categories = within(dialog).getByRole('group', { name: SETTINGS.categories });
    expect(within(categories).queryByRole('checkbox', { name: 'Health' })).not.toBeInTheDocument();
    const sources = within(dialog).getByRole('group', { name: SETTINGS.sources });
    expect(within(sources).getAllByRole('checkbox').map((b) => b.closest('label')?.textContent)).toEqual(['Gmail', 'Local folder']);
    await expectNoAxeViolations();

    await user.click(within(sources).getByRole('checkbox', { name: 'Gmail' }));
    await user.click(within(sources).getByRole('checkbox', { name: 'Local folder' }));
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.save }));
    expect(within(dialog).getByText(SETTINGS.keepOne)).toBeInTheDocument();
    expect(grantActions.narrow).not.toHaveBeenCalled();

    await user.click(within(sources).getByRole('checkbox', { name: 'Local folder' }));
    await user.click(within(dialog).getByRole('radio', { name: SETTINGS.capAnswer }));
    await user.click(within(categories).getByRole('checkbox', { name: 'Money' }));
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.save }));
    expect(grantActions.narrow).toHaveBeenCalledWith('g1', {
      maxStep: 'answer',
      allowedCategories: CATEGORIES.filter((c) => c !== 'Health' && c !== 'Money'),
      allowedSources: ['folder'],
    });
    expect(useToasts.getState().toasts.map((t) => t.title)).toContain(`${AI}'s access was narrowed.`);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('revokes a grant after confirming', async () => {
    const user = userEvent.setup();
    useGrants.setState({ grants: [grant({})] });
    renderSettings();
    await user.click(screen.getByRole('button', { name: SETTINGS.revoke }));
    const dialog = screen.getByRole('dialog', { name: fillText(SETTINGS.revokeTitle, { aiName: AI }) });
    expect(within(dialog).getByText(SETTINGS.revokeBody)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.revokeConfirm }));
    expect(grantActions.revoke).toHaveBeenCalledWith('g1');
    expect(useToasts.getState().toasts.map((t) => t.title)).toContain(`${AI} can't ask any more.`);
  });

  it('opens Connect an AI from ?connect=1 and removes the param, keeping the hash', async () => {
    const router = renderSettings('/settings?connect=1#ais');
    expect(await screen.findByRole('dialog', { name: SETTINGS.connectTitle })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(router.state.location.hash).toBe('#ais');
  });

  it('changes a rule at once, and asks before moving a category away from never (AT-24)', async () => {
    const user = userEvent.setup();
    renderSettings();
    const rules = cardOf(SETTINGS.rulesHeading);
    expect(within(rules).getByText(SETTINGS.rulesSub)).toBeInTheDocument();
    const home = within(rules).getByRole('radiogroup', { name: 'Rule for Home' });
    expect(within(home).getByRole('radio', { name: SETTINGS.ruleApprove })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(home).getByRole('radio', { name: SETTINGS.ruleAskFirst }));
    expect(settingsActions.setCategoryRule).toHaveBeenCalledWith('Home', 'ask-first');

    const health = within(rules).getByRole('radiogroup', { name: 'Rule for Health' });
    expect(within(health).getByRole('radio', { name: SETTINGS.ruleNever })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(health).getByRole('radio', { name: SETTINGS.ruleApprove }));
    const confirm = screen.getByRole('dialog', { name: 'Allow sharing Health?' });
    expect(within(confirm).getByText('Items labelled Health could then be shared, always with your approval.')).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(confirm).getByRole('button', { name: SETTINGS.allowCancel }));
    expect(settingsActions.setCategoryRule).not.toHaveBeenCalledWith('Health', 'approve');

    await user.click(within(health).getByRole('radio', { name: SETTINGS.ruleApprove }));
    await user.click(within(screen.getByRole('dialog', { name: 'Allow sharing Health?' })).getByRole('button', { name: SETTINGS.allowConfirm }));
    expect(settingsActions.setCategoryRule).toHaveBeenCalledWith('Health', 'approve');
  });

  it('shows each card\'s save status, including offline (AT-23)', async () => {
    useSettings.setState({ saving: { 'rule:Money': 'queued', defaultStep: 'saved', cloudFallbackForOwnData: 'error', pushEnabled: 'saving' } });
    renderSettings();
    expect(within(cardOf(SETTINGS.rulesHeading)).getByText(SETTINGS.queued)).toBeInTheDocument();
    expect(within(cardOf(SETTINGS.defaultStepHeading)).getByText(SETTINGS.saved)).toBeInTheDocument();
    expect(within(cardOf(SETTINGS.cloudHeading)).getByText(SETTINGS.saveError)).toBeInTheDocument();
    expect(within(cardOf(SETTINGS.notificationsHeading)).getByText(SETTINGS.saving)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('sets the default step', async () => {
    const user = userEvent.setup();
    renderSettings();
    const card = cardOf(SETTINGS.defaultStepHeading);
    expect(within(card).getByText(SETTINGS.defaultStepSub)).toBeInTheDocument();
    const group = within(card).getByRole('radiogroup', { name: SETTINGS.defaultStepHeading });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Answer only', 'Excerpt', 'Full item']);
    await user.click(within(group).getByRole('radio', { name: 'Excerpt' }));
    expect(settingsActions.setDefaultStep).toHaveBeenCalledWith('excerpt');
  });

  it('confirms before turning cloud fallback on, and turns it off at once', async () => {
    const user = userEvent.setup();
    useAvailability.setState({ text: 'available' });
    renderSettings();
    const card = cardOf(SETTINGS.cloudHeading);
    expect(within(card).getByText(SETTINGS.cloudHasNano)).toBeInTheDocument();
    const box = within(card).getByRole('checkbox', { name: SETTINGS.cloudCheckbox });
    expect(box).toHaveAccessibleDescription(SETTINGS.cloudNote);
    await user.click(box);
    const dialog = screen.getByRole('dialog', { name: SETTINGS.cloudTitle });
    expect(within(dialog).getByText(SETTINGS.cloudBody)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.cloudConfirm }));
    expect(settingsActions.setCloudFallback).toHaveBeenCalledWith(true);

    useSettings.setState({ settings: { ...useSettings.getState().settings, cloudFallbackForOwnData: true } });
    await user.click(within(card).getByRole('checkbox', { name: SETTINGS.cloudCheckbox }));
    expect(settingsActions.setCloudFallback).toHaveBeenLastCalledWith(false);
  });

  it('turns on push from the click and explains a denied or unsupported browser', async () => {
    const user = userEvent.setup();
    settingsActions.setPushEnabled.mockResolvedValueOnce('denied').mockResolvedValueOnce('unsupported').mockResolvedValueOnce('error');
    renderSettings();
    const card = cardOf(SETTINGS.notificationsHeading);
    const box = within(card).getByRole('checkbox', { name: SETTINGS.pushCheckbox });
    expect(box).toHaveAccessibleDescription(SETTINGS.pushNote);
    await user.click(box);
    expect(settingsActions.setPushEnabled).toHaveBeenCalledWith(true);
    expect(await within(card).findByText(SETTINGS.pushDenied)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(box);
    expect(await within(card).findByText(SETTINGS.pushUnsupported)).toBeInTheDocument();
    expect(box).toBeDisabled();
  });

  it('lists the computers and makes this one the home base through the 11.2 dialog', async () => {
    const user = userEvent.setup();
    useHomeBase.setState({
      devices: [{ id: 'dev-2', label: 'Chrome on Windows', isHomeBase: true, hasPush: true, updatedAt: NOW, isThisDevice: false }],
      role: 'other-device',
      homeBaseLabel: 'Chrome on Windows',
    });
    renderSettings();
    const card = cardOf(SETTINGS.notificationsHeading);
    const rows = within(card).getAllByRole('listitem');
    // This computer has no device doc yet: its row uses the default label (jsdom's is "This computer" too).
    expect(within(rows[0]).getAllByText(SETTINGS.thisComputer).length).toBeGreaterThan(0);
    expect(within(rows[0]).queryByText(SETTINGS.homeBase)).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('Chrome on Windows')).toBeInTheDocument();
    expect(within(rows[1]).getByText(SETTINGS.homeBase)).toBeInTheDocument();
    expect(within(rows[1]).getByText(SETTINGS.pushOn)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(rows[0]).getByRole('button', { name: SETTINGS.makeHomeBase }));
    const dialog = screen.getByRole('dialog', { name: HOME_BASE_DIALOG.title });
    expect(within(dialog).getByText('Chrome on Windows is your home base now. Requests already waiting there stay there.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: HOME_BASE_DIALOG.confirm }));
    expect(homeActions.makeThisHomeBase).toHaveBeenCalledOnce();
  });

  it('stops being the home base after confirming, and shows the extension shortcut', async () => {
    const user = userEvent.setup();
    useHomeBase.setState({
      role: 'active',
      devices: [{ id: 'dev-1', label: 'Studio Mac', isHomeBase: true, hasPush: false, updatedAt: NOW, isThisDevice: true }],
      extension: 'connected',
      extensionShortcut: 'Ctrl+Shift+S',
    } as Partial<HomeBaseState>);
    renderSettings();
    const card = cardOf(SETTINGS.notificationsHeading);
    expect(within(card).getByText(SETTINGS.homeBase)).toBeInTheDocument();
    expect(within(card).getByText(sentence(fillText(SETTINGS.extensionShortcut, { shortcut: 'Ctrl+Shift+S' })))).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: SETTINGS.copyAddress }));
    expect(await navigator.clipboard.readText()).toBe('chrome://extensions/shortcuts');
    await expectNoAxeViolations();
    await user.click(within(card).getByRole('button', { name: SETTINGS.stopHomeBase }));
    const dialog = screen.getByRole('dialog', { name: HOME_BASE_DIALOG.stopTitle });
    await user.click(within(dialog).getByRole('button', { name: HOME_BASE_DIALOG.stopConfirm }));
    expect(homeActions.stopBeingHomeBase).toHaveBeenCalledOnce();
  });

  it('says how to set an extension shortcut when there is none', () => {
    useHomeBase.setState({ extension: 'connected', extensionShortcut: '' } as Partial<HomeBaseState>);
    renderSettings();
    expect(screen.getByText(SETTINGS.extensionShortcutUnset)).toBeInTheDocument();
  });

  it('puts the test request next to the extension status, enabled only while connected (50 section 11)', async () => {
    useHomeBase.setState({ extension: 'not-installed' } as Partial<HomeBaseState>);
    renderSettings();
    const card = cardOf(SETTINGS.notificationsHeading);
    expect(within(card).getByText(STATUS_POPOVER.extensionNotInstalled)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: TEST_REQUEST.button })).toBeDisabled();
    await expectNoAxeViolations();
    act(() => useHomeBase.setState({ extension: 'connected' } as Partial<HomeBaseState>));
    expect(within(card).getByRole('button', { name: TEST_REQUEST.button })).toBeEnabled();
  });

  it('shows no test request when the extension bridge is off', () => {
    renderSettings();
    expect(screen.queryByRole('button', { name: TEST_REQUEST.button })).not.toBeInTheDocument();
  });

  it('signs out to the welcome page', async () => {
    const user = userEvent.setup();
    const router = renderSettings();
    const card = cardOf(SETTINGS.accountHeading);
    expect(within(card).getByText('Signed in as person@example.com')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: SETTINGS.signOut }));
    expect(signOut).toHaveBeenCalledOnce();
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'));
  });

  it('deletes the account only after DELETE is typed, with a live checklist (AT-30)', async () => {
    const user = userEvent.setup();
    let release: (v: 'ok') => void = () => undefined;
    vi.mocked(runDeleteAccount).mockImplementationOnce(async (onStep: (s: DeleteStep) => void) => {
      onStep('stopping');
      onStep('push');
      onStep('account');
      return new Promise<'ok'>((resolve) => {
        release = resolve;
      });
    });
    renderSettings();
    const card = cardOf(SETTINGS.accountHeading);
    expect(within(card).getByText(SETTINGS.deleteText)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: SETTINGS.deleteButton }));
    const dialog = screen.getByRole('dialog', { name: SETTINGS.deleteTitle });
    expect(within(dialog).getByText(SETTINGS.deleteBody)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: SETTINGS.deleteConfirm });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(SETTINGS.deleteField), 'delete');
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(SETTINGS.deleteField));
    await user.type(within(dialog).getByLabelText(SETTINGS.deleteField), 'DELETE');
    expect(confirm).toBeEnabled();
    await expectNoAxeViolations();
    await user.click(confirm);
    expect(runDeleteAccount).toHaveBeenCalledOnce();
    const items = within(dialog).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.replace(/^Done: |^Working/, ''))).toEqual(Object.values(SETTINGS.deleteSteps));
    expect(within(items[0]).getByText(/Done/)).toBeInTheDocument();
    expect(within(items[2]).getByText('Working')).toBeInTheDocument();
    // Not dismissible while it runs.
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await expectNoAxeViolations();
    release('ok');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('starts over when deleting did not finish (the service says why in a toast)', async () => {
    const user = userEvent.setup();
    vi.mocked(runDeleteAccount).mockResolvedValueOnce('cancelled');
    renderSettings();
    await user.click(within(cardOf(SETTINGS.accountHeading)).getByRole('button', { name: SETTINGS.deleteButton }));
    const dialog = screen.getByRole('dialog', { name: SETTINGS.deleteTitle });
    await user.type(within(dialog).getByLabelText(SETTINGS.deleteField), 'DELETE');
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.deleteConfirm }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: SETTINGS.deleteConfirm })).toBeEnabled());
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: SETTINGS.deleteTitle })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
