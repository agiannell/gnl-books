import type { GoalSummary } from './queries.ts';

/** This year's reading goal as a progress bar with the numbers beside it. */
export default function GoalProgress({ goal }: { goal: GoalSummary }) {
  const { year, target, booksRead } = goal;
  const label = `${year} goal: ${booksRead} of ${target} ${target === 1 ? 'book' : 'books'}`;
  return (
    <p>
      <label>
        {label}
        {booksRead >= target && ' ✓'}{' '}
        {/* A bar cannot show more than full. */}
        <progress value={Math.min(booksRead, target)} max={target} />
      </label>
    </p>
  );
}
