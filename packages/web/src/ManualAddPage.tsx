import { useApolloClient } from '@apollo/client/react';
import { type FormEvent, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ADD_MANUAL_BOOK, ADD_TO_SHELF, type ShelfName } from './queries.ts';

const SHELVES: { shelf: ShelfName; label: string }[] = [
  { shelf: 'TO_READ', label: 'Want to read' },
  { shelf: 'CURRENTLY_READING', label: 'Reading now' },
  { shelf: 'READ', label: 'Already read' },
];

/** A whole number from a text box, null when it is empty, or undefined when it is not a number. */
function wholeNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** For a book the catalog does not have: type it in and put it on the reader's shelf. */
export default function ManualAddPage() {
  const { profileId = '' } = useParams();
  const client = useApolloClient();
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [pages, setPages] = useState('');
  const [year, setYear] = useState('');
  const [shelf, setShelf] = useState<ShelfName>('TO_READ');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  // The book is saved before it is shelved. If shelving fails, trying again with the same
  // details must reuse that book: manual books are not matched up, so a second save would be a duplicate.
  const saved = useRef<{ key: string; bookId: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setAdded(null);
    const authorList = authors
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const pageCount = wholeNumber(pages);
    const releaseYear = wholeNumber(year);
    if (!title.trim()) return setError('Give the book a title');
    if (authorList.length === 0) return setError('Give at least one author');
    if (pageCount === undefined) return setError('Pages must be a whole number');
    if (releaseYear === undefined) return setError('Year must be a whole number');

    const input = { title: title.trim(), authors: authorList, pages: pageCount, releaseYear };
    const key = JSON.stringify(input);
    setError(null);
    setBusy(true);
    try {
      let bookId = saved.current?.key === key ? saved.current.bookId : undefined;
      if (!bookId) {
        const result = await client.mutate<{ addManualBook: { id: string } }>({
          mutation: ADD_MANUAL_BOOK,
          variables: { input },
        });
        bookId = result.data?.addManualBook.id;
        if (!bookId) throw new Error('The book could not be saved');
        saved.current = { key, bookId };
      }
      await client.mutate({ mutation: ADD_TO_SHELF, variables: { profileId, bookId, shelf } });
      const label = SHELVES.find((s) => s.shelf === shelf)!.label;
      setAdded(`Added “${input.title}” to ${label}`);
      saved.current = null;
      setTitle('');
      setAuthors('');
      setPages('');
      setYear('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Add a book yourself</h1>
      <form onSubmit={(event) => void submit(event)}>
        <p>
          <label>
            Title <input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Authors, separated by commas{' '}
            <input value={authors} onChange={(e) => setAuthors(e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Pages (optional){' '}
            <input value={pages} inputMode="numeric" onChange={(e) => setPages(e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Year published (optional){' '}
            <input value={year} inputMode="numeric" onChange={(e) => setYear(e.target.value)} />
          </label>
        </p>
        <p>
          <label>
            Shelf{' '}
            <select value={shelf} onChange={(e) => setShelf(e.target.value as ShelfName)}>
              {SHELVES.map((s) => (
                <option key={s.shelf} value={s.shelf}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </p>
        <button type="submit" disabled={busy}>
          Add book
        </button>
      </form>
      {busy && <p>Adding…</p>}
      {added && <p role="status">{added}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        <Link to={`/p/${profileId}/search`}>Back to search</Link> · <Link to={`/p/${profileId}`}>Back to the shelves</Link>
      </p>
    </>
  );
}
