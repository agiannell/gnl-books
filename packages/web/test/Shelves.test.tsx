import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ShelfItem } from '../src/queries.ts';
import Shelves from '../src/Shelves.tsx';

let n = 0;
const item = (over: Partial<Omit<ShelfItem, 'book'>> & { book?: Partial<ShelfItem['book']> } = {}): ShelfItem => {
  n += 1;
  const { book, ...rest } = over;
  return {
    id: `e-${n}`,
    shelf: 'TO_READ',
    rating: null,
    dateRead: null,
    currentPage: null,
    book: { id: `b-${n}`, title: `Book ${n}`, authors: ['Ann Lee'], pages: null, seriesName: null, seriesPosition: null, ...book },
    ...rest,
  };
};

const section = (title: RegExp) => within(screen.getByRole('region', { name: title }));

describe('Shelves', () => {
  it('lists the three shelves in reading order, each with a count', () => {
    render(<Shelves items={[]} />);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Reading now (0)',
      'Want to read (0)',
      'Read (0)',
    ]);
  });

  it('puts each book on its own shelf', () => {
    render(
      <Shelves
        items={[
          item({ shelf: 'READ', book: { title: 'Finished One' } }),
          item({ shelf: 'TO_READ', book: { title: 'Waiting One' } }),
          item({ shelf: 'CURRENTLY_READING', book: { title: 'Going One' } }),
          item({ shelf: 'TO_READ', book: { title: 'Waiting Two' } }),
        ]}
      />,
    );
    const titles = (name: RegExp) => section(name).queryAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
    expect(titles(/Reading now/)).toEqual(['Going One']);
    expect(titles(/Want to read/)).toEqual(['Waiting One', 'Waiting Two']);
    expect(titles(/^Read \(/)).toEqual(['Finished One']);
    expect(screen.getByRole('heading', { name: 'Want to read (2)' })).toBeTruthy();
  });

  it('says what an empty shelf is for, and only for that shelf', () => {
    render(<Shelves items={[item({ shelf: 'READ' })]} />);
    expect(section(/Reading now/).getByText('Nothing being read right now.')).toBeTruthy();
    expect(section(/Want to read/).getByText('No books waiting.')).toBeTruthy();
    expect(section(/^Read \(/).queryByText('No finished books yet.')).toBeNull();
  });

  it('names every author', () => {
    render(<Shelves items={[item({ book: { authors: ['Ann Lee', 'Bo Chan'] } })]} />);
    expect(screen.getByText('by Ann Lee, Bo Chan')).toBeTruthy();
  });

  it.each([
    [{ seriesName: 'Dog Man', seriesPosition: 2 }, 'Dog Man #2'],
    [{ seriesName: 'Dog Man', seriesPosition: 2.5 }, 'Dog Man #2.5'],
    [{ seriesName: 'Dog Man', seriesPosition: null }, 'Dog Man'],
  ])('shows the series as %j', (book, text) => {
    render(<Shelves items={[item({ book })]} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('shows no series line for a standalone book', () => {
    render(<Shelves items={[item({ book: { seriesName: null, seriesPosition: 3 } })]} />);
    expect(screen.queryByText(/#3/)).toBeNull();
  });

  it('shows how far a book being read has got, against its length when that is known', () => {
    render(
      <Shelves
        items={[
          item({ shelf: 'CURRENTLY_READING', currentPage: 120, book: { title: 'Known', pages: 240 } }),
          item({ shelf: 'CURRENTLY_READING', currentPage: 30, book: { title: 'Unknown', pages: null } }),
        ]}
      />,
    );
    expect(screen.getByText('Page 120 of 240')).toBeTruthy();
    expect(screen.getByText('Page 30')).toBeTruthy();
  });

  it('shows no page for a book being read that has none logged, or for a book not being read', () => {
    render(
      <Shelves
        items={[item({ shelf: 'CURRENTLY_READING', currentPage: null }), item({ shelf: 'TO_READ', currentPage: 5 })]}
      />,
    );
    expect(screen.queryByText(/Page/)).toBeNull();
  });

  it('shows a finished book’s stars and finish date', () => {
    render(<Shelves items={[item({ shelf: 'READ', rating: 4, dateRead: '2026-02-14' })]} />);
    const rating = screen.getByRole('img', { name: '4 out of 5 stars' });
    expect(rating.textContent).toBe('★★★★☆');
    expect(screen.getByText('Finished Feb 14, 2026')).toBeTruthy();
  });

  it('leaves out what a finished book does not have', () => {
    render(<Shelves items={[item({ shelf: 'READ', rating: null, dateRead: null })]} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/Finished/)).toBeNull();
  });

  it('does not show a rating or finish date on a book that is not finished', () => {
    render(<Shelves items={[item({ shelf: 'TO_READ', rating: 5, dateRead: '2026-01-01' })]} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/Finished/)).toBeNull();
  });
});
