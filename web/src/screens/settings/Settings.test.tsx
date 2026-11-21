// Settings (40 section 13.8; design handoff of Nov 20, 2026): every part's states with axe and exact copy, and the
// store calls behind each control. The assistants' own states are in AisCard.test.tsx.
import { act, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { CATEGORIES } from '@sieve/shared';
import { CONSOLE, HOME_BASE_DIALOG, SETTINGS, TEST_REQUEST, fillText } from '@/copy/screens-controls';
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
      { path: '/', element: <main><p>welcome page</p></main> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** The default step, cloud fallback, past connections and Delete sit under "More": open it when a test needs them. */
function openMore(): void {
  const more = screen.getByRole('button', { name: new RegExp(`^${SETTINGS.moreHeading}`) });
  if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more);
}

/** A section of the screen, found by its heading. */
function cardOf(heading: string): HTMLElement {
  const section = screen.getByRole('heading', { level: 2, name: heading }).closest('section');
  if (!section) throw new Error(`no section for ${heading}`);
  return section;
}

/** A row under "More", found by its label. */
function moreRow(label: string): HTMLElement {
  openMore();
  const row = within(screen.getByRole('list', { name: SETTINGS.moreHeading })).getByText(label).closest('li');
  if (!row) throw new Error(`no row for ${label}`);
  return row;
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
  it('lays out every part and focuses the one named by the hash', async () => {
    renderSettings('/settings#rules');
    expect(document.title).toBe('Settings · Sieve');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: CONSOLE.tryNow })).toHaveAttribute('href', '/try');
    for (const h of [SETTINGS.aisHeading, SETTINGS.rulesHeading, SETTINGS.notificationsHeading, SETTINGS.accountHeading]) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: SETTINGS.rulesHeading })).toHaveFocus());
    // With nothing connected the first assistant's connect steps are open in place.
    expect(screen.getByText(SETTINGS.aisNoteNone)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: fillText(SETTINGS.connectHeading, { name: 'Claude' }) })).toBeInTheDocument();
    // More is closed until pressed.
    const more = screen.getByRole('button', { name: new RegExp(`^${SETTINGS.moreHeading}`) });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(SETTINGS.defaultStepHeading)).not.toBeVisible();
    openMore();
    for (const label of [SETTINGS.defaultStepHeading, SETTINGS.cloudHeading, SETTINGS.deleteHeading]) expect(screen.getByText(label)).toBeVisible();
    await expectNoAxeViolations();
  });

  it('opens More and focuses the row a hash names inside it', async () => {
    renderSettings('/settings#cloud');
    await waitFor(() => expect(screen.getByText(SETTINGS.cloudHeading)).toHaveFocus());
    expect(screen.getByRole('button', { name: new RegExp(`^${SETTINGS.moreHeading}`) })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows skeleton rows while connections load', async () => {
    useGrants.setState({ status: 'loading' });
    renderSettings();
    expect(screen.getByText(SETTINGS.aisLoading)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('opens each connection with its limits, and keeps past ones as a line under More', async () => {
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
    expect(within(ais).getByText(fillText(SETTINGS.aisNote, { n: 2 }))).toBeInTheDocument();
    const first = within(ais).getByRole('article', { name: AI });
    expect(within(first).getByText(`Link ends in …k3x9 · made ${formatDate(NOW - 10 * DAY)} · last used 3 hours ago`)).toBeInTheDocument();
    expect(within(first).getByText(SETTINGS.capExcerpt)).toBeInTheDocument();
    expect(within(first).getByText(SETTINGS.allButHealth)).toBeInTheDocument();
    expect(within(first).getByText('Local folder')).toBeInTheDocument();
    expect(within(first).getByText(formatDate(NOW + 20 * DAY))).toBeInTheDocument();
    await expectNoAxeViolations();

    await user.click(within(ais).getByRole('button', { name: /^Other/ }));
    const second = within(ais).getByRole('article', { name: 'Notes helper' });
    expect(within(second).getByText(SETTINGS.capAnswer)).toBeInTheDocument();
    expect(within(second).getByText(SETTINGS.allCategories)).toBeInTheDocument();
    expect(within(second).getByText('Files you add')).toBeInTheDocument();
    expect(within(second).getByText(/^Expires soon · /)).toBeInTheDocument();

    const past = moreRow(fillText(SETTINGS.past, { n: 1 }));
    expect(within(past).getByText(fillText(SETTINGS.pastRevoked, { aiName: 'Old helper', date: formatDate(NOW - DAY) }))).toBeInTheDocument();
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

  it('revokes a grant after confirming in place', async () => {
    const user = userEvent.setup();
    useGrants.setState({ grants: [grant({})] });
    renderSettings();
    await user.click(screen.getByRole('button', { name: SETTINGS.revoke }));
    const confirm = screen.getByRole('group', { name: fillText(SETTINGS.revokeTitle, { aiName: AI }) });
    expect(within(confirm).getByText(SETTINGS.revokeBody)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(confirm).getByRole('button', { name: SETTINGS.revokeConfirm }));
    expect(grantActions.revoke).toHaveBeenCalledWith('g1');
    expect(useToasts.getState().toasts.map((t) => t.title)).toContain(`${AI} can't ask any more.`);
  });

  it('opens the first assistant with no connection from ?connect=1 and removes the param, keeping the hash', async () => {
    useGrants.setState({ grants: [grant({ aiName: 'Claude' })] });
    const router = renderSettings('/settings?connect=1#ais');
    expect(await screen.findByRole('article', { name: fillText(SETTINGS.connectHeading, { name: 'Claude Code' }) })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(router.state.location.hash).toBe('#ais');
  });

  it('shows each rule in a word on its tile, changes a rule at once, and asks before moving a category away from never (AT-24)', async () => {
    const user = userEvent.setup();
    renderSettings();
    const rules = cardOf(SETTINGS.rulesHeading);
    expect(within(rules).getByText(SETTINGS.rulesNote)).toBeInTheDocument();
    const tiles = within(rules).getByRole('list', { name: SETTINGS.rulesLabel });
    const tile = (category: string) => within(tiles).getByRole('button', { name: new RegExp(`^${category}`) });
    expect(within(tiles).getAllByRole('button')).toHaveLength(9);
    expect(tile('Home')).toHaveTextContent(SETTINGS.ruleWord.approve);
    expect(tile('Health')).toHaveTextContent(SETTINGS.ruleWord.never);
    expect(tile('Money')).toHaveTextContent(SETTINGS.ruleWord['ask-first']);
    expect(within(rules).queryByRole('radiogroup')).not.toBeInTheDocument();

    await user.click(tile('Home'));
    expect(tile('Home')).toHaveAttribute('aria-pressed', 'true');
    const home = within(rules).getByRole('radiogroup', { name: 'Rule for Home' });
    expect(within(home).getByRole('radio', { name: SETTINGS.ruleApprove })).toHaveAttribute('aria-checked', 'true');
    expect(within(rules).getByText(SETTINGS.ruleNote.approve)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(home).getByRole('radio', { name: SETTINGS.ruleAskFirst }));
    expect(settingsActions.setCategoryRule).toHaveBeenCalledWith('Home', 'ask-first');

    await user.click(tile('Health'));
    expect(within(rules).queryByRole('radiogroup', { name: 'Rule for Home' })).not.toBeInTheDocument();
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

    // Pressing the open tile again closes its band.
    await user.click(tile('Health'));
    expect(within(rules).queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('shows each part\'s save status, including offline (AT-23)', async () => {
    useSettings.setState({ saving: { 'rule:Money': 'queued', defaultStep: 'saved', cloudFallbackForOwnData: 'error', pushEnabled: 'saving' } });
    renderSettings();
    expect(within(cardOf(SETTINGS.rulesHeading)).getByText(SETTINGS.queued)).toBeInTheDocument();
    expect(within(moreRow(SETTINGS.defaultStepHeading)).getByText(SETTINGS.saved)).toBeInTheDocument();
    expect(within(moreRow(SETTINGS.cloudHeading)).getByText(SETTINGS.saveError)).toBeInTheDocument();
    expect(within(cardOf(SETTINGS.notificationsHeading)).getByText(SETTINGS.saving)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('sets the default step', async () => {
    const user = userEvent.setup();
    renderSettings();
    const row = moreRow(SETTINGS.defaultStepHeading);
    expect(within(row).getByText(SETTINGS.defaultStepSub)).toBeInTheDocument();
    const group = within(row).getByRole('radiogroup', { name: SETTINGS.defaultStepHeading });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Answer only', 'Excerpt', 'Full item']);
    await user.click(within(group).getByRole('radio', { name: 'Excerpt' }));
    expect(settingsActions.setDefaultStep).toHaveBeenCalledWith('excerpt');
  });

  it('confirms before turning cloud fallback on, and turns it off at once', async () => {
    const user = userEvent.setup();
    useAvailability.setState({ text: 'available' });
    renderSettings();
    const row = moreRow(SETTINGS.cloudHeading);
    const toggle = within(row).getByRole('switch', { name: SETTINGS.cloudCheckbox });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(`${SETTINGS.cloudNote} ${SETTINGS.cloudHasNano}`);
    await user.click(toggle);
    const dialog = screen.getByRole('dialog', { name: SETTINGS.cloudTitle });
    expect(within(dialog).getByText(SETTINGS.cloudBody)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.cloudConfirm }));
    expect(settingsActions.setCloudFallback).toHaveBeenCalledWith(true);

    act(() => useSettings.setState({ settings: { ...useSettings.getState().settings, cloudFallbackForOwnData: true } }));
    expect(within(row).getByRole('switch', { name: SETTINGS.cloudCheckbox })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(row).getByRole('switch', { name: SETTINGS.cloudCheckbox }));
    expect(settingsActions.setCloudFallback).toHaveBeenLastCalledWith(false);
  });

  it('turns on push from the click and explains a denied or unsupported browser', async () => {
    const user = userEvent.setup();
    settingsActions.setPushEnabled.mockResolvedValueOnce('denied').mockResolvedValueOnce('unsupported').mockResolvedValueOnce('error');
    renderSettings();
    const card = cardOf(SETTINGS.notificationsHeading);
    const toggle = within(card).getByRole('switch', { name: SETTINGS.pushCheckbox });
    expect(toggle).toHaveAccessibleDescription(SETTINGS.pushNote);
    await user.click(toggle);
    expect(settingsActions.setPushEnabled).toHaveBeenCalledWith(true);
    expect(await within(card).findByText(SETTINGS.pushDenied)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(toggle);
    expect(await within(card).findByText(SETTINGS.pushUnsupported)).toBeInTheDocument();
    expect(toggle).toBeDisabled();
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
    // The rows: the push switch, this computer, then the others.
    const rows = within(card).getAllByRole('listitem');
    // This computer has no device doc yet: its row uses the default label (jsdom's is "This computer" too).
    expect(within(rows[1]!).getAllByText(SETTINGS.thisComputer).length).toBeGreaterThan(0);
    expect(within(rows[1]!).queryByText(SETTINGS.homeBase)).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText('Chrome on Windows')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(SETTINGS.homeBase)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(SETTINGS.pushOn)).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(rows[1]!).getByRole('button', { name: SETTINGS.makeHomeBase }));
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
    expect(within(card).getByText(SETTINGS.accountSub)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: SETTINGS.signOut }));
    expect(signOut).toHaveBeenCalledOnce();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
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
    const row = moreRow(SETTINGS.deleteHeading);
    expect(within(row).getByText(SETTINGS.deleteText)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: SETTINGS.deleteButton }));
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
    await user.click(within(moreRow(SETTINGS.deleteHeading)).getByRole('button', { name: SETTINGS.deleteButton }));
    const dialog = screen.getByRole('dialog', { name: SETTINGS.deleteTitle });
    await user.type(within(dialog).getByLabelText(SETTINGS.deleteField), 'DELETE');
    await user.click(within(dialog).getByRole('button', { name: SETTINGS.deleteConfirm }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: SETTINGS.deleteConfirm })).toBeEnabled());
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: SETTINGS.deleteTitle })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
