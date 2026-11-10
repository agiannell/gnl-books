import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GoalProgress from '../src/GoalProgress.tsx';

const bar = () => screen.getByRole('progressbar') as HTMLProgressElement;

describe('GoalProgress', () => {
  it('shows how many of the year’s target are read, as numbers and as a bar', () => {
    render(<GoalProgress goal={{ year: 2026, target: 12, booksRead: 3 }} />);
    expect(screen.getByText('2026 goal: 3 of 12 books')).toBeTruthy();
    expect([bar().value, bar().max]).toEqual([3, 12]);
  });

  it('says "book" for a target of one', () => {
    render(<GoalProgress goal={{ year: 2026, target: 1, booksRead: 0 }} />);
    expect(screen.getByText('2026 goal: 0 of 1 book')).toBeTruthy();
  });

  it('marks a reached goal, and never fills the bar past full', () => {
    render(<GoalProgress goal={{ year: 2026, target: 5, booksRead: 7 }} />);
    expect(screen.getByText(/2026 goal: 7 of 5 books ✓/)).toBeTruthy();
    expect([bar().value, bar().max]).toEqual([5, 5]);
  });

  it('marks a goal reached exactly, not only one passed', () => {
    render(<GoalProgress goal={{ year: 2026, target: 5, booksRead: 5 }} />);
    expect(screen.getByText(/2026 goal: 5 of 5 books ✓/)).toBeTruthy();
  });

  it('does not mark a goal that is not reached', () => {
    render(<GoalProgress goal={{ year: 2026, target: 5, booksRead: 4 }} />);
    expect(screen.queryByText(/✓/)).toBeNull();
  });
});
