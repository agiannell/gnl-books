import { useQuery } from '@apollo/client/react';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatDate, seriesLabel, stars } from './format.ts';
import NotFound from './NotFound.tsx';
import {
  ADD_TO_SHELF,
  BOOK_PAGE,
  type BookPageData,
  type BookPageEntry,
  FINISH_BOOK,
  LOG_PROGRESS,
  RATE_BOOK,
  REVIEW_BOOK,
  type ShelfName,
} from './queries.ts';
import { type Edit, useEdit } from './useEdit.ts';

const SHELF_LABELS: Record<ShelfName, string> = {
  TO_READ: 'Want to read',
  CURRENTLY_READING: 'Reading now',
  READ: 'Read',
};

// Matches the API's limit on a review.
const MAX_REVIEW_CHARACTERS = 5000;

function Rating({ entry, edit, busy }: { entry: BookPageEntry; edit: Edit; busy: boolean }) {
  const rate = (rating: number | null) =>
    edit({ mutation: RATE_BOOK, variables: { shelfEntryId: entry.id, rating } });
  return (
    <section aria-labelledby="rating-heading">
      <h2 id="rating-heading">Rating</h2>
      <div>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
            aria-pressed={entry.rating === n}
            disabled={busy}
            onClick={() => void rate(n)}
          >
            {n <= (entry.rating ?? 0) ? '★' : '☆'}
          </button>
        ))}{' '}
        {entry.rating !== null && (
          <button type="button" disabled={busy} onClick={() => void rate(null)}>
            Clear rating
          </button>
        )}
      </div>
      {entry.rating !== null && <p>{stars(entry.rating)}</p>}
    </section>
  );
}

function Review({ entry, edit, busy }: { entry: BookPageEntry; edit: Edit; busy: boolean }) {
  const saved = entry.review ?? '';
  const [text, setText] = useState(saved);
  const changed = text.trim() !== saved;
  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">Review</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void edit({ mutation: REVIEW_BOOK, variables: { shelfEntryId: entry.id, review: text.trim() } });
        }}
      >
        <label>
          What did you think?{' '}
          <textarea value={text} maxLength={MAX_REVIEW_CHARACTERS} onChange={(event) => setText(event.target.value)} />
        </label>{' '}
        <button type="submit" disabled={busy || !changed}>
          Save review
        </button>
      </form>
    </section>
  );
}

function Progress({ entry, edit, busy }: { entry: BookPageEntry; edit: Edit; busy: boolean }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const page = text.trim();
    if (!/^\d+$/.test(page)) return setProblem('The page must be a whole number');
    setProblem(null);
    if (await edit({ mutation: LOG_PROGRESS, variables: { shelfEntryId: entry.id, page: Number(page) } })) setText('');
  }

  const { currentPage } = entry;
  return (
    <section aria-labelledby="progress-heading">
      <h2 id="progress-heading">Progress</h2>
      {currentPage !== null && (
        <p>{entry.book.pages ? `Page ${currentPage} of ${entry.book.pages}` : `Page ${currentPage}`}</p>
      )}
      <form onSubmit={(event) => void save(event)}>
        <label>
          I’m on page <input value={text} inputMode="numeric" onChange={(event) => setText(event.target.value)} />
        </label>{' '}
        <button type="submit" disabled={busy}>
          Save page
        </button>
      </form>
      {problem && <p role="alert">{problem}</p>}
    </section>
  );
}

function Finish({ entry, edit, busy }: { entry: BookPageEntry; edit: Edit; busy: boolean }) {
  const [date, setDate] = useState('');
  return (
    <section aria-labelledby="finish-heading">
      <h2 id="finish-heading">Finished?</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // No date means today, in the family's time zone: the API works that out.
          void edit({ mutation: FINISH_BOOK, variables: { shelfEntryId: entry.id, dateRead: date || null } });
        }}
      >
        <label>
          Date finished (optional) <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>{' '}
        <button type="submit" disabled={busy}>
          I finished it
        </button>
      </form>
    </section>
  );
}

/** A reader's copy of one book: where it is on their shelves, and everything they can change about it. */
export default function BookPage() {
  const { profileId = '', bookId = '' } = useParams();
  // Always ask again, so a change made elsewhere (or by someone else in the family) shows.
  const { data, loading, error } = useQuery<BookPageData>(BOOK_PAGE, {
    variables: { id: profileId },
    fetchPolicy: 'cache-and-network',
  });
  const { edit, busy, error: editError } = useEdit();

  if (error) return <p role="alert">Something went wrong: {error.message}</p>;
  if (loading || !data) return <p>Loading…</p>;
  if (!data.profile) return <NotFound />;

  const entry = data.profile.shelf.find((e) => e.book.id === bookId);
  if (!entry) {
    return (
      <>
        <h1>Book not found</h1>
        <p>This book is not on {data.profile.name}’s shelves.</p>
        <p>
          <Link to={`/p/${profileId}`}>Back to the shelves</Link>
        </p>
      </>
    );
  }

  const { book } = entry;
  const seriesText = seriesLabel(book);
  const move = (shelf: ShelfName) =>
    edit({ mutation: ADD_TO_SHELF, variables: { profileId, bookId: book.id, shelf } });

  return (
    <>
      <h1>{book.title}</h1>
      <p>by {book.authors.join(', ')}</p>
      {seriesText && <p>{seriesText}</p>}
      {(book.releaseYear || book.pages) && (
        <p>{[book.releaseYear, book.pages && `${book.pages} pages`].filter(Boolean).join(' · ')}</p>
      )}
      {book.description && <p>{book.description}</p>}

      <p>
        On {data.profile.name}’s shelf: <strong>{SHELF_LABELS[entry.shelf]}</strong>
        {entry.shelf === 'READ' && entry.dateRead && <> · Finished {formatDate(entry.dateRead)}</>}
      </p>
      {editError && <p role="alert">Something went wrong: {editError}</p>}

      {entry.shelf !== 'READ' && <Finish key={`finish-${entry.id}`} entry={entry} edit={edit} busy={busy} />}
      {entry.shelf !== 'READ' && <Progress key={`progress-${entry.id}`} entry={entry} edit={edit} busy={busy} />}
      <Rating entry={entry} edit={edit} busy={busy} />
      <Review key={`review-${entry.id}-${entry.review ?? ''}`} entry={entry} edit={edit} busy={busy} />

      <section aria-labelledby="move-heading">
        <h2 id="move-heading">Move to</h2>
        {(Object.keys(SHELF_LABELS) as ShelfName[])
          .filter((shelf) => shelf !== entry.shelf)
          .map((shelf) => (
            <button key={shelf} type="button" disabled={busy} onClick={() => void move(shelf)}>
              {SHELF_LABELS[shelf]}
            </button>
          ))}
      </section>

      <p>
        <Link to={`/p/${profileId}`}>Back to the shelves</Link>
      </p>
    </>
  );
}
