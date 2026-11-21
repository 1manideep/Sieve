// Sources (40 section 13.6; design handoff of Nov 20, 2026): the totals, the source marks with one panel in place
// in every state, the confirms and uploads, and the grid of categories by source.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { Category, ItemKind, SourceKind } from '@sieve/shared';
import { SETTINGS, SOURCES, fillText } from '@/copy/screens-controls';
import { useIndexing } from '@/state/indexing';
import { useReceipts } from '@/state/receipts';
import { useSettings } from '@/state/settings';
import { useSources, type SourceRowView, type SourcesState } from '@/state/sources';
import type { ReceiptView } from '@/state/types';
import { expectNoAxeViolations } from '@/test/axe';
import { Component, sourceState } from './index';
import { buildLabelExport } from './LabelExport';
import { radius } from './SourcesGrid';
import { senderName } from './sourcesDb';

interface FakeRecord { id: string; source: SourceKind; category: Category; date: number; title: string; kind: ItemKind; from?: string; caption?: string }

const fake = vi.hoisted(() => ({ rows: [] as SourceRowView[], records: [] as FakeRecord[] }));

vi.mock('@/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/index')>();
  const by = (index: 'category' | 'source', value: string) => fake.records.filter((r) => r[index] === value);
  const db = {
    name: 'sieve',
    sources: { toArray: async () => fake.rows },
    records: {
      where: (index: 'category' | 'source') => ({
        equals: (value: string) => ({
          count: async () => by(index, value).length,
          primaryKeys: async () => by(index, value).map((r) => r.id),
          each: async (fn: (r: FakeRecord) => void) => by(index, value).forEach(fn),
          reverse: () => ({ limit: (n: number) => ({ toArray: async () => [...by(index, value)].reverse().slice(0, n) }) }),
        }),
      }),
      orderBy: () => ({
        reverse: () => ({ limit: (n: number) => ({ toArray: async () => [...fake.records].sort((a, b) => b.date - a.date).slice(0, n) }) }),
      }),
    },
  };
  return { ...actual, openDb: () => db };
});

const NOW = Date.now();

function row(kind: SourceKind, over: Partial<SourceRowView> = {}): SourceRowView {
  return { kind, connected: true, paused: false, progress: { done: 0, total: 0 }, ...over };
}

function records(source: SourceKind, category: Category, n: number, from?: string): FakeRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${source}:${category}-${i}`,
    source,
    category,
    date: NOW - i * 86_400_000,
    title: `${category} item ${i + 1}`,
    kind: 'email' as const,
    from,
  }));
}

const actions = {
  connect: vi.fn<SourcesState['connect']>(async () => undefined),
  reauthorize: vi.fn<SourcesState['reauthorize']>(async () => undefined),
  disconnect: vi.fn<SourcesState['disconnect']>(async () => undefined),
  setPaused: vi.fn<SourcesState['setPaused']>(async () => undefined),
  rebuild: vi.fn<SourcesState['rebuild']>(async () => undefined),
  addFiles: vi.fn<SourcesState['addFiles']>(async (_kind, files) =>
    files.map((f) => ({ name: f.name, ok: false as const, reason: `Couldn't read ${f.name}.` })),
  ),
};

