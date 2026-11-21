// CategoryIcon: one line icon per category (design handoff of Nov 20, 2026), bare, with no disc behind it. A
// category whose rule is "never" is drawn in the never colour. CATEGORY_COLORS are the nine category colours of the
// Sources grid.
import type { Category } from '@sieve/shared';

const SHAPES: Record<Category, string> = {
  Home: 'M4.5 10.5L12 4.5l7.5 6V19a1 1 0 0 1-1 1H15v-5.5H9V20H5.5a1 1 0 0 1-1-1z',
  Work: 'M5.5 8h13A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-8A1.5 1.5 0 0 1 5.5 8zM9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8M4 13h16',
  Money: 'M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM3 10h18M7 14.5h4',
  Health: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  Travel: 'M12 3c.9 0 1.5.9 1.5 2v4.5l6.5 4v2l-6.5-2v4l2 1.5V21L12 20l-3.5 1v-1.5l2-1.5v-4l-6.5 2v-2l6.5-4V5c0-1.1.6-2 1.5-2z',
  Shopping: 'M6 8h12l-.9 11.1a1 1 0 0 1-1 .9H7.9a1 1 0 0 1-1-.9zM9 10V7a3 3 0 0 1 6 0v3',
  Personal: 'M12 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7zM5 20c.6-3.4 3.4-5.5 7-5.5s6.4 2.1 7 5.5',
  Newsletters: 'M6 5h10a1 1 0 0 1 1 1v13H7a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1zM17 9h2v8a2 2 0 0 1-2 2M8.5 9h5M8.5 12.5h5M8.5 16h3',
  Photos: 'M4 9a1.5 1.5 0 0 1 1.5-1.5h2.5L9.5 5.5h5L16 7.5h2.5A1.5 1.5 0 0 1 20 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 10a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 0 1 0-6.4z',
};

export const CATEGORY_COLORS: Record<Category, string> = {
  Home: '#A8C7FA',
  Work: '#D3B4FA',
  Money: '#81C995',
  Health: '#F6AEA9',
  Travel: '#78D9EC',
  Shopping: '#FBB6D9',
  Personal: '#FCC08B',
  Newsletters: '#C4C7C5',
  Photos: '#F9E08B',
};

export interface CategoryIconProps {
  category: Category;
  size?: number;
  /** The never colour: this category is never shared. */
  never?: boolean;
}

export function CategoryIcon({ category, size = 18, never = false }: CategoryIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={never ? '#F28B82' : 'rgba(255, 255, 255, 0.88)'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path d={SHAPES[category]} />
    </svg>
  );
}
