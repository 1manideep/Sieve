// Sources (40 section 13.6): source cards in every state, the indexing card, confirms, uploads and categories.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { Category, SourceKind } from '@sieve/shared';
import { CONSOLE, SOURCES, fillText } from '@/copy/screens-controls';
import { useIndexing } from '@/state/indexing';
import { useSettings } from '@/state/settings';
import { useSources, type SourceRowView, type SourcesState } from '@/state/sources';
import { expectNoAxeViolations } from '@/test/axe';
import { Component } from './index';

interface FakeRecord { id: string; source: SourceKind; category: Category; date: number; title: string }

const fake = vi.hoisted(() => ({ rows: [] as SourceRowView[], records: [] as FakeRecord[] }));

vi.mock('@/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/index')>();
  const db = {
    name: 'sieve',
    sources: { toArray: async () => fake.rows },
    records: {
      where: (index: 'category' | 'source') => ({
        equals: (value: string) => ({ count: async () => fake.records.filter((r) => r[index] === value).length }),
      }),
      orderBy: () => ({
        reverse: () => ({
          filter: (fn: (r: FakeRecord) => boolean) => ({
            limit: (n: number) => ({
              toArray: async () => [...fake.records].sort((a, b) => b.date - a.date).filter(fn).slice(0, n),
            }),
          }),
        }),
      }),
    },
  };
  return { ...actual, openDb: () => db };
});

const NOW = Date.now();

function row(kind: SourceKind, over: Partial<SourceRowView> = {}): SourceRowView {
  return { kind, connected: true, paused: false, progress: { done: 0, total: 0 }, ...over };
}

