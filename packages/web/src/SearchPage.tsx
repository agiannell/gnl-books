import { useApolloClient } from '@apollo/client/react';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { seriesLabel } from './format.ts';
import {
  ADD_TO_SHELF,
  IMPORT_BOOK,
  SEARCH_BOOKS,
  type SearchHit,
  type ShelfName,
} from './queries.ts';

// Matches the API's limit on a search.
const MAX_QUERY_LENGTH = 200;

const SHELF_BUTTONS: { shelf: ShelfName; label: string; done: string }[] = [
  { shelf: 'TO_READ', label: 'Want to read', done: 'Added to Want to read' },
  { shelf: 'CURRENTLY_READING', label: 'Reading now', done: 'Added to Reading now' },
  { shelf: 'READ', label: 'Already read', done: 'Added to Read' },
];

/** What happened the last time a button on this hit was pressed. */
type Outcome = { kind: 'adding' } | { kind: 'added'; text: string } | { kind: 'failed'; message: string };

function Hit({ hit, profileId }: { hit: SearchHit; profileId: string }) {
  const client = useApolloClient();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const seriesText = seriesLabel(hit);

  async function add(shelf: ShelfName, done: string) {
    if (!hit.sourceId) return;
    setOutcome({ kind: 'adding' });
    try {
      // Importing the same book twice returns the same id, so retrying is safe.
      const imported = await client.mutate<{ importBook: { id: string } }>({
        mutation: IMPORT_BOOK,
        variables: { sourceId: hit.sourceId },
      });
      const bookId = imported.data?.importBook.id;
      if (!bookId) throw new Error('The book could not be saved');
      await client.mutate({
        mutation: ADD_TO_SHELF,
        variables: { profileId, bookId, shelf },
      });
      setOutcome({ kind: 'added', text: done });
    } catch (error) {
      setOutcome({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <li>
      <strong>{hit.title}</strong>
      <div>by {hit.authors.join(', ')}</div>
      {seriesText && <div>{seriesText}</div>}
      {(hit.releaseYear || hit.pages) && (
        <div>{[hit.releaseYear, hit.pages && `${hit.pages} pages`].filter(Boolean).join(' · ')}</div>
      )}
      <div>
        {SHELF_BUTTONS.map(({ shelf, label, done }) => (
          <button
            key={shelf}
            type="button"
            disabled={!hit.sourceId || outcome?.kind === 'adding'}
            onClick={() => void add(shelf, done)}
          >
            {label}
          </button>
        ))}
      </div>
      {outcome?.kind === 'adding' && <p>Adding…</p>}
      {outcome?.kind === 'added' && <p role="status">{outcome.text}</p>}
      {outcome?.kind === 'failed' && <p role="alert">Something went wrong: {outcome.message}</p>}
    </li>
  );
}

/** Looks books up in the catalog and puts the one a reader picks on their shelf. */
export default function SearchPage() {
  const { profileId = '' } = useParams();
  const client = useApolloClient();
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until a search has run, so "no results" is not shown before anyone has searched.
  const [hits, setHits] = useState<{ query: string; books: SearchHit[] } | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    const query = text.trim();
    if (!query || searching) return;
    setSearching(true);
    setError(null);
    try {
      // Always ask the catalog: a second search for the same words should not be answered from a cache.
      const result = await client.query<{ searchBooks: SearchHit[] }>({
        query: SEARCH_BOOKS,
        variables: { query },
        fetchPolicy: 'network-only',
      });
      setHits({ query, books: result.data?.searchBooks ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  return (
    <>
      <h1>Find a book</h1>
      <form onSubmit={(event) => void search(event)}>
        <label>
          Title, author or ISBN{' '}
          <input value={text} maxLength={MAX_QUERY_LENGTH} onChange={(event) => setText(event.target.value)} />
        </label>{' '}
        <button type="submit" disabled={searching || !text.trim()}>
          Search
        </button>
      </form>
      {searching && <p>Searching…</p>}
      {error && <p role="alert">Something went wrong: {error}</p>}
      {hits &&
        !searching &&
        (hits.books.length === 0 ? (
          <p>No books found for “{hits.query}”.</p>
        ) : (
          <ul>
            {hits.books.map((hit) => (
              <Hit key={hit.sourceId ?? hit.title} hit={hit} profileId={profileId} />
            ))}
          </ul>
        ))}
      <p>
        Can’t find it? <Link to={`/p/${profileId}/add`}>Add it yourself</Link>
      </p>
      <p>
        <Link to={`/p/${profileId}`}>Back to the shelves</Link>
      </p>
    </>
  );
}
