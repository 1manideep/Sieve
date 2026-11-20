import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { makeFakeDb, SAMPLE_RECORDS } from '../__fixtures__/fakeDb';
import { ItemViewer } from './ItemViewer';

const db = makeFakeDb('playground');

vi.mock('@/index', () => ({
  openDb: () => db,
  getRecord: (d: typeof db, id: string) => d.table('records').get(id),
}));

beforeAll(async () => {
  await db.table('records').bulkPut(SAMPLE_RECORDS);
  await db.table('blobs').put({ id: 'playground:pg-photo-01', blob: new Blob(['x']), thumb: new Blob(['t'], { type: 'image/jpeg' }) });
});

describe('ItemViewer', () => {
  it('opens an item on the device: title, meta, category and its text as text', async () => {
    const onClose = vi.fn();
    render(<main><ItemViewer dbKind="playground" recordId="playground:pg-mail-02" onClose={onClose} /></main>);
    expect(await screen.findByRole('dialog', { name: 'Re: Deposit for the apartment' })).toBeInTheDocument();
    expect(screen.getByText('Only on this device')).toBeInTheDocument();
    expect(screen.getByText('From: Dana Whitfield · Oct 29, 2026')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Item text' })).toHaveTextContent('We received your security deposit of $1,200 on March 3.');
    await expectNoAxeViolations();
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows removed hidden text and a flagged instruction', async () => {
    render(<main><ItemViewer dbKind="playground" recordId="playground:pg-mail-30" onClose={() => undefined} /></main>);
    expect(await screen.findByText('Hidden text removed')).toBeInTheDocument();
    expect(screen.getByText('Sieve removed this before any model read the item.')).toBeInTheDocument();
    expect(screen.getByText('Flagged as a possible instruction to an AI')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('a photo shows its caption with where it was made; a missing item says so', async () => {
    const { unmount } = render(<main><ItemViewer dbKind="playground" recordId="playground:pg-photo-01" onClose={() => undefined} /></main>);
    expect(await screen.findByText('A man with five hot dogs in his mouth at a backyard party.')).toBeInTheDocument();
    expect(screen.getByText('Captioned beforehand')).toBeInTheDocument();
    unmount();
    render(<main><ItemViewer dbKind="playground" recordId="playground:gone" onClose={() => undefined} /></main>);
    expect(await screen.findByRole('dialog', { name: "This item isn't on this device anymore." })).toBeInTheDocument();
  });

  it('renders nothing without a record id', () => {
    const { container } = render(<ItemViewer dbKind="playground" recordId={null} onClose={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