function records(source: SourceKind, category: Category, n: number): FakeRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${source}:${category}-${i}`,
    source,
    category,
    date: NOW - i * 86_400_000,
    title: `${category} item ${i + 1}`,
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

function renderSources() {
  const router = createMemoryRouter(
    [
      { path: '/sources', element: <main><Component /></main> },
      { path: '/settings', element: <main><p>settings page</p></main> },
    ],
    { initialEntries: ['/sources'] },
  );
  return render(<RouterProvider router={router} />);
}

/** The card for one source, found by its heading. */
function card(name: string): HTMLElement {
  return screen.getByRole('article', { name });
}

// The screen opens the index with a dynamic import, and the mock above loads the whole real module. Load it once
// here, so its first transform (seconds on a busy machine) never counts against a findBy window.
beforeAll(async () => {
  await import('@/index');
}, 60_000);

beforeEach(() => {
  fake.rows = [];
  fake.records = [];
  useSources.setState({ busy: {}, ...actions });
  useIndexing.setState({ state: 'idle', pausedBy: undefined, left: 0, done: 0, total: 0, etaMs: undefined, activity: undefined, counting: false, onBattery: false, batteryOverride: false });
});

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'showDirectoryPicker');
});

describe('Sources', () => {
  it('shows every source as not connected, the Gmail testing-mode note and the categories', async () => {
    renderSources();
    expect(document.title).toBe('Sources · Sieve');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: CONSOLE.tryNow })).toHaveAttribute('href', '/try');
    for (const name of ['Gmail', 'Local folder', 'Files you add']) {
      expect(within(card(name)).getByText(SOURCES.tagNotConnected)).toBeInTheDocument();
    }
    expect(within(card('Gmail')).getByText(SOURCES.details.gmail)).toBeInTheDocument();
    expect(within(card('Gmail')).getByText(SOURCES.gmailTesting)).toBeInTheDocument();
    expect(within(card('Gmail')).getByRole('button', { name: SOURCES.connect.gmail })).toBeInTheDocument();
    // jsdom has no showDirectoryPicker.
    expect(within(card('Local folder')).getByText(SOURCES.noFolderPicker)).toBeInTheDocument();
    expect(within(card('Files you add')).getByRole('button', { name: SOURCES.connect.upload })).toBeInTheDocument();
    expect(screen.getByText(SOURCES.laterSources)).toBeInTheDocument();
    expect(screen.queryByText(SOURCES.idleTitle)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: SOURCES.pause })).toBeDisabled();
    expect(screen.getByRole('button', { name: SOURCES.rebuild })).toBeDisabled();
    expect(screen.getByRole('link', { name: SOURCES.changeRules })).toHaveAttribute('href', '/settings#rules');
    await expectNoAxeViolations();
  });

  it('connects straight from the click', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'showDirectoryPicker', { value: () => undefined, configurable: true });
    renderSources();
    await user.click(await within(card('Gmail')).findByRole('button', { name: SOURCES.connect.gmail }));
    expect(actions.connect).toHaveBeenCalledWith('gmail');
    await user.click(within(card('Local folder')).getByRole('button', { name: SOURCES.connect.folder }));
    expect(actions.connect).toHaveBeenCalledWith('folder');
    await user.click(within(card('Gmail')).getByRole('button', { name: SOURCES.useFolderInstead }));
    expect(actions.connect).toHaveBeenLastCalledWith('folder');
  });

  it('shows progress while indexing and the indexing card with an ETA', async () => {
    fake.rows = [
      row('gmail', { progress: { done: 40, total: 100 } }),
      row('folder', { progress: { done: 12, total: 12 }, folderName: 'Taxes' }),
    ];
    fake.records = [...records('gmail', 'Home', 3), ...records('folder', 'Money', 2)];
    useIndexing.setState({ state: 'running', left: 60, done: 40, total: 100, etaMs: 120_000 });
    renderSources();
    const gmail = card('Gmail');
    // Gmail reads "Live" while connected; the folder reads "Connected". Each card shows its count and, while it
    // indexes, the percentage over the progress bar.
    expect(await within(gmail).findByText(SOURCES.tagLive)).toBeInTheDocument();
    expect(within(card('Local folder')).getByText(SOURCES.tagConnected)).toBeInTheDocument();
    expect(within(gmail).getByText('indexing 40%')).toBeInTheDocument();
    expect(within(gmail).getByText(SOURCES.countLabel).previousElementSibling).toHaveTextContent('3');
    expect(within(gmail).getByText('Indexing 40 of 100 items')).toBeInTheDocument();
    expect(within(gmail).queryByText(SOURCES.gmailTesting)).not.toBeInTheDocument();
    expect(within(card('Local folder')).getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Up to date · Folder: Taxes')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: SOURCES.runningTitle })).toBeInTheDocument();
    expect(screen.getByText('40 of 100 items · about 2 min left')).toBeInTheDocument();
    expect(screen.getByText(SOURCES.runningSub)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Home 3 items$/ })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('says what is left without an ETA, and while a question runs', async () => {
    fake.rows = [row('gmail', { progress: { done: 10, total: 30 } })];
    useIndexing.setState({ state: 'running', left: 1204, done: 10, total: 1214 });
    const view = renderSources();
    expect(await screen.findByText('1,204 items left')).toBeInTheDocument();
    useIndexing.setState({ state: 'yielding' });
    expect(await screen.findByText(SOURCES.yieldingText)).toBeInTheDocument();
    view.unmount();
  });

  it('shows the paused state and resumes indexing', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail', { paused: true, progress: { done: 40, total: 100 } })];
    useIndexing.setState({ state: 'paused', left: 60, done: 40, total: 100 });
    renderSources();
    const gmail = card('Gmail');
    expect(await within(gmail).findByText(SOURCES.tagPaused)).toBeInTheDocument();
    expect(within(gmail).getByText(SOURCES.pausedLabel)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: SOURCES.pausedTitle })).toBeInTheDocument();
    expect(screen.getByText('Resume to finish the index. 60 items left.')).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: SOURCES.resume }));
    expect(actions.setPaused).toHaveBeenCalledWith(false);
  });

  it('says what it works on now, in the order the work runs (20 section 13.5)', async () => {
    fake.rows = [row('folder', { progress: { done: 0, total: 22 }, folderName: 'Taxes' })];
    useIndexing.setState({ state: 'running', left: 22, done: 0, total: 22, activity: { stage: 'reading', inventory: { pdfs: 7 } } });
    const view = renderSources();
    expect(await screen.findByText('Reading 7 PDFs')).toBeInTheDocument();
    useIndexing.setState({ activity: { stage: 'reading', inventory: { pdfs: 7, notes: 3, photos: 12 } } });
    expect(await screen.findByText('Reading 7 PDFs, 3 notes and 12 photos')).toBeInTheDocument();
    useIndexing.setState({ activity: { stage: 'label', count: 10 } });
    expect(await screen.findByText('Sorting 10 items with Gemini Nano')).toBeInTheDocument();
    useIndexing.setState({ activity: { stage: 'embed' } });
    expect(await screen.findByText('Making the search index')).toBeInTheDocument();
    useIndexing.setState({ activity: { stage: 'privacy' } });
    expect(await screen.findByText('Checking for personal details')).toBeInTheDocument();
    useIndexing.setState({ activity: { stage: 'caption', count: 12 } });
    expect(await screen.findByText('Describing 12 photos with Gemini Nano')).toBeInTheDocument();
    useIndexing.setState({ activity: { stage: 'caption', count: 1 } });
    expect(await screen.findByText('Describing 1 photo with Gemini Nano')).toBeInTheDocument();
    expect(screen.getByText('22 items left')).toBeInTheDocument();
    // while a source is still finding items: "so far", no ETA (20 section 13.5)
    useIndexing.setState({ counting: true, done: 128, total: 5_670, etaMs: 44 * 60_000 });
    expect(await screen.findByText('128 of 5,670 items so far. Still finding more.')).toBeInTheDocument();
    expect(screen.queryByText(/about 44 min left/)).toBeNull();
    await expectNoAxeViolations();
    view.unmount();
  });

  it('paused on battery: says so, and the header Resume indexes anyway', async () => {
    const user = userEvent.setup();
    fake.rows = [row('folder', { progress: { done: 2, total: 9 }, folderName: 'Taxes' })];
    useIndexing.setState({ state: 'paused', pausedBy: 'battery', left: 7, done: 2, total: 9, onBattery: true });
    renderSources();
    expect(await screen.findByText(SOURCES.batteryText)).toBeInTheDocument();
    expect(screen.getByText('Paused on battery. Plug in, or press Resume to index anyway.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: SOURCES.pausedTitle })).toBeInTheDocument();
    // the card's own Resume is for the Ask home; here the header button is the one
    expect(screen.queryByRole('button', { name: SOURCES.batteryResume })).not.toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: SOURCES.resume }));
    expect(actions.setPaused).toHaveBeenCalledWith(false);
  });

  it('the switch "Describe photos with Gemini Nano" is on by default and saves on this device', async () => {
    const user = userEvent.setup();
    const set = vi.spyOn(useSettings.getState(), 'setDescribePhotos');
    useSettings.setState({ describePhotos: true, setDescribePhotos: set as unknown as (on: boolean) => Promise<void> });
    set.mockImplementation(async (on: boolean) => {
      useSettings.setState({ describePhotos: on });
    });
    renderSources();
    const sw = await screen.findByRole('switch', { name: SOURCES.describePhotos });
    expect(sw).toBeChecked();
    expect(sw).toHaveAccessibleDescription(SOURCES.describePhotosHelp);
    await user.click(sw);
    expect(set).toHaveBeenCalledWith(false);
    expect(sw).not.toBeChecked();
    set.mockRestore();
  });

  it('says the index is up to date with the last sync time', async () => {
    fake.rows = [row('gmail', { lastSyncAt: NOW - 5 * 60_000 }), row('folder', { lastSyncAt: NOW - 3_600_000 })];
    renderSources();
    expect(await screen.findByText(SOURCES.idleTitle)).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Last updated 5 minutes ago')).toBeInTheDocument();
    expect(within(card('Gmail')).getByText(SOURCES.upToDateGmail)).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('asks Google again when Gmail needs a new sign-in, and retries a source with an error', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail', { needsAuth: true }), row('folder', { error: "Couldn't read the folder.", folderName: 'Taxes' })];
    renderSources();
    const gmail = card('Gmail');
    expect(await within(gmail).findByText(SOURCES.needsAuthGmail)).toBeInTheDocument();
    await user.click(within(gmail).getByRole('button', { name: SOURCES.continue }));
    expect(actions.reauthorize).toHaveBeenCalledWith('gmail');
    const folder = card('Local folder');
    expect(within(folder).getByText("Couldn't read the folder.")).toBeInTheDocument();
    await user.click(within(folder).getByRole('button', { name: SOURCES.tryAgain }));
    expect(actions.connect).toHaveBeenCalledWith('folder');
    await expectNoAxeViolations();
  });

  it('asks Chrome again for a folder it can no longer read', async () => {
    const user = userEvent.setup();
    fake.rows = [row('folder', { needsAuth: true, folderName: 'Taxes' })];
    renderSources();
    const folder = card('Local folder');
    expect(
      await within(folder).findByText((_, el) => el?.textContent === 'Chrome needs your OK to read "Taxes" again.' && el.children.length === 1),
    ).toBeInTheDocument();
    await user.click(within(folder).getByRole('button', { name: SOURCES.allowAgain }));
    expect(actions.reauthorize).toHaveBeenCalledWith('folder');
  });

  it('confirms before disconnecting, with the item count and the Google account note', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail')];
    fake.records = records('gmail', 'Work', 7);
    renderSources();
    await user.click(await within(card('Gmail')).findByRole('button', { name: SOURCES.disconnect }));
    const dialog = screen.getByRole('dialog', { name: fillText(SOURCES.disconnectTitle, { name: 'Gmail' }) });
    expect(
      within(dialog).getByText(`${fillText(SOURCES.disconnectBody, { n: '7', name: 'Gmail' })} ${SOURCES.disconnectGmailExtra}`),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
    await user.click(within(dialog).getByRole('button', { name: SOURCES.disconnectConfirm }));
    expect(actions.disconnect).toHaveBeenCalledWith('gmail');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirms before rebuilding the index', async () => {
    const user = userEvent.setup();
    fake.rows = [row('folder')];
    renderSources();
    await user.click(await screen.findByRole('button', { name: SOURCES.rebuild }));
    const dialog = screen.getByRole('dialog', { name: SOURCES.rebuildTitle });
    expect(within(dialog).getByText(SOURCES.rebuildBody)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: SOURCES.rebuildConfirm }));
    expect(actions.rebuild).toHaveBeenCalledOnce();
  });

  it('checks files before adding them and shows what could not be added', async () => {
    const user = userEvent.setup({ applyAccept: false });
    fake.rows = [row('upload')];
    fake.records = records('upload', 'Personal', 2);
    const view = renderSources();
    const upload = card('Files you add');
    expect(await within(upload).findByText('2 files')).toBeInTheDocument();
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

  it('expands a category to its newest titles and shows each rule', async () => {
    const user = userEvent.setup();
    fake.rows = [row('gmail')];
    fake.records = [...records('gmail', 'Home', 7), ...records('gmail', 'Health', 1)];
    renderSources();
    const aside = screen.getByRole('complementary', { name: SOURCES.categoriesLabel });
    const home = await within(aside).findByRole('button', { name: /^Home 7 items$/ });
    expect(home).toHaveAttribute('aria-expanded', 'false');
    await user.click(home);
    expect(home).toHaveAttribute('aria-expanded', 'true');
    const titles = await within(aside).findAllByText(/^Home item \d$/);
    expect(titles.map((t) => t.textContent)).toEqual(['Home item 1', 'Home item 2', 'Home item 3', 'Home item 4', 'Home item 5']);
    await user.click(within(aside).getByRole('button', { name: /^Travel 0 items$/ }));
    expect(await within(aside).findByText(SOURCES.categoryEmpty)).toBeInTheDocument();
    expect(within(aside).getAllByText('Never shared').length).toBeGreaterThan(0);
    expect(within(aside).getAllByText('Ask first').length).toBeGreaterThan(0);
    await expectNoAxeViolations();
  });
});
