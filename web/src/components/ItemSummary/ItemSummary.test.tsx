import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { healthBlocked, landlordReady, uploadNeedsConsent } from '../__fixtures__/proposals';
import { ItemSummary, senderName } from './ItemSummary';

describe('ItemSummary', () => {
  it('an email (the found-item chip): title, "From: {name} · {date}", kind, source, category, why this one, Open on this device', async () => {
    const onOpen = vi.fn();
    render(<main><ItemSummary item={landlordReady.item!} rule="approve" reason={'Picked "Re: Deposit for the apartment" and wrote the answer'} onOpen={onOpen} /></main>);
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Re: Deposit for the apartment' })).toBeInTheDocument();
    expect(screen.getByText(/^From:/).textContent).toBe('From: Dana Whitfield · Oct 29, 2026');
    expect(screen.getByText('Why this one:')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open on this device' }));
    expect(onOpen).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('a document shows only the date; a never item shows only the title and category', async () => {
    const { rerender } = render(<main><ItemSummary item={uploadNeedsConsent.item!} rule="approve" /></main>);
    expect(screen.getByText('Nov 18, 2026')).toBeInTheDocument();
    expect(screen.getByText('Document')).toBeInTheDocument();
    rerender(<main><ItemSummary item={healthBlocked.item!} rule="never" minimal /></main>);
    expect(screen.queryByText('Found on this device')).toBeNull();
    expect(screen.getByText('Never shared')).toBeInTheDocument();
    expect(screen.queryByText(/^From:/)).toBeNull();
    await expectNoAxeViolations();
  });

  it('takes the name part of a sender', () => {
    expect(senderName('Dana Whitfield <dana@x.example>')).toBe('Dana Whitfield');
    expect(senderName('"Bank, Inc." <a@b.example>')).toBe('Bank, Inc.');
    expect(senderName('<only@x.example>')).toBe('only@x.example');
  });
});
