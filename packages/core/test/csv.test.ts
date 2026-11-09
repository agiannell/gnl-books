import { describe, expect, it } from 'vitest';
import { GOODREADS_HEADER, lastFirst, toGoodreadsCsv } from '../src/csv';
import type { ShelfEntry } from '../src/shelf';

const entry = (over: Partial<ShelfEntry> = {}, book: Partial<ShelfEntry['book']> = {}): ShelfEntry => ({
  id: 'e-1',
  profileId: 'p-1',
  shelf: 'read',
  rating: 4,
  review: null,
  dateAdded: '2026-03-02',
  dateStarted: null,
  dateRead: '2026-03-09',
  readCount: 1,
  currentPage: null,
  owned: false,
  tags: [],
  book: {
    id: 'b-1',
    sourceId: '1',
    title: 'Dog Man',
    subtitle: null,
    authors: ['Dav Pilkey'],
    isbn13: '9780545581608',
    isbn10: '0545581605',
    pages: 240,
    releaseYear: 2016,
    coverUrl: null,
    seriesName: null,
    seriesPosition: null,
    description: null,
    publisher: 'Graphix',
    binding: 'Paperback',
    ...book,
  },
  ...over,
});

/** Minimal CSV reader (quotes, doubled quotes, newlines in quotes) so the tests check what a real importer would see. */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') (row.push(cell), (cell = ''));
    else if (c === '\n') (row.push(cell), rows.push(row), (row = []), (cell = ''));
    else cell += c;
  }
  return rows;
}

const asObjects = (csv: string) => {
  const [header, ...rows] = parse(csv);
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]])));
};

describe('lastFirst', () => {
  it('puts the last word first', () => {
    expect(lastFirst('Dav Pilkey')).toBe('Pilkey, Dav');
    expect(lastFirst('Ursula K. Le Guin')).toBe('Guin, Ursula K. Le');
  });

  it('leaves a single name alone', () => {
    expect(lastFirst('Plato')).toBe('Plato');
    expect(lastFirst('  Plato ')).toBe('Plato');
  });
});

describe('toGoodreadsCsv', () => {
  it('starts with the full Goodreads header, in order', () => {
    expect(toGoodreadsCsv([]).split('\n')[0]).toBe(
      'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies',
    );
    expect(GOODREADS_HEADER).toHaveLength(24);
  });

  it('writes a finished, rated book', () => {
    const [r] = asObjects(toGoodreadsCsv([entry({ review: 'Funny', owned: true })]));
    expect(r).toMatchObject({
      'Book Id': '',
      Title: 'Dog Man',
      Author: 'Dav Pilkey',
      'Author l-f': 'Pilkey, Dav',
      'Additional Authors': '',
      ISBN: '0545581605',
      ISBN13: '9780545581608',
      'My Rating': '4',
      Publisher: 'Graphix',
      Binding: 'Paperback',
      'Number of Pages': '240',
      'Year Published': '2016',
      'Date Read': '2026/03/09',
      'Date Added': '2026/03/02',
      'My Review': 'Funny',
      'Read Count': '1',
      'Owned Copies': '1',
    });
  });

  it('writes the shelf into both Bookshelves and Exclusive Shelf', () => {
    for (const shelf of ['to-read', 'currently-reading', 'read'] as const) {
      const [r] = asObjects(toGoodreadsCsv([entry({ shelf })]));
      expect(r).toMatchObject({ Bookshelves: shelf, 'Exclusive Shelf': shelf });
    }
  });

  it('adds custom shelves after the main shelf in Bookshelves only', () => {
    const [r] = asObjects(toGoodreadsCsv([entry({ tags: ['favorites', 'funny'] })]));
    expect(r).toMatchObject({ Bookshelves: 'read, favorites, funny', 'Exclusive Shelf': 'read' });
  });

  it('writes 0 for an unrated book and leaves absent values blank', () => {
    const [r] = asObjects(
      toGoodreadsCsv([
        entry(
          { shelf: 'to-read', rating: null, dateRead: null },
          { isbn10: null, isbn13: null, pages: null, releaseYear: null, publisher: null, binding: null },
        ),
      ]),
    );
    expect(r).toMatchObject({
      'My Rating': '0',
      'Date Read': '',
      ISBN: '',
      ISBN13: '',
      'Number of Pages': '',
      'Year Published': '',
      Publisher: '',
      Binding: '',
      'My Review': '',
      'Owned Copies': '0',
    });
  });

  it('puts authors past the first in Additional Authors', () => {
    const [r] = asObjects(toGoodreadsCsv([entry({}, { authors: ['Ann Lee', 'Bo Chan', 'Cy Doe'] })]));
    expect(r).toMatchObject({ Author: 'Ann Lee', 'Author l-f': 'Lee, Ann', 'Additional Authors': 'Bo Chan, Cy Doe' });
  });

  it('survives commas, quotes and line breaks in titles and reviews', () => {
    const title = 'Dog Man: "Fetch-22", Part 1';
    const review = 'Line one,\nline "two"\r\nline three';
    const [r] = asObjects(toGoodreadsCsv([entry({ review }, { title })]));
    expect(r).toMatchObject({ Title: title, 'My Review': review, 'Exclusive Shelf': 'read' });
  });

  it('writes one row per entry, oldest added first, ending in a newline', () => {
    const csv = toGoodreadsCsv([
      entry({ id: 'b', dateAdded: '2026-05-01' }, { title: 'Second' }),
      entry({ id: 'a', dateAdded: '2026-01-01' }, { title: 'First' }),
    ]);
    expect(asObjects(csv).map((r) => r.Title)).toEqual(['First', 'Second']);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('is just the header for an empty shelf', () => {
    expect(parse(toGoodreadsCsv([]))).toHaveLength(1);
  });
});
