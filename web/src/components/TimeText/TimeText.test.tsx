import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { formatDate, formatDayTime, formatRelative, TimeText } from './TimeText';

const NOW = new Date(2026, 10, 18, 15, 0).getTime();

describe('TimeText', () => {
  it('formats the four ways and renders a time element', async () => {
    expect(formatDayTime(new Date(2026, 10, 18, 14, 15).getTime(), NOW)).toBe('Today, 2:15 PM');
    expect(formatDayTime(new Date(2026, 10, 17, 9, 3).getTime(), NOW)).toBe('Yesterday, 9:03 AM');
    expect(formatDayTime(new Date(2026, 10, 12, 9, 3).getTime(), NOW)).toBe('Nov 12');
    expect(formatDayTime(new Date(2025, 10, 12, 9, 3).getTime(), NOW)).toBe('Nov 12, 2025');
    expect(formatDate(new Date(2026, 2, 3).getTime())).toBe('Mar 3, 2026');
    expect(formatRelative(new Date(2026, 10, 17, 12).getTime(), NOW)).toBe('yesterday');
    expect(formatRelative(new Date(2026, 8, 18).getTime(), NOW)).toBe('2 months ago');
    const at = new Date(2026, 2, 3).getTime();
    render(<main><TimeText at={at} format="date" /></main>);
    expect(screen.getByText('Mar 3, 2026').tagName).toBe('TIME');
    expect(screen.getByText('Mar 3, 2026')).toHaveAttribute('datetime', new Date(at).toISOString());
    await expectNoAxeViolations();
  });
});
