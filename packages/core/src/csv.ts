import type { Db } from './db';
import { getProfile } from './profiles';
import { listShelf, type ShelfEntry } from './shelf';

/** Goodreads' export header, in its order. The import reads columns by name, but matching the order keeps the file unsurprising. */
export const GOODREADS_HEADER = [
  'Book Id',
  'Title',
  'Author',
  'Author l-f',
  'Additional Authors',
  'ISBN',
  'ISBN13',
  'My Rating',
  'Average Rating',
  'Publisher',
  'Binding',
  'Number of Pages',
  'Year Published',
  'Original Publication Year',
  'Date Read',
  'Date Added',
  'Bookshelves',
  'Bookshelves with positions',
  'Exclusive Shelf',
  'My Review',
  'Spoiler',
  'Private Notes',
  'Read Count',
  'Owned Copies',
] as const;

/** Quotes a field that contains a comma, quote or line break, doubling inner quotes. */
const field = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** `2026-11-09` to Goodreads' `2026/11/09`. */
const goodreadsDate = (date: string | null) => (date === null ? '' : date.replaceAll('-', '/'));

/** "Dav Pilkey" to "Pilkey, Dav". A single name stays as it is. */
export function lastFirst(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
}

function row(entry: ShelfEntry): string {
  const { book } = entry;
  const [first = '', ...others] = book.authors;
  // Our shelf names are Goodreads' own, and its import has a long-standing bug
  // where `Exclusive Shelf` alone is ignored, so the shelf goes in both columns.
  const bookshelves = [entry.shelf, ...entry.tags].join(', ');
  return [
    '', // Book Id: Goodreads assigns its own
    book.title,
    first,
    lastFirst(first),
    others.join(', '),
    book.isbn10,
    book.isbn13,
    entry.rating ?? 0,
    '', // Average Rating: not ours to know
    book.publisher,
    book.binding,
    book.pages,
    book.releaseYear,
    '', // Original Publication Year: we do not hold it separately
    goodreadsDate(entry.dateRead),
    goodreadsDate(entry.dateAdded),
    bookshelves,
    '', // Bookshelves with positions
    entry.shelf,
    entry.review,
    '', // Spoiler
    '', // Private Notes
    entry.readCount,
    entry.owned ? 1 : 0,
  ]
    .map(field)
    .join(',');
}

/** The Goodreads import file for a list of entries: a header row, then one row per entry, oldest added first. */
export function toGoodreadsCsv(entries: readonly ShelfEntry[]): string {
  const ordered = [...entries].sort((a, b) => a.dateAdded.localeCompare(b.dateAdded) || a.id.localeCompare(b.id));
  return [GOODREADS_HEADER.join(','), ...ordered.map(row)].join('\n') + '\n';
}

/** One profile's whole shelf as a Goodreads CSV, or `undefined` when the profile is not in this family. */
export async function exportGoodreadsCsv(db: Db, familyId: string, profileId: string): Promise<string | undefined> {
  if (!(await getProfile(db, familyId, profileId))) return undefined;
  return toGoodreadsCsv(await listShelf(db, familyId, profileId));
}