function renderSources(path = '/sources') {
  const router = createMemoryRouter(
    [
      { path: '/sources', element: <main><Component /></main> },
      { path: '/settings', element: <main><p>settings page</p></main> },
      { path: '/ask', element: <main><p>ask page</p></main> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

/** A source's mark in the row, and the one panel under the row. */
const mark = (name: string) => within(screen.getByRole('list', { name: SOURCES.sourcesLabel })).getByRole('button', { name: new RegExp(`^${name}`) });
const panel = (name: string) => screen.getByRole('article', { name });
const totals = () => screen.getByRole('region', { name: SOURCES.totalsLabel });
/** The grid's category rows, in order: each is the button that opens its items. */
const gridRows = () => screen.getAllByRole('button').filter((b) => b.getAttribute('aria-controls')?.startsWith('category-'));

// The screen opens the index with a dynamic import, and the mock above loads the whole real module. Load it once
// here, so its first transform (seconds on a busy machine) never counts against a findBy window.
beforeAll(async () => {
  await import('@/index');
}, 60_000);

beforeEach(() => {
  fake.rows = [];
  fake.records = [];
  useSources.setState({ busy: {}, ...actions });
  useReceipts.setState({ status: 'ready', receipts: [] });
  useIndexing.setState({ state: 'idle', pausedBy: undefined, left: 0, done: 0, total: 0, etaMs: undefined, activity: undefined, counting: false, onBattery: false, batteryOverride: false, bySource: {} });
});

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'showDirectoryPicker');
});

describe('Sources', () => {
  it('with nothing connected: every mark offers to connect, Gmail is open with the testing-mode note', async () => {
    Object.assign(window, { showDirectoryPicker: vi.fn() });
    renderSources();
    expect(document.title).toBe('Sources · Sieve');
    expect(mark('Gmail')).toHaveTextContent(SOURCES.markConnect);
    expect(mark('Gmail')).toHaveAttribute('aria-pressed', 'true');
    expect(mark('Local folder')).toHaveTextContent(SOURCES.markConnect);
    expect(mark('Files you add')).toHaveTextContent(SOURCES.markAdd);
    expect(mark('Google Drive')).toHaveTextContent(SOURCES.markLater);
    expect(mark('Calendar')).toHaveTextContent(SOURCES.markLater);
    const gmail = panel('Connect Gmail');
    expect(within(gmail).getByText(SOURCES.tagNotConnected)).toBeInTheDocument();
    expect(within(gmail).getByText(SOURCES.details.gmail)).toBeInTheDocument();
    expect(within(gmail).getByText(SOURCES.gmailTesting)).toBeInTheDocument();
    expect(screen.getByText(SOURCES.sourcesNoteNone)).toBeInTheDocument();
    expect(within(totals()).getByText(SOURCES.statItems).previousElementSibling).toHaveTextContent('0');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('connects straight from the click, for Gmail and for a folder', async () => {
    const user = userEvent.setup();
    Object.assign(window, { showDirectoryPicker: vi.fn() });
    renderSources();
    await user.click(within(panel('Connect Gmail')).getByRole('button', { name: SOURCES.connect.gmail }));
    expect(actions.connect).toHaveBeenCalledWith('gmail');
    await user.click(mark('Local folder'));
    expect(mark('Local folder')).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(panel('Connect Local folder')).getByRole('button', { name: SOURCES.connect.folder }));
    expect(actions.connect).toHaveBeenLastCalledWith('folder');
  });

  it('says so when this browser cannot open folders', async () => {
    const user = userEvent.setup();
    renderSources();
    await user.click(mark('Local folder'));
    expect(within(panel('Connect Local folder')).getByText(SOURCES.noFolderPicker)).toBeInTheDocument();
  });

  it('shows the totals, each mark with its count, and the open source with what it holds', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail', { lastSyncAt: NOW - 120_000 }), row('folder', { folderName: 'Taxes' })];
    fake.records = [...records('gmail', 'Home', 3), ...records('gmail', 'Health', 2), ...records('folder', 'Money', 2), ...records('upload', 'Personal', 1)];
    useReceipts.setState({
      receipts: [{ id: 'r1', requestId: 'r1', requester: { kind: 'outside', grantId: 'g', aiName: 'Claude' }, question: 'q', step: 'answer', itemIds: ['gmail:Home-0', 'gmail:Home-1'], status: 'delivered', chars: 9, createdAt: NOW } as ReceiptView],
    });
    renderSources();
    expect(await screen.findByText(fillText(SOURCES.sourcesNote, { n: 3 }))).toBeInTheDocument();
    const t = totals();
    expect(within(t).getByText(SOURCES.statItems).previousElementSibling).toHaveTextContent('8');
    expect(within(t).getByText(SOURCES.statCategories).previousElementSibling).toHaveTextContent('4');
    expect(within(t).getByText(fillText(SOURCES.statNever, { pct: 75 })).previousElementSibling).toHaveTextContent('6');
    expect(within(t).getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Gmail 5')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`${SOURCES.pillUpToDate}· 8 items`);

    expect(mark('Gmail')).toHaveTextContent('5 emails');
    expect(mark('Local folder')).toHaveTextContent('2 items');
    expect(mark('Files you add')).toHaveTextContent('1 files');
    const gmail = panel('Gmail');
    expect(within(gmail).getByText(SOURCES.tagLive)).toBeInTheDocument();
    expect(within(gmail).getByText(/^5 emails · Up to date · new mail is added while Sieve is open · synced 2 minutes ago$/)).toBeInTheDocument();
    const holds = within(gmail).getAllByRole('listitem');
    expect(holds.map((li) => li.textContent)).toEqual(['Home3', 'Health2']);
    expect(within(gmail).queryByText(SOURCES.gmailTesting)).not.toBeInTheDocument();
    expect(within(gmail).getByRole('button', { name: SOURCES.pause })).toBeInTheDocument();
    await expectNoAxeViolations();

    await user.click(mark('Local folder'));
    const folder = panel('Local folder');
    expect(within(folder).getByText(SOURCES.tagConnected)).toBeInTheDocument();
    expect(within(folder).getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === `2 items · Folder: Taxes · ${SOURCES.metaOnDevice}`)).toBeInTheDocument();
  });

  it('shows progress while indexing: on the mark, in the head and in the open panel', async () => {
    fake.rows = [row('gmail', { progress: { done: 40, total: 100 } }), row('folder', { progress: { done: 12, total: 12 } })];
    fake.records = records('gmail', 'Home', 3);
    useIndexing.setState({ state: 'running', left: 60, done: 40, total: 100, etaMs: 120_000 });
    renderSources();
    expect(await screen.findByRole('article', { name: 'Gmail' })).toBeInTheDocument();
    expect(mark('Gmail')).toHaveTextContent('indexing 40%');
    expect(screen.getByRole('status')).toHaveTextContent(`${SOURCES.pillIndexing}· 60 left`);
    const gmail = panel('Gmail');
    expect(within(gmail).getByRole('heading', { name: SOURCES.runningTitle })).toBeInTheDocument();
    expect(within(gmail).getByText('40 of 100 items · about 2 min left')).toBeInTheDocument();
    expect(within(gmail).getByText(SOURCES.runningSub)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('two stages: once every item can be searched it says "Ready to ask", with Gemini Nano\'s sorting as background work', async () => {
    fake.rows = [row('gmail', { progress: { done: 400, total: 5670 } })];
    fake.records = records('gmail', 'Home', 3);
    useIndexing.setState({
      state: 'running', left: 5270, done: 400, total: 5670, fraction: 400 / 5670, etaMs: 50 * 60_000, ready: true, searchLeft: 0, searchFraction: 1,
      activity: { stage: 'label', count: 5270 },
      bySource: { gmail: { done: 400, total: 5670, fraction: 400 / 5670, counting: false, ready: true, searchFraction: 1 } },
    });
    renderSources();
    const gmail = await screen.findByRole('article', { name: 'Gmail' });
    expect(screen.getByRole('status')).toHaveTextContent(`${SOURCES.pillReady}· 5,270 in the background`);
    // The source is live, not "indexing": its mark shows its count.
    expect(mark('Gmail')).toHaveTextContent('3 emails');
    expect(within(gmail).getByText(SOURCES.tagLive)).toBeInTheDocument();
    expect(within(gmail).getByRole('heading', { name: SOURCES.readyTitle })).toBeInTheDocument();
    expect(within(gmail).getByText(fillText(SOURCES.readyText, { total: '5,670' }))).toBeInTheDocument();
    expect(within(gmail).getByText(fillText(SOURCES.bgLabel, { n: '5,270' }))).toBeInTheDocument();
    expect(within(gmail).getByRole('progressbar', { name: SOURCES.bgProgressLabel })).toHaveAttribute('aria-valuetext', 'Indexing 400 of 5,670 items');
    expect(within(gmail).getByText('400 of 5,670 items done · about 50 min left')).toBeInTheDocument();
    expect(within(gmail).getByText(SOURCES.bgSub)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('while items are still being read it counts the ones that can be searched', async () => {
    fake.rows = [row('gmail', { progress: { done: 10, total: 100 } })];
    useIndexing.setState({
      state: 'running', left: 90, done: 10, total: 100, fraction: 0.1, ready: false, searchLeft: 30, searchFraction: 0.7,
      bySource: { gmail: { done: 10, total: 100, fraction: 0.1, counting: false, ready: false, searchFraction: 0.7 } },
    });
    renderSources();
    const gmail = await screen.findByRole('article', { name: 'Gmail' });
    expect(mark('Gmail')).toHaveTextContent('indexing 70%');
    expect(screen.getByRole('status')).toHaveTextContent(`${SOURCES.pillIndexing}· 30 left`);
    expect(within(gmail).getByRole('progressbar', { name: SOURCES.progressLabel })).toHaveAttribute('aria-valuetext', '70 of 100 items searchable');
    expect(within(gmail).getByText(fillText(SOURCES.runningLeft, { left: '30' }))).toBeInTheDocument();
  });

  it('says what it works on now, in the order the work runs (20 section 13.5)', async () => {
    fake.rows = [row('folder', { progress: { done: 2, total: 22 } })];
    useIndexing.setState({ state: 'running', left: 20, done: 2, total: 22, activity: { stage: 'reading', inventory: { pdfs: 7, notes: 3, photos: 12 } } });
    renderSources();
    expect(await screen.findByText('Reading 7 PDFs, 3 notes and 12 photos')).toBeInTheDocument();
  });

  it('shows the paused state and resumes indexing', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail', { paused: true, progress: { done: 40, total: 100 } })];
    useIndexing.setState({ state: 'paused', pausedBy: 'person', left: 60, done: 40, total: 100 });
    renderSources();
    const gmail = await screen.findByRole('article', { name: 'Gmail' });
    expect(mark('Gmail')).toHaveTextContent(SOURCES.tagPaused);
    expect(screen.getByRole('status')).toHaveTextContent(SOURCES.pillPaused);
    expect(within(gmail).getByRole('heading', { name: SOURCES.pausedTitle })).toBeInTheDocument();
    await user.click(within(gmail).getByRole('button', { name: SOURCES.resume }));
    expect(actions.setPaused).toHaveBeenCalledWith(false);
  });

  it('pauses indexing from the open source', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail')];
    renderSources();
    await user.click(within(await screen.findByRole('article', { name: 'Gmail' })).getByRole('button', { name: SOURCES.pause }));
    expect(actions.setPaused).toHaveBeenCalledWith(true);
  });

  it('the switch "Describe photos with Gemini Nano" sits with the folder, is on by default and saves on this device', async () => {
    const user = userEvent.setup();
    const setDescribePhotos = vi.fn(async () => undefined);
    useSettings.setState({ describePhotos: true, setDescribePhotos });
    fake.rows = [row('folder')];
    renderSources();
    const folder = await screen.findByRole('article', { name: 'Local folder' });
    const toggle = within(folder).getByRole('switch', { name: SOURCES.describePhotos });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveAccessibleDescription(SOURCES.describePhotosHelp);
    await user.click(toggle);
    expect(setDescribePhotos).toHaveBeenCalledWith(false);
  });

  it('opens the source that needs the person: Gmail asks to continue, an error offers to try again', async () => {
    const user = userEvent.setup();
    fake.rows = [row('folder'), row('gmail', { needsAuth: true })];
    const view = renderSources();
    const gmail = await screen.findByRole('article', { name: 'Gmail' });
    expect(mark('Gmail')).toHaveAttribute('aria-pressed', 'true');
    expect(mark('Gmail')).toHaveTextContent(SOURCES.markNeedsYou);
    expect(within(gmail).getByText(SOURCES.needsAuthGmail)).toBeInTheDocument();
    await user.click(within(gmail).getByRole('button', { name: SOURCES.continue }));
    expect(actions.reauthorize).toHaveBeenCalledWith('gmail');
    view.unmount();

    fake.rows = [row('gmail', { needsAuth: true, errorCode: 'auth-needed', error: 'refused' })];
    const second = renderSources();
    expect(await screen.findByText(SOURCES.needsAuthGmailRefused)).toBeInTheDocument();
    expect(screen.queryByText('refused')).not.toBeInTheDocument();
    second.unmount();

    fake.rows = [row('folder', { error: "Couldn't read the folder." })];
    renderSources();
    const folder = await screen.findByRole('article', { name: 'Local folder' });
    expect(within(folder).getByText("Couldn't read the folder.")).toBeInTheDocument();
    await user.click(within(folder).getByRole('button', { name: SOURCES.tryAgain }));
    expect(actions.connect).toHaveBeenCalledWith('folder');
  });

  it('asks Chrome again for a folder it can no longer read', async () => {
    const user = userEvent.setup();
    fake.rows = [row('folder', { needsAuth: true, folderName: 'Taxes' })];
    renderSources();
    const folder = await screen.findByRole('article', { name: 'Local folder' });
    expect(within(folder).getByText((_, el) => el?.textContent === 'Chrome needs your OK to read "Taxes" again.')).toBeInTheDocument();
    await user.click(within(folder).getByRole('button', { name: SOURCES.allowAgain }));
    expect(actions.reauthorize).toHaveBeenCalledWith('folder');
  });

  it('confirms before disconnecting, with the item count and the Google account note', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail')];
    fake.records = records('gmail', 'Home', 3);
    renderSources();
    const gmail = await screen.findByRole('article', { name: 'Gmail' });
    await within(gmail).findByText(/^3 emails/);
    await user.click(within(gmail).getByRole('button', { name: SOURCES.disconnect }));
    const dialog = await screen.findByRole('dialog', { name: fillText(SOURCES.disconnectTitle, { name: 'Gmail' }) });
    expect(dialog).toHaveTextContent(fillText(SOURCES.disconnectBody, { n: '3', name: 'Gmail' }));
    expect(dialog).toHaveTextContent(SOURCES.disconnectGmailExtra);
    await user.click(within(dialog).getByRole('button', { name: SOURCES.disconnectConfirm }));
    expect(actions.disconnect).toHaveBeenCalledWith('gmail');
  });

  it('confirms before rebuilding the index', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail')];
    renderSources();
    await user.click(within(await screen.findByRole('article', { name: 'Gmail' })).getByRole('button', { name: SOURCES.rebuild }));
    const dialog = await screen.findByRole('dialog', { name: SOURCES.rebuildTitle });
    expect(actions.rebuild).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: SOURCES.rebuildConfirm }));
    expect(actions.rebuild).toHaveBeenCalledOnce();
  });

  it('checks files before adding them and shows what could not be added', async () => {
    const user = userEvent.setup({ applyAccept: false });
    fake.rows = [row('upload')];
    fake.records = records('upload', 'Personal', 2);
    const view = renderSources();
    const upload = await screen.findByRole('article', { name: 'Files you add' });
    expect(await within(upload).findByText(`2 files · ${SOURCES.details.upload}`)).toBeInTheDocument();
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');

    const many = Array.from({ length: 6 }, (_, i) => new File(['x'], `note${i}.txt`, { type: 'text/plain' }));
    await user.upload(input, many);
    expect(within(upload).getByText(SOURCES.tooManyFiles)).toBeInTheDocument();
    expect(actions.addFiles).not.toHaveBeenCalled();

    const big = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    const odd = new File(['x'], 'tool.exe', { type: 'application/octet-stream' });
    const fine = new File(['hello'], 'lease.txt', { type: 'text/plain' });
    await user.upload(input, [big, odd, fine]);
    expect(actions.addFiles).toHaveBeenCalledWith('real', [fine]);
    expect(within(upload).getByText('scan.pdf is over 10 MB.')).toBeInTheDocument();
    expect(within(upload).getByText("tool.exe isn't a supported file. Try PDF, text or a photo.")).toBeInTheDocument();
    expect(await within(upload).findByText("Couldn't read lease.txt.")).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('says what a later source would be', async () => {
    const user = userEvent.setup();
    renderSources();
    await user.click(mark('Google Drive'));
    const drive = panel('Google Drive');
    expect(within(drive).getByText(SOURCES.later.drive.lead)).toBeInTheDocument();
    expect(within(drive).getByText(fillText(SOURCES.laterText, { name: 'Google Drive' }))).toBeInTheDocument();
    expect(within(drive).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Sources: the grid', () => {
  beforeEach(() => {
    fake.rows = [row('gmail'), row('folder')];
    fake.records = [
      ...records('gmail', 'Home', 4, 'Dana Whitfield <dana@thistlewick.example>'),
      ...records('gmail', 'Health', 2, 'Corvane Medical Group <no-reply@corvane.example>'),
      ...records('gmail', 'Money', 6, 'Kestrelmoor Bank <alerts@kestrelmoor.example>'),
      ...records('folder', 'Home', 1),
      { id: 'folder:IMG_1.jpg', source: 'folder', category: 'Photos', date: NOW, title: 'IMG_1.jpg', kind: 'photo', caption: 'Trays of hot dogs and buns' },
    ];
    useSettings.setState((s) => ({ settings: { ...s.settings, categoryRules: { ...s.settings.categoryRules, Money: 'ask-first', Health: 'never' } } }));
  });

  it('lists every category with a count per source, who it is often from, and its rule', async () => {
    renderSources();
    await screen.findByText('Dana Whitfield');
    const rows = gridRows();
    expect(rows).toHaveLength(9);
    // By size: Money 6, Home 5, Health 2, Photos 1, then the empty ones.
    expect(rows.slice(0, 4).map((r) => within(r).getAllByText(/./)[0]?.textContent)).toEqual(['Money', 'Home', 'Health', 'Photos']);
    const home = rows[1]!;
    expect(home).toHaveTextContent('5 items');
    expect(home).toHaveTextContent('Gmail: 4');
    expect(home).toHaveTextContent('Local folder: 1');
    expect(home).toHaveTextContent(`Files you add: ${SOURCES.cellNone}`);
    expect(home).toHaveTextContent('Dana Whitfield');
    expect(home).toHaveTextContent(SETTINGS.ruleApprove);
    expect(rows[0]).toHaveTextContent(`6 items · ${SOURCES.rowAsk}`);
    expect(rows[0]).toHaveTextContent(SETTINGS.ruleAskFirst);
    expect(rows[2]).toHaveTextContent(`2 items · ${SOURCES.rowNever}`);
    expect(rows[2]).toHaveTextContent(SETTINGS.ruleNever);
    expect(rows[3]).toHaveTextContent(SOURCES.noOne);
    expect(screen.getByText(SOURCES.allOfIt).parentElement).toHaveTextContent('Gmail: 12Local folder: 2Files you add: 014');
    await expectNoAxeViolations();
  });

  it('sorts by rule and by name', async () => {
    const user = userEvent.setup();
    renderSources();
    await screen.findByText('Dana Whitfield');
    const sort = screen.getByRole('radiogroup', { name: SOURCES.sortLabel });
    await user.click(within(sort).getByRole('radio', { name: SOURCES.sortRule }));
    expect(gridRows().slice(0, 3).map((r) => r.getAttribute('aria-controls'))).toEqual(['category-Health', 'category-Money', 'category-Home']);
    await user.click(within(sort).getByRole('radio', { name: SOURCES.sortName }));
    expect(gridRows().slice(0, 3).map((r) => r.getAttribute('aria-controls'))).toEqual(['category-Health', 'category-Home', 'category-Money']);
  });

  it('opens a row in place with its newest items, where they came from, its rule and two ways on', async () => {
    const user = userEvent.setup();
    renderSources();
    await screen.findByText('Dana Whitfield');
    await user.click(gridRows()[1]!);
    expect(gridRows()[1]).toHaveAttribute('aria-expanded', 'true');
    const open = await screen.findByRole('region', { name: 'Home' });
    const items = await within(open).findAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Home item 1');
    expect(items[0]).toHaveTextContent('Local folder · ');
    expect(items[1]).toHaveTextContent('Dana Whitfield · Gmail · ');
    expect(within(open).getByText('Gmail 4 · Local folder 1')).toBeInTheDocument();
    expect(within(open).getByText(SOURCES.readBy)).toBeInTheDocument();
    expect(within(open).getByText(fillText(SOURCES.showing, { n: '5', total: '5' }))).toBeInTheDocument();
    expect(within(open).getByRole('link', { name: SOURCES.askAbout })).toHaveAttribute('href', '/ask');
    expect(within(open).getByRole('link', { name: SOURCES.changeRule })).toHaveAttribute('href', '/settings#rules');
    await expectNoAxeViolations();

    // A never-shared category says what an outside assistant is told; a photo shows its caption, then its file.
    await user.click(gridRows()[2]!);
    const health = await screen.findByRole('region', { name: 'Health' });
    expect(screen.queryByRole('region', { name: 'Home' })).not.toBeInTheDocument();
    expect(within(health).getByText(SOURCES.readByNever)).toBeInTheDocument();
    expect(within(health).getByText(SOURCES.ruleSentence.never, { exact: false })).toBeInTheDocument();
    await user.click(gridRows()[3]!);
    const photos = await screen.findByRole('region', { name: 'Photos' });
    expect(await within(photos).findByText('Trays of hot dogs and buns')).toBeInTheDocument();
    expect(within(photos).getByText('IMG_1.jpg')).toBeInTheDocument();
    await user.click(gridRows()[3]!);
    expect(screen.queryByRole('region', { name: 'Photos' })).not.toBeInTheDocument();
  });

  it('dims the rows a search does not match, by category or by sender, and plays the circles again', async () => {
    const user = userEvent.setup();
    renderSources();
    await screen.findByText('Dana Whitfield');
    const box = screen.getByRole('searchbox', { name: SOURCES.gridSearchLabel });
    await user.type(box, 'kestrel');
    const dimmed = () => gridRows().filter((r) => r.className.includes('dim')).length;
    expect(dimmed()).toBe(8);
    expect(gridRows()[0]!.className).not.toContain('dim');
    await user.clear(box);
    await user.type(box, 'photo');
    expect(dimmed()).toBe(8);
    await user.clear(box);
    expect(dimmed()).toBe(0);
    await user.click(screen.getByRole('button', { name: SOURCES.play }));
    expect(gridRows()).toHaveLength(9);
  });
});

describe('Sources: the label export (a testing tool)', () => {
  it('is not on the screen unless the address asks for it', async () => {
    fake.rows = [row('gmail')];
    renderSources();
    await screen.findByRole('article', { name: 'Gmail' });
    expect(screen.queryByRole('region', { name: SOURCES.exportLabel })).not.toBeInTheDocument();
  });

  it('writes one line per Gmail item with its id, category and who chose it, and never a subject', async () => {
    fake.rows = [row('gmail')];
    fake.records = [...records('gmail', 'Home', 2, 'Dana Whitfield <dana@example.com>'), ...records('folder', 'Money', 1)];
    const { openDb } = await import('@/index');
    const { text, count } = await buildLabelExport(openDb('real'));
    expect(count).toBe(2);
    const lines = text.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toEqual({ id: 'Home-0', thread: null, category: 'Home', by: undefined, label: null, body: false });
    expect(text).not.toContain('Home item');
    expect(text).not.toContain('Dana');

    renderSources('/sources?tool=labels');
    const tool = await screen.findByRole('region', { name: SOURCES.exportLabel });
    expect(within(tool).getByRole('button', { name: SOURCES.exportButton })).toBeInTheDocument();
    // The readout says which rules this page runs and whether this tab is the one indexing.
    expect(await within(tool).findByText(fillText(SOURCES.statusRules, { v: 2 }))).toBeInTheDocument();
    expect(within(tool).getByText(fillText(SOURCES.statusLeader, { answer: SOURCES.statusLeaderNo }))).toBeInTheDocument();
    expect(within(tool).getByText(SOURCES.statusNoQueue)).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});

describe('Sources: helpers', () => {
  it('sourceState reads one source from its row, its count and the shared indexing numbers', () => {
    expect(sourceState('gmail', undefined, 0, undefined)).toEqual({ connected: false, paused: false, indexing: false, background: false, needsYou: false, pct: 0 });
    expect(sourceState('upload', undefined, 2, undefined).connected).toBe(true);
    expect(sourceState('gmail', row('gmail', { progress: { done: 1, total: 4 } }), 1, undefined)).toMatchObject({ indexing: true, pct: 25 });
    expect(sourceState('gmail', row('gmail', { progress: { done: 1, total: 4 } }), 1, { done: 2, total: 4, fraction: 0.5 } as never)).toMatchObject({ pct: 50 });
    expect(sourceState('folder', row('folder', { paused: true, progress: { done: 1, total: 4 } }), 1, undefined)).toMatchObject({ paused: true, indexing: false });
    expect(sourceState('folder', row('folder', { needsAuth: true }), 1, undefined).needsYou).toBe(true);
    // Everything it found can be searched: the model work behind it is not "indexing".
    const ready = { done: 2, total: 4, fraction: 0.5, counting: false, ready: true, searchFraction: 1 };
    expect(sourceState('gmail', row('gmail', { progress: { done: 2, total: 4 } }), 4, ready)).toMatchObject({ indexing: false, background: true });
    const reading = { done: 0, total: 4, fraction: 0, counting: false, ready: false, searchFraction: 0.25 };
    expect(sourceState('gmail', row('gmail', { progress: { done: 0, total: 4 } }), 4, reading)).toMatchObject({ indexing: true, background: false, pct: 25 });
  });

  it('radius grows with the square root of the count, within its bounds', () => {
    expect(radius(0)).toBe(0);
    expect(radius(1)).toBe(4.5);
    expect(radius(400)).toBe(14);
    expect(radius(1_000_000)).toBe(27);
  });

  it('senderName keeps the name, or the part of an address before the @', () => {
    expect(senderName('Dana Whitfield <dana@example.com>')).toBe('Dana Whitfield');
    expect(senderName('"Kestrelmoor Bank" <alerts@kestrelmoor.example>')).toBe('Kestrelmoor Bank');
    expect(senderName('<alerts@kestrelmoor.example>')).toBe('alerts');
    expect(senderName('jordan@example.com')).toBe('jordan');
  });
});
